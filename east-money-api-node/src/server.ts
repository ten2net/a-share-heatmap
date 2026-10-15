/**
 * Fastify REST API 服务：东方财富自选股 + 行情
 * 凭据从环境变量 EASTMONEY_COOKIE / EASTMONEY_APPKEY 读取
 * （浏览器登录 quote.eastmoney.com 后 F12 → 网络请求里复制 Cookie 整串；
 *   cookie 值也可以是文件路径，与 Python 版一致）
 */
import Fastify, { type FastifyReply } from "fastify";
import cors from "@fastify/cors";

import { EastMoneyClient } from "./client.js";

const appkey = process.env.EASTMONEY_APPKEY ?? null;
const cookie = process.env.EASTMONEY_COOKIE ?? null;

// 未配置凭据时仍允许启动（/healthz 可用），其余端点会返回错误
const client = new EastMoneyClient({
  appkey,
  cookie: cookie || null,
});

const app = Fastify({ logger: true });

// 纯内网工具服务：允许任意来源的浏览器调用
await app.register(cors, { origin: true });

/** 统一错误响应 {error: message} */
function errorReply(reply: FastifyReply, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return reply.code(500).send({ error: message });
}

/**
 * 带 TTL 的读取缓存：东财首拉常有 10-20s 延迟，前端每次同步都冷拉会长时间无响应。
 * 同时做 in-flight 去重，避免并发请求各自穿透到东财。
 * invalidate() 清空全部条目，供写操作后立即失效使用。
 */
function createTtlCache<T>(ttlMs: number) {
  const entries = new Map<string, { value: T; expiresAt: number }>();
  const inflight = new Map<string, Promise<T>>();

  const run = async (key: string, load: () => Promise<T>): Promise<T> => {
    const cached = entries.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    const pending = inflight.get(key);
    if (pending) {
      return pending;
    }

    const promise = load()
      .then((loaded) => {
        entries.set(key, { value: loaded, expiresAt: Date.now() + ttlMs });
        return loaded;
      })
      .finally(() => {
        inflight.delete(key);
      });

    inflight.set(key, promise);
    return promise;
  };

  const invalidate = (key?: string) => {
    if (key === undefined) {
      entries.clear();
      return;
    }
    entries.delete(key);
  };

  return { run, invalidate };
}

// 自选股变动不频繁，缓存 60s 足以覆盖一次同步内的多次调用
const groupsCache = createTtlCache<Awaited<ReturnType<EastMoneyClient["getWatchlistGroups"]>>>(60_000);
const watchlistCache = createTtlCache<Awaited<ReturnType<EastMoneyClient["getWatchlist"]>>>(60_000);

/** 自选股缓存按分组 key 隔离，避免不同分组互相覆盖 */
function watchlistCacheKey(groupId: string | null, groupName: string | null) {
  return `gid:${groupId ?? ""}|name:${groupName ?? ""}`;
}

// 简单健康检查
app.get("/healthz", async () => "ok");

// ============ 自选股分组 ============

const groupBodySchema = {
  type: "object",
  required: ["name"],
  properties: { name: { type: "string", minLength: 1 } },
} as const;

app.post("/watchlist-groups", { schema: { body: groupBodySchema } }, async (req, reply) => {
  const { name } = req.body as { name: string };
  try {
    const ok = await client.createGroup(name);
    // 分组结构已变，缓存立即失效
    groupsCache.invalidate();
    watchlistCache.invalidate();
    return { success: ok };
  } catch (e) {
    return errorReply(reply, e);
  }
});

app.get("/watchlist-groups", async (_req, reply) => {
  try {
    return await groupsCache.run("all", () => client.getWatchlistGroups());
  } catch (e) {
    return errorReply(reply, e);
  }
});

app.delete("/watchlist-groups/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  try {
    const ok = await client.deleteGroup(id);
    groupsCache.invalidate();
    watchlistCache.invalidate();
    return { success: ok };
  } catch (e) {
    return errorReply(reply, e);
  }
});

// ============ 自选股 ============

const codesBodySchema = {
  type: "object",
  required: ["codes"],
  properties: {
    codes: { type: "array", items: { type: "string" }, minItems: 1 },
    groupId: { type: "string" },
    groupName: { type: "string" },
  },
} as const;

app.get("/watchlist", async (req, reply) => {
  const { groupId, groupName } = req.query as { groupId?: string; groupName?: string };
  try {
    // 按分组分别缓存，避免不同分组互相串数据
    return await watchlistCache.run(watchlistCacheKey(groupId ?? null, groupName ?? null), () =>
      client.getWatchlist(groupId ?? null, groupName ?? null)
    );
  } catch (e) {
    return errorReply(reply, e);
  }
});

app.post("/watchlist", { schema: { body: codesBodySchema } }, async (req, reply) => {
  const body = req.body as { codes: string[]; groupId?: string; groupName?: string };
  try {
    const ok = await client.addToWatchlist(body.codes, body.groupId ?? null, body.groupName ?? null);
    watchlistCache.invalidate();
    return { success: ok };
  } catch (e) {
    return errorReply(reply, e);
  }
});

app.delete("/watchlist", { schema: { body: codesBodySchema } }, async (req, reply) => {
  const body = req.body as { codes: string[]; groupId?: string; groupName?: string };
  try {
    const ok = await client.removeFromWatchlist(body.codes, body.groupId ?? null, body.groupName ?? null);
    watchlistCache.invalidate();
    return { success: ok };
  } catch (e) {
    return errorReply(reply, e);
  }
});

// ============ 行情 ============

app.get("/quotes/:code", async (req, reply) => {
  const { code } = req.params as { code: string };
  try {
    const quote = await client.getQuote(code);
    if (!quote) {
      return reply.code(404).send({ error: `未找到行情: ${code}` });
    }
    return quote;
  } catch (e) {
    return errorReply(reply, e);
  }
});

const batchBodySchema = {
  type: "object",
  required: ["codes"],
  properties: { codes: { type: "array", items: { type: "string" }, minItems: 1 } },
} as const;

app.post("/quotes/batch", { schema: { body: batchBodySchema } }, async (req, reply) => {
  const { codes } = req.body as { codes: string[] };
  try {
    return await client.getBatchQuotes(codes);
  } catch (e) {
    return errorReply(reply, e);
  }
});

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

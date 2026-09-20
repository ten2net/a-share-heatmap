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
    return { success: ok };
  } catch (e) {
    return errorReply(reply, e);
  }
});

app.get("/watchlist-groups", async (_req, reply) => {
  try {
    return await client.getWatchlistGroups();
  } catch (e) {
    return errorReply(reply, e);
  }
});

app.delete("/watchlist-groups/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  try {
    const ok = await client.deleteGroup(id);
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
    return await client.getWatchlist(groupId ?? null, groupName ?? null);
  } catch (e) {
    return errorReply(reply, e);
  }
});

app.post("/watchlist", { schema: { body: codesBodySchema } }, async (req, reply) => {
  const body = req.body as { codes: string[]; groupId?: string; groupName?: string };
  try {
    const ok = await client.addToWatchlist(body.codes, body.groupId ?? null, body.groupName ?? null);
    return { success: ok };
  } catch (e) {
    return errorReply(reply, e);
  }
});

app.delete("/watchlist", { schema: { body: codesBodySchema } }, async (req, reply) => {
  const body = req.body as { codes: string[]; groupId?: string; groupName?: string };
  try {
    const ok = await client.removeFromWatchlist(body.codes, body.groupId ?? null, body.groupName ?? null);
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

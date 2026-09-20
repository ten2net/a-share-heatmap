/**
 * 东方财富云自选股 → 本站本地自选股的单向同步。
 * 固定使用东财分组「自选股」（按 groupName 匹配），同步后本地自选股与该分组内容一致。
 * 解析到的 groupId 缓存到 localStorage，避免每次拉取分组列表。
 */
import type { WatchlistExchange, WatchlistItem } from "@/lib/watchlist";

/** 固定使用的东财分组名称 */
export const emGroupName = "自选股";

// groupId 缓存键带版本号：早期下拉选择版本写入的同名旧值不再可信，直接弃用
const groupIdCacheKey = "emWatchlist:v2:groupId";
const legacyGroupIdCacheKey = "emWatchlist:groupId";
const apiBaseKey = "emWatchlist:apiBase";

/** Fastify 服务地址：localStorage 覆盖 > NEXT_PUBLIC_EM_API_URL > 缺省值 */
export const defaultEmApiBase = "http://localhost:8787";

export type EmWatchlistGroup = {
  id: string;
  name: string;
  count?: number;
};

type EmStock = {
  code?: unknown;
  name?: unknown;
  market?: unknown;
  full_code?: unknown;
};

export type EmSyncResult =
  | { ok: true; items: WatchlistItem[]; syncedAt: string }
  | { ok: false; error: string; syncedAt: string };

function storage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

/** 当前生效的东财 API 服务地址 */
export function getEmApiBase(): string {
  const override = storage()?.getItem(apiBaseKey)?.trim();
  if (override) {
    return override.replace(/\/+$/, "");
  }

  const fromEnv = process.env.NEXT_PUBLIC_EM_API_URL?.trim();
  return (fromEnv || defaultEmApiBase).replace(/\/+$/, "");
}

/** 按名称「自选股」解析东财 groupId：先读缓存，未命中则拉取分组列表查找 */
export async function resolveEmGroupId(): Promise<string | null> {
  const store = storage();
  // 清理早期版本留下的未校验缓存
  store?.removeItem(legacyGroupIdCacheKey);

  const cached = store?.getItem(groupIdCacheKey)?.trim();
  if (cached) {
    return cached;
  }

  const groups = await fetchEmWatchlistGroups();
  const group = groups.find((g) => g.name === emGroupName);
  if (!group) {
    return null;
  }

  store?.setItem(groupIdCacheKey, group.id);
  return group.id;
}

/** 清除 groupId 缓存（服务端分组变动后下次重新解析） */
export function clearEmGroupIdCache() {
  storage()?.removeItem(groupIdCacheKey);
}

async function requestEmApi<T>(path: string): Promise<T> {
  const base = getEmApiBase();
  const url = `${base}${path}`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(`connect:${base}`);
  }

  if (!response.ok) {
    throw new Error(`http:${response.status}`);
  }

  const payload = (await response.json()) as T & { error?: unknown };
  if (payload && typeof payload === "object" && typeof payload.error === "string") {
    throw new Error(payload.error);
  }

  return payload;
}

/** 拉取东财自选股分组列表 */
export async function fetchEmWatchlistGroups(): Promise<EmWatchlistGroup[]> {
  const payload = await requestEmApi<unknown>("/watchlist-groups");
  if (!Array.isArray(payload)) {
    throw new Error("invalid");
  }

  const groups: EmWatchlistGroup[] = [];
  for (const item of payload as Array<{ id?: unknown; name?: unknown; count?: unknown }>) {
    if (!item || typeof item.id !== "string" || typeof item.name !== "string") {
      continue;
    }

    groups.push({
      id: item.id,
      name: item.name,
      count: typeof item.count === "number" ? item.count : undefined,
    });
  }

  return groups;
}

/** 把东财代码规整成本站格式：sh600519 → 600519.SH */
export function normalizeEmStockCode(stock: EmStock): string | null {
  const rawCode = typeof stock.code === "string" ? stock.code.trim() : "";
  if (!rawCode) {
    return null;
  }

  // full_code / market 形如 sh600519 / sh；缺省时按代码段推断
  let market = "";
  const fullCode = typeof stock.full_code === "string" ? stock.full_code.trim().toLowerCase() : "";
  const marketField = typeof stock.market === "string" ? stock.market.trim().toLowerCase() : "";
  if (/^(sh|sz|bj)\d+$/.test(fullCode)) {
    market = fullCode.slice(0, 2);
  } else if (/^(sh|sz|bj)$/.test(marketField)) {
    market = marketField;
  } else if (/^(sh|sz|bj)\d+$/.test(rawCode.toLowerCase())) {
    const lower = rawCode.toLowerCase();
    market = lower.slice(0, 2);
    return `${lower.slice(2)}.${market.toUpperCase()}`;
  } else if (/^\d{6}$/.test(rawCode)) {
    const codeInt = parseInt(rawCode, 10);
    if (rawCode.startsWith("4") || rawCode.startsWith("8")) {
      market = "bj";
    } else if (codeInt >= 600000) {
      market = "sh";
    } else {
      market = "sz";
    }
  } else {
    return null;
  }

  const exchange = market.toUpperCase() as WatchlistExchange;
  return `${rawCode}.${exchange}`;
}

/** 拉取指定分组的自选股，并规整成本站 WatchlistItem */
export async function fetchEmGroupStocks(groupId: string): Promise<WatchlistItem[]> {
  const payload = await requestEmApi<unknown>(`/watchlist?groupId=${encodeURIComponent(groupId)}`);
  if (!Array.isArray(payload)) {
    throw new Error("invalid");
  }

  const items: WatchlistItem[] = [];
  const seen = new Set<string>();
  for (const stock of payload as EmStock[]) {
    const code = normalizeEmStockCode(stock ?? {});
    if (!code || seen.has(code)) {
      continue;
    }

    seen.add(code);
    const exchange = (code.split(".")[1] ?? "") as WatchlistExchange;
    items.push({
      code,
      // 东财该接口不返回 name，先留空，后续通过本站搜索接口补齐
      name: typeof stock.name === "string" ? stock.name.trim() : "",
      exchange: exchange === "SH" || exchange === "SZ" || exchange === "BJ" ? exchange : undefined,
    });
  }

  return backfillStockInfo(items);
}

/**
 * 用本站搜索接口（内置股票名册）补齐缺失的名称/板块信息。
 * 东财 gstkinfos 接口的 name 为空字符串，必须补齐，否则同步结果无名称可展示。
 */
async function backfillStockInfo(items: WatchlistItem[]): Promise<WatchlistItem[]> {
  const missing = items.filter((item) => !item.name);
  if (missing.length === 0) {
    return items;
  }

  const codeBySymbol = new Map(missing.map((item) => [item.code.split(".")[0], item.code]));
  const resolved = new Map<string, { name: string; boardName?: string; subBoardName?: string }>();
  const symbols = [...codeBySymbol.keys()];

  // 并发受限地逐个按代码精确匹配，避免一次性打满搜索接口
  const concurrency = 8;
  for (let i = 0; i < symbols.length; i += concurrency) {
    const chunk = symbols.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (symbol) => {
        try {
          const response = await fetch(
            `/api/heatmap/search?q=${encodeURIComponent(symbol)}&limit=4`,
          );
          if (!response.ok) {
            return;
          }

          const payload = (await response.json()) as {
            items?: Array<{ code?: unknown; name?: unknown; boardName?: unknown; subBoardName?: unknown }>;
          };
          const targetCode = codeBySymbol.get(symbol);
          const match = (payload.items ?? []).find((item) => item.code === targetCode);
          if (match && typeof match.name === "string" && match.name.trim()) {
            resolved.set(symbol, {
              name: match.name.trim(),
              boardName: typeof match.boardName === "string" ? match.boardName : undefined,
              subBoardName: typeof match.subBoardName === "string" ? match.subBoardName : undefined,
            });
          }
        } catch {
          // 单个代码补全失败不阻塞整体同步
        }
      }),
    );
  }

  return items.map((item) => {
    if (item.name) {
      return item;
    }

    const info = resolved.get(item.code.split(".")[0]);
    if (!info) {
      // 名册里查不到时退回代码本身，保证 name 非空（本地存储与渲染都依赖 name）
      return { ...item, name: item.code };
    }

    return { ...item, name: info.name, boardName: info.boardName, subBoardName: info.subBoardName };
  });
}

/**
 * 以远端为准合并：远端增的加进来、远端删的去掉；
 * 仍存在的条目保留本地的板块等信息。远端为空视为异常，不清空本地。
 */
export function resolveSyncedWatchlist(local: WatchlistItem[], remote: WatchlistItem[]): WatchlistItem[] {
  const localByCode = new Map(local.map((item) => [item.code, item]));
  const merged: WatchlistItem[] = [];
  const seen = new Set<string>();

  for (const item of remote) {
    if (seen.has(item.code)) {
      continue;
    }

    seen.add(item.code);
    const existing = localByCode.get(item.code);
    merged.push(existing ? { ...existing, name: item.name || existing.name } : item);
  }

  return merged;
}

/**
 * 执行一次同步：按名称「自选股」解析分组并拉取，以远端为准更新本地。
 * 返回合并后的本地列表；调用方负责写回存储。
 */
export async function syncFromEmGroup(local: WatchlistItem[]): Promise<EmSyncResult> {
  const syncedAt = new Date().toISOString();

  try {
    const groupId = await resolveEmGroupId();
    if (!groupId) {
      return { ok: false, error: "group-not-found", syncedAt };
    }

    const remote = await fetchEmGroupStocks(groupId);
    if (remote.length === 0) {
      // 远端返回空列表视为异常（凭据失效/分组被删等），不做清空，防止误删本地；
      // 同时清掉 groupId 缓存，下次重新按名称解析
      clearEmGroupIdCache();
      return { ok: false, error: "empty", syncedAt };
    }

    return { ok: true, items: resolveSyncedWatchlist(local, remote), syncedAt };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      syncedAt,
    };
  }
}

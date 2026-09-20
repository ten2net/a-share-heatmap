/**
 * 东方财富 API 客户端（api.py 的 TypeScript 移植版）
 * 基于 OpenClaw 原始代码重构
 */
import { readFileSync, existsSync } from "node:fs";

import type { Stock, StockQuote, WatchlistGroup } from "./models.js";

/** sleep 毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface EastMoneyClientOptions {
  appkey?: string | null;
  cookie?: string | null;
  token?: string | null;
}

export class EastMoneyClient {
  // API 基础地址
  static readonly BASE_URL = "http://myfavor.eastmoney.com/v4/webouter";
  static readonly QUOTE_URL = "http://push2.eastmoney.com/api/qt/stock/get";
  static readonly ULIST_URL = "https://push2.eastmoney.com/api/qt/ulist.np/get";

  static readonly HEADERS: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Referer: "https://quote.eastmoney.com/zixuan/",
  };

  private appkey: string | null;
  private token: string | null;
  /** 简易 cookie jar：key -> value */
  private cookies = new Map<string, string>();

  constructor(options: EastMoneyClientOptions = {}) {
    this.appkey = options.appkey ?? null;
    this.token = options.token ?? null;
    if (options.cookie) {
      this.parseCookie(options.cookie);
    }
  }

  /** 序列化 cookie jar 为请求头字符串 */
  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  /** 解析 Cookie 字符串（支持把 cookie 值当文件路径读取，与 Python 一致） */
  private parseCookie(cookieStr: string): void {
    cookieStr = cookieStr.trim();

    // 如果是文件路径，读取文件
    if ((cookieStr.startsWith("/") || cookieStr.length < 100) && existsSync(cookieStr)) {
      cookieStr = readFileSync(cookieStr, "utf-8").trim();
    }

    // 解析 key=value 对
    const cookies: Record<string, string> = {};
    for (const item of cookieStr.split(";")) {
      const trimmed = item.trim();
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        cookies[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
      }
    }

    for (const [k, v] of Object.entries(cookies)) {
      this.cookies.set(k, v);
    }

    // 提取常用 token（优先 ut，其次 em_token）
    if (cookies["ut"]) {
      this.token = cookies["ut"];
    } else if (cookies["em_token"]) {
      this.token = cookies["em_token"];
    }
  }

  /** 构建 API URL（JSONP 格式）；注意：会修改传入的 params（补 ut），与 Python 行为一致 */
  private buildUrl(action: string, params: Record<string, string | number>): string {
    const ts = Date.now() - 10;

    // 添加 ut 参数用于认证（EastMoney 部分接口需要）
    if (this.token && !("ut" in params)) {
      params["ut"] = this.token;
    }

    const base = this.appkey
      ? `${EastMoneyClient.BASE_URL}/${action}?appkey=${this.appkey}&cb=jQuery_${ts}&`
      : `${EastMoneyClient.BASE_URL}/${action}?cb=jQuery_${ts}&`;

    // URLSearchParams 会把空格编码为 +，与 Python urlencode 一致
    const paramStr = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)] as [string, string])
    ).toString();

    let url = base + paramStr + `&_=${ts}`;

    // 修复 URL 编码问题（东方财富特殊处理：要求 $ 不被编码）
    url = url.replace(/%24/g, "$");

    return url;
  }

  /** 带重试的 GET：东财偶发 502/空响应/断连，重试即可。线性退避 sleep min(2*(i+1),8)s */
  private async get(
    url: string,
    retries = 6,
    timeoutMs = 20000
  ): Promise<{ status: number; text: string }> {
    let last: Error | null = null;
    for (let i = 0; i < retries; i++) {
      try {
        const resp = await fetch(url, {
          headers: { ...EastMoneyClient.HEADERS, Cookie: this.cookieHeader() },
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await resp.text();
        if (resp.status === 200 && text.trim()) {
          return { status: resp.status, text };
        }
        last = new Error(resp.status === 200 ? `HTTP ${resp.status}: 空响应` : `HTTP ${resp.status}`);
      } catch (e) {
        last = e instanceof Error ? e : new Error(String(e));
      }
      await sleep(Math.min(2 * (i + 1), 8) * 1000);
    }
    throw last ?? new Error("请求失败");
  }

  /** 解析 JSONP 响应；东方财富 API: state=0 表示成功 */
  private parseJsonp<T>(resp: { status: number; text: string }): { ok: boolean; data: T | null } {
    if (resp.status !== 200) {
      throw new Error(`HTTP ${resp.status}: ${resp.text}`);
    }

    const text = resp.text.trim();

    // 提取 JSON 部分
    const start = text.indexOf("(");
    const end = text.lastIndexOf(")");
    try {
      let parsed: { state?: unknown; data?: unknown } | null;
      if (start !== -1 && end !== -1 && end > start) {
        parsed = JSON.parse(text.slice(start + 1, end));
      } else {
        // 尝试直接解析 JSON
        parsed = JSON.parse(text);
      }
      return { ok: (parsed?.state ?? 0) === 0, data: (parsed?.data ?? null) as T | null };
    } catch {
      return { ok: false, data: null };
    }
  }

  // ============ 自选股分组管理 ============

  /** 确保 CUToken cookie 存在，如果不存在则尝试获取 */
  private async ensureCutmToken(): Promise<void> {
    if (this.cookies.has("CUToken")) {
      return;
    }

    try {
      const ut = this.token ?? this.cookies.get("ut") ?? "";
      if (!ut) {
        return;
      }

      // 独立请求（不复用连接），失败非致命
      const resp = await fetch(
        `https://emweb.securities.eastmoney.com/pc_hsf10/pages/index.html?ut=${ut}`,
        {
          headers: {
            "User-Agent": EastMoneyClient.HEADERS["User-Agent"],
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": EastMoneyClient.HEADERS["Accept-Language"],
            Cookie: `ut=${ut}`,
          },
          redirect: "follow",
          signal: AbortSignal.timeout(10000),
        }
      );
      // 从响应 Set-Cookie 中提取 CUToken
      const setCookies = resp.headers.getSetCookie?.() ?? [];
      for (const sc of setCookies) {
        const [pair] = sc.split(";");
        const idx = pair.indexOf("=");
        if (idx !== -1 && pair.slice(0, idx).trim() === "CUToken") {
          this.cookies.set("CUToken", pair.slice(idx + 1).trim());
        }
      }
    } catch {
      // 获取 CUToken 失败（非致命）
    }
  }

  /** 获取所有自选股分组 */
  async getWatchlistGroups(): Promise<WatchlistGroup[]> {
    await this.ensureCutmToken();
    const url = this.buildUrl("ggdefstkindexinfos", { g: 1 });
    const resp = await this.get(url);

    const { data } = this.parseJsonp<{ ginfolist?: Array<Record<string, unknown>> }>(resp);
    if (data == null) {
      return [];
    }

    const groups: WatchlistGroup[] = [];
    for (const g of data.ginfolist ?? []) {
      groups.push({
        id: String(g.gid ?? ""),
        name: typeof g.gname === "string" ? g.gname : "",
        count: 0, // API 不返回 count，需要单独获取
      });
    }

    return groups;
  }

  /** 创建分组 */
  async createGroup(name: string): Promise<boolean> {
    await this.ensureCutmToken();
    const url = this.buildUrl("ag", { gn: name });
    const resp = await this.get(url);
    const { ok } = this.parseJsonp(resp);
    return ok;
  }

  /** 删除分组 */
  async deleteGroup(groupId: string): Promise<boolean> {
    await this.ensureCutmToken();
    const url = this.buildUrl("dg", { g: groupId });
    const resp = await this.get(url);
    const { ok } = this.parseJsonp(resp);
    return ok;
  }

  /** 根据名称获取分组 ID */
  async getGroupId(name: string): Promise<string | null> {
    const groups = await this.getWatchlistGroups();
    for (const g of groups) {
      if (g.name === name) {
        return g.id;
      }
    }
    return null;
  }

  // ============ 自选股管理 ============

  /** 获取自选股列表（group_id / group_name 二选一） */
  async getWatchlist(groupId?: string | null, groupName?: string | null): Promise<Stock[]> {
    await this.ensureCutmToken();
    if (!groupId && groupName) {
      groupId = await this.getGroupId(groupName);
    }

    if (!groupId) {
      console.warn(`未找到分组: ${groupName}`);
      return [];
    }

    const url = this.buildUrl("gstkinfos", { g: groupId });
    const resp = await this.get(url);

    const { data: result } = this.parseJsonp<{ stkinfolist?: Array<Record<string, unknown>> }>(resp);
    if (result == null) {
      return [];
    }

    const stocks: Stock[] = [];
    for (const item of result.stkinfolist ?? []) {
      // security 字段格式: "1$600519" 或 "0$000001" 或 "0$002491$10096287127286"
      const security = typeof item.security === "string" ? item.security : "";
      if (security.includes("$")) {
        const parts = security.split("$");
        const marketCode = parts[0];
        const code = parts[1];
        const market =
          (
            {
              "1": "sh",
              "0": "sz",
              "116": "hk",
              "105": "us",
              "90": "block",
              "112": "commodity",
              "102": "futures",
            } as Record<string, string>
          )[marketCode] ?? "sz";
        stocks.push({
          code,
          name: typeof item.stockName === "string" ? item.stockName : "",
          market,
          full_code: `${market}${code}`,
        });
      }
    }

    return stocks;
  }

  /** 添加股票到自选股 */
  async addToWatchlist(
    codes: string[],
    groupId?: string | null,
    groupName?: string | null
  ): Promise<boolean> {
    await this.ensureCutmToken();
    if (!groupId && groupName) {
      groupId = await this.getGroupId(groupName);
      if (!groupId) {
        // 尝试创建分组
        await this.createGroup(groupName);
        groupId = await this.getGroupId(groupName);
      }
    }

    if (!groupId) {
      console.error("未找到或创建分组");
      return false;
    }

    // 转换代码格式
    const emCodes = codes.map((c) => this.toEastmoneyCode(c));

    // 分批添加（每批最多45只）
    for (let i = 0; i < emCodes.length; i += 45) {
      const batch = emCodes.slice(i, i + 45);
      const url = this.buildUrl("aslot", { g: groupId, scs: batch.join(",") });
      const resp = await this.get(url);

      // 直接解析完整响应以获取 state 和 message
      try {
        const text = resp.text.trim();
        const start = text.indexOf("(");
        const end = text.lastIndexOf(")");
        const result =
          start !== -1 && end !== -1 && end > start
            ? JSON.parse(text.slice(start + 1, end))
            : JSON.parse(text);
        const state: number = result.state ?? 0;
        if (state === 0) {
          continue;
        }
        // state=-217 表示"该证券代码已存在"，视为成功
        if (state === -217) {
          continue;
        }
        console.error(
          `批量添加失败: ${batch}, state=${state}, message=${result.message ?? "unknown"}`
        );
        return false;
      } catch {
        console.error(`解析响应失败: ${resp.text.slice(0, 200)}`);
        return false;
      }
    }

    return true;
  }

  /** 从自选股中移除股票 */
  async removeFromWatchlist(
    codes: string[],
    groupId?: string | null,
    groupName?: string | null
  ): Promise<boolean> {
    await this.ensureCutmToken();
    if (!groupId && groupName) {
      groupId = await this.getGroupId(groupName);
    }

    if (!groupId) {
      return false;
    }

    // 转换代码格式
    const emCodes = codes.map((c) => this.toEastmoneyCode(c));

    const failed: string[] = [];
    for (const code of emCodes) {
      const url = this.buildUrl("ds", { g: groupId, sc: code });
      const resp = await this.get(url);

      const { ok } = this.parseJsonp(resp);
      if (!ok) {
        console.error(`删除失败: ${code}`);
        failed.push(code);
      }
    }

    if (failed.length > 0) {
      console.error(`${failed.length} 只删除失败: ${failed.join(",")}`);
      return false;
    }
    return true;
  }

  /** 清空分组 */
  async clearWatchlist(groupId?: string | null, groupName?: string | null): Promise<boolean> {
    const stocks = await this.getWatchlist(groupId, groupName);
    if (stocks.length === 0) {
      return true;
    }

    const codes = stocks.map((s) => s.code);
    return this.removeFromWatchlist(codes, groupId, groupName);
  }

  /** 将股票代码转换为东方财富格式：600519 -> 1$600519（上海），000001 -> 0$000001（深圳） */
  toEastmoneyCode(code: string): string {
    // 去除市场前缀
    if (/^(sh|sz|bj|hk|us)/.test(code)) {
      code = code.slice(2);
    }

    // 根据代码判断市场
    if (/^\d+$/.test(code)) {
      const codeInt = parseInt(code, 10);
      if ((codeInt >= 600000 && codeInt < 800000) || codeInt >= 880000) {
        return `1$${code}`; // 上海
      }
      return `0$${code}`; // 深圳
    }

    // 可能是港股或美股
    if (code.length === 5) {
      return `116$${code}`; // 港股
    }
    return `105$${code}`; // 美股
  }

  // ============ 行情接口 ============

  /** 获取单只股票行情（f43 等字段需 /100） */
  async getQuote(code: string): Promise<StockQuote | null> {
    // 处理带市场前缀的代码
    let market: string;
    let codeNum: string;
    if (/^(sh|sz|bj|hk|us)/.test(code)) {
      market = code.slice(0, 2);
      codeNum = code.slice(2);
    } else {
      codeNum = code;
      market = this.detectMarket(code);
    }

    const secid = this.getSecid(`${market}${codeNum}`);

    const url = `${EastMoneyClient.QUOTE_URL}?secid=${secid}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f170,f169,f168`;

    try {
      const resp = await fetch(url, {
        headers: { ...EastMoneyClient.HEADERS, Cookie: this.cookieHeader() },
        signal: AbortSignal.timeout(10000),
      });
      const json = (await resp.json()) as { data?: Record<string, unknown> };
      const data = json.data ?? {};

      if (!data) {
        return null;
      }

      // 解析字段（东方财富字段编码，需要除以100）
      return {
        code: codeNum,
        name: typeof data.f58 === "string" ? data.f58 : "",
        price: this.safeDiv100(data.f43),
        open: this.safeDiv100(data.f46),
        high: this.safeDiv100(data.f44),
        low: this.safeDiv100(data.f45),
        prev_close: this.safeDiv100(data.f60),
        change: this.safeDiv100(data.f169),
        change_pct: this.safeDiv100(data.f170),
        volume: this.safeInt(data.f47),
        amount: this.safeDiv10000(data.f48), // 成交额：元->万元
        turnover: this.safeDiv100(data.f168),
        volume_ratio: 0,
        market_cap: null,
        circulating_cap: null,
      };
    } catch (e) {
      console.error(`获取行情失败 ${code}: ${e}`);
      return null;
    }
  }

  /** 批量获取行情（fltt=2 字段不除 100），分批 100 只 */
  async getBatchQuotes(codes: string[]): Promise<StockQuote[]> {
    const results: StockQuote[] = [];

    // 标准化代码
    const fullCodes: string[] = [];
    for (const code of codes) {
      if (/^(sh|sz|bj|hk|us)/.test(code)) {
        fullCodes.push(code);
      } else {
        fullCodes.push(`${this.detectMarket(code)}${code}`);
      }
    }

    // 分批处理（每批最多 100 只）
    for (let i = 0; i < fullCodes.length; i += 100) {
      const batch = fullCodes.slice(i, i + 100);
      const secids = batch.map((c) => this.getSecid(c));

      const url =
        `${EastMoneyClient.ULIST_URL}?ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2` +
        `&fields=f12,f14,f2,f3,f4,f5,f6,f8,f10,f15,f16,f17,f18,f20,f21&secids=${secids.join(",")}`;

      try {
        const resp = await fetch(url, {
          headers: { ...EastMoneyClient.HEADERS, Cookie: this.cookieHeader() },
          signal: AbortSignal.timeout(10000),
        });
        const json = (await resp.json()) as { data?: { diff?: unknown[] } };

        for (const item of json.data?.diff ?? []) {
          const quote = this.parseUlistItem(item);
          if (quote) {
            results.push(quote);
          }
        }
      } catch (e) {
        console.error(`批量获取行情失败: ${e}`);
      }
    }

    return results;
  }

  /** 解析 ulist 接口数据（fltt=2 时 API 直接返回浮点数，不需要再除以 100） */
  private parseUlistItem(item: unknown): StockQuote | null {
    try {
      const record = item as Record<string, unknown>;
      const code = typeof record.f12 === "string" ? record.f12 : "";
      this.detectMarket(code);

      // 计算市值（元 -> 亿元）
      const totalCap = this.safeDiv100000000(record.f20); // 总市值
      const circulatingCapYi = this.safeDiv100000000(record.f21); // 流通市值

      return {
        code,
        name: typeof record.f14 === "string" ? record.f14 : "",
        price: this.safeFloat(record.f2),
        open: this.safeFloat(record.f17),
        high: this.safeFloat(record.f15),
        low: this.safeFloat(record.f16),
        prev_close: this.safeFloat(record.f18),
        change: this.safeFloat(record.f4),
        change_pct: this.safeFloat(record.f3),
        volume: this.safeInt(record.f5),
        amount: this.safeDiv10000(record.f6), // 金额保持除以10000(元->万元)
        turnover: this.safeFloat(record.f8),
        volume_ratio: this.safeFloat(record.f10), // f10 = 量比
        market_cap: totalCap > 0 ? totalCap : null,
        circulating_cap: circulatingCapYi > 0 ? circulatingCapYi : null,
      };
    } catch (e) {
      console.error(`解析行情数据失败: ${e}`);
      return null;
    }
  }

  // ============ 工具方法 ============

  /** 检测市场类型 */
  private detectMarket(code: string): string {
    if (code.length === 5) {
      return "hk";
    }
    if (/^[A-Za-z]+$/.test(code)) {
      return "us";
    }

    if (/^\d+$/.test(code)) {
      const codeInt = parseInt(code, 10);
      if (codeInt >= 600000 && codeInt < 800000) {
        return "sh";
      }
      if (codeInt >= 880000) {
        return "sh"; // 板块指数
      }
      return "sz";
    }
    return "sz";
  }

  /** 获取东方财富 secid：0.{code} 深市, 1.{code} 沪市, 105.{code} 美股, 116.{code} 港股 */
  private getSecid(fullCode: string): string {
    const market = fullCode.slice(0, 2);
    const code = fullCode.slice(2);

    const mapping: Record<string, string> = {
      sz: "0",
      sh: "1",
      bj: "0",
      us: "105",
      hk: "116",
    };

    return `${mapping[market] ?? "0"}.${code}`;
  }

  /** 安全转浮点数 */
  private safeFloat(val: unknown): number {
    if (val == null) {
      return 0;
    }
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
  }

  /** 安全除以100 */
  private safeDiv100(val: unknown): number {
    return this.safeFloat(val) / 100;
  }

  /** 安全除以10000 */
  private safeDiv10000(val: unknown): number {
    return this.safeFloat(val) / 10000;
  }

  /** 安全除以100000000（元转亿元） */
  private safeDiv100000000(val: unknown): number {
    return this.safeFloat(val) / 100000000;
  }

  /** 安全转整数 */
  private safeInt(val: unknown): number {
    return Math.trunc(this.safeFloat(val));
  }
}

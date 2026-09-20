import type { Stock, StockQuote, WatchlistGroup } from "./models.js";
export interface EastMoneyClientOptions {
    appkey?: string | null;
    cookie?: string | null;
    token?: string | null;
}
export declare class EastMoneyClient {
    static readonly BASE_URL = "http://myfavor.eastmoney.com/v4/webouter";
    static readonly QUOTE_URL = "http://push2.eastmoney.com/api/qt/stock/get";
    static readonly ULIST_URL = "https://push2.eastmoney.com/api/qt/ulist.np/get";
    static readonly HEADERS: Record<string, string>;
    private appkey;
    private token;
    /** 简易 cookie jar：key -> value */
    private cookies;
    constructor(options?: EastMoneyClientOptions);
    /** 序列化 cookie jar 为请求头字符串 */
    private cookieHeader;
    /** 解析 Cookie 字符串（支持把 cookie 值当文件路径读取，与 Python 一致） */
    private parseCookie;
    /** 构建 API URL（JSONP 格式）；注意：会修改传入的 params（补 ut），与 Python 行为一致 */
    private buildUrl;
    /** 带重试的 GET：东财偶发 502/空响应/断连，重试即可。线性退避 sleep min(2*(i+1),8)s */
    private get;
    /** 解析 JSONP 响应；东方财富 API: state=0 表示成功 */
    private parseJsonp;
    /** 确保 CUToken cookie 存在，如果不存在则尝试获取 */
    private ensureCutmToken;
    /** 获取所有自选股分组 */
    getWatchlistGroups(): Promise<WatchlistGroup[]>;
    /** 创建分组 */
    createGroup(name: string): Promise<boolean>;
    /** 删除分组 */
    deleteGroup(groupId: string): Promise<boolean>;
    /** 根据名称获取分组 ID */
    getGroupId(name: string): Promise<string | null>;
    /** 获取自选股列表（group_id / group_name 二选一） */
    getWatchlist(groupId?: string | null, groupName?: string | null): Promise<Stock[]>;
    /** 添加股票到自选股 */
    addToWatchlist(codes: string[], groupId?: string | null, groupName?: string | null): Promise<boolean>;
    /** 从自选股中移除股票 */
    removeFromWatchlist(codes: string[], groupId?: string | null, groupName?: string | null): Promise<boolean>;
    /** 清空分组 */
    clearWatchlist(groupId?: string | null, groupName?: string | null): Promise<boolean>;
    /** 将股票代码转换为东方财富格式：600519 -> 1$600519（上海），000001 -> 0$000001（深圳） */
    toEastmoneyCode(code: string): string;
    /** 获取单只股票行情（f43 等字段需 /100） */
    getQuote(code: string): Promise<StockQuote | null>;
    /** 批量获取行情（fltt=2 字段不除 100），分批 100 只 */
    getBatchQuotes(codes: string[]): Promise<StockQuote[]>;
    /** 解析 ulist 接口数据（fltt=2 时 API 直接返回浮点数，不需要再除以 100） */
    private parseUlistItem;
    /** 检测市场类型 */
    private detectMarket;
    /** 获取东方财富 secid：0.{code} 深市, 1.{code} 沪市, 105.{code} 美股, 116.{code} 港股 */
    private getSecid;
    /** 安全转浮点数 */
    private safeFloat;
    /** 安全除以100 */
    private safeDiv100;
    /** 安全除以10000 */
    private safeDiv10000;
    /** 安全除以100000000（元转亿元） */
    private safeDiv100000000;
    /** 安全转整数 */
    private safeInt;
}

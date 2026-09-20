/** 东方财富 API 的数据模型（对应 Python 版 models.py） */

export interface Stock {
  code: string;
  name: string;
  market: string;
  full_code: string;
}

export interface StockQuote {
  code: string;
  name: string;
  price: number;
  open: number;
  high: number;
  low: number;
  prev_close: number;
  change: number;
  change_pct: number;
  volume: number;
  amount: number; // 万元
  turnover: number;
  volume_ratio: number;
  market_cap: number | null; // 亿元
  circulating_cap: number | null; // 亿元
}

export interface WatchlistGroup {
  id: string;
  name: string;
  count: number;
}

import { describe, expect, it } from "vitest";

import { parseTencentQuoteBatch } from "@/lib/market-heatmap";

// 真实腾讯行情格式：字段以 "~" 分隔，第 38 位为换手率（百分比）。
function tencentQuote(symbol: string, name: string, price: string, changePct: string, turnoverRate: string) {
  const fields = Array(71).fill("");
  fields[1] = name;
  fields[3] = price;
  fields[4] = price;
  fields[30] = "20261030150000";
  fields[32] = changePct;
  fields[37] = "123456";
  fields[38] = turnoverRate;
  fields[44] = "80";
  fields[45] = "120";
  fields[57] = "123456";
  fields[62] = "12.5";
  fields[63] = "3.2";
  fields[70] = "8.8";
  return `v_${symbol}="${fields.join("~")}";`;
}

describe("腾讯行情解析", () => {
  it("解析第 38 位换手率，缺失时保持 undefined", () => {
    const raw = [
      tencentQuote("sz002602", "世纪华通", "11.79", "2.52", "1.63"),
      tencentQuote("sh600519", "贵州茅台", "1688.00", "-0.34", "0.34"),
      tencentQuote("sz000001", "平安银行", "10.30", "1.03", "-"),
    ].join("\n");

    const result = parseTencentQuoteBatch(raw);

    expect(result.quotes["002602.SZ"].turnoverRate).toBe(1.63);
    expect(result.quotes["600519.SH"].turnoverRate).toBe(0.34);
    // 缺失值不写成 0，以便区分“无数据”与“真实 0”。
    expect(result.quotes["000001.SZ"].turnoverRate).toBeUndefined();
    expect(result.quotes["002602.SZ"].changes).toMatchObject({ day: 2.52, week: 3.2, month: 8.8, year: 12.5 });
    expect(result.quotes["002602.SZ"].turnoverAmount).toBe(1_234_560_000);
  });

  it("为 baseline 内的股票生成带换手率的快照", () => {
    const result = parseTencentQuoteBatch(tencentQuote("sz002602", "世纪华通", "11.79", "2.52", "1.63"));
    const stock = result.stocks.find((item) => item.code === "002602.SZ");

    expect(stock).toBeDefined();
    expect(stock).toMatchObject({
      price: 11.79,
      changePct: 2.52,
      turnoverRate: 1.63,
      turnoverAmount: 1_234_560_000,
      totalMarketCap: 12_000_000_000,
      floatMarketCap: 8_000_000_000,
    });
  });
});

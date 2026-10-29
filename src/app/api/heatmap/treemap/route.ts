import { NextRequest, NextResponse } from "next/server";

import {
  getTreemapData,
  getTreemapDataByCodes,
  isHeatmapPeriodKey,
  isMarketKey,
  parseStockCodeList,
  PeriodDataUnavailableError,
} from "@/lib/market-heatmap";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const marketParam = request.nextUrl.searchParams.get("market") ?? "all";
  const periodParam = request.nextUrl.searchParams.get("period") ?? "day";
  const codes = parseStockCodeList(request.nextUrl.searchParams.get("codes"));

  if (!isHeatmapPeriodKey(periodParam)) {
    return NextResponse.json(
      {
        success: false,
        message: `Invalid period: ${periodParam}`,
      },
      { status: 400 }
    );
  }

  if (codes.length === 0 && !isMarketKey(marketParam)) {
    return NextResponse.json(
      {
        success: false,
        message: `Invalid market: ${marketParam}`,
      },
      { status: 400 }
    );
  }

  try {
    const data = codes.length > 0
      ? await getTreemapDataByCodes(codes, periodParam)
      : isMarketKey(marketParam)
        ? await getTreemapData(marketParam, periodParam)
        : null;

    if (!data) {
      return NextResponse.json(
        {
          success: false,
          message: `Invalid market: ${marketParam}`,
        },
        { status: 400 }
      );
    }
    const response = NextResponse.json(data);
    response.headers.set("Cache-Control", "public, s-maxage=6, stale-while-revalidate=10");

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to load treemap data",
      },
      { status: error instanceof PeriodDataUnavailableError ? 503 : 502 }
    );
  }
}

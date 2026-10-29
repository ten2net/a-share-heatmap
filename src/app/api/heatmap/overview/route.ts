import { NextRequest, NextResponse } from "next/server";

import { getOverviewData, isHeatmapPeriodKey, PeriodDataUnavailableError } from "@/lib/market-heatmap";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const periodParam = request.nextUrl.searchParams.get("period") ?? "day";

  if (!isHeatmapPeriodKey(periodParam)) {
    return NextResponse.json(
      {
        success: false,
        message: `Invalid period: ${periodParam}`,
      },
      { status: 400 }
    );
  }

  try {
    const data = await getOverviewData(periodParam);
    const response = NextResponse.json(data);
    response.headers.set("Cache-Control", "public, s-maxage=8, stale-while-revalidate=30");

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Failed to load overview data",
      },
      { status: error instanceof PeriodDataUnavailableError ? 503 : 502 }
    );
  }
}

import { NextResponse } from "next/server";

// Liveness probe: must stay dependency-free so a slow upstream market feed
// never marks the container unhealthy. Guards against the probe itself
// triggering a full-market quote fetch.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } }
  );
}

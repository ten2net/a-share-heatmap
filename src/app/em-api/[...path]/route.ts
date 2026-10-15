import { NextRequest } from "next/server";

/**
 * 同源反代：把 /em-api/* 转发到东财自选同步服务（east-money-api-node）。
 *
 * 前端 NEXT_PUBLIC_EM_API_URL=/em-api 是相对路径，不同入口的解析方不同：
 * - 经 nginx(:8088)/cloudflared 访问时由它们剥离前缀转发；
 * - 直连 web(:3000) 时没有该路由，会 404。
 * 这里补一条服务端转发，使直连 3000 端口也能同步。
 */

export const dynamic = "force-dynamic";

/** 目标地址：容器内用服务名，本地开发可覆盖 */
const proxyTarget = (process.env.EM_API_PROXY_TARGET || "http://em-api:8787").replace(/\/+$/, "");

function buildTargetUrl(request: NextRequest, path: string[]) {
  const suffix = path.map((segment) => encodeURIComponent(segment)).join("/");
  const search = request.nextUrl.search;
  return `${proxyTarget}/${suffix}${search}`;
}

async function forward(request: NextRequest, path: string[]) {
  const target = buildTargetUrl(request, path);

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    // 同步服务偶发慢响应，避免请求无限挂起
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    const body = await request.text();
    if (body) {
      init.body = body;
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    return Response.json(
      { error: `同步服务不可达（${proxyTarget}）：${detail}` },
      { status: 502 }
    );
  }

  // 透传响应体与关键响应头，避免 Next 缓存同步结果
  const responseHeaders = new Headers();
  const upstreamType = upstream.headers.get("content-type");
  if (upstreamType) {
    responseHeaders.set("Content-Type", upstreamType);
  }
  responseHeaders.set("Cache-Control", "no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return forward(request, path);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return forward(request, path);
}

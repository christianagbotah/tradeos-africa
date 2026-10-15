import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface AdminProxyContext {
  params: Promise<{ path: string[] }>;
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

async function proxyAdminRequest(request: NextRequest, context: AdminProxyContext): Promise<NextResponse> {
  const apiBase = process.env.API_BASE_URL?.trim();
  if (!apiBase) {
    return NextResponse.json({ message: "System Admin API is not configured" }, { status: 503 });
  }

  const { path } = await context.params;
  const target = new URL(`${apiBase.replace(/\/$/, "")}/api/admin/${path.map(encodeURIComponent).join("/")}`);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  for (const [name, value] of request.headers.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) headers.append(name, value);
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
    cache: "no-store",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  try {
    const upstream = await fetch(target, init);
    const responseHeaders = new Headers();
    for (const [name, value] of upstream.headers.entries()) {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) responseHeaders.append(name, value);
    }
    return new NextResponse(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return NextResponse.json({ message: "System Admin API is unavailable" }, { status: 502 });
  }
}

export const GET = proxyAdminRequest;
export const POST = proxyAdminRequest;
export const PUT = proxyAdminRequest;
export const PATCH = proxyAdminRequest;
export const DELETE = proxyAdminRequest;
export const OPTIONS = proxyAdminRequest;

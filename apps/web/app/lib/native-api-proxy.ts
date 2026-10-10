import { NextRequest, NextResponse } from "next/server";

const exactRoutes = new Map<string, ReadonlySet<string>>([
  ["v1/auth/login", new Set(["POST"])],
  ["v1/auth/refresh", new Set(["POST"])],
  ["v1/auth/logout", new Set(["POST"])],
  ["v1/me", new Set(["GET"])],
  ["v1/sync", new Set(["POST"])],
]);
const businessContextPattern = /^v1\/businesses\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/context$/i;

type NativeProxyDependencies = {
  apiBase?: string;
  fetchImpl?: typeof fetch;
};

export function isNativeApiRouteAllowed(method: string, path: string): boolean {
  const normalizedMethod = method.toUpperCase();
  const exactMethods = exactRoutes.get(path);
  if (exactMethods?.has(normalizedMethod)) return true;
  return normalizedMethod === "GET" && businessContextPattern.test(path);
}

export async function forwardNativeApi(
  request: NextRequest,
  apiPath: string,
  dependencies: NativeProxyDependencies = {},
): Promise<NextResponse> {
  const apiBase = (dependencies.apiBase ?? process.env.TRADEOS_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const headers: Record<string, string> = {};
  const authorization = request.headers.get("authorization");
  const contentType = request.headers.get("content-type");
  if (authorization) headers.authorization = authorization;
  if (contentType) headers["content-type"] = contentType;

  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
  const upstream = await fetchImpl(`${apiBase}${apiPath}`, {
    method: request.method,
    headers,
    ...(body !== undefined ? { body } : {}),
    cache: "no-store",
  });
  const text = await upstream.text();
  const upstreamContentType = upstream.headers.get("content-type");

  return new NextResponse(text || null, {
    status: upstream.status,
    ...(upstreamContentType ? { headers: { "content-type": upstreamContentType } } : {}),
  });
}
import { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "tradeos_access";
const REFRESH_COOKIE = "tradeos_refresh";
const API_BASE = (process.env.TRADEOS_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

type SessionPayload = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
};

export async function openSession(request: NextRequest, apiPath: "/v1/auth/register" | "/v1/auth/login") {
  const body = await request.text();
  const upstream = await fetch(`${API_BASE}${apiPath}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    cache: "no-store",
  });

  const text = await upstream.text();
  if (!upstream.ok) return responseFrom(upstream, text);

  const parsed = safeJson(text) as { user?: unknown; session?: SessionPayload } | null;
  if (!parsed?.session) {
    return NextResponse.json({ error: "INVALID_AUTH_RESPONSE", message: "Authentication service returned an invalid session." }, { status: 502 });
  }

  const response = NextResponse.json({ user: parsed.user ?? null }, { status: upstream.status });
  writeSessionCookies(response, parsed.session);
  return response;
}

export async function closeSession(request: NextRequest) {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  if (accessToken) {
    try {
      await fetch(`${API_BASE}/v1/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
    } catch {
      // Local logout must still succeed when the API is temporarily unreachable.
    }
  }

  const response = new NextResponse(null, { status: 204 });
  clearSessionCookies(response);
  return response;
}

export async function forwardAuthenticated(request: NextRequest, apiPath: string) {
  const requestBody = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ error: "AUTH_REQUIRED", message: "Please sign in to continue." }, { status: 401 });
  }

  let upstream = await callApi(request, apiPath, accessToken, requestBody);
  if (upstream.status !== 401) return responseFrom(upstream, await upstream.text());

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    const response = NextResponse.json({ error: "SESSION_EXPIRED", message: "Your session has expired. Please sign in again." }, { status: 401 });
    clearSessionCookies(response);
    return response;
  }

  const refresh = await fetch(`${API_BASE}/v1/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store",
  });
  if (!refresh.ok) {
    const response = NextResponse.json({ error: "SESSION_EXPIRED", message: "Your session has expired. Please sign in again." }, { status: 401 });
    clearSessionCookies(response);
    return response;
  }

  const refreshBody = (await refresh.json()) as { session?: SessionPayload };
  if (!refreshBody.session) {
    const response = NextResponse.json({ error: "SESSION_REFRESH_FAILED", message: "The session could not be refreshed." }, { status: 502 });
    clearSessionCookies(response);
    return response;
  }

  upstream = await callApi(request, apiPath, refreshBody.session.accessToken, requestBody);
  const response = responseFrom(upstream, await upstream.text());
  writeSessionCookies(response, refreshBody.session);
  return response;
}

function callApi(request: NextRequest, apiPath: string, accessToken: string, body?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` };
  const contentType = request.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;

  return fetch(`${API_BASE}${apiPath}`, {
    method: request.method,
    headers,
    ...(body !== undefined ? { body } : {}),
    cache: "no-store",
  });
}

function writeSessionCookies(response: NextResponse, session: SessionPayload) {
  response.cookies.set(ACCESS_COOKIE, session.accessToken, {
    ...cookieOptions,
    expires: new Date(session.accessExpiresAt),
  });
  response.cookies.set(REFRESH_COOKIE, session.refreshToken, {
    ...cookieOptions,
    expires: new Date(session.refreshExpiresAt),
  });
}

function clearSessionCookies(response: NextResponse) {
  response.cookies.set(ACCESS_COOKIE, "", { ...cookieOptions, maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}

function responseFrom(upstream: Response, text: string) {
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

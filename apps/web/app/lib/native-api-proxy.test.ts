import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { forwardNativeApi, isNativeApiRouteAllowed } from "./native-api-proxy";

const businessId = "11111111-1111-4111-8111-111111111111";

describe("native mobile API route policy", () => {
  it("allows only the mobile foundation methods and routes", () => {
    expect(isNativeApiRouteAllowed("POST", "v1/auth/login")).toBe(true);
    expect(isNativeApiRouteAllowed("POST", "v1/auth/refresh")).toBe(true);
    expect(isNativeApiRouteAllowed("POST", "v1/auth/logout")).toBe(true);
    expect(isNativeApiRouteAllowed("POST", "v1/sync")).toBe(true);
    expect(isNativeApiRouteAllowed("GET", "v1/me")).toBe(true);
    expect(isNativeApiRouteAllowed("GET", `v1/businesses/${businessId}/context`)).toBe(true);

    expect(isNativeApiRouteAllowed("GET", "v1/auth/login")).toBe(false);
    expect(isNativeApiRouteAllowed("POST", "v1/me")).toBe(false);
    expect(isNativeApiRouteAllowed("GET", "v1/catalog/items")).toBe(false);
    expect(isNativeApiRouteAllowed("GET", "v1/businesses/not-a-uuid/context")).toBe(false);
    expect(isNativeApiRouteAllowed("DELETE", `v1/businesses/${businessId}/context`)).toBe(false);
  });
});

describe("forwardNativeApi", () => {
  it("forwards bearer/content-type and body without cookies, preserving upstream response", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ accepted: true }), {
        status: 202,
        headers: { "content-type": "application/json", "x-upstream-secret": "do-not-forward" },
      });
    }) as typeof fetch;
    const request = new NextRequest("https://tradeosafrica.lightworldtech.com/api/mobile/v1/sync?cursor=next", {
      method: "POST",
      headers: {
        authorization: "Bearer mobile-token",
        "content-type": "application/json",
        cookie: "tradeos_access=browser-cookie",
        "x-untrusted": "drop-me",
      },
      body: JSON.stringify({ mutations: [] }),
    });

    const response = await forwardNativeApi(request, "/v1/sync?cursor=next", {
      apiBase: "http://127.0.0.1:4036",
      fetchImpl,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:4036/v1/sync?cursor=next");
    expect(calls[0]!.init).toMatchObject({ method: "POST", cache: "no-store" });
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers).toEqual({ authorization: "Bearer mobile-token", "content-type": "application/json" });
    expect(calls[0]!.init!.body).toBe(JSON.stringify({ mutations: [] }));
    expect(response.status).toBe(202);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-upstream-secret")).toBeNull();
    await expect(response.json()).resolves.toEqual({ accepted: true });
  });

  it("does not invent an authorization header for public login", async () => {
    let observedHeaders: HeadersInit | undefined;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      observedHeaders = init?.headers;
      return new Response(JSON.stringify({ session: { accessToken: "a" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const request = new NextRequest("https://tradeosafrica.lightworldtech.com/api/mobile/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "should-not-forward=true" },
      body: JSON.stringify({ identifier: "owner@example.com" }),
    });

    await forwardNativeApi(request, "/v1/auth/login", { apiBase: "http://127.0.0.1:4036", fetchImpl });

    expect(observedHeaders).toEqual({ "content-type": "application/json" });
  });
});
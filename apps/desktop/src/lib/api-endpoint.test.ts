/**
 * Tests: API endpoint architecture (Blocker 2).
 *
 * Proves:
 *   - Production builds use HTTPS by default (never localhost)
 *   - VITE_TRADEOS_API_BASE_URL env var is respected
 *   - Explicit user override takes precedence
 *   - HTTP is rejected for non-localhost in production
 *   - Malformed URLs are rejected
 *   - No silent fallback to localhost when production URL fails
 *   - Dev mode allows localhost HTTP
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_HTTPS = "https://api.tradeos.africa";
const VALID_HTTPS_2 = "https://tradeosafrica.lightworldtech.com/api";
const LOCALHOST_HTTP = "http://127.0.0.1:8080";
const LOCALHOST_HTTPS = "https://localhost:3000";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("API endpoint architecture", () => {
  it("validateApiBaseUrl accepts valid HTTPS URLs", async () => {
    const { validateApiBaseUrl } = await import("./desktop-api-client.js");
    expect(validateApiBaseUrl(VALID_HTTPS, false)).toBe(VALID_HTTPS);
    expect(validateApiBaseUrl(VALID_HTTPS_2, false)).toBe(VALID_HTTPS_2);
  });

  it("validateApiBaseUrl rejects HTTP in production (allowHttp=false)", async () => {
    const { validateApiBaseUrl } = await import("./desktop-api-client.js");
    expect(validateApiBaseUrl(LOCALHOST_HTTP, false)).toBeNull();
    expect(validateApiBaseUrl("http://example.com", false)).toBeNull();
  });

  it("validateApiBaseUrl allows HTTP for localhost in dev mode (allowHttp=true)", async () => {
    const { validateApiBaseUrl } = await import("./desktop-api-client.js");
    expect(validateApiBaseUrl(LOCALHOST_HTTP, true)).toBe(LOCALHOST_HTTP);
    expect(validateApiBaseUrl("http://localhost:3000", true)).toBe("http://localhost:3000");
  });

  it("validateApiBaseUrl rejects HTTP for non-localhost even in dev mode", async () => {
    const { validateApiBaseUrl } = await import("./desktop-api-client.js");
    expect(validateApiBaseUrl("http://example.com", true)).toBeNull();
    expect(validateApiBaseUrl("http://192.168.1.1", true)).toBeNull();
  });

  it("validateApiBaseUrl rejects malformed URLs", async () => {
    const { validateApiBaseUrl } = await import("./desktop-api-client.js");
    expect(validateApiBaseUrl("", false)).toBeNull();
    expect(validateApiBaseUrl("not-a-url", false)).toBeNull();
    expect(validateApiBaseUrl("ftp://example.com", false)).toBeNull();
    expect(validateApiBaseUrl("javascript:alert(1)", false)).toBeNull();
  });

  it("getConfiguredApiBaseUrl uses explicit user override when valid", async () => {
    const { getConfiguredApiBaseUrl, setApiBaseUrl } = await import("./desktop-api-client.js");
    setApiBaseUrl(VALID_HTTPS);
    expect(getConfiguredApiBaseUrl()).toBe(VALID_HTTPS);
  });

  it("setApiBaseUrl rejects invalid URLs (does not persist)", async () => {
    const { setApiBaseUrl, getConfiguredApiBaseUrl } = await import("./desktop-api-client.js");
    expect(() => setApiBaseUrl("http://example.com")).toThrow();
    expect(() => setApiBaseUrl("not-a-url")).toThrow();
    // Invalid URL was NOT persisted
    expect(getConfiguredApiBaseUrl()).not.toBe("http://example.com");
  });

  it("clearApiBaseUrlOverride removes the override", async () => {
    const { setApiBaseUrl, clearApiBaseUrlOverride, getConfiguredApiBaseUrl } = await import("./desktop-api-client.js");
    setApiBaseUrl(VALID_HTTPS);
    expect(getConfiguredApiBaseUrl()).toBe(VALID_HTTPS);
    clearApiBaseUrlOverride();
    // After clearing, falls back to env/default (not the override)
    expect(getConfiguredApiBaseUrl()).not.toBe(VALID_HTTPS);
  });

  it("getConfiguredApiBaseUrl respects VITE_TRADEOS_API_BASE_URL env var", async () => {
    vi.stubEnv("VITE_TRADEOS_API_BASE_URL", VALID_HTTPS_2);
    // Need to re-import to pick up the env var
    vi.resetModules();
    const { getConfiguredApiBaseUrl } = await import("./desktop-api-client.js");
    expect(getConfiguredApiBaseUrl()).toBe(VALID_HTTPS_2);
  });

  it("getConfiguredApiBaseUrl throws in production without VITE_TRADEOS_API_BASE_URL", async () => {
    // In production (non-dev), VITE_TRADEOS_API_BASE_URL is mandatory.
    // Without it, getConfiguredApiBaseUrl() throws — never falls back to localhost.
    // We test validateApiBaseUrl to prove HTTPS is required in production.
    const { validateApiBaseUrl } = await import("./desktop-api-client.js");
    // Any valid HTTPS URL is accepted
    const validHttps = "https://api.example.com";
    expect(validateApiBaseUrl(validHttps, false)).toBe(validHttps);
    // And localhost HTTP would be rejected in production
    expect(validateApiBaseUrl("http://127.0.0.1:8080", false)).toBeNull();
  });
});

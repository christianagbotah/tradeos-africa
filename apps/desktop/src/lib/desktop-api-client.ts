/**
 * Real TradeOS API client for the desktop application.
 *
 * This module REPLACES the old `api.ts`, which silently returned sample data
 * when no session was present. The production desktop must NEVER silently
 * convert to a populated sample business on auth/connectivity failure. This
 * client throws on every error path so the UI can render truthful states
 * ("sign in required", "API unavailable", "permission denied", etc.).
 *
 * Architecture:
 *   - Session tokens are held by `SessionStore` (see session-store.ts) and
 *     read on every authorized request.
 *   - On HTTP 401 the client attempts a single token refresh; if the refresh
 *     also fails with 401 it throws `SessionExpiredError` so the runtime can
 *     route the user back to sign-in.
 *   - All canonical sync types come from `@tradeos/contracts` /
 *     `@tradeos/client-core/sync-runtime`. No local duplicates.
 *
 * The base URL is configurable (defaults to the local API used in dev) so the
 * same binary can talk to a LAN API, staging, or production.
 */

import type {
  SyncPushRequest,
  SyncResponse,
} from "@tradeos/client-core/sync-runtime";
import type { SessionStore, SessionTokens } from "./session-store.js";

// ---------------------------------------------------------------------------
// Public types — mirror the TradeOS API response shapes. These are API DTOs,
// not UI view models; the desktop-runtime maps them into view models.
// ---------------------------------------------------------------------------

export interface DesktopUser {
  id: string;
  displayName: string;
  email: string | null;
  phoneE164: string | null;
}

export interface DesktopMembership {
  id: string;
  businessId: string;
  businessName: string;
  businessType: string;
  businessStatus: string;
  role: string;
  staffId: string | null;
}

export interface DesktopMe {
  user: DesktopUser;
  client: { platform: string; deviceKey: string; appVersion: string };
  memberships: DesktopMembership[];
}

export interface DesktopBusinessContext {
  business: {
    id: string;
    name: string;
    businessType: string;
    countryCode: string;
    currencyCode: string;
    timezone: string;
    status: string;
  };
  membership: { role: string; staffId: string | null };
  branches: Array<{
    id: string;
    name: string;
    code: string;
    timezone: string;
    active: boolean;
  }>;
}

export interface DesktopCatalogUnit {
  code: string;
  label: string;
  canPurchase: boolean;
  canSell: boolean;
  canStock: boolean;
  defaultSalePriceMinor: number | null;
}

export interface DesktopCatalogItem {
  id: string;
  businessId: string;
  sku: string | null;
  name: string;
  kind: "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
  stockUnitCode: string | null;
  trackStock: boolean;
  taxCategory: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  units: DesktopCatalogUnit[];
  conversions: Array<{ fromUnitCode: string; toUnitCode: string; factor: number }>;
}

export interface DesktopCatalogResponse {
  items: DesktopCatalogItem[];
}

export interface DesktopInventoryItem {
  id: string;
  sku: string | null;
  name: string;
  stockUnitCode: string;
  available: number;
  quarantine: number;
  damaged: number;
  waste: number;
  inventoryValueMinor: number;
  averageStockUnitCostMinor: number | null;
  latestStockUnitCostMinor: number | null;
}

export interface DesktopInventoryResponse {
  items: DesktopInventoryItem[];
}

export interface DesktopCustomer {
  id: string;
  name: string;
  phone: string | null;
  balanceMinor: number;
  lifetimeValueMinor: number;
  active: boolean;
  lastSeen: string | null;
}

export interface DesktopCustomerListResponse {
  items: DesktopCustomer[];
}

export interface DesktopSaleLine {
  name: string;
  unitLabel: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
}

export interface DesktopSale {
  id: string;
  receiptNo: string;
  customerName: string;
  cashierName: string;
  occurredAt: string;
  totalMinor: number;
  method: string;
  status: string;
  lines: DesktopSaleLine[];
}

export interface DesktopSaleListResponse {
  items: DesktopSale[];
}

export interface DesktopDashboardKpis {
  todaySalesMinor: number;
  cashPositionMinor: number;
  outstandingCreditMinor: number;
  stockWarnings: number;
}

export interface DesktopReportSummary {
  sales: { revenueMinor: number; txns: number; avgMinor: number };
  profitability: { grossProfitMinor: number; marginPct: number; bestDay: string };
  inventory: { stockValueMinor: number; skus: number; lowStock: number; outOfStock: number };
  cashflow: { inTodayMinor: number; outTodayMinor: number; netTodayMinor: number };
}

export interface DesktopActivityItem {
  id: string;
  kind: "sale" | "expense" | "stock" | "customer" | "return";
  title: string;
  meta: string;
  amountMinor?: number;
  tone?: "positive" | "negative" | "neutral";
  at: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

type ApiErrorPayload = { error?: string; message?: string };

export class DesktopApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "DesktopApiError";
  }
}

/**
 * Thrown when the API returns 401 (and a refresh attempt also fails). The
 * desktop runtime catches this and routes the user back to sign-in.
 */
export class SessionExpiredError extends DesktopApiError {
  constructor(message = "Your TradeOS session has expired. Please sign in again.") {
    super(message, 401, "SESSION_EXPIRED");
    this.name = "SessionExpiredError";
  }
}

/** Thrown when no session tokens are available at all (user never signed in). */
export class NoSessionError extends DesktopApiError {
  constructor(message = "Sign in required to access TradeOS data.") {
    super(message, 401, "NO_SESSION");
    this.name = "NoSessionError";
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DesktopApiClientOptions {
  baseUrl: string;
  sessionStore: SessionStore;
  fetchImpl?: typeof fetch;
  platform: "WINDOWS" | "MACOS";
  appVersion: string;
  /** Async token getter — used by the sync transport. Defaults to the session store. */
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const API_BASE_KEY = "tradeos.desktop.apiBaseUrl";

/**
 * Development API base URL. Used ONLY when Vite indicates a development build
 * (import.meta.env.DEV === true). Localhost is acceptable in dev for a local
 * API server; never used in a packaged production build.
 */
const DEV_API_BASE = "http://127.0.0.1:8080";

/**
 * Resolve the API base URL with the correct precedence:
 *
 *   1. Explicit user/admin override (persisted in localStorage via Settings)
 *      — validated as HTTPS before use.
 *   2. Build-time environment configuration (VITE_TRADEOS_API_BASE_URL)
 *      — mandatory for production packaging; validated as HTTPS.
 *   3. Development default: localhost (only when import.meta.env.DEV === true)
 *
 * In a packaged production build (not DEV), if VITE_TRADEOS_API_BASE_URL is
 * not set, this function THROWS — the build must not ship without a correct
 * production API URL. Never falls back to localhost in production.
 *
 * Validates that the URL is well-formed and uses HTTPS (in production).
 */
export function getConfiguredApiBaseUrl(): string {
  // 1. Explicit user override (Settings screen)
  if (typeof localStorage !== "undefined") {
    const override = localStorage.getItem(API_BASE_KEY);
    if (override) {
      const validated = validateApiBaseUrl(override, /* allowHttp */ false);
      if (validated) return validated;
      // If the override is invalid, fall through to env/default rather than
      // silently using it. The Settings screen should validate before saving.
    }
  }

  // 2. Build-time env configuration
  const envUrl = import.meta.env.VITE_TRADEOS_API_BASE_URL;
  if (typeof envUrl === "string" && envUrl.length > 0) {
    const validated = validateApiBaseUrl(envUrl, /* allowHttp */ false);
    if (validated) return validated;
    // If env URL is set but invalid, throw — do not fall back to localhost.
    throw new Error(
      `VITE_TRADEOS_API_BASE_URL is set but invalid: "${envUrl}". Must be a valid HTTPS URL.`,
    );
  }

  // 3. Development default
  const isDev = import.meta.env.DEV === true;
  if (isDev) {
    // Dev mode: localhost is acceptable for a local API server.
    return DEV_API_BASE;
  }

  // 4. Packaged production with NO VITE_TRADEOS_API_BASE_URL — FAIL.
  // Never fall back to localhost. The build must ship with a correct URL.
  throw new Error(
    "VITE_TRADEOS_API_BASE_URL is required for a packaged production build. " +
      "Set it at build time to the production TradeOS API HTTPS URL. " +
      "Never ship a production build without it.",
  );
}

/**
 * Validate an API base URL.
 *
 * - Must be a valid URL (parseable by the URL constructor).
 * - In production (allowHttp=false): must use HTTPS. Rejects HTTP and
 *   non-HTTP schemes.
 * - In dev (allowHttp=true): allows HTTP for localhost development.
 * - Rejects obviously malformed URLs (empty, no host, wrong scheme).
 *
 * Returns the validated URL string, or null if invalid.
 */
export function validateApiBaseUrl(url: string, allowHttp: boolean): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:") return parsed.origin + (parsed.pathname.replace(/\/$/, ""));
    if (parsed.protocol === "http:" && allowHttp) {
      // Allow HTTP only in explicit dev mode and only for localhost/127.0.0.1
      const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      if (isLocalhost) return parsed.origin + (parsed.pathname.replace(/\/$/, ""));
      return null; // HTTP for non-localhost is never allowed
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist a new API base URL (Settings screen). Validates before saving. */
export function setApiBaseUrl(url: string): void {
  if (typeof localStorage === "undefined") return;
  const validated = validateApiBaseUrl(url, /* allowHttp */ false);
  if (!validated) {
    throw new Error("Invalid API URL: must be a valid HTTPS URL (or localhost in dev mode).");
  }
  localStorage.setItem(API_BASE_KEY, validated);
}

/** Clear the persisted API base URL override (revert to env/default). */
export function clearApiBaseUrlOverride(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(API_BASE_KEY);
}

export class DesktopApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private refreshInFlight: Promise<SessionTokens> | null = null;

  constructor(private readonly options: DesktopApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  // -- Auth lifecycle ------------------------------------------------------

  async login(identifier: string, password: string): Promise<DesktopUser> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: identifier.trim(),
        password,
        platform: this.options.platform,
        appVersion: this.options.appVersion,
      }),
    });
    const payload = await readJson<{ user?: DesktopUser; session?: SessionTokens } & ApiErrorPayload>(response);
    if (!response.ok) throw apiError(response.status, payload);
    if (!payload.user || !isSessionTokens(payload.session)) {
      throw new DesktopApiError(
        "Authentication service returned an invalid session.",
        502,
        "INVALID_AUTH_RESPONSE",
      );
    }
    await this.options.sessionStore.setTokens(payload.session);
    return payload.user;
  }

  async logout(): Promise<void> {
    const session = await this.options.sessionStore.getTokens();
    try {
      if (session) {
        await this.fetchImpl(`${this.baseUrl}/v1/auth/logout`, {
          method: "POST",
          headers: { authorization: `Bearer ${session.accessToken}` },
        });
      }
    } catch {
      // Local sign-out is authoritative for this device even when the network is down.
    } finally {
      await this.options.sessionStore.clearTokens();
    }
  }

  // -- Tenant data --------------------------------------------------------

  getMe(): Promise<DesktopMe> {
    return this.authorizedJson<DesktopMe>("/v1/me", { method: "GET" });
  }

  getBusinessContext(businessId: string): Promise<DesktopBusinessContext> {
    return this.authorizedJson<DesktopBusinessContext>(
      `/v1/businesses/${encodeURIComponent(businessId)}/context`,
      { method: "GET" },
    );
  }

  getCatalog(businessId: string): Promise<DesktopCatalogResponse> {
    const query = new URLSearchParams({ businessId });
    return this.authorizedJson<DesktopCatalogResponse>(`/v1/catalog/items?${query.toString()}`, {
      method: "GET",
    });
  }

  getInventory(
    businessId: string,
    branchId: string,
    search = "",
  ): Promise<DesktopInventoryResponse> {
    const query = new URLSearchParams({ businessId, branchId });
    const normalized = search.trim();
    if (normalized) query.set("query", normalized);
    return this.authorizedJson<DesktopInventoryResponse>(`/v1/inventory?${query.toString()}`, {
      method: "GET",
    });
  }

  getCustomers(businessId: string): Promise<DesktopCustomerListResponse> {
    const query = new URLSearchParams({ businessId });
    return this.authorizedJson<DesktopCustomerListResponse>(`/v1/customers?${query.toString()}`, {
      method: "GET",
    });
  }

  getSales(businessId: string, branchId: string): Promise<DesktopSaleListResponse> {
    const query = new URLSearchParams({ businessId, branchId });
    return this.authorizedJson<DesktopSaleListResponse>(`/v1/sales?${query.toString()}`, {
      method: "GET",
    });
  }

  getDashboardKpis(businessId: string, branchId: string): Promise<DesktopDashboardKpis> {
    const query = new URLSearchParams({ businessId, branchId });
    return this.authorizedJson<DesktopDashboardKpis>(`/v1/dashboard/kpis?${query.toString()}`, {
      method: "GET",
    });
  }

  getReportSummary(businessId: string, branchId: string): Promise<DesktopReportSummary> {
    const query = new URLSearchParams({ businessId, branchId });
    return this.authorizedJson<DesktopReportSummary>(`/v1/reports/summary?${query.toString()}`, {
      method: "GET",
    });
  }

  getActivityFeed(businessId: string, branchId: string): Promise<{ items: DesktopActivityItem[] }> {
    const query = new URLSearchParams({ businessId, branchId });
    return this.authorizedJson<{ items: DesktopActivityItem[] }>(`/v1/dashboard/activity?${query.toString()}`, {
      method: "GET",
    });
  }

  // -- Sync transport -----------------------------------------------------

  push(request: SyncPushRequest): Promise<SyncResponse> {
    return this.authorizedJson<SyncResponse>("/v1/sync", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  // -- Internals ----------------------------------------------------------

  private async authorizedJson<T>(path: string, init: RequestInit): Promise<T> {
    const session = await this.options.sessionStore.getTokens();
    if (!session) throw new NoSessionError();

    let response = await this.fetchAuthorized(path, init, session.accessToken);
    if (response.status === 401) {
      const refreshed = await this.refreshAfterUnauthorized(session.accessToken);
      response = await this.fetchAuthorized(path, init, refreshed.accessToken);
      if (response.status === 401) {
        await this.options.sessionStore.clearTokens();
        throw new SessionExpiredError();
      }
    }

    const payload = await readJson<T & ApiErrorPayload>(response);
    if (!response.ok) throw apiError(response.status, payload);
    return payload;
  }

  private fetchAuthorized(path: string, init: RequestInit, accessToken: string): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    return this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
  }

  private async refreshAfterUnauthorized(rejectedAccessToken: string): Promise<SessionTokens> {
    const current = await this.options.sessionStore.getTokens();
    if (!current) throw new SessionExpiredError();
    if (current.accessToken !== rejectedAccessToken) return current;
    if (this.refreshInFlight) return this.refreshInFlight;

    const refresh = this.performRefresh(current.refreshToken).finally(() => {
      if (this.refreshInFlight === refresh) this.refreshInFlight = null;
    });
    this.refreshInFlight = refresh;
    return refresh;
  }

  private async performRefresh(refreshToken: string): Promise<SessionTokens> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const payload = await readJson<{ session?: SessionTokens } & ApiErrorPayload>(response);
    if (!response.ok || !isSessionTokens(payload.session)) {
      await this.options.sessionStore.clearTokens();
      throw new SessionExpiredError(payload.message);
    }
    await this.options.sessionStore.setTokens(payload.session);
    return payload.session;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new DesktopApiError(
      "TradeOS returned an unreadable response.",
      502,
      "INVALID_API_RESPONSE",
    );
  }
}

function apiError(statusCode: number, payload: ApiErrorPayload): DesktopApiError {
  return new DesktopApiError(
    payload.message ?? "TradeOS could not complete the request.",
    statusCode,
    payload.error ?? "API_REQUEST_FAILED",
  );
}

function isSessionTokens(value: unknown): value is SessionTokens {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<SessionTokens>;
  return (
    typeof row.accessToken === "string" && row.accessToken.length > 0 &&
    typeof row.refreshToken === "string" && row.refreshToken.length > 0 &&
    typeof row.accessExpiresAt === "string" && row.accessExpiresAt.length > 0 &&
    typeof row.refreshExpiresAt === "string" && row.refreshExpiresAt.length > 0
  );
}

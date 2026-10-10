import type { SyncPushRequest, SyncResponse } from "@tradeos/client-core/sync-runtime";
import { type MobileSessionTokens, MobilePersistence } from "./storage";

export type MobilePlatform = "ANDROID" | "IOS";

export type MobileUser = {
  id: string;
  displayName: string;
  email: string | null;
  phoneE164: string | null;
};

export type MobileMembership = {
  id: string;
  businessId: string;
  businessName: string;
  businessType: string;
  businessStatus: string;
  role: string;
  staffId: string | null;
};

export type MobileMe = {
  user: MobileUser;
  client: { platform: string; deviceKey: string; appVersion: string };
  memberships: MobileMembership[];
};

export type MobileBusinessContext = {
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
  branches: Array<{ id: string; name: string; code: string; timezone: string; active: boolean }>;
};

export type MobileApiClientOptions = {
  baseUrl: string;
  persistence: MobilePersistence;
  fetchImpl?: typeof fetch;
  platform: MobilePlatform;
  appVersion: string;
};

type ApiErrorPayload = { error?: string; message?: string };
type SessionResponse = { session?: MobileSessionTokens };

export class MobileApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "MobileApiError";
  }
}

export class SessionExpiredError extends MobileApiError {
  constructor(message = "Your TradeOS session has expired. Please sign in again.") {
    super(message, 401, "SESSION_EXPIRED");
    this.name = "SessionExpiredError";
  }
}

export class MobileApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private refreshInFlight: Promise<MobileSessionTokens> | null = null;

  constructor(private readonly options: MobileApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async login(identifier: string, password: string): Promise<MobileUser> {
    const deviceKey = await this.options.persistence.getOrCreateDeviceKey();
    const response = await this.fetchImpl(`${this.baseUrl}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: identifier.trim(),
        password,
        platform: this.options.platform,
        deviceKey,
        appVersion: this.options.appVersion,
      }),
    });
    const payload = await readJson<{ user?: MobileUser; session?: MobileSessionTokens } & ApiErrorPayload>(response);
    if (!response.ok) throw apiError(response.status, payload);
    if (!payload.user || !isSessionTokens(payload.session)) {
      throw new MobileApiError("Authentication service returned an invalid session.", 502, "INVALID_AUTH_RESPONSE");
    }
    await this.options.persistence.saveSession(payload.session);
    return payload.user;
  }

  getMe(): Promise<MobileMe> {
    return this.authorizedJson<MobileMe>("/v1/me", { method: "GET" });
  }

  getBusinessContext(businessId: string): Promise<MobileBusinessContext> {
    return this.authorizedJson<MobileBusinessContext>(`/v1/businesses/${encodeURIComponent(businessId)}/context`, { method: "GET" });
  }

  push(request: SyncPushRequest): Promise<SyncResponse> {
    return this.authorizedJson<SyncResponse>("/v1/sync", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async logout(): Promise<void> {
    const session = await this.options.persistence.loadSession();
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
      await this.options.persistence.clearSession();
    }
  }

  private async authorizedJson<T>(path: string, init: RequestInit): Promise<T> {
    const session = await this.options.persistence.loadSession();
    if (!session) throw new SessionExpiredError();

    let response = await this.fetchAuthorized(path, init, session.accessToken);
    if (response.status === 401) {
      const refreshed = await this.refreshAfterUnauthorized(session.accessToken);
      response = await this.fetchAuthorized(path, init, refreshed.accessToken);
      if (response.status === 401) {
        await this.options.persistence.clearSession();
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

  private async refreshAfterUnauthorized(rejectedAccessToken: string): Promise<MobileSessionTokens> {
    const current = await this.options.persistence.loadSession();
    if (!current) throw new SessionExpiredError();
    if (current.accessToken !== rejectedAccessToken) return current;
    if (this.refreshInFlight) return this.refreshInFlight;

    const refresh = this.performRefresh(current.refreshToken).finally(() => {
      if (this.refreshInFlight === refresh) this.refreshInFlight = null;
    });
    this.refreshInFlight = refresh;
    return refresh;
  }

  private async performRefresh(refreshToken: string): Promise<MobileSessionTokens> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const payload = await readJson<SessionResponse & ApiErrorPayload>(response);
    if (!response.ok || !isSessionTokens(payload.session)) {
      await this.options.persistence.clearSession();
      throw new SessionExpiredError(payload.message);
    }
    await this.options.persistence.saveSession(payload.session);
    return payload.session;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new MobileApiError("TradeOS returned an unreadable response.", 502, "INVALID_API_RESPONSE");
  }
}

function apiError(statusCode: number, payload: ApiErrorPayload): MobileApiError {
  return new MobileApiError(
    payload.message ?? "TradeOS could not complete the request.",
    statusCode,
    payload.error ?? "API_REQUEST_FAILED",
  );
}

function isSessionTokens(value: unknown): value is MobileSessionTokens {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<MobileSessionTokens>;
  return typeof row.accessToken === "string" && row.accessToken.length > 0
    && typeof row.refreshToken === "string" && row.refreshToken.length > 0
    && typeof row.accessExpiresAt === "string" && row.accessExpiresAt.length > 0
    && typeof row.refreshExpiresAt === "string" && row.refreshExpiresAt.length > 0;
}
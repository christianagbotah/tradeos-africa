export interface RefreshableWebSession {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  businessId: string;
}

export interface RefreshableSessionStore<TSession extends RefreshableWebSession = RefreshableWebSession> {
  load(): TSession | null;
  save(session: TSession | null): void;
}

interface RefreshResponse {
  session?: {
    accessToken?: string;
    refreshToken?: string;
    clientId?: string;
  };
  error?: string;
  message?: string;
}

export class SessionExpiredError extends Error {
  constructor(message = "Your session has expired. Please sign in again.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

const refreshes = new WeakMap<object, Promise<RefreshableWebSession>>();

function withBearer(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

async function isAccessRejected(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const payload = await response.clone().json() as { error?: string };
    return payload.error === "ACCESS_REJECTED";
  } catch {
    return false;
  }
}

async function refreshSession<TSession extends RefreshableWebSession>(
  store: RefreshableSessionStore<TSession>,
): Promise<TSession> {
  const current = store.load();
  if (!current?.refreshToken) throw new SessionExpiredError();

  const existing = refreshes.get(store as object);
  if (existing) return existing as Promise<TSession>;

  const operation = (async () => {
    const response = await fetch("/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    const payload = await response.json().catch(() => ({})) as RefreshResponse;
    if (!response.ok) {
      if (response.status === 401) throw new SessionExpiredError();
      throw new Error(payload.message ?? "Your session could not be renewed. Please try again.");
    }
    if (!payload.session?.accessToken || !payload.session.refreshToken) {
      throw new Error("Server returned an incomplete refreshed session.");
    }
    const latest = store.load() ?? current;
    const next = {
      ...latest,
      accessToken: payload.session.accessToken,
      refreshToken: payload.session.refreshToken,
      clientId: payload.session.clientId ?? latest.clientId,
    } as TSession;
    store.save(next);
    return next;
  })().finally(() => {
    refreshes.delete(store as object);
  });

  refreshes.set(store as object, operation);
  return operation;
}

export async function fetchWithSessionRefresh<TSession extends RefreshableWebSession>(
  store: RefreshableSessionStore<TSession>,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const initial = store.load();
  if (!initial) throw new SessionExpiredError("You are signed out. Please sign in again.");

  const first = await fetch(input, withBearer(init, initial.accessToken));
  if (!(await isAccessRejected(first))) return first;

  const latest = store.load();
  if (latest && latest.accessToken !== initial.accessToken) {
    const retryWithLatest = await fetch(input, withBearer(init, latest.accessToken));
    if (!(await isAccessRejected(retryWithLatest))) return retryWithLatest;
  }

  let refreshed: TSession;
  try {
    refreshed = await refreshSession(store);
  } catch (error) {
    const afterFailure = store.load();
    if (afterFailure && afterFailure.accessToken !== initial.accessToken) {
      const retryAfterOtherRefresh = await fetch(input, withBearer(init, afterFailure.accessToken));
      if (!(await isAccessRejected(retryAfterOtherRefresh))) return retryAfterOtherRefresh;
    }
    throw error;
  }

  return fetch(input, withBearer(init, refreshed.accessToken));
}

export async function readApiErrorMessage(response: Response, fallback = "Request failed"): Promise<string> {
  const text = await response.text().catch(() => "");
  if (text) {
    try {
      const payload = JSON.parse(text) as { message?: string; error?: string };
      if (payload.message) return payload.message;
      if (payload.error) return payload.error;
    } catch {
      return text;
    }
  }
  return `${fallback} (${response.status})`;
}

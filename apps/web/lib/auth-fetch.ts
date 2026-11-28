export interface RefreshableWebSession {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  businessId: string;
  branchId?: string;
  staffId?: string;
  role?: string;
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

const refreshes = new WeakMap<object, {session:RefreshableWebSession;promise:Promise<RefreshableWebSession>}>();

function sameScope(a:RefreshableWebSession,b:RefreshableWebSession):boolean{
  return a.businessId===b.businessId&&a.branchId===b.branchId&&a.staffId===b.staffId&&a.role===b.role&&a.clientId===b.clientId;
}
function requireCurrentScope<T extends RefreshableWebSession>(store:RefreshableSessionStore<T>,expected:RefreshableWebSession):T{
  const current=store.load();
  if(!current||!sameScope(current,expected))throw new SessionExpiredError("Your account or workspace changed. Review the original transaction before retrying.");
  return current;
}
function sameCredentials(a:RefreshableWebSession,b:RefreshableWebSession):boolean{
  return a.accessToken===b.accessToken&&a.refreshToken===b.refreshToken;
}

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
  expected:RefreshableWebSession,
): Promise<TSession> {
  const current=requireCurrentScope(store,expected);
  if(!current.refreshToken)throw new SessionExpiredError();

  const existing=refreshes.get(store as object);
  if(existing){
    if(!sameScope(existing.session,current)||!sameCredentials(existing.session,current))
      throw new SessionExpiredError("A different session is being renewed. Review the current workspace before retrying.");
    return existing.promise as Promise<TSession>;
  }

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
    // Never restore a signed-out account or combine credentials from one
    // account with the metadata of another. Do not change authenticated device identity.
    const latest=requireCurrentScope(store,current);
    if(!sameCredentials(latest,current)||
      (payload.session.clientId!==undefined&&payload.session.clientId!==current.clientId))
      throw new SessionExpiredError("Your session changed while it was being renewed. Review before retrying.");
    const next={
      ...latest,
      accessToken:payload.session.accessToken,
      refreshToken:payload.session.refreshToken,
      clientId:latest.clientId,
    } as TSession;
    store.save(next);
    return next;
  })().finally(() => {
    refreshes.delete(store as object);
  });

  refreshes.set(store as object,{session:current,promise:operation});
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

  const latest=requireCurrentScope(store,initial);
  if (latest.accessToken !== initial.accessToken) {
    const retryWithLatest = await fetch(input, withBearer(init, latest.accessToken));
    if (!(await isAccessRejected(retryWithLatest))) return retryWithLatest;
  }

  let refreshed: TSession;
  try {
    refreshed = await refreshSession(store,initial);
  } catch (error) {
    const afterFailure=requireCurrentScope(store,initial);
    if (afterFailure.accessToken !== initial.accessToken) {
      const retryAfterOtherRefresh = await fetch(input, withBearer(init, afterFailure.accessToken));
      if (!(await isAccessRejected(retryAfterOtherRefresh))) return retryAfterOtherRefresh;
    }
    throw error;
  }

  const current=requireCurrentScope(store,initial);
  if(!sameCredentials(current,refreshed))throw new SessionExpiredError("Your session changed before retrying. Review the original transaction.");
  return fetch(input, withBearer(init, current.accessToken));
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

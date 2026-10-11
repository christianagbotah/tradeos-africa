/**
 * Desktop session storage abstraction.
 *
 * Authentication credentials (access/refresh tokens) are stored in Tauri
 * Stronghold — an encrypted-at-rest secure secret store — when running in
 * a native Tauri build. Stronghold is separate from tauri-plugin-store
 * (which is used only for non-secret application state like selected
 * business/branch).
 *
 * Architecture:
 *
 *   1. On first native launch, the Rust layer generates a cryptographically
 *      random 32-byte vault secret and stores it in the OS credential
 *      manager (Windows Credential Manager, macOS Keychain, Linux secret
 *      service) via the `keyring` crate.
 *   2. The JS layer calls the `get_vault_secret` Tauri command to retrieve
 *      the per-installation secret.
 *   3. The JS layer resolves the Stronghold snapshot path via
 *      `appDataDir()` from @tauri-apps/api/path.
 *   4. `Stronghold.load(snapshotPath, vaultSecret)` initializes the
 *      Stronghold instance. The Rust layer's Argon2id KDF (with a
 *      per-installation salt file) derives the snapshot encryption key.
 *   5. A named Stronghold client (`tradeos-session`) is loaded or created.
 *   6. The client's Store is used for token persistence:
 *        - store.insert(SESSION_STORE_KEY, encodedTokens)
 *        - store.get(SESSION_STORE_KEY)
 *        - store.remove(SESSION_STORE_KEY)
 *      The snapshot is persisted via stronghold.save().
 *   7. On logout/session-expiry, tokens are removed from the store and the
 *      snapshot is saved.
 *
 * If any step fails, the store refuses to persist (RefusingSessionStore)
 * rather than silently downgrading to localStorage or plugin-store.
 */

/** Token pair returned by the TradeOS auth endpoints. */
export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

/** Minimum surface a session-store backend must implement. */
export interface SessionStore {
  getTokens(): Promise<SessionTokens | null>;
  setTokens(tokens: SessionTokens): Promise<void>;
  clearTokens(): Promise<void>;
}

const SESSION_STORE_KEY = "tradeos-session-tokens";
const STRONGHOLD_CLIENT_NAME = "tradeos-session";
const SNAPSHOT_FILENAME = "tradeos-session.hold";

/** Returns true when running inside a Tauri native window. */
function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

/** Backend interface for Stronghold-based secret storage. */
type SecureStoreBackend = Pick<SessionStore, "getTokens" | "setTokens" | "clearTokens">;

let secureBackendPromise: Promise<SecureStoreBackend | null> | null = null;

/**
 * Test-injectable backend resolver. When set, resolveSecureBackend()
 * uses this instead of the real Stronghold + Tauri command path.
 * TEST-ONLY — never call in production code.
 */
let testSecureBackendResolver: (() => Promise<SecureStoreBackend | null>) | null = null;

/**
 * Reset the secure backend cache. TEST-ONLY.
 */
export function __resetSecureBackendCacheForTests(): void {
  secureBackendPromise = null;
  testSecureBackendResolver = null;
}

/**
 * Inject a secure backend resolver for testing. TEST-ONLY.
 * Pass null to clear the injection.
 */
export function __setSecureBackendResolverForTests(resolver: (() => Promise<SecureStoreBackend | null>) | null): void {
  testSecureBackendResolver = resolver;
  secureBackendPromise = null;
}

/**
 * Lazy resolver for the Stronghold secure store backend. Resolved once on
 * first use; if resolution fails (plugin missing, runtime not Tauri,
 * Stronghold initialization error, OS credential store unavailable)
 * returns null and the caller surfaces a clear error rather than silently
 * downgrading to localStorage.
 *
 * Uses the REAL @tauri-apps/plugin-stronghold v2 API:
 *   - Stronghold.load(snapshotPath, password)
 *   - stronghold.loadClient(name) / stronghold.createClient(name)
 *   - client.getStore()
 *   - store.insert(key, value) / store.get(key) / store.remove(key)
 *   - stronghold.save()
 *
 * The password is the per-installation vault secret retrieved from the OS
 * credential manager via the `get_vault_secret` Tauri command (Rust keyring).
 */
async function resolveSecureBackend(): Promise<SecureStoreBackend | null> {
  if (!isTauri()) return null;
  if (secureBackendPromise) return secureBackendPromise;
  secureBackendPromise = (async () => {
    // Test injection
    if (testSecureBackendResolver) {
      try {
        return await testSecureBackendResolver();
      } catch {
        return null;
      }
    }
    try {
      // 1. Get the per-installation vault secret from the OS credential
      //    manager via the Rust `get_vault_secret` Tauri command.
      const { invoke } = await import(/* @vite-ignore */ "@tauri-apps/api/core");
      const vaultSecret: string = await invoke("get_vault_secret");

      // 2. Resolve the Stronghold snapshot path via appDataDir().
      const { appDataDir } = await import(/* @vite-ignore */ "@tauri-apps/api/path");
      const dataDir: string = await appDataDir();
      const snapshotPath = `${dataDir}/${SNAPSHOT_FILENAME}`;

      // 3. Load the Stronghold instance with the real API.
      const { Stronghold } = await import(/* @vite-ignore */ "@tauri-apps/plugin-stronghold");
      const stronghold = await Stronghold.load(snapshotPath, vaultSecret);

      // 4. Load or create the named client.
      let client: import("@tauri-apps/plugin-stronghold").Client;
      try {
        client = await stronghold.loadClient(STRONGHOLD_CLIENT_NAME);
      } catch {
        client = await stronghold.createClient(STRONGHOLD_CLIENT_NAME);
      }

      // 5. Use the client's Store for token persistence.
      const store = client.getStore();

      return {
        async getTokens(): Promise<SessionTokens | null> {
          const data = await store.get(SESSION_STORE_KEY);
          if (!data) return null;
          const text = new TextDecoder().decode(data);
          return parseTokens(text);
        },
        async setTokens(tokens: SessionTokens): Promise<void> {
          const encoded = Array.from(new TextEncoder().encode(JSON.stringify(tokens)));
          await store.insert(SESSION_STORE_KEY, encoded);
          await stronghold.save();
        },
        async clearTokens(): Promise<void> {
          await store.remove(SESSION_STORE_KEY);
          await stronghold.save();
        },
      };
    } catch {
      // Stronghold or OS credential store unavailable — surface as "no
      // backend" so the caller refuses to persist rather than silently
      // downgrading to localStorage.
      return null;
    }
  })();
  return secureBackendPromise;
}

/**
 * Browser localStorage-backed session store. Used in plain Vite dev mode
 * and in any non-Tauri runtime. Tokens are stored as a single JSON blob
 * under a versioned key so a future schema change can migrate cleanly.
 */
export class LocalStorageSessionStore implements SessionStore {
  constructor(private readonly storage: Storage) {}

  async getTokens(): Promise<SessionTokens | null> {
    const raw = this.storage.getItem("tradeos.desktop.session.v1");
    if (!raw) return null;
    return parseTokens(raw);
  }

  async setTokens(tokens: SessionTokens): Promise<void> {
    this.storage.setItem("tradeos.desktop.session.v1", JSON.stringify(tokens));
  }

  async clearTokens(): Promise<void> {
    this.storage.removeItem("tradeos.desktop.session.v1");
  }
}

/**
 * Resolve the best available session store for the current runtime.
 *
 *   - In Tauri: prefers Stronghold (secure encrypted storage with OS
 *     keychain-protected vault secret); if unavailable, returns a
 *     RefusingSessionStore so the caller surfaces a clear error rather
 *     than silently downgrading to localStorage or plugin-store.
 *   - In a browser: returns a LocalStorageSessionStore backed by
 *     `window.localStorage`.
 *   - In an environment with no `window`/`localStorage` (SSR, tests without
 *     a DOM shim): returns a `RefusingSessionStore`.
 */
export async function resolveSessionStore(): Promise<SessionStore> {
  if (isTauri()) {
    const backend = await resolveSecureBackend();
    if (backend) return wrapSecure(backend);
    return new RefusingSessionStore(
      "TradeOS desktop could not initialize Stronghold secure storage. Reinstall the application to sign in.",
    );
  }
  if (typeof window !== "undefined" && window.localStorage) {
    return new LocalStorageSessionStore(window.localStorage);
  }
  return new RefusingSessionStore(
    "TradeOS desktop has no session store available in this environment.",
  );
}

/**
 * Synchronous accessor for the localStorage-backed store. Used by the API
 * client's interceptor (which needs tokens without an `await`) when we know
 * we are in browser dev mode. In a Tauri runtime the API client must use
 * the async resolveSessionStore() path instead.
 *
 * @deprecated Use resolveSessionStore() for all new code. This exists only
 *             for the browser-dev-mode API client interceptor.
 */
export function getSyncSessionStore(): SessionStore {
  if (typeof window !== "undefined" && window.localStorage) {
    return new LocalStorageSessionStore(window.localStorage);
  }
  return new RefusingSessionStore(
    "TradeOS desktop has no synchronous session store in this environment.",
  );
}

function wrapSecure(backend: SecureStoreBackend): SessionStore {
  return {
    getTokens: () => backend.getTokens(),
    setTokens: (tokens) => backend.setTokens(tokens),
    clearTokens: () => backend.clearTokens(),
  };
}

/** Session store that always refuses operations with a clear error. */
export class RefusingSessionStore implements SessionStore {
  constructor(private readonly reason: string) {}

  async getTokens(): Promise<SessionTokens | null> {
    return null;
  }

  async setTokens(_tokens: SessionTokens): Promise<void> {
    throw new Error(this.reason);
  }

  async clearTokens(): Promise<void> {
    /* no-op — nothing was stored */
  }
}

/** Parse + validate a stored token blob. Returns null on any shape mismatch. */
function parseTokens(raw: string): SessionTokens | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt } = parsed;
    if (
      typeof accessToken !== "string" || accessToken.length === 0 ||
      typeof refreshToken !== "string" || refreshToken.length === 0 ||
      typeof accessExpiresAt !== "string" || accessExpiresAt.length === 0 ||
      typeof refreshExpiresAt !== "string" || refreshExpiresAt.length === 0
    ) {
      return null;
    }
    return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

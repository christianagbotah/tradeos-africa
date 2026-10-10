import type { QueueState } from "@tradeos/client-core/sync-runtime";
import { MobileApiError, SessionExpiredError } from "./api-client";
import {
  MobileRuntimeError,
  type MobileBootstrapState,
  type MobileReadyState,
  type MobileRuntime,
} from "./runtime";
import { QueueStorageCorruptError } from "./storage";

type AppRuntime = Pick<MobileRuntime, "bootstrap" | "login" | "flush" | "logout" | "getQueueState">;

export type MobileAppPhase = "BOOTING" | "SIGNED_OUT" | "NEEDS_BUSINESS" | "READY" | "ERROR";

export type MobileAppSnapshot = {
  phase: MobileAppPhase;
  bootstrap: MobileBootstrapState | null;
  error: string | null;
  online: boolean | null;
  syncing: boolean;
};

const emptyQueue: QueueState = { pending: 0, blocked: 0, failed: 0 };

export class MobileAppModel {
  private state: MobileAppSnapshot = {
    phase: "BOOTING",
    bootstrap: null,
    error: null,
    online: null,
    syncing: false,
  };

  constructor(private readonly runtime: AppRuntime) {}

  get snapshot(): MobileAppSnapshot {
    return { ...this.state };
  }

  async start(): Promise<MobileAppSnapshot> {
    this.state = { ...this.state, phase: "BOOTING", error: null, syncing: false };
    try {
      return this.applyBootstrap(await this.runtime.bootstrap());
    } catch (error) {
      this.state = { ...this.state, phase: "ERROR", bootstrap: null, error: safeMobileErrorMessage(error), syncing: false };
      return this.snapshot;
    }
  }

  async login(identifier: string, password: string): Promise<MobileAppSnapshot> {
    this.state = { ...this.state, phase: "BOOTING", error: null, syncing: false };
    try {
      return this.applyBootstrap(await this.runtime.login(identifier, password));
    } catch (error) {
      const queue = await this.safeQueueState();
      this.state = {
        ...this.state,
        phase: "SIGNED_OUT",
        bootstrap: { status: "SIGNED_OUT", queue },
        error: safeMobileErrorMessage(error),
        syncing: false,
      };
      return this.snapshot;
    }
  }

  async sync(): Promise<MobileAppSnapshot> {
    if (this.state.phase !== "READY" || this.state.bootstrap?.status !== "READY") return this.snapshot;
    const currentReady = this.state.bootstrap;
    this.state = { ...this.state, syncing: true, error: null };
    try {
      const summary = await this.runtime.flush(this.state.online === true);
      const ready: MobileReadyState = {
        ...currentReady,
        queue: { pending: summary.pending, blocked: summary.blocked, failed: summary.failed },
      };
      this.state = { ...this.state, phase: "READY", bootstrap: ready, syncing: false };
    } catch (error) {
      this.state = { ...this.state, error: safeMobileErrorMessage(error), syncing: false };
    }
    return this.snapshot;
  }

  async connectivityChanged(online: boolean): Promise<MobileAppSnapshot> {
    const previous = this.state.online;
    this.state = { ...this.state, online };
    if (previous === false && online && this.state.phase === "READY") return this.sync();
    return this.snapshot;
  }

  async logout(): Promise<MobileAppSnapshot> {
    try {
      await this.runtime.logout();
    } finally {
      const queue = await this.safeQueueState();
      this.state = {
        ...this.state,
        phase: "SIGNED_OUT",
        bootstrap: { status: "SIGNED_OUT", queue },
        error: null,
        syncing: false,
      };
    }
    return this.snapshot;
  }

  private applyBootstrap(bootstrap: MobileBootstrapState): MobileAppSnapshot {
    this.state = {
      ...this.state,
      phase: bootstrap.status,
      bootstrap,
      error: null,
      syncing: false,
    };
    return this.snapshot;
  }

  private async safeQueueState(): Promise<QueueState> {
    try {
      return await this.runtime.getQueueState();
    } catch {
      return emptyQueue;
    }
  }
}

export function safeMobileErrorMessage(error: unknown): string {
  if (error instanceof SessionExpiredError) return error.message;
  if (error instanceof QueueStorageCorruptError) return error.message;
  if (error instanceof MobileRuntimeError) return error.message;
  if (error instanceof MobileApiError) return error.message || "TradeOS could not complete the request.";
  return "TradeOS could not complete that action. Check your connection and try again.";
}
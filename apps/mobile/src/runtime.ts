import {
  OfflineMutationQueue,
  type FlushSummary,
  type QueueSnapshotStorage,
  type QueueState,
  type SyncTransport,
} from "@tradeos/client-core/sync-runtime";
import {
  SessionExpiredError,
  type MobileApiClient,
  type MobileBusinessContext,
  type MobileMembership,
  type MobileMe,
  type MobileUser,
} from "./api-client";
import { MobilePersistence } from "./storage";

type RuntimeApi = Pick<
  MobileApiClient,
  "login" | "getMe" | "getBusinessContext" | "push" | "logout"
> & SyncTransport;

export type MobileReadyState = {
  status: "READY";
  user: MobileUser;
  membership: MobileMembership;
  business: MobileBusinessContext["business"];
  branch: MobileBusinessContext["branches"][number];
  queue: QueueState;
};

export type MobileBootstrapState =
  | { status: "SIGNED_OUT"; queue: QueueState }
  | { status: "NEEDS_BUSINESS"; user: MobileUser; queue: QueueState }
  | MobileReadyState;

export type MobileRuntimeOptions = {
  api: RuntimeApi;
  persistence: MobilePersistence;
  queueStorage: QueueSnapshotStorage;
  now: () => string;
  createMutationId: () => string;
};

export class MobileRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MobileRuntimeError";
  }
}

export class MobileRuntime {
  readonly queue: OfflineMutationQueue;
  private current: MobileReadyState | null = null;

  constructor(private readonly options: MobileRuntimeOptions) {
    this.queue = new OfflineMutationQueue(options.queueStorage, {
      now: options.now,
      createMutationId: options.createMutationId,
    });
  }

  async bootstrap(): Promise<MobileBootstrapState> {
    const session = await this.options.persistence.loadSession();
    if (!session) return this.signedOut();

    let me: MobileMe;
    try {
      me = await this.options.api.getMe();
    } catch (error) {
      if (error instanceof SessionExpiredError) return this.signedOut();
      throw error;
    }

    const memberships = me.memberships.filter((membership) => membership.businessStatus === "ACTIVE");
    if (memberships.length === 0) {
      this.current = null;
      return {
        status: "NEEDS_BUSINESS",
        user: me.user,
        queue: await this.queue.getState(null),
      };
    }

    const saved = await this.options.persistence.loadWorkspaceSelection();
    const membership = memberships.find((candidate) => candidate.businessId === saved?.businessId) ?? memberships[0]!;
    const context = await this.options.api.getBusinessContext(membership.businessId);
    const activeBranches = context.branches.filter((branch) => branch.active);
    const branch = (saved?.businessId === membership.businessId
      ? activeBranches.find((candidate) => candidate.id === saved.branchId)
      : undefined)
      ?? activeBranches.find((candidate) => candidate.code === "MAIN")
      ?? activeBranches[0];

    if (!branch) {
      this.current = null;
      throw new MobileRuntimeError("This TradeOS business has no active branch available on mobile.");
    }

    await this.options.persistence.saveWorkspaceSelection({ businessId: membership.businessId, branchId: branch.id });
    const ready: MobileReadyState = {
      status: "READY",
      user: me.user,
      membership,
      business: context.business,
      branch,
      queue: await this.queue.getState(membership.businessId),
    };
    this.current = ready;
    return ready;
  }

  async login(identifier: string, password: string): Promise<MobileBootstrapState> {
    await this.options.api.login(identifier, password);
    return this.bootstrap();
  }

  async flush(online: boolean): Promise<FlushSummary> {
    const activeBusinessId = this.current?.membership.businessId ?? null;
    const summary = await this.queue.flush({
      activeBusinessId,
      online,
      transport: this.options.api,
    });
    if (this.current) {
      this.current = {
        ...this.current,
        queue: { pending: summary.pending, blocked: summary.blocked, failed: summary.failed },
      };
    }
    return summary;
  }

  getCurrentReadyState(): MobileReadyState | null {
    return this.current;
  }

  async getQueueState(): Promise<QueueState> {
    return this.queue.getState(this.current?.membership.businessId ?? null);
  }

  async logout(): Promise<void> {
    try {
      await this.options.api.logout();
    } finally {
      await this.options.persistence.clearSession();
      this.current = null;
    }
  }

  private async signedOut(): Promise<MobileBootstrapState> {
    this.current = null;
    return { status: "SIGNED_OUT", queue: await this.queue.getState(null) };
  }
}
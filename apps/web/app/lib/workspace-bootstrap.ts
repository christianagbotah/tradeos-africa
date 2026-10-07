import type { BusinessContext, CatalogItem, MePayload } from "./workspace-types";

const workspaceBootstrapKey = "tradeos.workspaceBootstrap.v1";

type WorkspaceBootstrap = {
  version: 1;
  savedAt: string;
  session: MePayload;
  context: BusinessContext;
  branchId: string;
  catalog: CatalogItem[];
};

export type WorkspaceBootstrapInput = Pick<WorkspaceBootstrap, "session" | "context" | "branchId" | "catalog">;

export function writeWorkspaceBootstrap(input: WorkspaceBootstrapInput): void {
  if (typeof localStorage === "undefined") return;
  const snapshot: WorkspaceBootstrap = {
    version: 1,
    savedAt: new Date().toISOString(),
    session: sanitizeSession(input.session),
    context: input.context,
    branchId: input.branchId,
    catalog: input.catalog,
  };
  if (!isWorkspaceBootstrap(snapshot)) return;
  try { localStorage.setItem(workspaceBootstrapKey, JSON.stringify(snapshot)); } catch { /* Offline bootstrap is best effort. */ }
}

export function readWorkspaceBootstrap(): WorkspaceBootstrapInput | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(workspaceBootstrapKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isWorkspaceBootstrap(parsed)) return null;
    return { session: parsed.session, context: parsed.context, branchId: parsed.branchId, catalog: parsed.catalog };
  } catch {
    return null;
  }
}

export function clearWorkspaceBootstrap(): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.removeItem(workspaceBootstrapKey); } catch { /* Storage can be unavailable in privacy modes. */ }
}

function sanitizeSession(session: MePayload): MePayload {
  return {
    user: { id: session.user.id, displayName: session.user.displayName, email: null, phoneE164: null },
    client: { platform: session.client.platform, deviceKey: "", appVersion: session.client.appVersion },
    memberships: session.memberships.map((membership) => ({ ...membership })),
  };
}

function isWorkspaceBootstrap(value: unknown): value is WorkspaceBootstrap {
  const row = record(value);
  if (!row || row.version !== 1 || typeof row.savedAt !== "string" || typeof row.branchId !== "string") return false;
  if (!validSession(row.session) || !validContext(row.context) || !Array.isArray(row.catalog)) return false;
  const session = row.session as MePayload;
  const context = row.context as BusinessContext;
  const membership = session.memberships.find((item) => item.businessId === context.business.id);
  if (!membership || membership.role !== context.membership.role || membership.staffId !== context.membership.staffId) return false;
  if (!context.branches.some((branch) => branch.id === row.branchId && branch.active)) return false;
  return row.catalog.every(validCatalogItem);
}

function validSession(value: unknown): value is MePayload {
  const row = record(value);
  const user = record(row?.user);
  const client = record(row?.client);
  if (!row || !user || !client || typeof user.id !== "string" || typeof user.displayName !== "string") return false;
  if (typeof client.platform !== "string" || typeof client.deviceKey !== "string" || typeof client.appVersion !== "string") return false;
  if (!Array.isArray(row.memberships)) return false;
  return row.memberships.every((entry) => {
    const item = record(entry);
    return Boolean(item && typeof item.id === "string" && typeof item.businessId === "string" && typeof item.businessName === "string" && typeof item.role === "string" && (typeof item.staffId === "string" || item.staffId === null));
  });
}

function validContext(value: unknown): value is BusinessContext {
  const row = record(value);
  const business = record(row?.business);
  const membership = record(row?.membership);
  if (!row || !business || !membership || typeof business.id !== "string" || typeof business.name !== "string" || typeof business.currencyCode !== "string" || typeof business.timezone !== "string") return false;
  if (typeof membership.role !== "string" || (typeof membership.staffId !== "string" && membership.staffId !== null)) return false;
  if (!Array.isArray(row.branches)) return false;
  return row.branches.every((entry) => {
    const branch = record(entry);
    return Boolean(branch && typeof branch.id === "string" && typeof branch.name === "string" && typeof branch.code === "string" && typeof branch.timezone === "string" && typeof branch.active === "boolean");
  });
}

function validCatalogItem(value: unknown): value is CatalogItem {
  const row = record(value);
  if (!row || typeof row.id !== "string" || typeof row.name !== "string" || typeof row.kind !== "string" || typeof row.active !== "boolean") return false;
  if (!Array.isArray(row.units) || !Array.isArray(row.conversions)) return false;
  return row.units.every((entry) => {
    const unit = record(entry);
    return Boolean(unit && typeof unit.code === "string" && typeof unit.label === "string" && typeof unit.canSell === "boolean" && (typeof unit.defaultSalePriceMinor === "number" || unit.defaultSalePriceMinor === null));
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

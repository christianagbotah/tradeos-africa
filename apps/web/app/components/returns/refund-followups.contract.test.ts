import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../../../../api/src/refund-followups.ts", import.meta.url), "utf8");
const worklistApi = readFileSync(new URL("../../../../api/src/sales-read.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("./refund-followup-panel.tsx", import.meta.url), "utf8");
const worklist = readFileSync(new URL("./refund-settlement-worklist.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../../../../packages/db/migrations/0058_refund_followup_events.sql", import.meta.url), "utf8");

describe("refund follow-up audit and escalation contract", () => {
  it("allows scoped member-only notes without payout-status changes", () => {
    expect(api).toContain('"/v1/refunds/followups"');
    expect(api).toContain("authenticateAccessToken(pool, headers.authorization)");
    expect(api).toContain("requireBusinessRole(pool, auth, businessId, ROLES)");
    expect(api).toContain("rc.branch_id=$3");
    expect(api).toContain("FOR UPDATE OF rt");
    expect(api).toContain("REFUND_FOLLOWUP_IDEMPOTENCY_CONFLICT");
    expect(api).toContain("payoutStatusUnchanged: true");
    expect(api).toContain('providerFinality: "NOT_ESTABLISHED"');
    expect(api).toContain('eventKind === "ESCALATION_REVIEWED"');
    expect(api).not.toContain("UPDATE refund_transactions SET status");
    expect(api).not.toContain("providerPayoutConfirmed: true");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OR DELETE");
    expect(migration).toContain("Refund follow-up evidence is append-only");
  });

  it("displays exact branch follow-up counts and escalation state on each refund", () => {
    expect(worklistApi).toContain("AS followup_count");
    expect(worklistApi).toContain("AS last_escalation_kind");
    expect(worklistApi).toContain('followupCount: safeMinor(row.followup_count)');
    expect(worklistApi).toContain('escalated: row.last_escalation_kind === "ESCALATED"');
    expect(worklist).toContain("item.followupCount");
    expect(worklist).toContain("item.escalated");
    expect(worklist).toContain("<RefundFollowupPanel");
    expect(worklist).toContain("setSelectedRefundId(null)");
  });

  it("rejects offline note submissions and preserves the request ID for retries", () => {
    expect(panel).toContain("!queue.online");
    expect(panel).toContain("pendingRequestId.current ?? crypto.randomUUID()");
    expect(panel).toContain('method: "POST"');
    expect(panel).toContain('cache: "no-store"');
    expect(panel).toContain("businessId, branchId, refundId, clientRequestId");
    expect(panel).toContain("pendingRequestId.current = null");
    expect(panel).toContain("onRecorded()");
    expect(panel).toContain("actorDisplayName");
    expect(panel).toContain("Payout status remains unchanged.");
  });
});

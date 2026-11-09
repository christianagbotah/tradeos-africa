import { describe, expect, it } from "vitest";
import type { BusinessActionItem, BusinessActionItemExplanation } from "@tradeos/contracts";
import { fetchBusinessActionItemExplanation, isBusinessActionItemActive, mutateBusinessActionItem } from "./business-action-items";

describe("business action item mutations", () => {
  it("marks an action item done with the tenant business id", async () => {
    const calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ item: { id: "action-1", status: "DONE" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await mutateBusinessActionItem(fetcher, {
      action: "complete",
      actionItemId: "action-1",
      businessId: "business-1",
      outcome: "NOT_RELEVANT",
    });

    expect(String(calls[0]?.input)).toBe("/v1/intelligence/action-items/action-1/complete");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ businessId: "business-1", outcome: "NOT_RELEVANT" });
    expect(result).toEqual({ id: "action-1", status: "DONE" });
  });

  it("snoozes an action item until the supplied future time", async () => {
    const calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ item: { id: "action-2", status: "SNOOZED" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const snoozedUntil = "2026-10-23T08:00:00.000Z";

    await mutateBusinessActionItem(fetcher, {
      action: "snooze",
      actionItemId: "action-2",
      businessId: "business-1",
      snoozedUntil,
    });

    expect(String(calls[0]?.input)).toBe("/v1/intelligence/action-items/action-2/snooze");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ businessId: "business-1", snoozedUntil });
  });

  it("surfaces the API error message instead of pretending the action succeeded", async () => {
    const fetcher = async () => new Response(JSON.stringify({ message: "Action item is already final" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    });

    await expect(mutateBusinessActionItem(fetcher, {
      action: "complete",
      actionItemId: "action-3",
      businessId: "business-1",
      outcome: "RESOLVED",
    })).rejects.toThrow("Action item is already final");
  });

  it("keeps future-snoozed work out of the active queue until its snooze expires", () => {
    const base: Omit<BusinessActionItem, "status" | "snoozedUntil"> = {
      id: "action-4",
      businessId: "business-1",
      branchId: null,
      sourceAttentionItemId: null,
      sourceAutomationRunId: null,
      sourceEntityType: null,
      sourceEntityId: null,
      createdByUserId: null,
      actionType: "FOLLOW_UP",
      title: "Follow up",
      reason: "Evidence",
      evidence: [],
      assignedUserId: null,
      assignedStaffId: null,
      dueAt: null,
      completedAt: null,
      completionOutcome: null,
      completedByUserId: null,
      createdAt: "2026-10-22T10:00:00.000Z",
      updatedAt: "2026-10-22T10:00:00.000Z",
    };
    const now = new Date("2026-10-22T12:00:00.000Z");

    expect(isBusinessActionItemActive({ ...base, status: "OPEN", snoozedUntil: null }, now)).toBe(true);
    expect(isBusinessActionItemActive({ ...base, status: "SNOOZED", snoozedUntil: "2026-10-23T12:00:00.000Z" }, now)).toBe(false);
    expect(isBusinessActionItemActive({ ...base, status: "SNOOZED", snoozedUntil: "2026-10-22T11:00:00.000Z" }, now)).toBe(true);
    expect(isBusinessActionItemActive({ ...base, status: "DONE", snoozedUntil: null }, now)).toBe(false);
  });
});


describe("business action item explanation fetch", () => {
  it("fetches one encoded read-only explanation only when invoked", async () => {
    const calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    const explanation = {
      businessId: "business/one",
      branchId: null,
      actionItemId: "action/one",
      generatedAt: "2026-10-24T12:00:00.000Z",
      sourceKind: "MANUAL",
      summary: "Review this task",
      action: { id: "action/one" },
      evidence: [],
    } as unknown as BusinessActionItemExplanation;
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify(explanation), { status: 200, headers: { "content-type": "application/json" } });
    };

    expect(calls).toHaveLength(0);
    const result = await fetchBusinessActionItemExplanation(fetcher, { businessId: "business/one", actionItemId: "action/one" });

    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe("/v1/intelligence/action-items/action%2Fone/explanation?businessId=business%2Fone");
    expect(calls[0]?.init?.method).toBeUndefined();
    expect(result).toEqual(explanation);
  });

  it("surfaces explanation API errors", async () => {
    const fetcher = async () => new Response(JSON.stringify({ message: "Explanation unavailable" }), {
      status: 403, headers: { "content-type": "application/json" },
    });
    await expect(fetchBusinessActionItemExplanation(fetcher, { businessId: "business-1", actionItemId: "action-1" }))
      .rejects.toThrow("Explanation unavailable");
  });
});

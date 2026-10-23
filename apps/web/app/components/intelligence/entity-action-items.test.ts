import { describe, expect, it } from "vitest";
import type { BusinessActionItem, BusinessEntityActionItemResponse } from "@tradeos/contracts";
import { createEntityActionItem } from "./entity-action-items";

const actionItem: BusinessActionItem = {
  businessId: "business-1",
  branchId: "branch-1",
  id: "action-1",
  sourceAttentionItemId: null,
  sourceAutomationRunId: null,
  sourceEntityType: "CUSTOMER",
  sourceEntityId: "customer-1",
  createdByUserId: "user-1",
  actionType: "CREATE_RECEIVABLE_FOLLOW_UP",
  title: "Follow up receivable: Customer One",
  reason: "Evidence-backed follow-up",
  evidence: [],
  assignedUserId: "user-1",
  assignedStaffId: "staff-1",
  dueAt: "2026-10-24T12:00:00.000Z",
  status: "OPEN",
  snoozedUntil: null,
  completedAt: null,
  createdAt: "2026-10-23T12:00:00.000Z",
  updatedAt: "2026-10-23T12:00:00.000Z",
};

const input = {
  businessId: "business-1",
  branchId: "branch-1",
  context: { entityType: "CUSTOMER" as const, entityId: "customer-1" },
};

describe("entity intelligence action item creation", () => {
  it("posts only tenant scope and structured entity context to the safe endpoint", async () => {
    const calls: Array<{ input: RequestInfo | URL; init: RequestInit | undefined }> = [];
    const fetcher = async (request: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: request, init });
      const payload: BusinessEntityActionItemResponse = { item: actionItem, created: true };
      return new Response(JSON.stringify(payload), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await createEntityActionItem(fetcher, input);

    expect(String(calls[0]?.input)).toBe("/v1/intelligence/entity/action-items");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(input);
    expect(result).toEqual({ item: actionItem, created: true });
  });

  it("returns an existing active task from a 200 idempotent response", async () => {
    const fetcher = async () => new Response(JSON.stringify({ item: actionItem, created: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    await expect(createEntityActionItem(fetcher, input)).resolves.toEqual({ item: actionItem, created: false });
  });

  it("surfaces the server error message instead of pretending the task was created", async () => {
    const fetcher = async () => new Response(JSON.stringify({ message: "Your role cannot create a review task for this record." }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });

    await expect(createEntityActionItem(fetcher, input)).rejects.toThrow("Your role cannot create a review task for this record.");
  });

  it("rejects an incomplete success response", async () => {
    const fetcher = async () => new Response(JSON.stringify({ created: true }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });

    await expect(createEntityActionItem(fetcher, input)).rejects.toThrow("incomplete entity action item response");
  });
});

import type { BusinessActionCompletionOutcome, BusinessActionItem, BusinessActionItemExplanation } from "@tradeos/contracts";
import { readApiErrorMessage } from "../../../lib/auth-fetch";

export type BusinessActionMutation =
  | {
      action: "complete";
      actionItemId: string;
      businessId: string;
      outcome: BusinessActionCompletionOutcome;
    }
  | {
      action: "snooze";
      actionItemId: string;
      businessId: string;
      snoozedUntil: string;
    };

type AuthenticatedFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function isBusinessActionItemActive(item: BusinessActionItem, now = new Date()): boolean {
  if (item.status === "OPEN") return true;
  if (item.status !== "SNOOZED") return false;
  if (!item.snoozedUntil) return true;
  const resumeAt = new Date(item.snoozedUntil);
  return !Number.isFinite(resumeAt.getTime()) || resumeAt.getTime() <= now.getTime();
}

export async function mutateBusinessActionItem(
  fetcher: AuthenticatedFetcher,
  input: BusinessActionMutation,
): Promise<BusinessActionItem> {
  const path = `/v1/intelligence/action-items/${encodeURIComponent(input.actionItemId)}/${input.action}`;
  const body = input.action === "snooze"
    ? { businessId: input.businessId, snoozedUntil: input.snoozedUntil }
    : { businessId: input.businessId, outcome: input.outcome };
  const response = await fetcher(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, "Action item could not be updated"));
  }
  const payload = await response.json() as { item?: BusinessActionItem };
  if (!payload.item) throw new Error("Server returned an incomplete action item response.");
  return payload.item;
}

export async function fetchBusinessActionItemExplanation(
  fetcher: AuthenticatedFetcher,
  input: { businessId: string; actionItemId: string },
): Promise<BusinessActionItemExplanation> {
  const path = `/v1/intelligence/action-items/${encodeURIComponent(input.actionItemId)}/explanation?businessId=${encodeURIComponent(input.businessId)}`;
  const response = await fetcher(path);
  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response, "Task explanation could not be loaded"));
  }
  return await response.json() as BusinessActionItemExplanation;
}

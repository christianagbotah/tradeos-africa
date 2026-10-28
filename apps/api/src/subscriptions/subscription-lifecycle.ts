export type SharedSubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "PAUSED" | "CANCELED" | "EXPIRED";

const CURRENT_SUBSCRIPTION_STATUSES = new Set<SharedSubscriptionStatus>(["TRIALING", "ACTIVE", "PAST_DUE", "PAUSED"]);

export function isCurrentSubscriptionStatus(status: string): status is SharedSubscriptionStatus {
  return CURRENT_SUBSCRIPTION_STATUSES.has(status as SharedSubscriptionStatus);
}

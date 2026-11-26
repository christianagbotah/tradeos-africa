/**
 * The cashier may begin serving another customer only when a sale has safely
 * reached a durable boundary. A server ACCEPTED/RECEIVED acknowledgement is
 * not a completed sale. Device-only capture is explicitly pending sync.
 *
 * This is a presentation / queue-clearing guard, NOT a payment settlement
 * authority. The canonical sync endpoint, accounting and provider state own
 * payment completion.
 */
export type QuickServeEvidence =
  | {
      source: "SERVER";
      mutationStatus: "RECEIVED" | "APPLIED" | "REJECTED" | "UNKNOWN";
      saleStatus: string | null;
    }
  | { source: "OFFLINE"; locallyPersisted: boolean };

export function mayStartNextQuickServeCustomer(evidence: QuickServeEvidence): boolean {
  if (evidence.source === "OFFLINE") return evidence.locallyPersisted === true;
  return evidence.mutationStatus === "APPLIED" && evidence.saleStatus === "COMPLETED";
}

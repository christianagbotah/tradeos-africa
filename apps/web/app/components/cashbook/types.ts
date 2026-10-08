export type CashbookCategory = { id: string; name: string; active: boolean };
export type CashbookEntry = { id: string; amountDeltaMinor: number; method: string; entryType: string; occurredAt: string };
export type CashbookExpense = { id: string; amountMinor: number; categoryName: string; description: string | null; payee: string | null; method: string };
export type CashbookSummaryData = { inflowMinor: number; outflowMinor: number; netMinor: number };
export type CashbookTotal = { method: string; balanceMinor: number; inflowMinor: number; outflowMinor: number };

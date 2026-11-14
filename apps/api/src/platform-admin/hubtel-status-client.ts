/**
 * Read-only Hubtel transaction status verification.
 * https://code.hubtel.com/docs/guides/reconciliation
 * Production callbacks do not provide a documented signature. Neither an
 * unsigned callback nor a customer return redirect confirms payment.
 * This does not initiate checkout, accept callbacks, or update subscriptions.
 */
export type HubtelStatus = "PAID" | "UNPAID" | "REFUNDED";

export interface HubtelStatusVerification {
  clientReference: string;
  collectionAccount: string;
  status: HubtelStatus;
  amountMinor: number | null;
  currencyCode: "GHS";
  transactionId: string | null;
  externalTransactionId: string | null;
  providerReportedAt: string | null;
  verifiedAt: string;
}

export interface HubtelStatusLookup {
  clientReference: string;
  expectedAmountMinor: number;
  currencyCode: string;
}

export interface HubtelStatusClientOptions {
  apiId: string;
  apiKey: string;
  collectionAccount: string;
  fetchImpl?: typeof fetch;
}

export class HubtelStatusError extends Error {
  constructor(message: string, readonly code: string, readonly statusCode: number) {
    super(message);
    this.name = "HubtelStatusError";
  }
}

const STATUS_HOST = "https://api-txnstatus.hubtel.com";
const REFERENCE = /^[A-Za-z0-9_-]{1,32}$/;

export class HubtelStatusClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: HubtelStatusClientOptions) {
    if (!options.apiId.trim() || !options.apiKey.trim() ||
        options.apiId.includes(":") || /[\r\n]/.test(options.apiId + options.apiKey) ||
        !REFERENCE.test(options.collectionAccount)) {
      throw new HubtelStatusError("Hubtel status authentication is not configured.",
        "HUBTEL_CONFIG_INVALID",503);
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async verifyStatus(lookup: HubtelStatusLookup): Promise<HubtelStatusVerification> {
    if (!REFERENCE.test(lookup.clientReference)) {
      throw new HubtelStatusError("Client reference is invalid.","HUBTEL_REFERENCE_INVALID",400);
    }
    if (!Number.isSafeInteger(lookup.expectedAmountMinor) || lookup.expectedAmountMinor <= 0 ||
        lookup.currencyCode !== "GHS") {
      throw new HubtelStatusError("Expected payment must be a positive Ghana cedi amount.",
        "HUBTEL_EXPECTED_PAYMENT_INVALID",400);
    }
    const url = new URL("/transactions/" +
      encodeURIComponent(this.options.collectionAccount) + "/status",STATUS_HOST);
    url.searchParams.set("clientReference",lookup.clientReference);
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(),{
        method:"GET",
        headers:{
          authorization:"Basic " +
            Buffer.from(this.options.apiId + ":" + this.options.apiKey).toString("base64"),
          accept:"application/json",
        },
        signal:AbortSignal.timeout(10000),
      });
    } catch {
      throw new HubtelStatusError("Hubtel status verification is unavailable.",
        "HUBTEL_STATUS_UNAVAILABLE",503);
    }
    if (!response.ok) {
      throw new HubtelStatusError("Hubtel status verification did not succeed.",
        "HUBTEL_STATUS_UNAVAILABLE",response.status >= 500 || response.status === 403 ||
          response.status === 401 || response.status === 429 ? 503 : 502);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new HubtelStatusError("Hubtel returned an unreadable status result.",
        "HUBTEL_STATUS_INVALID",502);
    }
    return verifyHubtelStatusPayload(payload,lookup,this.options.collectionAccount);
  }
}

/** Fail closed on unexpected status, mismatch, missing amount, or missing transaction ID. */
export function verifyHubtelStatusPayload(
  payload: unknown,
  lookup: HubtelStatusLookup,
  collectionAccount: string,
  verifiedAt = new Date().toISOString(),
): HubtelStatusVerification {
  if (!isRecord(payload) || payload.responseCode !== "0000" || !isRecord(payload.data)) {
    throw new HubtelStatusError("Hubtel returned an unverified transaction status.",
      "HUBTEL_STATUS_INVALID",502);
  }
  const data = payload.data;
  if (data.clientReference !== lookup.clientReference) {
    throw new HubtelStatusError("Hubtel transaction reference does not match this payment.",
      "HUBTEL_STATUS_REFERENCE_MISMATCH",409);
  }
  if (data.currencyCode != null && data.currencyCode !== "GHS") {
    throw new HubtelStatusError("Hubtel transaction currency does not match this payment.",
      "HUBTEL_STATUS_CURRENCY_MISMATCH",409);
  }
  const status: HubtelStatus | null = data.status === "Paid" ? "PAID" :
    data.status === "Unpaid" ? "UNPAID" :
    data.status === "Refunded" ? "REFUNDED" : null;
  if (status === null) {
    throw new HubtelStatusError("Hubtel status was not recognized.","HUBTEL_STATUS_INVALID",502);
  }
  const amountMinor = data.amount == null ? null : toMoneyMinor(data.amount);
  if ((status === "PAID" || status === "REFUNDED") &&
      amountMinor !== lookup.expectedAmountMinor) {
    throw new HubtelStatusError("Hubtel amount does not match the expected invoice payment.",
      "HUBTEL_STATUS_AMOUNT_MISMATCH",409);
  }
  const transactionId = ref(data.transactionId);
  if ((status === "PAID" || status === "REFUNDED") && transactionId === null) {
    throw new HubtelStatusError("Hubtel did not confirm a transaction identifier.",
      "HUBTEL_STATUS_INVALID",502);
  }
  const date = typeof data.date === "string" && Number.isFinite(Date.parse(data.date))
    ? new Date(data.date).toISOString() : null;
  return {
    clientReference:lookup.clientReference,collectionAccount,status,amountMinor,
    currencyCode:"GHS",transactionId,externalTransactionId:ref(data.externalTransactionId),
    providerReportedAt:date,verifiedAt,
  };
}

function ref(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 128
    ? value.trim() : null;
}
function isRecord(value:unknown):value is Record<string,unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function toMoneyMinor(value:unknown):number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new HubtelStatusError("Hubtel amount is invalid.","HUBTEL_STATUS_INVALID",502);
  }
  const raw = value * 100;
  const rounded = Math.round(raw);
  if (!Number.isSafeInteger(rounded) || Math.abs(raw-rounded) > 0.000001) {
    throw new HubtelStatusError("Hubtel amount is not representable as two-decimal money.",
      "HUBTEL_STATUS_INVALID",502);
  }
  return rounded;
}

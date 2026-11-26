/**
 * Hosted Hubtel Checkout creation, deliberately DISCONNECTED from API routes.
 * Official contract: https://code.hubtel.com/docs/guides/online-checkout
 *
 * A responseCode of 0000 here means "checkout created", NOT "payment paid".
 * Always reconcile independently via the transaction-status service.
 */
export interface HubtelCheckoutInput {
  clientReference: string;
  amountMinor: number;
  description: string;
  callbackUrl: string;
  returnUrl: string;
  cancellationUrl: string;
}

export interface HubtelCreatedCheckout {
  state: "CHECKOUT_CREATED_NOT_PAID";
  clientReference: string;
  checkoutId: string;
  checkoutUrl: string;
  checkoutDirectUrl: string;
}

export interface HubtelCheckoutClientOptions {
  apiId: string;
  apiKey: string;
  merchantAccountNumber: string;
  publicOrigin: string;
  fetchImpl?: typeof fetch;
}

export class HubtelCheckoutError extends Error {
  constructor(message:string,readonly code:string,readonly statusCode:number) {
    super(message);
    this.name="HubtelCheckoutError";
  }
}

const CHECKOUT_HOST="https://payproxyapi.hubtel.com";
const REFERENCE=/^[A-Za-z0-9_-]{1,32}$/;
const DESCRIPTION=/^[A-Za-z0-9 .-]{3,120}$/;
const CHECKOUT_PUBLIC_HOST="pay.hubtel.com";

function publicCheckoutUrl(value: unknown):string {
  if (typeof value!=="string") throw new HubtelCheckoutError(
    "Hubtel did not return a valid checkout URL.","HUBTEL_CHECKOUT_INVALID",502);
  let url:URL;
  try { url=new URL(value); } catch {
    throw new HubtelCheckoutError("Hubtel checkout URL is invalid.","HUBTEL_CHECKOUT_INVALID",502);
  }
  if (url.protocol!=="https:" || url.hostname!==CHECKOUT_PUBLIC_HOST ||
      url.port!=="" || url.username!=="" || url.password!=="" ||
      url.hash!=="" || url.pathname==="/" || url.pathname.startsWith("//")) {
    throw new HubtelCheckoutError(
      "Hubtel returned an untrusted checkout destination.","HUBTEL_CHECKOUT_INVALID",502);
  }
  return url.toString();
}

function trustedLocalUrl(value: string,origin:URL,label:string):string {
  let url:URL;
  try { url=new URL(value); } catch {
    throw new HubtelCheckoutError(label+" must be an absolute HTTPS URL.",
      "HUBTEL_CHECKOUT_URL_INVALID",400);
  }
  if (url.origin!==origin.origin || url.protocol!=="https:" ||
      url.username!=="" || url.password!=="" || url.hash!=="" ||
      url.pathname==="/" || url.pathname.startsWith("//")) {
    throw new HubtelCheckoutError(label+" must remain on the configured merchant HTTPS origin.",
      "HUBTEL_CHECKOUT_URL_INVALID",400);
  }
  return url.toString();
}

function safeOrigin(input:string):URL {
  let url:URL;
  try { url=new URL(input); } catch {
    throw new HubtelCheckoutError("Merchant public origin is invalid.","HUBTEL_CHECKOUT_CONFIG_INVALID",503);
  }
  if(url.protocol!=="https:" || !url.hostname || url.username || url.password ||
    url.pathname!=="/" || url.search || url.hash || url.port ||
    url.hostname==="localhost" || url.hostname==="127.0.0.1") {
    throw new HubtelCheckoutError("Merchant public HTTPS origin is invalid.",
      "HUBTEL_CHECKOUT_CONFIG_INVALID",503);
  }
  return url;
}

export class HubtelCheckoutClient {
  private readonly fetchImpl:typeof fetch;
  private readonly origin:URL;

  constructor(private readonly options:HubtelCheckoutClientOptions) {
    if (!options.apiId.trim() || !options.apiKey.trim() ||
        options.apiId.includes(":") || /[\r\n]/.test(options.apiId+options.apiKey) ||
        !REFERENCE.test(options.merchantAccountNumber)) {
      throw new HubtelCheckoutError("Hubtel checkout credentials are invalid.",
        "HUBTEL_CHECKOUT_CONFIG_INVALID",503);
    }
    this.origin=safeOrigin(options.publicOrigin);
    this.fetchImpl=options.fetchImpl ?? fetch;
  }

  async initiate(input:HubtelCheckoutInput):Promise<HubtelCreatedCheckout> {
    if (!REFERENCE.test(input.clientReference)) {
      throw new HubtelCheckoutError("Checkout reference is invalid.",
        "HUBTEL_CHECKOUT_REFERENCE_INVALID",400);
    }
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor<=0 ||
        input.amountMinor>90071992547409) {
      throw new HubtelCheckoutError("Checkout amount is invalid.",
        "HUBTEL_CHECKOUT_AMOUNT_INVALID",400);
    }
    if (!DESCRIPTION.test(input.description.trim())) {
      throw new HubtelCheckoutError("Checkout description must contain simple text.",
        "HUBTEL_CHECKOUT_DESCRIPTION_INVALID",400);
    }
    const callbackUrl=trustedLocalUrl(input.callbackUrl,this.origin,"Callback URL");
    const returnUrl=trustedLocalUrl(input.returnUrl,this.origin,"Return URL");
    const cancellationUrl=trustedLocalUrl(input.cancellationUrl,this.origin,"Cancellation URL");

    let response:Response;
    try {
      response=await this.fetchImpl(CHECKOUT_HOST+"/items/initiate",{
        method:"POST",
        headers:{
          "content-type":"application/json",
          accept:"application/json",
          authorization:"Basic "+
            Buffer.from(this.options.apiId+":"+this.options.apiKey).toString("base64"),
        },
        body:JSON.stringify({
          totalAmount:input.amountMinor/100,
          description:input.description.trim(),
          callbackUrl,returnUrl,cancellationUrl,
          merchantAccountNumber:this.options.merchantAccountNumber,
          clientReference:input.clientReference,
        }),
        signal:AbortSignal.timeout(10000),
      });
    } catch {
      throw new HubtelCheckoutError("Hubtel checkout is temporarily unavailable.",
        "HUBTEL_CHECKOUT_UNAVAILABLE",503);
    }
    if(!response.ok) {
      throw new HubtelCheckoutError("Hubtel could not create the hosted checkout.",
        "HUBTEL_CHECKOUT_UNAVAILABLE",503);
    }
    let raw:unknown;
    try { raw=await response.json(); } catch {
      throw new HubtelCheckoutError("Hubtel checkout response was unreadable.",
        "HUBTEL_CHECKOUT_INVALID",502);
    }
    return parseCreatedHubtelCheckout(raw,input.clientReference);
  }
}

export function parseCreatedHubtelCheckout(
  raw:unknown,expectedReference:string,
):HubtelCreatedCheckout {
  if (!isRecord(raw) || raw.responseCode!=="0000" ||
      raw.status!=="Success" || !isRecord(raw.data)) {
    throw new HubtelCheckoutError("Hubtel has not confirmed checkout creation.",
      "HUBTEL_CHECKOUT_INVALID",502);
  }
  const data=raw.data;
  if (data.clientReference!==expectedReference ||
      typeof data.checkoutId!=="string" ||
      !/^[A-Za-z0-9-]{8,100}$/.test(data.checkoutId)) {
    throw new HubtelCheckoutError("Hubtel checkout identity does not match the request.",
      "HUBTEL_CHECKOUT_IDENTITY_MISMATCH",409);
  }
  const checkoutUrl=publicCheckoutUrl(data.checkoutUrl);
  const checkoutDirectUrl=publicCheckoutUrl(data.checkoutDirectUrl);
  return {
    state:"CHECKOUT_CREATED_NOT_PAID",
    clientReference:expectedReference,
    checkoutId:data.checkoutId,
    checkoutUrl,checkoutDirectUrl,
  };
}

function isRecord(value:unknown):value is Record<string,unknown> {
  return typeof value==="object" && value!==null && !Array.isArray(value);
}

import { describe, expect, it } from "vitest";
import {
  HubtelStatusClient, HubtelStatusError, verifyHubtelStatusPayload,
} from "../src/platform-admin/hubtel-status-client.js";

const reference="INV123-01";
const expected={clientReference:reference,expectedAmountMinor:4500,currencyCode:"GHS"};
const paid={
  message:"Successful",responseCode:"0000",
  data:{
    clientReference:reference,status:"Paid",amount:45,
    transactionId:"provider-transaction-101",
    externalTransactionId:"network-33",currencyCode:null,
    date:"2026-11-14T02:30:00Z",
  },
};
const options={apiId:"test-id",apiKey:"test-private-key",collectionAccount:"11684"};

function client(fetchImpl:typeof fetch){
  return new HubtelStatusClient({...options,fetchImpl});
}

describe("Hubtel verified collection status",()=>{
  it("checks the exact Hubtel status endpoint with server-held credentials",async()=>{
    let calls=0;
    const fetchImpl=(async(input:RequestInfo|URL, init?:RequestInit)=>{
      calls+=1;
      expect(String(input)).toBe(
        "https://api-txnstatus.hubtel.com/transactions/11684/status?clientReference=INV123-01",
      );
      expect(init?.method).toBe("GET");
      const auth=(init?.headers as Record<string,string>).authorization;
      expect(auth).toBe("Basic "+Buffer.from("test-id:test-private-key").toString("base64"));
      expect(String(init?.body)).toBe("undefined");
      return new Response(JSON.stringify(paid),{status:200});
    }) as typeof fetch;
    const response=await client(fetchImpl).verifyStatus(expected);
    expect(calls).toBe(1);
    expect(response).toMatchObject({
      clientReference:reference,collectionAccount:"11684",status:"PAID",amountMinor:4500,
      currencyCode:"GHS",transactionId:"provider-transaction-101",
      externalTransactionId:"network-33",providerReportedAt:"2026-11-14T02:30:00.000Z",
    });
  });

  it("accepts an unpaid status without reporting it as a paid invoice",()=>{
    const unpaid={...paid,data:{...paid.data,status:"Unpaid",amount:null,transactionId:null}};
    const response=verifyHubtelStatusPayload(unpaid,expected,"11684");
    expect(response.status).toBe("UNPAID");
    expect(response.amountMinor).toBeNull();
    expect(response.transactionId).toBeNull();
  });

  it("retains refunded as a distinct state, never a successful collection",()=>{
    const response=verifyHubtelStatusPayload(
      {...paid,data:{...paid.data,status:"Refunded"}},expected,"11684");
    expect(response.status).toBe("REFUNDED");
    expect(response.amountMinor).toBe(4500);
  });

  it("rejects wrong reference, amount, currency, missing ID and unknown status",()=>{
    const samples=[
      [{...paid,data:{...paid.data,clientReference:"other-ref"}},"HUBTEL_STATUS_REFERENCE_MISMATCH"],
      [{...paid,data:{...paid.data,amount:44.99}},"HUBTEL_STATUS_AMOUNT_MISMATCH"],
      [{...paid,data:{...paid.data,currencyCode:"USD"}},"HUBTEL_STATUS_CURRENCY_MISMATCH"],
      [{...paid,data:{...paid.data,transactionId:null}},"HUBTEL_STATUS_INVALID"],
      [{...paid,data:{...paid.data,status:"Pending"}},"HUBTEL_STATUS_INVALID"],
      [{...paid,responseCode:"0001"},"HUBTEL_STATUS_INVALID"],
      [{...paid,data:{...paid.data,amount:44.999}},"HUBTEL_STATUS_INVALID"],
    ] as const;
    for(const [payload,code] of samples){
      expect(()=>verifyHubtelStatusPayload(payload,expected,"11684"))
        .toThrowError(expect.objectContaining({code}));
    }
  });

  it("does not accept missing auth configuration, unsupported currency or bad reference",async()=>{
    expect(()=>new HubtelStatusClient({...options,apiKey:""}))
      .toThrowError(expect.objectContaining({code:"HUBTEL_CONFIG_INVALID"}));
    const failFetch=(async()=>{ throw new Error("Network request must not happen"); }) as typeof fetch;
    const instance=client(failFetch);
    await expect(instance.verifyStatus({...expected,clientReference:"../../secrets"}))
      .rejects.toMatchObject({code:"HUBTEL_REFERENCE_INVALID",statusCode:400});
    await expect(instance.verifyStatus({...expected,currencyCode:"USD"}))
      .rejects.toMatchObject({code:"HUBTEL_EXPECTED_PAYMENT_INVALID",statusCode:400});
  });

  it("treats 403 IP-allowlist failures, malformed responses and outages as unavailable",async()=>{
    const denied=client((async()=>new Response("Forbidden",{status:403})) as typeof fetch);
    await expect(denied.verifyStatus(expected))
      .rejects.toMatchObject({code:"HUBTEL_STATUS_UNAVAILABLE",statusCode:503});
    const offline=client((async()=>{throw new Error("Connection lost");}) as typeof fetch);
    await expect(offline.verifyStatus(expected))
      .rejects.toMatchObject({code:"HUBTEL_STATUS_UNAVAILABLE",statusCode:503});
    const invalid=client((async()=>new Response("<not JSON>",{status:200})) as typeof fetch);
    await expect(invalid.verifyStatus(expected))
      .rejects.toMatchObject({code:"HUBTEL_STATUS_INVALID",statusCode:502});
  });
});

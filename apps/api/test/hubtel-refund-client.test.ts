import { describe,expect,it,vi } from "vitest";
import {
  HubtelRefundClient,parseHubtelRefundPending,validateHubtelRefund,
} from "../src/providers/hubtel-refund-client.js";

const NOW=new Date("2026-11-15T16:00:00.000Z");
const original={
  orderId:"a4e406711db74687bbd307ead23bd015",
  originalPaidAt:"2026-11-01T10:00:00Z",
  originalPaymentAmountMinor:5000,
  requestedRefundAmountMinor:5000,
  verifiedOriginalPayment:true,
  callbackUrl:"https://tradeosafrica.lightworldtech.com/v1/provider/hubtel/refunds",
};
const config={
  apiId:"unit-test-key-id",apiKey:"unit-test-key-secret",
  collectionAccount:"11684",publicOrigin:"https://tradeosafrica.lightworldtech.com",
  now:()=>NOW,
};
const accepted={message:"Transaction pending. Expect callback request for final state.",
  responseCode:"0001",data:{orderId:original.orderId}};
describe("Hubtel refund safety",()=>{
  it("initiates a full-order refund and reports PENDING, never success",async()=>{
    const fetchImpl=vi.fn(async(url:string,init:RequestInit)=>{
      expect(url).toBe("https://refund-api.hubtel.com/refund/11684/order/"+original.orderId);
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({callbackUrl:original.callbackUrl});
      expect((init.headers as Record<string,string>).authorization).toBe(
        "Basic "+Buffer.from(config.apiId+":"+config.apiKey).toString("base64"));
      return new Response(JSON.stringify(accepted),{status:200});
    }) as unknown as typeof fetch;
    const r=await new HubtelRefundClient({...config,fetchImpl}).requestRefund(original);
    expect(r).toEqual({state:"REFUND_PENDING_UNVERIFIED",orderId:original.orderId});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("rejects partial refund, unverified originals, sub-one-cedi and unsafe redirect before any network call",async()=>{
    const fetchImpl=vi.fn() as unknown as typeof fetch;
    const client=new HubtelRefundClient({...config,fetchImpl});
    for(const [partial,code] of [
      [{requestedRefundAmountMinor:2500},"HUBTEL_REFUND_FULL_ORDER_ONLY"],
      [{originalPaymentAmountMinor:50,requestedRefundAmountMinor:50},"HUBTEL_REFUND_FULL_ORDER_ONLY"],
      [{verifiedOriginalPayment:false},"HUBTEL_REFUND_PAYMENT_UNVERIFIED"],
      [{orderId:"../admin"},"HUBTEL_REFUND_ORDER_INVALID"],
      [{callbackUrl:"https://attacker.example/payout"},"HUBTEL_REFUND_CALLBACK_INVALID"],
      [{callbackUrl:"http://tradeosafrica.lightworldtech.com/payout"},"HUBTEL_REFUND_CALLBACK_INVALID"],
      [{originalPaidAt:"2026-09-15T10:00:00Z"},"HUBTEL_REFUND_WINDOW_EXPIRED"],
      [{originalPaidAt:"2026-11-16T10:00:00Z"},"HUBTEL_REFUND_WINDOW_EXPIRED"],
    ] as const){
      await expect(client.requestRefund({...original,...partial})).rejects.toMatchObject({code});
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("accepts a 45-day boundary but not a 46-day transaction",()=>{
    const exact={...original,originalPaidAt:"2026-10-01T16:00:00Z"};
    expect(validateHubtelRefund(exact,config.collectionAccount,config.publicOrigin,NOW))
      .toMatchObject({orderId:original.orderId});
    expect(()=>validateHubtelRefund({...exact,originalPaidAt:"2026-09-30T16:00:00Z"},
      config.collectionAccount,config.publicOrigin,NOW))
      .toThrowError(expect.objectContaining({code:"HUBTEL_REFUND_WINDOW_EXPIRED"}));
  });
  it("rejects response mismatches and provider refusal",async()=>{
    for(const v of [
      {...accepted,responseCode:"0000"},
      {...accepted,data:{orderId:"anotherOrder123"}},
      {...accepted,data:null},
      {},
    ]) expect(()=>parseHubtelRefundPending(v,original.orderId))
      .toThrowError(expect.objectContaining({code:"HUBTEL_REFUND_RESPONSE_INVALID"}));
    const denied=new HubtelRefundClient({...config,fetchImpl:(async()=>new Response("invalid",{status:404})) as typeof fetch});
    await expect(denied.requestRefund(original)).rejects.toMatchObject({
      code:"HUBTEL_REFUND_NOT_ACCEPTED",
    });
    const timed=new HubtelRefundClient({...config,fetchImpl:(async()=>{throw new Error("timeout")}) as typeof fetch});
    await expect(timed.requestRefund(original)).rejects.toMatchObject({
      code:"HUBTEL_REFUND_OUTCOME_UNKNOWN",
    });
  });
});

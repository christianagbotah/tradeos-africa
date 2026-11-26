import { describe,expect,it } from "vitest";
import {
  HubtelCheckoutClient,parseCreatedHubtelCheckout,
} from "../src/platform-admin/hubtel-checkout-client.js";

const options={
  apiId:"internal-api-id",
  apiKey:"internal-private-key",
  merchantAccountNumber:"11684",
  publicOrigin:"https://tradeosafrica.lightworldtech.com",
};
const input={
  clientReference:"TradeOS-INV-1234",
  amountMinor:4550,
  description:"TradeOS subscription INV 1234",
  callbackUrl:"https://tradeosafrica.lightworldtech.com/api/billing/hubtel/callback",
  returnUrl:"https://tradeosafrica.lightworldtech.com/settings?section=billing",
  cancellationUrl:"https://tradeosafrica.lightworldtech.com/settings?section=billing&cancelled=1",
};
const created={
  responseCode:"0000",status:"Success",
  data:{
    checkoutUrl:"https://pay.hubtel.com/7569a11e8b784f21baa9443b3fce31ed",
    checkoutDirectUrl:"https://pay.hubtel.com/7569a11e8b784f21baa9443b3fce31ed/direct",
    checkoutId:"7569a11e8b784f21baa9443b3fce31ed",
    clientReference:input.clientReference,
  },
};
const mockResponse=(payload:unknown,status=200)=>
  new Response(JSON.stringify(payload),{status,headers:{"content-type":"application/json"}});

describe("Hubtel hosted checkout initiation is not payment confirmation",()=>{
  it("uses only Hubtel's checkout host, exact minor-unit amount and server Basic auth",async()=>{
    let calls=0;
    const fetchImpl=(async (url:RequestInfo|URL,init?:RequestInit)=>{
      calls++;
      expect(String(url)).toBe("https://payproxyapi.hubtel.com/items/initiate");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string,string>).authorization).toBe(
        "Basic "+Buffer.from(options.apiId+":"+options.apiKey).toString("base64"));
      expect(JSON.parse(String(init?.body))).toEqual({
        totalAmount:45.50,
        description:input.description,
        callbackUrl:input.callbackUrl,returnUrl:input.returnUrl,
        cancellationUrl:input.cancellationUrl,
        merchantAccountNumber:options.merchantAccountNumber,
        clientReference:input.clientReference,
      });
      return mockResponse(created);
    }) as typeof fetch;
    const client=new HubtelCheckoutClient({...options,fetchImpl});
    await expect(client.initiate(input)).resolves.toMatchObject({
      state:"CHECKOUT_CREATED_NOT_PAID",
      clientReference:input.clientReference,
      checkoutUrl:created.data.checkoutUrl,
      checkoutId:created.data.checkoutId,
    });
    expect(calls).toBe(1);
  });

  it("rejects mismatched checkout IDs, malicious destinations and unknown response statuses",()=>{
    const payloads=[
      [{...created,data:{...created.data,clientReference:"someone-else"}},
        "HUBTEL_CHECKOUT_IDENTITY_MISMATCH"],
      [{...created,data:{...created.data,checkoutUrl:"https://fake-pay.hubtel.com/phish"}},
        "HUBTEL_CHECKOUT_INVALID"],
      [{...created,data:{...created.data,checkoutDirectUrl:"http://pay.hubtel.com/test"}},
        "HUBTEL_CHECKOUT_INVALID"],
      [{...created,data:{...created.data,checkoutId:"!"}},
        "HUBTEL_CHECKOUT_IDENTITY_MISMATCH"],
      [{...created,responseCode:"2001"},"HUBTEL_CHECKOUT_INVALID"],
      [{...created,status:"Pending"},"HUBTEL_CHECKOUT_INVALID"],
      [{...created,data:{...created.data,checkoutUrl:"https://pay.hubtel.com/"}},
        "HUBTEL_CHECKOUT_INVALID"],
    ] as const;
    for(const [payload,code] of payloads) {
      expect(()=>parseCreatedHubtelCheckout(payload,input.clientReference))
        .toThrowError(expect.objectContaining({code}));
    }
  });

  it("does not call Hubtel for invalid amount, reference or callbacks",async()=>{
    let calls=0;
    const fetchImpl=(async()=>{calls++;throw Error("Unexpected outgoing payment request");}) as typeof fetch;
    const c=new HubtelCheckoutClient({...options,fetchImpl});
    const invalid=[
      [{...input,amountMinor:0},"HUBTEL_CHECKOUT_AMOUNT_INVALID"],
      [{...input,amountMinor:0.5},"HUBTEL_CHECKOUT_AMOUNT_INVALID"],
      [{...input,clientReference:"../secret"},"HUBTEL_CHECKOUT_REFERENCE_INVALID"],
      [{...input,description:"Bad@description"},"HUBTEL_CHECKOUT_DESCRIPTION_INVALID"],
      [{...input,returnUrl:"https://attacker.example/steal"},"HUBTEL_CHECKOUT_URL_INVALID"],
      [{...input,callbackUrl:"http://tradeosafrica.lightworldtech.com/api/callback"},
        "HUBTEL_CHECKOUT_URL_INVALID"],
      [{...input,cancellationUrl:"https://tradeosafrica.lightworldtech.com/"},
        "HUBTEL_CHECKOUT_URL_INVALID"],
    ] as const;
    for(const [request,code] of invalid) {
      await expect(c.initiate(request)).rejects.toMatchObject({code});
    }
    expect(calls).toBe(0);
  });

  it("rejects missing credentials and unsafe non-HTTPS merchant origins",()=>{
    expect(()=>new HubtelCheckoutClient({...options,apiId:""}))
      .toThrowError(expect.objectContaining({code:"HUBTEL_CHECKOUT_CONFIG_INVALID"}));
    expect(()=>new HubtelCheckoutClient({...options,publicOrigin:"http://localhost:3036"}))
      .toThrowError(expect.objectContaining({code:"HUBTEL_CHECKOUT_CONFIG_INVALID"}));
  });

  it("fails closed when network errors, provider rejects or malformed data is returned",async()=>{
    const disconnected=new HubtelCheckoutClient({
      ...options,fetchImpl:(async()=>{throw Error("timeout");}) as typeof fetch,
    });
    await expect(disconnected.initiate(input))
      .rejects.toMatchObject({code:"HUBTEL_CHECKOUT_UNAVAILABLE",statusCode:503});
    const rejected=new HubtelCheckoutClient({
      ...options,fetchImpl:(async()=>mockResponse({responseCode:"2001"},403)) as typeof fetch,
    });
    await expect(rejected.initiate(input))
      .rejects.toMatchObject({code:"HUBTEL_CHECKOUT_UNAVAILABLE",statusCode:503});
    const malformed=new HubtelCheckoutClient({
      ...options,fetchImpl:(async()=>new Response("bad json",{status:200})) as typeof fetch,
    });
    await expect(malformed.initiate(input))
      .rejects.toMatchObject({code:"HUBTEL_CHECKOUT_INVALID",statusCode:502});
  });
});

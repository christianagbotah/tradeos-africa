import {describe,expect,it,vi} from "vitest";
import {PaystackHostedAdapter,FlutterwaveHostedAdapter} from
  "../src/payment-providers/hosted-adapters.js";
const request={
  reference:"TSP_PROVIDER_2026",amountMinor:15750,currencyCode:"GHS",
  customerEmail:"buyer@example.test",
  returnUrl:"https://tradeosafrica.lightworldtech.com/sales",
  method:"MOMO" as const,
};
const secret="sk_test_merchant_secret_key";
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,
  headers:{"content-type":"application/json"}});
describe("unactivated hosted gateway clients",()=>{
  it("creates Paystack MoMo checkout server-side, then validates paid provider evidence",async()=>{
    const fetchMock=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
      expect((init?.headers as Record<string,string>).authorization).toBe("Bearer "+secret);
      if(String(url).endsWith("/initialize")){
        expect(init?.method).toBe("POST");
        const body=JSON.parse(String(init?.body));
        expect(body).toMatchObject({amount:15750,currency:"GHS",reference:request.reference,
          channels:["mobile_money"],email:request.customerEmail});
        return json({status:true,data:{
          reference:request.reference,
          authorization_url:"https://checkout.paystack.com/approved123"}});
      }
      expect(String(url)).toContain("/transaction/verify/TSP_PROVIDER_2026");
      return json({status:true,data:{
        reference:request.reference,status:"success",amount:15750,
        currency:"GHS",channel:"mobile_money",id:6754343}});
    });
    const adapter=new PaystackHostedAdapter(secret,fetchMock as typeof fetch);
    expect((await adapter.initialize(request)).checkoutUrl)
      .toBe("https://checkout.paystack.com/approved123");
    expect(await adapter.verify(request)).toMatchObject({
      status:"PAID",reference:request.reference,amountMinor:15750,
      currencyCode:"GHS",method:"MOMO",transactionId:"6754343"});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("will not treat payment amount mismatch or wrong Paystack channel as paid",async()=>{
    const adapter=new PaystackHostedAdapter(secret,async()=>json({
      status:true,data:{reference:request.reference,status:"success",
        amount:15700,currency:"GHS",channel:"card",id:2},
    }));
    await expect(adapter.verify(request)).rejects.toMatchObject({
      code:"GATEWAY_VERIFICATION_MISMATCH"});
  });
  it("rejects untrusted Paystack destinations and does not leak HTTP auth response body",async()=>{
    const unsafe=new PaystackHostedAdapter(secret,async()=>json({
      status:true,data:{reference:request.reference,
        authorization_url:"https://evil.example/pay?token=secret"},
    }));
    await expect(unsafe.initialize(request)).rejects.toMatchObject({
      code:"GATEWAY_CHECKOUT_URL_INVALID"});
    const denied=new PaystackHostedAdapter(secret,async()=>json(
      {apiKey:"private-provider-token"},403));
    await expect(denied.verify(request)).rejects.toMatchObject({
      code:"GATEWAY_NOT_AUTHORIZED",statusCode:503});
  });
  it("validates Flutterwave link and verifies exact reference, amount, method and provider ID",async()=>{
    const fetchMock=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
      if(String(url).endsWith("/payments")){
        const body=JSON.parse(String(init?.body));
        expect(body).toMatchObject({tx_ref:request.reference,amount:"157.50",
          payment_options:"mobilemoneyghana",currency:"GHS"});
        return json({status:"success",data:{
          link:"https://checkout.flutterwave.com/v3/hosted/pay/example"}});
      }
      expect(String(url)).toMatch(/\/transactions\/12345\/verify$/);
      return json({status:"success",data:{
        id:12345,tx_ref:request.reference,status:"successful",
        amount:157.5,currency:"GHS",payment_type:"mobilemoneyghana"}});
    });
    const adapter=new FlutterwaveHostedAdapter(secret,fetchMock as typeof fetch);
    expect((await adapter.initialize(request)).checkoutUrl)
      .toContain("checkout.flutterwave.com");
    expect(await adapter.verify(request,"12345")).toMatchObject({
      status:"PAID",transactionId:"12345",amountMinor:15750,method:"MOMO"});
  });
  it("uses currency-specific major amounts for zero-minor-unit mobile wallets",async()=>{
    const req={...request,currencyCode:"UGX",amountMinor:1540};
    const fetchMock=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
      if(String(url).endsWith("/payments")){
        const body=JSON.parse(String(init?.body));
        expect(body.amount).toBe("1540");
        expect(body.payment_options).toBe("mobilemoneyuganda");
        return json({status:"success",data:{
          link:"https://checkout.flutterwave.com/v3/hosted/pay/ugx"}});
      }
      return json({status:"success",data:{
        id:812,tx_ref:req.reference,status:"successful",amount:1540,
        currency:"UGX",payment_type:"mobilemoneyuganda"}});
    });
    const adapter=new FlutterwaveHostedAdapter(secret,fetchMock as typeof fetch);
    await adapter.initialize(req);
    expect(await adapter.verify(req,"812")).toMatchObject({
      status:"PAID",amountMinor:1540,currencyCode:"UGX",method:"MOMO"});
  });
  it("holds Flutterwave payment on unknown payment type or wrong currency",async()=>{
    const adapter=new FlutterwaveHostedAdapter(secret,async()=>json({
      status:"success",data:{id:12345,tx_ref:request.reference,status:"successful",
        amount:157.5,currency:"USD",payment_type:"card"}}));
    await expect(adapter.verify(request,"12345")).rejects.toMatchObject({
      code:"GATEWAY_VERIFICATION_MISMATCH"});
  });
  it("does not initiate payments with fabricated buyer email or unsupported MoMo",async()=>{
    const noNetwork=vi.fn(async()=>{throw new Error("must not call provider")});
    const paystack=new PaystackHostedAdapter(secret,noNetwork as typeof fetch);
    await expect(paystack.initialize({...request,customerEmail:""}))
      .rejects.toMatchObject({code:"GATEWAY_REQUEST_INVALID"});
    await expect(paystack.initialize({...request,returnUrl:"https://not-our-app.example/return"}))
      .rejects.toMatchObject({code:"GATEWAY_RETURN_URL_INVALID"});
    const flutterwave=new FlutterwaveHostedAdapter(secret,noNetwork as typeof fetch);
    await expect(flutterwave.initialize({...request,currencyCode:"EUR"}))
      .rejects.toMatchObject({code:"GATEWAY_METHOD_UNSUPPORTED"});
    expect(noNetwork).not.toHaveBeenCalled();
  });
});

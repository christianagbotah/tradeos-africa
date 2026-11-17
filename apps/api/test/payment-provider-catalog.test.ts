import {describe,expect,it} from "vitest";
import {availableGateways,gatewayFor,gatewaySupported,GATEWAYS} from
  "../src/payment-providers/catalog.js";

describe("country-aware merchant payment gateway discovery",()=>{
  it("offers Ghanaian options without pretending Stripe has local Ghana accounts",()=>{
    const byCode=Object.fromEntries(availableGateways("GH","GHS").map(p=>[p.code,p]));
    for(const code of ["HUBTEL","PAYSTACK","FLUTTERWAVE","DPO"]){
      expect(byCode[code]?.eligible,code).toBe(true);
    }
    expect(byCode.STRIPE?.eligible).toBe(false);
    expect(byCode.PESAPAL?.eligible).toBe(false);
    expect(byCode.HUBTEL?.integrationStage).toBe("EXISTING_GATED");
    expect(byCode.PAYSTACK?.integrationStage).toBe("PLANNED");
    expect(byCode.STRIPE?.methods).toContain("CARD");
    expect(byCode.PAYSTACK?.methods).toContain("MOMO");
    expect(availableGateways("NG","NGN").find(p=>p.code==="PAYSTACK")?.methods)
      .toEqual(["CARD","BANK"]);
  });
  it("offers regional or European options based on merchant location and currency",()=>{
    expect(gatewaySupported(gatewayFor("PAYSTACK")!,"NG","NGN")).toBe(true);
    expect(gatewaySupported(gatewayFor("PAYSTACK")!,"GH","USD")).toBe(false);
    expect(gatewaySupported(gatewayFor("FLUTTERWAVE")!,"UG","UGX")).toBe(true);
    expect(gatewaySupported(gatewayFor("PESAPAL")!,"KE","KES")).toBe(true);
    expect(gatewaySupported(gatewayFor("MPESA")!,"KE","KES")).toBe(true);
    expect(gatewaySupported(gatewayFor("STRIPE")!,"DE","EUR")).toBe(true);
    expect(gatewaySupported(gatewayFor("STRIPE")!,"GB","GBP")).toBe(true);
    expect(gatewaySupported(gatewayFor("HUBTEL")!,"DE","EUR")).toBe(false);
    expect(gatewaySupported(gatewayFor("FLUTTERWAVE")!,"GH","EUR")).toBe(false);
    expect(gatewayFor("UNKNOWN")).toBeNull();
    expect(new Set(GATEWAYS.map(g=>g.code)).size).toBe(GATEWAYS.length);
  });
});

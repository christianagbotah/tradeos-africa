import {describe,expect,it} from "vitest";
import {evaluateVoicePaymentSuggestion as evaluate} from "./voice-payment-review";
const hint={paymentState:"PARTIAL" as const,tenderedMinor:2500};
const defaults={
  suggestion:hint,paymentMethod:"CASH",online:true,
  pricingVerified:true,hubtelSelected:false,totalMinor:10000,
  activeCustomer:true,availableCreditMinor:15000,
};
describe("spoken payment guidance cannot mark money paid",()=>{
  it("offers a cash-and-credit split only after customer and credit checks",()=>{
    expect(evaluate(defaults).action).toBe("SPLIT_CASH");
    expect(evaluate({...defaults,activeCustomer:false}).action).toBe(null);
    expect(evaluate({...defaults,availableCreditMinor:7400}).action).toBe(null);
    expect(evaluate({...defaults,suggestion:{...hint,tenderedMinor:11000}}).action).toBe(null);
    expect(evaluate({...defaults,online:false}).action).toBe(null);
  });
  it("requires cash and verified prices; electronic payments are never settled by voice",()=>{
    expect(evaluate({...defaults,paymentMethod:"MOMO"}).action).toBe(null);
    expect(evaluate({...defaults,hubtelSelected:true}).action).toBe(null);
    expect(evaluate({...defaults,pricingVerified:false}).action).toBe(null);
    expect(evaluate({...defaults,suggestion:{paymentState:"FULL",tenderedMinor:10000}})
      .action).toBe("CASH_RECEIVED");
    expect(evaluate({...defaults,suggestion:{paymentState:"FULL",tenderedMinor:9900}})
      .action).toBe(null);
  });
  it("does not prefill unknown, invalid or credit-only spoken amounts",()=>{
    expect(evaluate({...defaults,suggestion:null}).action).toBe(null);
    expect(evaluate({...defaults,suggestion:{paymentState:"PARTIAL",tenderedMinor:null}})
      .action).toBe(null);
    expect(evaluate({...defaults,suggestion:{paymentState:"CREDIT",tenderedMinor:2500}})
      .action).toBe(null);
  });
});

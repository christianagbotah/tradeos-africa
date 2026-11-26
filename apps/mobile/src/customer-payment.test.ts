import {describe,it,expect} from "vitest";
import {parseMinorAmount,creditTerms,eligibleCustomerAccounts,preferredAccount,canCollectCustomerPayment,canControlCustomerCredit} from "./customer-payment";
import type {MobileMoneyAccount} from "./api-client";
describe("customer finance safeguards",()=>{
  it("parses exact minor units and rejects invalid or fractional pennies",()=>{
    expect(parseMinorAmount("12.30")).toBe(1230);
    expect(parseMinorAmount("0",true)).toBe(0);
    for(const value of ["0","-3","12.345","1e3","NaN",""])expect(()=>parseMinorAmount(value)).toThrow();
    expect(()=>creditTerms("3651")).toThrow();
  });
  it("uses server role boundaries",()=>{
    expect(canCollectCustomerPayment("CASHIER")).toBe(true);
    expect(canCollectCustomerPayment("POS_ATTENDANT")).toBe(false);
    expect(canControlCustomerCredit("CASHIER")).toBe(false);
    expect(canControlCustomerCredit("ACCOUNTANT")).toBe(true);
  });
  it("only accepts active tenant/branch/currency/method accounts and never guesses from multiple",()=>{
    const a:MobileMoneyAccount={id:"a",businessId:"b",branchId:"br",name:"Cash",method:"CASH",currencyCode:"GHS",active:true};
    const accounts=eligibleCustomerAccounts([a,{...a,id:"b"},{...a,id:"x",businessId:"other"},{...a,id:"y",branchId:"other"},{...a,id:"z",active:false}],"b","br","CASH","GHS");
    expect(accounts.map(x=>x.id)).toEqual(["a","b"]);
    expect(preferredAccount(accounts,[],"br","CASH")).toBeNull();
    expect(preferredAccount(accounts,[{branchId:"br",method:"CASH",moneyAccountId:"b"}],"br","CASH")).toBe("b");
  });
});

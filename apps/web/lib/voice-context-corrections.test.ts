import {describe,expect,it} from "vitest";
import {
  parseVoiceContextCorrection as parse,rankVoiceCustomerCandidates,
} from "./voice-context-corrections";
describe("review-only customer/payment corrections",()=>{
  it("recognizes saved-customer name requests",()=>{
    expect(parse("change customer to Comfort Mensah")).toEqual({
      recognized:true,ok:true,value:{
        kind:"CUSTOMER",nameQuery:"comfort mensah",walkIn:false,
      },
    });
    expect(parse("set the customer name to Michael Dapaah")).toEqual({
      recognized:true,ok:true,value:{
        kind:"CUSTOMER",nameQuery:"michael dapaah",walkIn:false,
      },
    });
    expect(parse("use walk in customer")).toEqual({
      recognized:true,ok:true,value:{
        kind:"CUSTOMER",nameQuery:"",walkIn:true,
      },
    });
    expect(parse("customer is walk in")).toEqual({
      recognized:true,ok:true,value:{
        kind:"CUSTOMER",nameQuery:"",walkIn:true,
      },
    });
  });
  it("recognizes a single payment method, not partial/split instructions",()=>{
    expect(parse("change payment method to MoMo")).toEqual({
      recognized:true,ok:true,value:{kind:"PAYMENT",method:"MOMO"},
    });
    expect(parse("set payment to bank transfer")).toEqual({
      recognized:true,ok:true,value:{kind:"PAYMENT",method:"BANK"},
    });
    expect(parse("payment is cash")).toEqual({
      recognized:true,ok:true,value:{kind:"PAYMENT",method:"CASH"},
    });
    expect(parse("set payment to credit")).toEqual({
      recognized:true,ok:true,value:{kind:"PAYMENT",method:"CREDIT"},
    });
    expect(parse("change payment to Telecel Cash")).toEqual({
      recognized:true,ok:true,value:{kind:"PAYMENT",method:"MOMO"},
    });
    expect(parse("change payment to MTN Money")).toEqual({
      recognized:true,ok:true,value:{kind:"PAYMENT",method:"MOMO"},
    });
    expect(parse("set payment to half cash and half MoMo")).toMatchObject({
      recognized:true,ok:false,
    });
  });
  it("leaves numbered-item corrections to the existing line parser",()=>{
    expect(parse("change item two to SKU 326")).toEqual({recognized:false});
    expect(parse("remove line three")).toEqual({recognized:false});
    expect(parse("change customer to paid momo")).toMatchObject({
      recognized:true,ok:false,
    });
    expect(parse("change payment price to 20")).toMatchObject({
      recognized:true,ok:false,
    });
  });
  it("only ranks existing customer records and handles close phonetic spelling",()=>{
    const customers=[
      {id:"a",name:"Comfort Mensah"},
      {id:"b",name:"Comfort Mensim"},
      {id:"c",name:"Michael Dapaah"},
    ];
    const exact=rankVoiceCustomerCandidates("comfort mensah",customers);
    expect(exact[0]?.customer.id).toBe("a");
    expect(exact.map(x=>x.customer.id)).toContain("b");
    const near=rankVoiceCustomerCandidates("komfort mensah",customers);
    expect(near.map(x=>x.customer.id)).toContain("a");
    expect(rankVoiceCustomerCandidates("unknown future customer",customers))
      .toHaveLength(0);
  });
});

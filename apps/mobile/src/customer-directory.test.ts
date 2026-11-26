import {describe,it,expect} from "vitest";
import {canReadCustomers,canEditCustomer,filterCustomers,confirmedCustomerRows,insertConfirmedCustomer,normalizeCustomerContact} from "./customer-directory";
import type {MobileCustomer} from "./api-client";
const row=(id:string,active:boolean,balanceMinor:number)=>({id,active,balanceMinor} as MobileCustomer);
describe("native customer directory",()=>{
  it("matches server contact permissions",()=>{
    expect(canReadCustomers("OWNER")).toBe(true);
    expect(canReadCustomers("POS_ATTENDANT")).toBe(false);
    expect(canEditCustomer("STAFF")).toBe(false);
    expect(canEditCustomer("CASHIER")).toBe(true);
    expect(canEditCustomer("VIEWER")).toBe(false);
  });
  it("filters only matching accounts",()=>{
    const rows=[row("a",true,100),row("b",false,0)];
    expect(filterCustomers(rows,"OWES")).toEqual([rows[0]]);
    expect(filterCustomers(rows,"INACTIVE")).toEqual([rows[1]]);
  });
  it("updates only the confirmed customer and preserves unrelated rows",()=>{
    const rows=[row("a",true,100),row("b",false,0)];
    const next={...rows[0]!,name:"Updated"};
    expect(confirmedCustomerRows(rows,next)).toEqual([next,rows[1]]);
  });
});

describe("customer creation",()=>{
  it("normalizes contact details without enabling credit",()=>{
    expect(normalizeCustomerContact({name:" Ama ",phone:" ",email:" AMA@EXAMPLE.COM "})).toEqual({name:"Ama",phone:null,email:"ama@example.com"});
    expect(()=>normalizeCustomerContact({name:" ",phone:"",email:""})).toThrow();
    expect(()=>normalizeCustomerContact({name:"Ama",phone:"",email:"invalid"})).toThrow();
  });
  it("inserts a confirmed result exactly once",()=>{
    const first=row("a",true,0),second=row("b",true,0);
    expect(insertConfirmedCustomer([first,second],second)).toEqual([second,first]);
  });
});

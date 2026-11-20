import {describe,expect,it} from "vitest";
import {moneyToMinor} from "./refund-provider-evidence-panel";

describe("exact merchant evidence decimal input",()=>{
  it("parses Ghana cedi and USD without floating-point multiplication",()=>{
    expect(moneyToMinor("25.50","GHS")).toBe(2550);
    expect(moneyToMinor("25","USD")).toBe(2500);
    expect(moneyToMinor("0.01","GHS")).toBe(1);
    expect(moneyToMinor("12.3","USD")).toBe(1230);
  });
  it("honors other ISO currency fraction conventions",()=>{
    expect(moneyToMinor("250","JPY")).toBe(250);
    expect(moneyToMinor("250.00","JPY")).toBeNull();
    expect(moneyToMinor("1.234","KWD")).toBe(1234);
    expect(moneyToMinor("1.234","GHS")).toBeNull();
  });
  it("rejects invalid, zero, imprecise or unsafe monetary input",()=>{
    for(const value of ["","0","0.00","NaN","-4.00","1e3","0.001",
      "25,500.00"," 12.000 ","9999999999999999999"]){
      expect(moneyToMinor(value,"GHS")).toBeNull();
    }
    expect(moneyToMinor("10.00","NOT_A_CURRENCY")).toBeNull();
  });
});

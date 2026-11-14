import { describe, expect, it } from "vitest";
import type { BusinessQuestionResponse } from "@tradeos/contracts";
import { MobileApiClient, SessionExpiredError } from "./api-client";
import { MobilePersistence, type StringStorage, type SecureStringStorage } from "./storage";
import { canAskMobileBusinessQuestions, questionResponseMatchesContext } from "./question-scope";
import { formatMoney } from "./lib/format";

const businessId="11111111-1111-4111-8111-111111111111";
const branchId="22222222-2222-4222-8222-222222222222";

class Storage implements StringStorage, SecureStringStorage {
  readonly items=new Map<string,string>();
  async getItem(key:string){return this.items.get(key)??null;}
  async setItem(key:string,value:string){this.items.set(key,value);}
  async removeItem(key:string){this.items.delete(key);}
}
function setup(fetchImpl:typeof fetch) {
  const persistence=new MobilePersistence(new Storage(),new Storage(),()=>businessId);
  const api=new MobileApiClient({
    baseUrl:"https://tradeos.example/api/mobile",
    persistence,fetchImpl,platform:"ANDROID",appVersion:"0.0.1",
  });
  return {api,persistence};
}
const result:BusinessQuestionResponse={
  businessId,branchId,question:"How much did we sell today?",
  intent:"SALES",answer:"Today, 2 recorded sales generated ₵100.00 net revenue.",
  currencyCode:"GHS",generatedAt:"2026-11-14T03:10:00Z",
  engine:"DETERMINISTIC_GROUNDED_V1",dataQuality:"LIMITED",
  evidence:[{key:"netRevenueMinor",label:"Net sales revenue",value:10000,unit:"MINOR",
    source:"FINANCIAL_REPORT"}],
  items:[],sourcePage:"/reports",limitations:["Only recorded transactions are included."],
};
const session={
  accessToken:"mobile-access",refreshToken:"mobile-refresh",
  accessExpiresAt:"2026-11-14T04:00:00Z",refreshExpiresAt:"2026-12-14T04:00:00Z",
};

describe("Mobile grounded business questions",()=>{
  it("rejects unsupported roles and discards a forged business/branch scope",()=>{
    for(const role of ["OWNER","ADMIN","MANAGER","ACCOUNTANT"]) {
      expect(canAskMobileBusinessQuestions(role)).toBe(true);
    }
    for(const role of ["CASHIER","SALES","STAFF","INVENTORY","VIEWER"]) {
      expect(canAskMobileBusinessQuestions(role)).toBe(false);
    }
    expect(questionResponseMatchesContext(result,businessId,branchId)).toBe(true);
    expect(questionResponseMatchesContext(result,businessId,"other-branch")).toBe(false);
    expect(questionResponseMatchesContext(result,"other-business",branchId)).toBe(false);
  });

  it("posts an authenticated, scoped question without local economic mutations",async()=>{
    let count=0;
    const fetchImpl=(async (input:RequestInfo|URL,init?:RequestInit)=>{
      count+=1;
      expect(String(input)).toBe("https://tradeos.example/api/mobile/v1/intelligence/question");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string,string>).authorization).toBe("Bearer mobile-access");
      expect(JSON.parse(String(init?.body))).toEqual({
        businessId,branchId,question:"How much did we sell today?",
      });
      return new Response(JSON.stringify(result),{status:200});
    }) as typeof fetch;
    const {api,persistence}=setup(fetchImpl);
    await persistence.saveSession(session);
    await expect(api.askBusinessQuestion(businessId,branchId,result.question)).resolves.toEqual(result);
    expect(count).toBe(1);
  });

  it("cannot ask questions without a persisted mobile login session",async()=>{
    let requests=0;
    const fetchImpl=(async()=>{requests+=1;throw Error("Unexpected request");}) as typeof fetch;
    const {api}=setup(fetchImpl);
    await expect(api.askBusinessQuestion(businessId,branchId,"Who owes us money?"))
      .rejects.toBeInstanceOf(SessionExpiredError);
    expect(requests).toBe(0);
  });

  it("uses the user-requested ₵ symbol for Ghana amounts, including negatives",()=>{
    expect(formatMoney(123456,"GHS")).toBe("₵1,234.56");
    expect(formatMoney(0,"GHS")).toBe("₵0.00");
    expect(formatMoney(-1234,"GHS")).toBe("-₵12.34");
    expect(formatMoney(199,"USD")).toMatch(/1\.99/);
  });
});

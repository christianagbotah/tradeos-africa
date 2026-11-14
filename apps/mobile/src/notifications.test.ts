import { describe, expect, it } from "vitest";
import type { BusinessNotificationsResponse } from "@tradeos/contracts";
import { MobileApiClient, SessionExpiredError } from "./api-client";
import { canReadMobileNotifications, notificationResponseMatchesContext } from "./notification-scope";
import { MobilePersistence, type SecureStringStorage, type StringStorage } from "./storage";

const BUSINESS_A = "11111111-1111-4111-8111-111111111111";
const BRANCH_A = "22222222-2222-4222-8222-222222222222";
const BRANCH_B = "33333333-3333-4333-8333-333333333333";
const NOTICE = "44444444-4444-4444-8444-444444444444";

class MemoryStorage implements StringStorage, SecureStringStorage {
  private readonly values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
}

function makeClient(fetchImpl: typeof fetch) {
  const persistence = new MobilePersistence(new MemoryStorage(),new MemoryStorage(),()=>BUSINESS_A);
  const client = new MobileApiClient({
    baseUrl: "https://tradeos.example/api/mobile",
    persistence, fetchImpl, platform: "ANDROID", appVersion: "0.0.1",
  });
  return { client, persistence };
}
const session = {
  accessToken:"mobile-access",refreshToken:"mobile-refresh",
  accessExpiresAt:"2026-11-14T03:00:00Z",refreshExpiresAt:"2026-12-14T03:00:00Z",
};
const inbox: BusinessNotificationsResponse = {
  businessId:BUSINESS_A,branchId:BRANCH_A,generatedAt:"2026-11-14T02:00:00Z",
  unreadCount:1,truncated:false,notifications:[{
    id:NOTICE,kind:"ATTENTION",severity:"HIGH",title:"Review low stock",
    summary:"Recorded stock is low",occurredAt:"2026-11-14T01:00:00Z",
    readAt:null,href:"/inventory",
  }],
};

describe("Mobile notifications business security",()=>{
  it("limits financial notices to authorized roles",()=>{
    for(const role of ["OWNER","ADMIN","MANAGER","ACCOUNTANT"]) {
      expect(canReadMobileNotifications(role)).toBe(true);
    }
    for(const role of ["CASHIER","SALES","STAFF","INVENTORY","VIEWER","unknown"]) {
      expect(canReadMobileNotifications(role)).toBe(false);
    }
  });

  it("discards branch/tenant-scoped results that do not match the selected workspace",()=>{
    expect(notificationResponseMatchesContext(inbox,BUSINESS_A,BRANCH_A)).toBe(true);
    expect(notificationResponseMatchesContext(inbox,BUSINESS_A,BRANCH_B)).toBe(false);
    expect(notificationResponseMatchesContext(inbox,"other-business",BRANCH_A)).toBe(false);
  });

  it("reads the authenticated branch inbox with encoded scope",async()=>{
    let calls=0;
    const fetchImpl=(async (input: RequestInfo | URL, init?: RequestInit)=>{
      calls+=1;
      expect(String(input)).toBe(
        "https://tradeos.example/api/mobile/v1/intelligence/notifications"+
        "?businessId="+BUSINESS_A+"&branchId="+BRANCH_A,
      );
      expect(init?.method).toBe("GET");
      expect((init?.headers as Record<string,string>).authorization).toBe("Bearer mobile-access");
      return new Response(JSON.stringify(inbox),{status:200});
    }) as typeof fetch;
    const {client,persistence}=makeClient(fetchImpl);
    await persistence.saveSession(session);
    await expect(client.getBusinessNotifications(BUSINESS_A,BRANCH_A)).resolves.toEqual(inbox);
    expect(calls).toBe(1);
  });

  it("acknowledges the exact notification once and does not send approval decision",async()=>{
    const readAt="2026-11-14T02:05:00Z";
    let calls=0;
    const fetchImpl=(async (input: RequestInfo | URL,init?: RequestInit)=>{
      calls+=1;
      expect(String(input)).toBe(
        "https://tradeos.example/api/mobile/v1/intelligence/notifications/ATTENTION/"+
        NOTICE+"/read?businessId="+BUSINESS_A+"&branchId="+BRANCH_A,
      );
      expect(init?.method).toBe("POST");
      expect(init?.body).toBeUndefined();
      expect((init?.headers as Record<string,string>).authorization).toBe("Bearer mobile-access");
      return new Response(JSON.stringify({readAt}),{status:200});
    }) as typeof fetch;
    const {client,persistence}=makeClient(fetchImpl);
    await persistence.saveSession(session);
    await expect(client.acknowledgeBusinessNotification(
      BUSINESS_A,BRANCH_A,"ATTENTION",NOTICE,
    )).resolves.toEqual({readAt});
    expect(calls).toBe(1);
  });

  it("does not read inbox data without a live authenticated session",async()=>{
    let calls=0;
    const fetchImpl=(async ()=>{
      calls+=1;
      throw new Error("Should not reach server");
    }) as typeof fetch;
    const {client}=makeClient(fetchImpl);
    await expect(client.getBusinessNotifications(BUSINESS_A,BRANCH_A))
      .rejects.toBeInstanceOf(SessionExpiredError);
    expect(calls).toBe(0);
  });
});

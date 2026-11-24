import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assertPosAttendantSalePayload, PosAttendantPolicyError } from "../src/auth/pos-attendant-policy.js";

const regularCash={
  paymentMethod:"CASH",
  currencyCode:"GHS",
  lines:[{itemId:"item-1",saleUnitCode:"portion",quantity:2,expectedUnitPriceMinor:1500}],
};
describe("dedicated POS attendant, authenticated-role economic authorization",()=>{
  it("accepts a normal cash walk-in sale, leaving price/stock to the server",()=>{
    expect(()=>assertPosAttendantSalePayload(regularCash)).not.toThrow();
    expect(()=>assertPosAttendantSalePayload({...regularCash,lines:[...regularCash.lines,regularCash.lines[0]]})).not.toThrow();
  });
  it.each([
    ["MOMO",{...regularCash,paymentMethod:"MOMO"}],
    ["CARD",{...regularCash,paymentMethod:"CARD"}],
    ["CUSTOMER_CREDIT",{...regularCash,paymentMethod:"CUSTOMER_CREDIT"}],
    ["OTHER",{...regularCash,paymentMethod:"OTHER"}],
    ["missing method",{...regularCash,paymentMethod:undefined}],
    ["customer account",{...regularCash,customerId:"customer-1"}],
    ["split payment",{...regularCash,payments:[{method:"CASH",amountMinor:2000}]}],
    ["gateway checkout",{...regularCash,paymentProvider:"HUBTEL"}],
    ["override",{...regularCash,lines:[{itemId:"item-1",quantity:1,priceApprovalId:"approval"}]}],
    ["empty lines",{...regularCash,lines:[]}],
    ["invalid line",{...regularCash,lines:[null]}],
  ])("rejects %s before a financial write",(_name,payload)=>{
    expect(()=>assertPosAttendantSalePayload(payload)).toThrow(PosAttendantPolicyError);
  });
  it("does not accept unstructured or array data",()=>{
    for(const value of [null,undefined,{},[],123,"hello"]){
      expect(()=>assertPosAttendantSalePayload(value)).toThrow(PosAttendantPolicyError);
    }
  });
  it("checks actual DB membership and forbids non-SALE_CREATE economic mutations",()=>{
    const source=readFileSync(new URL("../src/app.ts",import.meta.url),"utf8");
    expect(source).toContain('if (access.role === "POS_ATTENDANT")');
    expect(source).toContain('normalizedMutation.mutationType !== "SALE_CREATE"');
    expect(source).toContain("assertPosAttendantSalePayload(normalizedMutation.payload)");
    expect(source).toContain('requireBusinessRole(pool, auth, mutation.businessId, roles)');
    expect(source).toContain('error instanceof PosAttendantPolicyError');
    const policy=readFileSync(new URL("../src/auth/pos-attendant-policy.ts",import.meta.url),"utf8");
    expect(policy).not.toContain("recordCashbookEntry");
    expect(policy).not.toContain("INSERT INTO");
  });
  it("allows POS-only price quote but not discount requests or customer rates",()=>{
    const source=readFileSync(new URL("../src/commerce/pricing-routes.ts",import.meta.url),"utf8");
    expect(source).toContain('const QUOTE_ROLES:readonly BusinessRole[]=[...SELL_ROLES,"POS_ATTENDANT"]');
    expect(source).toContain('a.role === "POS_ATTENDANT" && req.body?.customerId');
    expect(source).toContain("req.query.businessId,CONTROL_ROLES");
    expect(source).toContain("req.body?.businessId,SELL_ROLES");
  });
  it("provides only POS availability with no cost valuation for the limited role",()=>{
    const source=readFileSync(new URL("../src/suppliers-inventory.ts",import.meta.url),"utf8");
    const start=source.indexOf('if (access.role === "POS_ATTENDANT")');
    const end=source.indexOf("const result = await pool.query<",start);
    expect(start).toBeGreaterThan(0);
    const block=source.slice(start,end);
    expect(block).toContain("im.location_type='AVAILABLE'");
    expect(block).toContain("available:Number(row.available)");
    expect(block).not.toContain("inventory_valuations");
    expect(block).not.toContain("inventoryValueMinor");
    expect(block).not.toContain("latestStockUnitCostMinor");
    expect(block).not.toContain("damaged:Number(");
    expect(block).not.toContain("quarantine:Number(");
    expect(source).toContain("const POS_STOCK_READ_ROLES");
    expect(source).toContain("await requireBusinessRole(pool,auth,businessId,READ_ROLES)");
  });
  it("limits receipt PDF retrieval to the attendant's own cashier identity",()=>{
    const source=readFileSync(new URL("../src/sales-read.ts",import.meta.url),"utf8");
    expect(source).toContain('const RECEIPT_ROLES: readonly BusinessRole[] = [...READ_ROLES, "POS_ATTENDANT"]');
    expect(source).toContain('const ownedStaffId=access.role === "POS_ATTENDANT" ? access.staffId : null');
    expect(source).toContain("s.cashier_staff_id=$3::uuid");
    expect(source).toContain("[saleId,businessId,ownedStaffId]");
    expect(source).toContain("A final receipt is available only for a completed, verified sale.");
    expect(source).toContain("requireBusinessRole(pool, auth, businessId, READ_ROLES)");
  });
  it("migration adds the role to all three explicit PostgreSQL constraints",()=>{
    const migration=readFileSync(new URL("../../../packages/db/migrations/0062_pos_attendant_role.sql",import.meta.url),"utf8");
    expect(migration).toContain("ALTER TABLE business_memberships");
    expect(migration).toContain("ALTER TABLE staff");
    expect(migration).toContain("ALTER TABLE staff_invitations");
    expect((migration.match(/'POS_ATTENDANT'/g)??[])).toHaveLength(3);
    expect(migration).not.toContain("UPDATE business_memberships SET");
    expect(migration).toMatch(/BEGIN;[\s\S]*COMMIT;/);
  });
});

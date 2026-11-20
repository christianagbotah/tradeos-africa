import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read=(relative:string)=>readFileSync(new URL(relative,import.meta.url),"utf8");
const service=read("../../../../api/src/commerce/hubtel-cancellation-investigation.ts");
const routes=read("../../../../api/src/commerce/hubtel-pos-routes.ts");
const preflight=read("../../../../api/src/commerce/hubtel-pos-cancellation-preflight.ts");
const panel=read("./hubtel-cancellation-preflight-panel.tsx");
const migration=read("../../../../../packages/db/migrations/0056_hubtel_cancellation_investigations.sql");

describe("Hubtel provider cancellation investigation",()=>{
  it("cannot void a payment, release inventory or bypass provider finality",()=>{
    expect(service).toContain('"NOT_ESTABLISHED" as const');
    expect(service).toContain("canReleaseStock: false as const");
    expect(service).toContain("ON CONFLICT(business_id,sale_id) DO NOTHING");
    expect(service).toContain("withTransaction(pool");
    expect(service).toContain("FOR UPDATE");
    expect(service).not.toContain("UPDATE payments SET");
    expect(service).not.toContain("UPDATE sales SET");
    expect(service).not.toContain("INSERT INTO inventory_movements");
    expect(service).not.toContain("adjustValuation");
    expect(routes).toContain('"/v1/sales/:saleId/hubtel/cancellation-investigation"');
    expect(routes).toContain("MONITOR_ROLES");
    expect(preflight).toContain("readHubtelCancellationInvestigation(");
  });
  it("enforces immutable tenant-scoped evidence and explicit browser safety",()=>{
    expect(migration).toContain("CREATE TABLE hubtel_pos_cancellation_investigations");
    expect(migration).toContain("UNIQUE(business_id,sale_id)");
    expect(migration).toContain("IF TG_OP IN ('UPDATE','DELETE')");
    expect(migration).toContain("s.status='OPEN' AND p.status='PENDING'");
    expect(panel).toContain("Request provider investigation");
    expect(panel).toContain("providerFinality!==\"NOT_ESTABLISHED\"");
    expect(panel).toContain("canReleaseStock!==false");
    expect(panel).toContain("onClick={() => void requestInvestigation()}");
    expect(panel).not.toContain("Cancel checkout now");
    expect(panel).not.toContain("Restore stock");
  });
});

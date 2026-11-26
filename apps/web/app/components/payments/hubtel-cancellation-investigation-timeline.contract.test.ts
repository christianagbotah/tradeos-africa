import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const migration=read("../../../../../packages/db/migrations/0057_hubtel_cancellation_investigation_events.sql");
const events=read("../../../../api/src/commerce/hubtel-cancellation-investigation-events.ts");
const routes=read("../../../../api/src/commerce/hubtel-pos-routes.ts");
const ui=read("./hubtel-cancellation-investigation-timeline.tsx");
const worklist=read("./hubtel-cancellation-investigation-queue.tsx");

describe("Hubtel provider investigation evidence is never payment-finality proof",()=>{
  it("enforces immutable, tenant-scoped, idempotent event evidence",()=>{
    expect(migration).toContain("CREATE TABLE hubtel_pos_cancellation_investigation_events");
    expect(migration).toContain("UNIQUE (investigation_id,client_request_id)");
    expect(migration).toContain("IF TG_OP IN ('UPDATE','DELETE')");
    expect(migration).toContain("c.business_id=NEW.business_id");
    expect(migration).toContain("m.status='ACTIVE'");
    expect(events).toContain("FOR UPDATE");
    expect(events).toContain("HUBTEL_INVESTIGATION_EVENT_IDEMPOTENCY_CONFLICT");
    expect(events).toContain("canReleaseStock:false as const");
    expect(events).toContain('"NOT_ESTABLISHED" as const');
    expect(events).toContain("HUBTEL_CANCELLATION_INVESTIGATION_EVENT_RECORDED");
    expect(events).not.toContain("UPDATE payments");
    expect(events).not.toContain("INSERT INTO inventory_movements");
    expect(events).not.toContain("recordCashbookEntry");
  });
  it("exposes authenticated no-store event routes and explicitly non-final provider claims",()=>{
    expect(routes).toContain('"/v1/payments/hubtel/cancellation-investigations/:investigationId/events"');
    expect(routes).toContain('reply.header("Cache-Control","private, no-store, max-age=0")');
    expect(routes).toContain("MONITOR_ROLES");
    expect(ui).toContain("Record investigation update");
    expect(ui).toContain("providerFinality");
    expect(ui).toContain('"NOT_ESTABLISHED"');
    expect(ui).toContain("does not authorise cancellation or stock restoration");
    expect(ui).toContain("crypto.randomUUID()");
    expect(worklist).toContain("HubtelCancellationInvestigationTimeline");
  });
});

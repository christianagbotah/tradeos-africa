import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
const read=(relative:string)=>readFileSync(new URL(relative,import.meta.url),"utf8");
const api=read("../../../../api/src/commerce/hubtel-cancellation-investigation-queue.ts");
const route=read("../../../../api/src/commerce/hubtel-pos-routes.ts");
const ui=read("./hubtel-cancellation-investigation-queue.tsx");
const parent=read("./hubtel-reconciliation-workspace.tsx");
const css=read("./hubtel-reconciliation-workspace.module.css");

describe("merchant Hubtel cancellation investigation worklist contract",()=>{
  it("lists entire merchant branch independently of recent checkout display and preserves paid cases",()=>{
    expect(api).toContain("hubtel_pos_cancellation_investigations c");
    expect(api).toContain("AND ($2::uuid IS NULL OR c.branch_id=$2::uuid)");
    expect(api).toContain("s.status='COMPLETED' AND p.status='SUCCEEDED'");
    expect(api).toContain("s.status='OPEN' AND p.status='PENDING'");
    expect(api).toContain("ORDER BY c.created_at DESC,c.id DESC");
    expect(api).toContain("LIMIT $4::integer OFFSET $5::integer");
    expect(api).toContain('"NOT_ESTABLISHED" as const');
    expect(api).toContain("canReleaseStock:false as const");
    expect(api).not.toContain("UPDATE payments");
    expect(api).not.toContain("INSERT INTO inventory_movements");
  });
  it("restricts merchant data and keeps accessible mobile pagination and drill-down",()=>{
    expect(route).toContain('"/v1/payments/hubtel/cancellation-investigations"');
    expect(route).toContain('reply.header("Cache-Control","private, no-store, max-age=0")');
    expect(route).toContain("listHubtelCancellationInvestigations(pool");
    expect(parent).toContain("HubtelCancellationInvestigationQueue");
    expect(ui).toContain("All-time branch worklist");
    expect(ui).toContain('value={outcome}');
    expect(ui).toContain("setOffset(0)");
    expect(ui).toContain("Previous");
    expect(ui).toContain("Next");
    expect(ui).toContain("HubtelCancellationPreflightPanel");
    expect(ui).toContain("Do not return stock or adjust payments");
    expect(css).toContain(".investigationStats");
    expect(css).toContain("@media(max-width:700px)");
  });
});

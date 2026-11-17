import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const file=(path:string)=>readFileSync(
  fileURLToPath(new URL(path,import.meta.url)),"utf8");
const editor=file("./purchase-order-draft-editor.tsx");
const styles=file("./purchase-order-draft-editor.module.css");
const preview=file("../../(workspace)/purchase-orders/[orderId]/page.tsx");
const api=file("../../../../api/src/purchase-orders.ts");

describe("saved purchase-order draft correction contract",()=>{
  it("shows editing only for authorized staff and DRAFT orders",()=>{
    expect(preview).toContain('order.status==="DRAFT"&&canEditDraft');
    expect(preview).toContain("<PurchaseOrderDraftEditor order={order}");
    expect(preview).toContain('onSaved={()=>{setEditOpen(false);refetch();}}');
    expect(editor).toContain('order.status==="DRAFT"&&canWrite');
  });
  it("requires explicit current server version and does not silently overwrite",()=>{
    expect(editor).toContain('expectedUpdatedAt:order.updatedAt');
    expect(editor).toContain('method:"PATCH"');
    expect(editor).toContain('changed&&valid&&validSupplier');
    expect(editor).toContain('Reload saved order');
    expect(editor).toContain('Discard local edits and reload the latest order?');
    expect(api).toContain('row.updated_at.toISOString()!==body.expectedUpdatedAt');
    expect(api).toContain('PURCHASE_ORDER_VERSION_CONFLICT');
    expect(api).toContain('WHERE id=$1 AND business_id=$2 FOR UPDATE');
  });
  it("rechecks supplier, product, purchase unit and amount before saving",()=>{
    expect(editor).toContain('validatePurchaseOrderLines(lines,items)');
    expect(editor).toContain('selectPurchaseOrderSupplier(prev,supplierId,next)');
    expect(editor).toContain('selectPurchaseOrderItem(row,event.target.value');
    expect(editor).toContain('selectPurchaseOrderUnit(row,event.target.value)');
    expect(editor).toContain('unitCostMinor:amount');
    expect(editor).toContain('Save draft changes');
    expect(editor).toContain('Discard unsaved purchase-order changes?');
    expect(api).toContain('PURCHASE_ORDER_NOT_DRAFT');
    expect(api).toContain('PURCHASE_ORDER_UNIT_INVALID');
    expect(api).toContain('PURCHASE_ORDER_DRAFT_UPDATED');
  });
  it("preserves one-row editing and excludes unposted edits from printable supplier document",()=>{
    expect(styles).toContain('min-width:950px');
    expect(styles).toContain('overflow-x:auto');
    expect(styles).toContain('@media(max-width:650px)');
    expect(styles).toContain('@media print{.editor{display:none!important}}');
    expect(editor).not.toContain('PURCHASE_RECEIVE_CREATE');
    expect(editor).not.toContain('HUBTEL');
    expect(preview).toContain('not proof of delivery');
    expect(preview).toContain('Print / Save as PDF');
  });
});

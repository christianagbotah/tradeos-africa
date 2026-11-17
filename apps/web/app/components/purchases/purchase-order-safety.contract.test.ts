import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const source=(file:string)=>readFileSync(
  fileURLToPath(new URL(file,import.meta.url)),"utf8");
const form=source("./purchase-order-workspace.tsx");
const styles=source("./purchase-order-workspace.module.css");

describe("purchase order quote and issue protections",()=>{
  it("starts with an explicitly unpriced line",()=>{
    expect(form).toContain('unitCostMinor:null');
    expect(form).toContain('validatePurchaseOrderLines(lines,items)');
    expect(form).toContain('purchaseOrderCostMissing(lines)');
    expect(form).toContain('unitCostMinor:minor})');
    expect(form).toContain('id={`tos-po-cost-${line.key}`}');
    expect(form).not.toContain('unitCostMinor:minor??0');
    expect(form).toContain('unitCostMinor:l.unitCostMinor!');
    expect(form).toContain('Current subtotal — supplier costs still missing');
    expect(form).toContain('Enter supplier unit cost for line');
  });
  it("invalidates old costs when catalog item, purchasing unit or supplier changes",()=>{
    expect(form).toContain('selectPurchaseOrderItem(l,e.target.value');
    expect(form).toContain('selectPurchaseOrderUnit(l,e.target.value)');
    expect(form).toContain('selectPurchaseOrderSupplier(prev,supplierId,next)');
    expect(form).toContain('setSupplierId(next);dirty()');
    expect(form).toContain('setLines(reviewed.map(line=>({');
  });
  it("requires a separate, accessible confirmation before order issuance",()=>{
    expect(form).toContain('onClick={()=>{\n                      setError(null);setIssueCandidate(order)');
    expect(form).toContain('role="alertdialog" aria-modal="true"');
    expect(form).toContain('aria-labelledby="tos-po-issue-title"');
    expect(form).toContain('Confirm issuing this purchase order');
    expect(form).toContain('issueCandidate.supplierName');
    expect(form).toContain('issueCandidate.orderNumber');
    expect(form).toContain('issueCandidate.totalMinor,issueCandidate.currencyCode');
    expect(form).toContain('onClick={()=>void transition(issueCandidate,"issue")}');
    expect(form).toContain('issueCandidate.id!==order.id||order.status!=="DRAFT"');
    expect(form).toContain('Keep as draft');
    expect(form).toContain('ref={issueCancelButton}');
    expect(form).toContain('if(issueCandidate)issueCancelButton.current?.focus()');
    expect(form).toContain('Confirm issue order');
    expect(form).toContain('setIssueCandidate(null)');
    expect(styles).toContain('.confirmBackdrop');
    expect(styles).toContain('.confirmDialog');
  });
  it("does not introduce any new payment, stock or sending API",()=>{
    expect(form).toContain('does not record a supplier payment or');
    expect(form).toContain('it does not automatically email the supplier');
    expect(form).not.toContain('PURCHASE_RECEIVE_CREATE');
    expect(form).not.toContain('HUBTEL_CHARGE');
    expect(form).toContain('method:"POST"');
  });
});

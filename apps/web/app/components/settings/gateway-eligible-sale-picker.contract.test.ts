import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";

const component=readFileSync(
  new URL("./gateway-eligible-sale-picker.tsx",import.meta.url),"utf8");
const service=readFileSync(
  new URL("../../../../api/src/payment-providers/eligible-sales.ts",import.meta.url),
  "utf8");
const routes=readFileSync(
  new URL("../../../../api/src/payment-providers/routes.ts",import.meta.url),
  "utf8");

describe("guided merchant sandbox sale selection",()=>{
  it("displays real merchant eligible sales without collecting money",()=>{
    expect(component).toContain("eligible-test-sales?limit=40");
    expect(component).toContain("payload.businessId!==businessId");
    expect(component).toContain("payload.collectionEnabled!==false");
    expect(component).toContain("Choose an eligible pending sale");
    expect(component).toContain("formatMoney(amount,s.currencyCode)");
    expect(component).toContain("MoneyValue");
    expect(component).toContain("exactly one pending MoMo or card payment");
    expect(component).not.toContain('method:"POST"');
  });
  it("blocks cross-business access and excludes prior checkouts, paid sales and duplicate tender",()=>{
    expect(service).toContain("AND s.status='OPEN'");
    expect(service).toContain("p.status='PENDING'");
    expect(service).toContain("p.amount_minor=s.total_minor");
    expect(service).toContain("NOT EXISTS(SELECT 1 FROM payments p2");
    expect(service).toContain("NOT EXISTS(SELECT 1 FROM gateway_collection_attempts a");
    expect(service).toContain("NOT EXISTS(SELECT 1 FROM hubtel_sale_checkout_attempts h");
    expect(service).toContain("collectionEnabled:false");
    expect(routes).toContain('"/v1/businesses/:businessId/payment-gateways/eligible-test-sales"');
    expect(routes).toContain("requireBusinessRole(pool,auth,req.params.businessId,MANAGE)");
  });
});

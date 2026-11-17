import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {describe,expect,it} from "vitest";

const latest=readFileSync(fileURLToPath(new URL(
  "../../../packages/db/migrations/0040_hubtel_pos_card_scope.sql",
  import.meta.url)),"utf8");
const original=readFileSync(fileURLToPath(new URL(
  "../../../packages/db/migrations/0030_business_hubtel_sales.sql",
  import.meta.url)),"utf8");

describe("Hubtel POS migration guard",()=>{
  it("retains original migration and upgrades scope to card or MoMo",()=>{
    expect(original).toContain("p.method='MOMO'");
    expect(latest).toContain("CREATE OR REPLACE FUNCTION validate_hubtel_sale_checkout_scope()");
    expect(latest).toContain("p.method IN ('MOMO','CARD')");
    expect(latest).toContain("p.business_id=NEW.business_id");
    expect(latest).toContain("s.business_id=NEW.business_id");
    expect(latest).toContain("p.branch_id=NEW.branch_id");
    expect(latest).toContain("s.branch_id=NEW.branch_id");
    expect(latest).toContain("p.sale_id=NEW.sale_id");
    expect(latest).toContain("p.amount_minor=NEW.expected_amount_minor");
    expect(latest).toContain("a.collection_account=NEW.merchant_collection_account");
    expect(latest).not.toContain("DROP TRIGGER");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const runtime=readFileSync(resolve(__dirname,"runtime.ts"),"utf8");
const screen=readFileSync(resolve(__dirname,"screens/PosScreen.tsx"),"utf8");
describe("native shop attendant cash-only POS",()=>{
  it("grants SALE_CREATE to the new role but rejects noncash tenders before durable queueing",()=>{
    expect(runtime).toContain('"POS_ATTENDANT"');
    expect(runtime).toContain('ready.membership.role === "POS_ATTENDANT" && paymentMethod !== "CASH"');
    expect(runtime.indexOf('POS attendants can record cash only')).toBeLessThan(runtime.indexOf('const clientMutationId = this.options.createMutationId()'));
  });
  it("shows only cash tender buttons and resets stale noncash selection",()=>{
    expect(screen).toContain('const attendantOnly = snapshot.bootstrap?.status === "READY"');
    expect(screen).toContain('if (attendantOnly && snapshot.paymentMethod !== "CASH") onPayment("CASH")');
    expect(screen).toContain('PAYMENT_METHODS.filter(method=>!attendantOnly || method.value==="CASH")');
  });
});

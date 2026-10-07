import test from "node:test";
import assert from "node:assert/strict";
import { demoAccounts, getDemoAccount } from "./demo-accounts";

test("demo login catalog exposes every supported business role with a real credential pair", () => {
  const roles = demoAccounts.map((account) => account.role);
  assert.deepEqual(roles, [
    "OWNER",
    "ADMIN",
    "MANAGER",
    "CASHIER",
    "SALES",
    "INVENTORY",
    "ACCOUNTANT",
    "STAFF",
    "VIEWER",
  ]);

  for (const account of demoAccounts) {
    assert.match(account.email, /^demo\.[a-z]+@tradeos\.africa$/);
    assert.ok(account.password.length >= 8);
    assert.equal(getDemoAccount(account.id), account);
  }
});

test("unknown demo account ids do not prefill credentials", () => {
  assert.equal(getDemoAccount("not-a-demo-account"), null);
});

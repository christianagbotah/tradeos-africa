import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DemoAccountSelect } from "./demo-account-select";
import { demoAccounts, getDemoAccount } from "./demo-accounts";

describe("TradeOS demo login", () => {
  it("exposes every supported business role with a real credential pair", () => {
    expect(demoAccounts.map((account) => account.role)).toEqual([
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
      expect(account.email).toMatch(/^demo\.[a-z]+@tradeos\.africa$/);
      expect(account.password.length).toBeGreaterThanOrEqual(8);
      expect(getDemoAccount(account.id)).toBe(account);
    }
  });

  it("renders a demo-account dropdown with the available roles", () => {
    const html = renderToStaticMarkup(createElement(DemoAccountSelect, {
      selectedId: "",
      onSelect: () => undefined,
    }));

    expect(html).toContain("Demo account");
    expect(html).toContain("Choose a demo user");
    expect(html).toContain("Business Owner · full access");
    expect(html).toContain("Cashier · POS");
    expect(html).toContain("Viewer · read only");
  });

  it("does not return credentials for unknown demo ids", () => {
    expect(getDemoAccount("not-a-demo-account")).toBeNull();
  });
});

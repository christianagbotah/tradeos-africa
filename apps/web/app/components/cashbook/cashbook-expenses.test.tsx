import React from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CashbookSummary } from "./cashbook-summary";
import { CashbookEntryForm } from "./cashbook-entry-form";
import { ExpenseCategoryCard } from "./expense-category-card";
import { CashbookHistory } from "./cashbook-history";

const noop = () => undefined;
const money = (minor: number) => `₵${(minor / 100).toFixed(2)}`;

const commonFormProps = {
  currencyCode: "GHS",
  mode: "EXPENSE_CREATE",
  canAdjust: true,
  amount: "",
  method: "CASH",
  moneyAccountId: "",
  accounts: [],
  branchId: "branch-1",
  categories: [{ id: "cat-1", name: "Fuel", active: true, system: false, createdAt: "2026-10-08T10:00:00.000Z", updatedAt: "2026-10-08T10:00:00.000Z" }],
  categoryId: "",
  payee: "",
  provider: "",
  providerReference: "",
  reason: "CORRECTION",
  note: "",
  methods: ["CASH", "MOMO"],
  onModeChange: noop,
  onAmountChange: noop,
  onMethodChange: noop,
  onMoneyAccountChange: noop,
  onCategoryChange: noop,
  onPayeeChange: noop,
  onProviderChange: noop,
  onProviderReferenceChange: noop,
  onReasonChange: noop,
  onNoteChange: noop,
  onSubmit: noop,
} as const;

describe("Cashbook page composition", () => {
  it("renders a compact toolbar and four owner-readable summary cards", () => {
    const html = renderToStaticMarkup(<CashbookSummary
      filter=""
      from="2026-10-07"
      to="2026-10-07"
      methods={["CASH", "MOMO"]}
      queued={3}
      summary={{ inflowMinor: 25000, outflowMinor: 10000, netMinor: 15000 }}
      totals={[{ method: "CASH", balanceMinor: 12000, inflowMinor: 20000, outflowMinor: 8000 }]}
      money={money}
      onFilterChange={noop}
      onFromChange={noop}
      onToChange={noop}
      onToday={noop}
    />);
    expect(html).toContain("Method");
    expect(html).toContain("From");
    expect(html).toContain("To");
    expect(html).toContain("Today");
    expect(html).toContain("Inflow");
    expect(html).toContain("Outflow");
    expect(html).toContain("Net movement");
    expect(html).toContain("Pending / offline");
    expect(html).toContain("3");
    expect(html).toContain("CASH");
  });

  it("renders expense fields and switches to adjustment reason/explanation fields", () => {
    const expense = renderToStaticMarkup(<CashbookEntryForm {...commonFormProps} />);
    for (const label of ["Entry type", "Amount", "Payment method", "Money account", "Category", "Payee", "Provider", "Provider reference", "Description", "Save entry"]) {
      expect(expense).toContain(label);
    }

    const adjustment = renderToStaticMarkup(<CashbookEntryForm {...commonFormProps} mode="CASHBOOK_ADJUSTMENT_CREATE" />);
    expect(adjustment).toContain("Reason");
    expect(adjustment).toContain("Required explanation");
    expect(adjustment).toContain("withdrawals as money out");
    expect(adjustment).not.toContain(">Category<");
  });

  it("keeps category management clearly online-only with lifecycle context", () => {
    const html = renderToStaticMarkup(<ExpenseCategoryCard businessId="business-1" role="OWNER" categories={commonFormProps.categories} onChanged={noop} onMessage={noop} />);
    expect(html).toContain("Expense categories");
    expect(html).toContain("online only");
    expect(html).toContain("Add category");
    expect(html).toContain("Edit");
  });

  it("renders useful empty states for movement and expense history", () => {
    const html = renderToStaticMarkup(<CashbookHistory entries={[]} expenses={[]} money={money} />);
    expect(html).toContain("Recent movements");
    expect(html).toContain("No money movements yet");
    expect(html).toContain("Recent expenses");
    expect(html).toContain("No expenses yet");
  });

  it("uses the canonical Z.ai command, stat, mobile-record and state primitives", () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const summary = fs.readFileSync(path.join(dir, "cashbook", "cashbook-summary.tsx"), "utf8");
    const history = fs.readFileSync(path.join(dir, "cashbook", "cashbook-history.tsx"), "utf8");
    const form = fs.readFileSync(path.join(dir, "cashbook", "cashbook-entry-form.tsx"), "utf8");
    const coordinator = fs.readFileSync(path.join(dir, "cashbook-expenses.tsx"), "utf8");
    for (const contract of ["CommandBar", "StatCard", "Button"]) expect(summary).toContain(contract);
    for (const contract of ["MobileRecordCard", "StatePanel", "StatusBadge"]) expect(history).toContain(contract);
    expect(form).toContain("Button");
    expect(form).not.toContain('className="primary-button"');
    expect(coordinator).toContain("StatePanel");
    expect(coordinator).toContain("StatusBadge");
    expect(coordinator).not.toContain('className="eyebrow"');
    expect(coordinator).not.toContain('className="form-error"');
  });

  it("retains offline queue and rejected-sync behavior in the coordinator", () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const source = fs.readFileSync(path.join(dir, "cashbook-expenses.tsx"), "utf8");
    expect(source).toContain("enqueueMutation");
    expect(source).toContain("getPendingMutations");
    expect(source).toContain("getFailedMutations");
    expect(source).toContain("Sync rejected:");
    expect(source).toContain("Saved on this device");
  });
});

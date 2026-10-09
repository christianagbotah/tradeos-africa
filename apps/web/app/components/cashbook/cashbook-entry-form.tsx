import React from "react";
import type { FormEvent } from "react";
import type { MoneyAccount } from "../treasury";
import type { CashbookCategory } from "./types";
import { Button } from "../ui/button";

type Props = {
  currencyCode: string;
  mode: string;
  canAdjust: boolean;
  amount: string;
  method: string;
  moneyAccountId: string;
  accounts: readonly MoneyAccount[];
  branchId: string;
  categories: readonly CashbookCategory[];
  categoryId: string;
  payee: string;
  provider: string;
  providerReference: string;
  reason: string;
  note: string;
  methods: readonly string[];
  onModeChange: (value: string) => void;
  onAmountChange: (value: string) => void;
  onMethodChange: (value: string) => void;
  onMoneyAccountChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onPayeeChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onProviderReferenceChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function CashbookEntryForm(props: Props) {
  const expenseMode = props.mode === "EXPENSE_CREATE";
  const matchingAccounts = props.accounts.filter((account) => account.active && account.method === props.method && (account.branchId === null || account.branchId === props.branchId));
  return (
    <section className="cashbook-card cashbook-entry-card">
      <div className="cashbook-section-heading"><div><span>New transaction</span><h3>Record money movement</h3></div><small>Saved locally first · synchronized when online</small></div>
      <form className="cashbook-entry-form" onSubmit={props.onSubmit}>
        <div className="cashbook-form-grid">
          <label><span>Entry type</span><select value={props.mode} onChange={(e) => props.onModeChange(e.target.value)}><option value="EXPENSE_CREATE">Expense</option>{props.canAdjust ? <option value="CASHBOOK_ADJUSTMENT_CREATE">Balance adjustment</option> : null}</select></label>
          <label><span>Amount ({props.currencyCode})</span><input required inputMode="decimal" value={props.amount} onChange={(e) => props.onAmountChange(e.target.value)} placeholder="0.00" /></label>
          <label><span>Payment method</span><select value={props.method} onChange={(e) => props.onMethodChange(e.target.value)}>{props.methods.map((method) => <option key={method}>{method}</option>)}</select></label>
          <label><span>Money account</span><select value={props.moneyAccountId} onChange={(e) => props.onMoneyAccountChange(e.target.value)}><option value="">Branch default</option>{matchingAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>

          {expenseMode ? <>
            <label><span>Category</span><select required value={props.categoryId} onChange={(e) => props.onCategoryChange(e.target.value)}><option value="">Select category</option>{props.categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label><span>Payee</span><input value={props.payee} onChange={(e) => props.onPayeeChange(e.target.value)} maxLength={1000} placeholder="Who was paid?" /></label>
            <label><span>Provider</span><input value={props.provider} onChange={(e) => props.onProviderChange(e.target.value)} maxLength={1000} placeholder="Optional provider" /></label>
            <label><span>Provider reference</span><input value={props.providerReference} onChange={(e) => props.onProviderReferenceChange(e.target.value)} maxLength={1000} placeholder="Receipt / transaction ID" /></label>
          </> : <>
            <label><span>Reason</span><select value={props.reason} onChange={(e) => props.onReasonChange(e.target.value)}>{["CORRECTION", "OPENING_BALANCE", "OWNER_INJECTION", "OWNER_WITHDRAWAL"].map((reason) => <option key={reason}>{reason}</option>)}</select></label>
            <div className="cashbook-adjustment-help">Enter the amount normally. TradeOS automatically treats withdrawals as money out; corrections may be positive or negative.</div>
          </>}

          <label className="cashbook-form-wide"><span>{expenseMode ? "Description" : "Required explanation"}</span><input required={!expenseMode || !props.payee.trim()} value={props.note} onChange={(e) => props.onNoteChange(e.target.value)} maxLength={1000} placeholder={expenseMode ? "What was this expense for?" : "Explain why this balance is changing"} /></label>
        </div>
        <div className="cashbook-form-actions"><Button type="submit">Save entry</Button></div>
      </form>
    </section>
  );
}

import React from "react";
import { demoAccounts, getDemoAccount, type DemoAccount } from "./demo-accounts";

export function DemoAccountSelect({
  selectedId,
  onSelect,
  hideLabel = false,
}: {
  selectedId: string;
  onSelect: (account: DemoAccount | null) => void;
  hideLabel?: boolean;
}) {
  const select = (
    <select
      className="context-select"
      style={{ width: "100%" }}
      value={selectedId}
      aria-label="Demo account"
      onChange={(event) => onSelect(getDemoAccount(event.target.value))}
    >
      <option value="">Choose a demo user…</option>
      {demoAccounts.map((account) => (
        <option key={account.id} value={account.id}>{account.label}</option>
      ))}
    </select>
  );
  if (hideLabel) return select;
  return <label>Demo account{select}</label>;
}

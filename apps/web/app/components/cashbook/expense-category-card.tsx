import React from "react";
type Props = { value: string; busy: boolean; onChange: (value: string) => void; onCreate: () => void };

export function ExpenseCategoryCard({ value, busy, onChange, onCreate }: Props) {
  return (
    <section className="cashbook-card cashbook-category-card">
      <div><span className="cashbook-card-kicker">Expense categories</span><h3>Manage categories</h3><p>Keep reporting consistent by adding reusable expense categories. <strong>Online only.</strong></p></div>
      <div className="cashbook-category-row">
        <label><span>New category</span><input value={value} onChange={(e) => onChange(e.target.value)} maxLength={160} placeholder="e.g. Vehicle fuel" /></label>
        <button className="ghost-button" type="button" disabled={busy || !value.trim()} onClick={onCreate}>{busy ? "Adding…" : "Add category"}</button>
      </div>
    </section>
  );
}

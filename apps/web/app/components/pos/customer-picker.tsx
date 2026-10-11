"use client";

import { useMemo, useState } from "react";
import type { Customer } from "../workspace/workspace-provider";
import { StatePanel } from "../ui/state-panel";

interface CustomerPickerProps {
  customers: readonly Customer[];
  selected: Customer | null;
  onSelect: (customer: Customer | null) => void;
}

export function CustomerPicker({ customers, selected, onSelect }: CustomerPickerProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? "").toLowerCase().includes(q));
  }, [customers, query]);

  return (
    <div className="tos-stack">
      <div className="tos-row tos-row--between">
        <h3 className="tos-section__title">Attach customer (optional)</h3>
        {selected ? (
          <button type="button" className="tos-public__form-link" onClick={() => onSelect(null)}>Clear</button>
        ) : null}
      </div>
      {selected ? (
        <div className="tos-callout tos-callout--info">
          <strong>{selected.name}</strong>
          {selected.phone ? ` · ${selected.phone}` : ""}
        </div>
      ) : (
        <>
          <input
            type="search"
            className="tos-input"
            placeholder="Search by name or phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search customers"
          />
          {customers.length === 0 ? (
            <StatePanel inline variant="empty" title="No customers yet" text="Walk-in will be used by default." />
          ) : filtered.length === 0 ? (
            <StatePanel inline variant="empty" title="No matches" text={`No customers match "${query}".`} />
          ) : (
            <ul className="tos-list">
              {filtered.slice(0, 30).map((c) => (
                <li key={c.id}>
                  <button type="button" className="tos-list__row" onClick={() => onSelect(c)} style={{ width: "100%" }}>
                    <div className="tos-list__row-main">
                      <span className="tos-list__row-title">{c.name}</span>
                      <span className="tos-list__row-sub">{c.phone ?? "No phone"}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import type { Customer } from "../workspace/workspace-provider";
import { StatePanel } from "../ui/state-panel";
import { IconUsers, IconUser, IconClose } from "../ui/icons";

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
          <button
            type="button"
            className="tos-public__form-link"
            onClick={() => onSelect(null)}
            aria-label="Clear customer — use walk-in"
          >
            Clear
          </button>
        ) : null}
      </div>
      {selected ? (
        <div className="tos-callout tos-callout--info" role="status">
          <span className="tos-callout__icon-wrap" aria-hidden="true">
            <IconUser style={{ width: 18, height: 18 }} />
          </span>
          <span className="tos-callout__body">
            <strong>{selected.name}</strong>
            {selected.phone ? <span className="tos-callout__sub"> · {selected.phone}</span> : null}
          </span>
          <button
            type="button"
            className="tos-cart-line__remove"
            onClick={() => onSelect(null)}
            aria-label="Remove customer"
            style={{ width: 32, height: 32 }}
          >
            <IconClose style={{ width: 14, height: 14 }} />
          </button>
        </div>
      ) : (
        <>
          <div className="tos-pos-search" style={{ height: "auto" }}>
            <IconUsers className="tos-pos-search__icon" />
            <input
              type="search"
              className="tos-pos-search__input"
              style={{ height: 44 }}
              placeholder="Search by name or phone…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search customers"
            />
          </div>
          {customers.length === 0 ? (
            <StatePanel
              inline
              variant="empty"
              icon={<IconUsers className="tos-state__icon" />}
              title="No customers yet"
              text="This sale will be recorded as a walk-in. Add customers from the Customers page to attach them."
            />
          ) : filtered.length === 0 ? (
            <StatePanel
              inline
              variant="empty"
              icon={<IconUsers className="tos-state__icon" />}
              title="No matches"
              text={`No customers match "${query}". This sale will be a walk-in unless you pick one.`}
            />
          ) : (
            <ul className="tos-list">
              {filtered.slice(0, 30).map((c) => (
                <li key={c.id}>
                  <button type="button" className="tos-list__row" onClick={() => onSelect(c)} style={{ width: "100%" }}>
                    <div className="tos-list__row-main">
                      <span className="tos-list__row-title">{c.name}</span>
                      <span className="tos-list__row-sub">{c.phone ?? "No phone on file"}</span>
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

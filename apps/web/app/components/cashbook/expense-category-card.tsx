"use client";

import React, { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ClientApiError, clientApi, messageFrom } from "../../lib/client-api";
import { Button } from "../ui/button";
import type { CashbookCategory } from "./types";

const categoryAdminRoles = new Set(["OWNER", "ADMIN", "MANAGER", "ACCOUNTANT"]);

export type ExpenseCategoryDraft = {
  categoryId: string | null;
  expectedUpdatedAt: string | null;
  name: string;
  active: boolean;
};

type CardProps = {
  businessId: string;
  role: string;
  categories: readonly CashbookCategory[];
  onChanged: (category: CashbookCategory) => void | Promise<void>;
  onMessage: (message: string) => void;
};

type SheetProps = {
  open: boolean;
  businessId: string;
  category: CashbookCategory | null;
  role: string;
  onClose: () => void;
  onSaved: (category: CashbookCategory) => void | Promise<void>;
  onMessage: (message: string) => void;
};

export function expenseCategoryDraftFor(category: CashbookCategory | null): ExpenseCategoryDraft {
  return category
    ? { categoryId: category.id, expectedUpdatedAt: category.updatedAt, name: category.name, active: category.active }
    : { categoryId: null, expectedUpdatedAt: null, name: "", active: true };
}

export function expenseCategoryMessage(code: string | null | undefined, fallback = "Category change could not be saved."): string {
  if (code === "STALE_VERSION") return "This category changed on another device. Refresh the latest version before saving again.";
  if (code === "REVISION_REQUIRED") return "Refresh this category before editing so TradeOS can protect newer changes.";
  if (code === "CATEGORY_EXISTS") return "A category with this name already exists.";
  if (code === "OFFLINE_CATEGORY_CHANGE") return "Category changes require an online connection so TradeOS can validate the latest version.";
  return fallback;
}

export function ExpenseCategoryCard({ businessId, role, categories, onChanged, onMessage }: CardProps) {
  const canManage = categoryAdminRoles.has(role);
  const [editor, setEditor] = useState<CashbookCategory | null | undefined>(undefined);
  const activeCount = useMemo(() => categories.filter((category) => category.active).length, [categories]);
  const archivedCount = categories.length - activeCount;

  return (
    <section className="cashbook-card cashbook-category-card">
      <div className="expense-category-head">
        <div>
          <span className="cashbook-card-kicker">Expense categories</span>
          <h3>Manage categories</h3>
          <p>Control future expense choices without rewriting historical expenses. Category changes are <strong>online only.</strong></p>
        </div>
        {canManage ? <Button type="button" onClick={() => setEditor(null)}>Add category</Button> : null}
      </div>

      <div className="expense-category-counts" aria-label="Expense category counts">
        <span><strong>{activeCount}</strong> Active</span>
        <span><strong>{archivedCount}</strong> Archived</span>
      </div>

      <div className="expense-category-list">
        {categories.length === 0 ? <div className="expense-category-empty">No expense categories are available yet.</div> : null}
        {categories.map((category) => (
          <article className={category.active ? "expense-category-row" : "expense-category-row archived"} key={category.id}>
            <div className="expense-category-copy">
              <strong>{category.name}</strong>
              <div className="expense-category-badges">
                {category.system ? <span className="system">System</span> : <span>Custom</span>}
                <span className={category.active ? "active" : "archived"}>{category.active ? "Active" : "Archived"}</span>
              </div>
            </div>
            {canManage ? <Button variant="secondary" size="compact" type="button" onClick={() => setEditor(category)}>Edit</Button> : null}
          </article>
        ))}
      </div>

      {editor !== undefined ? (
        <ExpenseCategorySheet
          open
          businessId={businessId}
          category={editor}
          role={role}
          onClose={() => setEditor(undefined)}
          onSaved={onChanged}
          onMessage={onMessage}
        />
      ) : null}
    </section>
  );
}

export function ExpenseCategorySheet({ open, businessId, category, role, onClose, onSaved, onMessage }: SheetProps) {
  const canManage = categoryAdminRoles.has(role);
  const [draft, setDraft] = useState<ExpenseCategoryDraft>(() => expenseCategoryDraftFor(category));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);
  const previous_active_element = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(expenseCategoryDraftFor(category));
    setMessage(null);
  }, [category, open]);

  useEffect(() => {
    if (!open) return;
    previous_active_element.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => firstInputRef.current?.focus());
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
      previous_active_element.current?.focus();
    };
  }, [onClose, open]);

  if (!open || !canManage) return null;

  const fail = (reason: unknown, fallback?: string) => {
    const text = reason instanceof ClientApiError
      ? expenseCategoryMessage(reason.code, reason.message)
      : messageFrom(reason);
    setMessage(text || fallback || "Category change could not be saved.");
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.name.trim() || busy) return;
    if (!navigator.onLine) {
      setMessage(expenseCategoryMessage("OFFLINE_CATEGORY_CHANGE"));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = category
        ? await clientApi<{ category: CashbookCategory }>(`/api/tradeos/v1/expense-categories/${category.id}`, {
            method: "PATCH",
            body: JSON.stringify({ businessId, expectedUpdatedAt: draft.expectedUpdatedAt, name: draft.name.trim() }),
          })
        : await clientApi<{ category: CashbookCategory }>("/api/tradeos/v1/expense-categories", {
            method: "POST",
            body: JSON.stringify({ businessId, name: draft.name.trim() }),
          });
      await onSaved(result.category);
      onMessage(category ? "Expense category updated." : "Expense category created.");
      onClose();
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async () => {
    if (!category || busy) return;
    if (!navigator.onLine) {
      setMessage(expenseCategoryMessage("OFFLINE_CATEGORY_CHANGE"));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await clientApi<{ category: CashbookCategory }>(`/api/tradeos/v1/expense-categories/${category.id}`, {
        method: "PATCH",
        body: JSON.stringify({ businessId, expectedUpdatedAt: draft.expectedUpdatedAt, active: !draft.active }),
      });
      await onSaved(result.category);
      onMessage(draft.active ? "Expense category archived for future entries." : "Expense category reactivated.");
      onClose();
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  };

  const title = category ? `Edit ${category.name}` : "Add expense category";
  return (
    <div className="expense-category-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={sheetRef} className="expense-category-sheet" role="dialog" aria-modal="true" aria-labelledby="expense-category-sheet-title">
        <header className="expense-category-sheet-header">
          <div><span>Cashbook configuration</span><h2 id="expense-category-sheet-title">{title}</h2></div>
          <button type="button" className="expense-category-sheet-close" aria-label="Close category" onClick={onClose}>×</button>
        </header>

        <form className="expense-category-sheet-body" onSubmit={(event) => void save(event)}>
          <section>
            <div className="expense-category-section-heading"><strong>Category details</strong><span>Used for future expense reporting</span></div>
            <label>Name<input ref={firstInputRef} required maxLength={160} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
            {category?.system ? <p className="expense-category-system-note"><strong>System category</strong> · This category came from the TradeOS default set. You may rename or archive it, but its system origin remains protected.</p> : null}
          </section>

          {category ? (
            <section>
              <div className="expense-category-section-heading"><strong>Status</strong><span>Historical expenses remain readable after archive</span></div>
              <p className="expense-category-status-copy">{draft.active ? "Active categories can be selected for new expenses." : "Archived categories remain in history but cannot be selected for new expenses."}</p>
              <Button variant={draft.active ? "danger" : "secondary"} type="button" disabled={busy} onClick={() => void toggleStatus()}>{draft.active ? "Archive category" : "Reactivate category"}</Button>
            </section>
          ) : null}

          {message ? <div className="expense-category-sheet-message" role="status">{message}</div> : null}
          <footer className="expense-category-sheet-footer">
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !draft.name.trim()}>{busy ? "Saving…" : category ? "Save changes" : "Create category"}</Button>
          </footer>
        </form>
      </div>
    </div>
  );
}

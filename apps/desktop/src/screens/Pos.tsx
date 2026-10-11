/**
 * Pos — the counter POS workspace.
 *
 * Product browser (left) + cart panel (right) + checkout dialog. Fully
 * keyboard-operable: F1 help, F2 search, F4 customer, F9 charge, Esc close.
 *
 * Sale capture flows through the DesktopRuntime.captureSale() which routes
 * the canonical SALE_CREATE mutation through the OfflineMutationQueue. The
 * server is authoritative for pricing, stock, and accounting; the cart shows
 * display-only previews.
 *
 * State handling:
 *   - DEMO MODE: renders sample catalog with a DemoBanner; checkout is
 *     toast-only (no real mutation).
 *   - SIGNED OUT: renders an AccessState ("sign-in-required").
 *   - READY: loads live commerce via runtime.loadCommerce(online); captureSale
 *     returns SYNCED | PENDING | NEEDS_REVIEW.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DesktopCartLine,
  DesktopCustomerRow,
  DesktopPaymentMethod,
  DesktopSellableItem,
  ScreenId,
} from "../lib/types.js";
import {
  SAMPLE_CUSTOMERS,
  SAMPLE_SELLABLE_ITEMS,
} from "../lib/sample-data.js";
import {
  addCartItem,
  displayCartTotalMinor,
  type DesktopCommerceSnapshot,
  type DesktopRuntime,
  type DesktopReadyState,
  type DesktopSaleCaptureResult,
  projectSellableItems,
  removeCartLine,
  setCartQuantity,
} from "../lib/desktop-runtime.js";
import type {
  DesktopCatalogResponse,
  DesktopCustomerListResponse,
  DesktopInventoryResponse,
} from "../lib/desktop-api-client.js";
import { fmtMoneyMinor } from "../lib/format.js";
import { PosBrowser } from "../components/PosBrowser.js";
import { PosCart } from "../components/PosCart.js";
import { CheckoutDialog, type CheckoutCaptureOutcome } from "../components/CheckoutDialog.js";
import { AccessState } from "../components/AccessState.js";
import { DemoBanner } from "../components/DemoBanner.js";
import { buildPosShortcutMap, useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts.js";
import {
  IconSell,
  IconClose,
  IconKeyboard,
  IconSearch,
  IconCheck,
  IconAlert,
} from "../components/icons.js";

const TAX_RATE = 0.0; // VAT is line-inclusive; the server computes tax.

export interface PosProps {
  runtime: DesktopRuntime | null;
  ready: DesktopReadyState | null;
  online: boolean;
  demoMode: boolean;
  onSignIn: () => void;
  onNavigate: (id: ScreenId) => void;
}

export function Pos({ runtime, ready, online, demoMode, onSignIn }: PosProps) {
  const [items, setItems] = useState<readonly DesktopSellableItem[]>(demoMode ? SAMPLE_SELLABLE_ITEMS : []);
  const [customers, setCustomers] = useState<readonly DesktopCustomerRow[]>(demoMode ? SAMPLE_CUSTOMERS : []);
  const [commerceSource, setCommerceSource] = useState<"LIVE" | "CACHE" | "DEMO" | null>(demoMode ? "DEMO" : null);
  const [warning, setWarning] = useState<string | null>(null);
  const [commerceError, setCommerceError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [lines, setLines] = useState<DesktopCartLine[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [captureOutcome, setCaptureOutcome] = useState<CheckoutCaptureOutcome | null>(null);
  const [capturing, setCapturing] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load commerce (live or cached) when ready. Demo mode skips this.
  useEffect(() => {
    if (demoMode || !runtime || !ready) return;
    let cancelled = false;
    setCommerceError(null);
    runtime.loadCommerce(online)
      .then((snap: DesktopCommerceSnapshot) => {
        if (cancelled) return;
        setItems(snap.items);
        setCommerceSource(snap.source);
        setWarning(snap.warning);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setCommerceError(e instanceof Error ? e.message : String(e));
      });
    // Also load customers for the picker.
    runtime.api.getCustomers(ready.membership.businessId)
      .then((res: DesktopCustomerListResponse) => {
        if (cancelled) return;
        setCustomers(res.items);
      })
      .catch(() => {
        // Customer picker is optional; silent failure is OK.
      });
    return () => {
      cancelled = true;
    };
  }, [demoMode, runtime, ready, online]);

  const categories = useMemo(() => {
    // Sample/demo categories: derive from SKU prefix until live catalog lands.
    const set = new Set<string>();
    for (const item of items) {
      if (item.sku) {
        const prefix = item.sku.split("-")[0];
        if (prefix) set.add(prefix);
      }
    }
    return Array.from(set).sort();
  }, [items]);

  function flash(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }

  function addToCart(item: DesktopSellableItem) {
    setLines((prev) => addCartItem(prev, item));
  }

  function inc(key: string) {
    setLines((prev) => prev.map((l) => l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
  }
  function dec(key: string) {
    setLines((prev) =>
      prev
        .map((l) => l.key === key ? { ...l, quantity: l.quantity - 1 } : l)
        .filter((l) => l.quantity > 0),
    );
  }
  function removeLine(key: string) {
    setLines((prev) => removeCartLine(prev, key));
  }
  function clearCart() {
    setLines([]);
  }

  function focusSearch() {
    const el = document.getElementById("pos-product-search") as HTMLInputElement | null;
    el?.focus();
    el?.select();
  }
  function openCustomer() {
    setCustomerOpen(true);
  }
  function openCheckout() {
    if (lines.length === 0) {
      flash("Add items to the cart before charging.");
      return;
    }
    setCaptureOutcome(null);
    setCheckoutOpen(true);
  }
  function closeTop() {
    if (checkoutOpen) {
      setCheckoutOpen(false);
      return;
    }
    if (customerOpen) {
      setCustomerOpen(false);
      return;
    }
    if (helpOpen) {
      setHelpOpen(false);
      return;
    }
    if (query) {
      setQuery("");
      return;
    }
  }

  const shortcutMap = useMemo(
    () =>
      buildPosShortcutMap({
        onHelp: (e) => {
          e.preventDefault();
          setHelpOpen((v) => !v);
        },
        onFocusSearch: (e) => {
          e.preventDefault();
          focusSearch();
        },
        onOpenCustomer: (e) => {
          e.preventDefault();
          openCustomer();
        },
        onCharge: (e) => {
          e.preventDefault();
          openCheckout();
        },
        onClose: (e) => {
          e.preventDefault();
          closeTop();
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [checkoutOpen, customerOpen, helpOpen, query, lines.length],
  );
  useKeyboardShortcuts(shortcutMap, { enabled: true });

  async function handleCapture(method: DesktopPaymentMethod) {
    if (demoMode) {
      // Demo mode: fake the sale with a random receipt no.
      const no = `RCP-DEMO-${String(Math.floor(Math.random() * 90000) + 10000)}`;
      setCaptureOutcome({ kind: "SYNCED", receiptNo: no });
      if (method === "CASH") {
        // No cash drawer in demo mode.
      }
      return;
    }
    if (!runtime || !ready) return;
    setCapturing(true);
    try {
      const result: DesktopSaleCaptureResult = await runtime.captureSale({
        cart: lines,
        paymentMethod: method,
        ...(customerId ? { customerId } : {}),
        online,
      });
      if (result.outcome === "SYNCED") {
        setCaptureOutcome({ kind: "SYNCED", receiptNo: `RCP-${result.clientMutationId.slice(0, 8).toUpperCase()}` });
      } else if (result.outcome === "PENDING") {
        setCaptureOutcome({ kind: "PENDING" });
      } else {
        setCaptureOutcome({
          kind: "NEEDS_REVIEW",
          ...(result.errorCode ? { errorCode: result.errorCode } : {}),
          ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
        });
      }
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    } finally {
      setCapturing(false);
    }
  }

  async function handleRetry() {
    if (!runtime) return;
    setCaptureOutcome(null);
    try {
      await runtime.flush(online);
      // Re-capture is not automatic — the user can press Charge again.
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e));
    }
  }

  function handleCheckoutClose() {
    setCheckoutOpen(false);
    // If the dialog closed from the success/pending/needs-review panel,
    // start a fresh sale.
    if (captureOutcome) {
      clearCart();
      setCustomerId(null);
      setCaptureOutcome(null);
    }
  }

  const customerName = customerId
    ? customers.find((c) => c.id === customerId)?.name ?? "Walk-in"
    : "Walk-in";
  const pendingSale = ready?.queue.pending !== 0 && ready?.queue.pending !== undefined;

  if (!demoMode && (!ready || !runtime)) {
    return (
      <div className="dsk-screen">
        <div className="dsk-screen__head" style={{ marginBottom: "var(--tos-space-1)" }}>
          <div>
            <div className="dsk-screen__eyebrow">Counter workspace</div>
            <h1 className="dsk-screen__title">Sell</h1>
          </div>
        </div>
        <AccessState kind="sign-in-required" onSignIn={onSignIn} />
      </div>
    );
  }

  if (!demoMode && commerceError && items.length === 0) {
    return (
      <div className="dsk-screen">
        <div className="dsk-screen__head" style={{ marginBottom: "var(--tos-space-1)" }}>
          <div>
            <div className="dsk-screen__eyebrow">Counter workspace</div>
            <h1 className="dsk-screen__title">Sell</h1>
          </div>
        </div>
        <AccessState kind="api-unavailable" detail={commerceError} />
      </div>
    );
  }

  return (
    <div className="dsk-screen" style={{ gap: "var(--tos-space-3)" }}>
      <div className="dsk-screen__head" style={{ marginBottom: "var(--tos-space-1)" }}>
        <div>
          <div className="dsk-screen__eyebrow">Counter workspace</div>
          <h1 className="dsk-screen__title">Sell</h1>
        </div>
        <div className="dsk-screen__actions">
          <button
            type="button"
            className="dsk-btn dsk-btn--outline dsk-btn--sm"
            onClick={() => setHelpOpen(true)}
          >
            <IconKeyboard width={15} height={15} />
            Shortcuts
            <kbd style={{ fontFamily: "var(--tos-font-mono)", fontSize: 10, background: "var(--tos-surface-soft)", border: "1px solid var(--tos-border)", borderRadius: 4, padding: "1px 5px" }}>F1</kbd>
          </button>
        </div>
      </div>

      {demoMode ? <DemoBanner /> : null}
      {!demoMode && warning ? (
        <div className="dsk-banner dsk-banner--warning" role="status">
          <IconAlert className="dsk-banner__icon" />
          <div className="dsk-banner__body">
            <div className="dsk-banner__title">Catalog warning</div>
            <div className="dsk-banner__text">{warning}</div>
          </div>
        </div>
      ) : null}
      {!demoMode && commerceSource === "CACHE" ? (
        <div className="dsk-banner dsk-banner--info" role="status">
          <div className="dsk-banner__body">
            <div className="dsk-banner__text">Showing cached catalog (offline). Sales will queue and sync when back online.</div>
          </div>
        </div>
      ) : null}

      <div className="dsk-pos">
        <div className="dsk-pos__left">
          <PosBrowser
            items={items}
            query={query}
            onQueryChange={setQuery}
            category={category}
            onCategoryChange={setCategory}
            categories={categories}
            onAdd={addToCart}
            isSample={demoMode}
          />
        </div>
        <div className="dsk-pos__right">
          <PosCart
            lines={lines}
            customerName={customerName}
            onPickCustomer={openCustomer}
            onInc={inc}
            onDec={dec}
            onRemove={removeLine}
            onClear={clearCart}
            onCharge={openCheckout}
            taxRate={TAX_RATE}
            pendingSale={pendingSale || false}
          />
        </div>
      </div>

      <CheckoutDialog
        open={checkoutOpen}
        lines={lines}
        customerName={customerName}
        cashier={ready?.user.displayName ?? "Operator"}
        taxRate={TAX_RATE}
        pendingSale={pendingSale || false}
        captureOutcome={captureOutcome}
        onClose={handleCheckoutClose}
        onCapture={(method) => void handleCapture(method)}
        onRetry={() => void handleRetry()}
      />

      {customerOpen ? (
        <CustomerPickerDialog
          customers={customers}
          selectedId={customerId}
          onPick={(c) => {
            setCustomerId(c.id);
            setCustomerOpen(false);
            flash(`Customer: ${c.name}`);
          }}
          onClear={() => {
            setCustomerId(null);
            setCustomerOpen(false);
          }}
          onClose={() => setCustomerOpen(false)}
        />
      ) : null}

      {helpOpen ? <HelpDialog onClose={() => setHelpOpen(false)} /> : null}

      {toast ? (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 200,
            background: "var(--tos-midnight)",
            color: "#fff",
            padding: "10px 16px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "var(--tos-shadow-2)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <IconCheck width={15} height={15} style={{ color: "var(--tos-positive)" }} />
          {toast}
        </div>
      ) : null}
      {capturing ? (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 200,
            background: "var(--tos-midnight)",
            color: "#fff",
            padding: "10px 16px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Capturing sale\u2026
        </div>
      ) : null}
    </div>
  );
}

/* --- Inline customer picker ------------------------------------------- */
function CustomerPickerDialog({
  customers,
  selectedId,
  onPick,
  onClear,
  onClose,
}: {
  customers: readonly DesktopCustomerRow[];
  selectedId: string | null;
  onPick: (c: DesktopCustomerRow) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const filtered = customers.filter(
    (c) =>
      !q ||
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      (c.phone ?? "").includes(q),
  );
  return (
    <div
      className="dsk-dialog-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="dsk-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cust-title"
      >
        <div className="dsk-dialog__head">
          <div>
            <h2 id="cust-title" className="dsk-dialog__title">
              Select customer
            </h2>
            <div className="dsk-dialog__sub">Walk-in is the default</div>
          </div>
          <button type="button" className="dsk-dialog__close" onClick={onClose} aria-label="Close">
            <IconClose width={16} height={16} />
          </button>
        </div>
        <div className="dsk-dialog__body">
          <div className="dsk-cmdbar__search">
            <IconSearch className="dsk-cmdbar__search-icon" />
            <input
              type="search"
              className="dsk-cmdbar__search-input"
              placeholder="Search by name or phone\u2026"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
              aria-label="Search customers"
            />
          </div>
          <div className="dsk-table__wrap" style={{ maxHeight: "320px" }}>
            <table className="dsk-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th data-num>Balance</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    data-clickable="true"
                    tabIndex={0}
                    onClick={() => onPick(c)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onPick(c);
                    }}
                  >
                    <td>
                      <div className="dsk-table__cell-main">{c.name}</div>
                      <div className="dsk-table__cell-sub">{c.active ? "Active" : "Inactive"}</div>
                    </td>
                    <td className="dsk-table__cell-mono">{c.phone ?? "—"}</td>
                    <td data-num>
                      <span className={c.balanceMinor > 0 ? "dsk-text-neg" : "dsk-text-muted"}>
                        {fmtMoneyMinor(c.balanceMinor)}
                      </span>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="dsk-table__empty">
                      No customers match "{q}"
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
        <div className="dsk-dialog__foot">
          <button type="button" className="dsk-btn dsk-btn--ghost" onClick={onClear}>
            Use walk-in
          </button>
          <button type="button" className="dsk-btn dsk-btn--outline" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* --- Inline help dialog ----------------------------------------------- */
function HelpDialog({ onClose }: { onClose: () => void }) {
  const rows: ReadonlyArray<{ keys: string[]; label: string }> = [
    { keys: ["F1"], label: "Open / close this shortcuts panel" },
    { keys: ["F2"], label: "Focus the product search box" },
    { keys: ["F4"], label: "Open the customer selector" },
    { keys: ["F9"], label: "Charge the current cart" },
    { keys: ["Enter"], label: "In checkout: confirm charge" },
    { keys: ["Esc"], label: "Close the topmost dialog / clear search" },
  ];
  return (
    <div
      className="dsk-dialog-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dsk-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <div className="dsk-dialog__head">
          <div>
            <h2 id="help-title" className="dsk-dialog__title">
              Keyboard shortcuts
            </h2>
            <div className="dsk-dialog__sub">The POS is fully operable by keyboard</div>
          </div>
          <button type="button" className="dsk-dialog__close" onClick={onClose} aria-label="Close">
            <IconClose width={16} height={16} />
          </button>
        </div>
        <div className="dsk-dialog__body">
          <div className="dsk-table__wrap" style={{ maxHeight: "none" }}>
            <table className="dsk-table">
              <thead>
                <tr>
                  <th style={{ width: "140px" }}>Key</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <td>
                      <span style={{ display: "inline-flex", gap: 4 }}>
                        {r.keys.map((k) => (
                          <kbd
                            key={k}
                            style={{
                              fontFamily: "var(--tos-font-mono)",
                              fontSize: 11,
                              background: "var(--tos-surface-soft)",
                              border: "1px solid var(--tos-border)",
                              borderRadius: 4,
                              padding: "2px 6px",
                              fontWeight: 700,
                              color: "var(--tos-text-strong)",
                            }}
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </td>
                    <td>{r.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dsk-banner dsk-banner--info">
            <IconKeyboard className="dsk-banner__icon" />
            <div className="dsk-banner__body">
              <div className="dsk-banner__title">Barcode scanners work out of the box</div>
              <div className="dsk-banner__text">
                USB HID scanners type into the focused search field (F2). Scan a code to jump
                straight to the matching product and press Enter to add it.
              </div>
            </div>
          </div>
          <div className="dsk-banner dsk-banner--neutral">
            <IconSell className="dsk-banner__icon" />
            <div className="dsk-banner__body">
              <div className="dsk-banner__title">Server-authoritative checkout</div>
              <div className="dsk-banner__text">
                The cart sends only <code>itemId</code>, <code>saleUnitCode</code> and
                <code>quantity</code> per line. The server computes prices, taxes, stock
                validation and accounting.
              </div>
            </div>
          </div>
        </div>
        <div className="dsk-dialog__foot">
          <button type="button" className="dsk-btn dsk-btn--primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

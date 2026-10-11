/**
 * Tauri API adapter for the TradeOS desktop client.
 *
 * Components and screens MUST NOT import `@tauri-apps/api` directly. They go
 * through this adapter, which gracefully degrades to browser no-ops when the
 * app is running in plain Vite dev mode (no Tauri runtime). This keeps the same
 * code path working for `vite dev`, `vite build`, and the eventual `tauri dev`
 * / `tauri build` native bundle.
 *
 * `@tauri-apps/api` is loaded lazily (dynamic import) and ONLY when a Tauri
 * runtime is actually present, so the browser bundle never pulls it in.
 */

import type { ClientPlatform } from "@tradeos/client-core";

/** True when running inside a Tauri native window. */
export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "__TAURI_INTERNALS__" in window ||
    "__TAURI__" in window ||
    // The official isTauri() helper checks this flag set by the bootstrap.
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
      undefined
  );
}

/** Detect the host platform for the titlebar + platform indicator. */
export function detectPlatform(): ClientPlatform {
  if (typeof navigator === "undefined") return "WINDOWS";
  const ua = navigator.userAgent || "";
  if (/Mac|iPhone|iPad|iPod/.test(ua)) return "MACOS";
  if (/Windows/.test(ua)) return "WINDOWS";
  if (/Linux/.test(ua)) return "WINDOWS"; // desktop Linux maps to the Windows shell layout
  return "WINDOWS";
}

export interface WindowControls {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
}

const noop = async (): Promise<void> => {
  /* browser no-op */
};

const noopBool = async (): Promise<boolean> => false;

/** Window control primitives. No-ops in the browser. */
export const windowControls: WindowControls = {
  minimize: noop,
  toggleMaximize: noop,
  close: noop,
  isMaximized: noopBool,
};

/**
 * Lazily wire the real Tauri window controls once we know we're in a native
 * window. Safe to call multiple times.
 */
let wired = false;
export async function ensureTauriWindow(): Promise<void> {
  if (wired || !isTauri()) return;
  wired = true;
  try {
    const mod = await import("@tauri-apps/api/window");
    const win = mod.getCurrentWindow();
    windowControls.minimize = async () => {
      await win.minimize();
    };
    windowControls.toggleMaximize = async () => {
      await win.toggleMaximize();
    };
    windowControls.close = async () => {
      await win.close();
    };
    windowControls.isMaximized = async () => win.isMaximized();
  } catch {
    // @tauri-apps/api not resolvable — keep no-op stubs (browser dev mode).
    wired = false;
  }
}

export interface ReceiptPayload {
  receiptNo: string;
  lines: ReadonlyArray<{ name: string; qty: number; unitPrice: number; total: number }>;
  total: number;
  method: string;
  cashier: string;
  customerName: string;
  date: string;
}

/** Print a receipt. Falls back to the browser print dialog. */
export async function printReceipt(payload: ReceiptPayload): Promise<void> {
  if (isTauri()) {
    try {
      // Future: a real Tauri receipt-printer plugin command.
      // For now we open the browser-style receipt window even in Tauri, since
      // the printer bridge is not yet wired (capability is declared but the
      // adapter is pending).
      openReceiptPrintWindow(payload);
      return;
    } catch {
      /* fall through */
    }
  }
  openReceiptPrintWindow(payload);
}

function openReceiptPrintWindow(payload: ReceiptPayload): void {
  const win = window.open("", "_blank", "width=380,height=640");
  if (!win) return;
  const lines = payload.lines
    .map(
      (l) =>
        `<tr><td>${l.qty}× ${escapeHtml(l.name)}</td><td style="text-align:right">${l.total.toFixed(2)}</td></tr>`,
    )
    .join("");
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${payload.receiptNo}</title>
  <style>
    body{font-family:ui-monospace,Menlo,monospace;font-size:12px;padding:16px;color:#000}
    h1{font-size:14px;margin:0 0 4px}
    .m{color:#444;font-size:11px;margin:2px 0}
    table{width:100%;border-collapse:collapse;margin:8px 0}
    td{padding:2px 0;border-bottom:1px dashed #ccc}
    .t{font-size:16px;font-weight:700;margin-top:8px}
    .f{margin-top:14px;font-size:10px;color:#666;text-align:center}
  </style></head><body>
  <h1>TradeOS Africa</h1>
  <div class="m">Receipt: ${escapeHtml(payload.receiptNo)}</div>
  <div class="m">Cashier: ${escapeHtml(payload.cashier)}</div>
  <div class="m">Customer: ${escapeHtml(payload.customerName)}</div>
  <div class="m">Date: ${escapeHtml(payload.date)}</div>
  <table>${lines}</table>
  <div class="t">Total: GHS ${payload.total.toFixed(2)}</div>
  <div class="m">Paid via: ${escapeHtml(payload.method)}</div>
  <div class="f">Thank you · TradeOS Desktop</div>
  <script>window.onload=function(){window.print()}</script>
  </body></html>`);
  win.document.close();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/** Trigger the cash drawer. No-op in the browser. */
export async function openCashDrawer(): Promise<void> {
  if (!isTauri()) return;
  // Future: invoke("plugin:cashdrawer|open") once the plugin is wired.
  return;
}

/**
 * Listen for barcode-scanner input. In Tauri this would subscribe to a
 * scanner plugin event; in the browser it returns a no-op unsubscribe.
 */
export function onBarcodeScan(_handler: (code: string) => void): () => void {
  // Browser fallback: barcode scanners present as HID keyboards, so the search
  // input already captures their output. The Tauri path will be wired when the
  // scanner plugin lands.
  return () => {
    /* no-op unsubscribe */
  };
}

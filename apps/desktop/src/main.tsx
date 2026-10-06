import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { defaultPlatformProfile } from "@tradeos/client-core";
import "./styles.css";

const runtimePlatform = navigator.userAgent.includes("Mac") ? "MACOS" : "WINDOWS";
const profile = defaultPlatformProfile(runtimePlatform);

function App() {
  return (
    <main className="shell">
      <aside>
        <div className="brand"><span>T</span><div><strong>TradeOS</strong><small>Desktop</small></div></div>
        <nav>
          <button className="active">Overview</button>
          <button>Sell</button>
          <button>Inventory</button>
          <button>Customers</button>
          <button>Returns</button>
          <button>Reports</button>
        </nav>
        <div className="device">
          <strong>{runtimePlatform === "MACOS" ? "macOS" : "Windows"}</strong>
          <span>Native shell · offline-first</span>
        </div>
      </aside>
      <section className="workspace">
        <header>
          <div><p>TradeOS Africa</p><h1>Desktop business workspace</h1></div>
          <button className="primary">+ New sale</button>
        </header>
        <section className="hero">
          <div>
            <p className="eyebrow">Native POS capability</p>
            <h2>One desktop client for Windows and macOS.</h2>
            <p>Built to add receipt printers, barcode scanners, cash drawers, local exports and resilient background sync without duplicating commerce rules.</p>
          </div>
          <div className="capabilities">
            {Array.from(profile.capabilities).map((capability) => <span key={capability}>{capability.replaceAll("_", " ")}</span>)}
          </div>
        </section>
        <section className="cards">
          <article><span>Offline queue</span><strong>Ready</strong><small>Local transaction persistence comes next.</small></article>
          <article><span>Peripheral bridge</span><strong>Planned</strong><small>Printer, scanner and cash-drawer adapters.</small></article>
          <article><span>Shared backend</span><strong>Connected by contract</strong><small>Uses the same API and sync semantics as web/mobile.</small></article>
        </section>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Desktop root element was not found");
createRoot(root).render(<StrictMode><App /></StrictMode>);

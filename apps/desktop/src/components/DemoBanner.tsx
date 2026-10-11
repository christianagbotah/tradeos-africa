/**
 * DemoBanner — a prominent banner shown at the top of every screen when the
 * desktop is running in DEMO MODE (VITE_TRADEOS_DEMO=true).
 *
 * The banner is intentionally loud so a user can never mistake demo content
 * for live business data. It explains that sample data is shown and that no
 * API session is connected.
 */
import { IconInfo } from "./icons.js";

export function DemoBanner() {
  return (
    <div className="dsk-banner dsk-banner--warning" role="status" style={{ marginBottom: "var(--tos-space-3)" }}>
      <IconInfo className="dsk-banner__icon" />
      <div className="dsk-banner__body">
        <div className="dsk-banner__title">DEMO MODE — sample data</div>
        <div className="dsk-banner__text">
          The desktop is running with <code style={{ fontFamily: "var(--tos-font-mono)" }}>VITE_TRADEOS_DEMO=true</code>.
          All figures below are sample data. No API session is connected and no mutations are sent to a
          TradeOS business. Build without the demo flag (or sign in to a real business) to load live data.
        </div>
      </div>
    </div>
  );
}

const areas = [
  ["Tenants", "Businesses, branches, activation, suspension and support access"],
  ["Subscriptions", "Plans, trials, renewals, upgrades, downgrades and billing state"],
  ["Entitlements", "Module licensing, limits, overrides and feature flags"],
  ["Payments", "Subscription providers, failed payments, refunds and reconciliation"],
  ["Client releases", "Web, Windows, macOS, Android and iOS versions and minimum-supported builds"],
  ["Devices & sync", "Registered devices, last-seen state, queue health and revocation"],
  ["Integrations", "Payment, tax, messaging, AI and third-party API configuration"],
  ["Platform audit", "Privileged actions, support access and system configuration changes"],
] as const;

export default function SystemAdminHome() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">T</span>
          <div>
            <strong>TradeOS</strong>
            <small>System Admin</small>
          </div>
        </div>
        <nav>
          {areas.map(([name]) => (
            <a href={`#${name.toLowerCase().replaceAll(" ", "-")}`} key={name}>{name}</a>
          ))}
        </nav>
        <div className="boundary">
          <strong>Platform boundary</strong>
          <span>This console is separate from tenant/business administration.</span>
        </div>
      </aside>

      <section className="workspace">
        <header>
          <div>
            <p className="eyebrow">TradeOS control plane</p>
            <h1>Platform operations</h1>
            <p className="lede">Manage the SaaS platform without entering a tenant's day-to-day business workspace.</p>
          </div>
          <div className="security-chip">Privileged access · audit required</div>
        </header>

        <section className="metrics">
          <article><span>Active tenants</span><strong>—</strong><small>Connected after control-plane API</small></article>
          <article><span>MRR</span><strong>—</strong><small>Subscription ledger pending</small></article>
          <article><span>Sync health</span><strong>—</strong><small>Device telemetry pending</small></article>
          <article><span>Release health</span><strong>—</strong><small>All five clients tracked here</small></article>
        </section>

        <section className="grid">
          {areas.map(([name, detail]) => (
            <article id={name.toLowerCase().replaceAll(" ", "-")} key={name}>
              <div className="icon">{name.slice(0, 1)}</div>
              <div>
                <h2>{name}</h2>
                <p>{detail}</p>
              </div>
              <button type="button" disabled>Coming online</button>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}

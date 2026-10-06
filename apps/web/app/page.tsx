import { NetworkStatus } from "./components/network-status";
import { ReturnsPanel } from "./components/returns-panel";

const businessPacks = [
  { name: "Retail & Hardware", detail: "Shops, provisions, iron rods, nails, sandpaper", icon: "▦" },
  { name: "Food & Waakye", detail: "Recipes, portions, ingredients, packaging", icon: "◒" },
  { name: "Salon & Barber", detail: "Services, chairs, stylists, commissions, consumables", icon: "✦" },
  { name: "Drinks & Spots", detail: "Crates, bottles, glasses, shots, tabs", icon: "◉" },
  { name: "Washing Bay", detail: "Vehicle services, attendants, chemicals, commissions", icon: "◇" },
  { name: "Car Park", detail: "Entry/exit, tickets, time billing, shift cash", icon: "▣" },
];

const quickItems = [
  { name: "Medium Waakye", unit: "plate", price: "₵30.00" },
  { name: "Egg", unit: "piece", price: "₵5.00" },
  { name: "Malt", unit: "bottle", price: "₵18.00" },
  { name: "Standard Haircut", unit: "service", price: "₵40.00" },
  { name: "SUV Full Wash", unit: "service", price: "₵80.00" },
  { name: "2.5mm Cable", unit: "yard", price: "₵11.50" },
];

export default function HomePage() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">T</div>
          <div>
            <strong>TradeOS</strong>
            <span>Africa</span>
          </div>
        </div>

        <nav className="nav-stack" aria-label="Primary navigation">
          <a className="nav-item active" href="#dashboard">Overview</a>
          <a className="nav-item" href="#sell">Sell</a>
          <a className="nav-item" href="#inventory">Inventory</a>
          <a className="nav-item" href="#customers">Customers & Credit</a>
          <a className="nav-item" href="#purchases">Purchases</a>
          <a className="nav-item" href="#returns">Returns & Refunds</a>
          <a className="nav-item" href="#reports">Reports</a>
        </nav>

        <NetworkStatus />
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Demo business</p>
            <h1>Good morning</h1>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button">Open shift</button>
            <button className="primary-button">+ New sale</button>
          </div>
        </header>

        <section className="metrics-grid" id="dashboard">
          <article className="metric-card">
            <span>Sales today</span>
            <strong>₵1,480.00</strong>
            <small className="positive">↑ 12% vs yesterday</small>
          </article>
          <article className="metric-card">
            <span>Estimated profit</span>
            <strong>₵510.00</strong>
            <small>After stock cost & recorded expenses</small>
          </article>
          <article className="metric-card">
            <span>Customers owe</span>
            <strong>₵4,820.00</strong>
            <small className="warning">7 balances overdue</small>
          </article>
          <article className="metric-card health-card">
            <span>Business health</span>
            <strong>82 / 100</strong>
            <small className="positive">Good</small>
          </article>
        </section>

        <section className="content-grid">
          <article className="panel quick-sale" id="sell">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Fast counter mode</p>
                <h2>Quick sale</h2>
              </div>
              <button className="text-button">View full POS</button>
            </div>

            <div className="quick-items">
              {quickItems.map((item) => (
                <button className="quick-item" key={item.name}>
                  <span>{item.name}</span>
                  <small>{item.unit}</small>
                  <strong>{item.price}</strong>
                </button>
              ))}
            </div>

            <div className="checkout-strip">
              <div>
                <span>Current sale</span>
                <strong>3 items · ₵53.00</strong>
              </div>
              <div className="payment-actions">
                <button>Cash</button>
                <button>MoMo</button>
                <button>Pay later</button>
                <button className="checkout-button">Charge ₵53.00</button>
              </div>
            </div>
          </article>

          <aside className="panel ai-panel">
            <div className="panel-heading compact">
              <div>
                <p className="eyebrow">AI business adviser</p>
                <h2>What needs attention</h2>
              </div>
            </div>
            <div className="insight important">
              <strong>Cash may be tight next week</strong>
              <p>₵4,820 is owed by customers while two supplier payments are due.</p>
            </div>
            <div className="insight">
              <strong>Rice usage is above expected</strong>
              <p>Actual usage is 11.8% above your configured portion yield.</p>
            </div>
            <div className="insight">
              <strong>Malt stock is moving slowly</strong>
              <p>Consider reducing your next order by about one crate.</p>
            </div>
          </aside>
        </section>

        <ReturnsPanel />

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">One core, different businesses</p>
              <h2>Business packs</h2>
            </div>
            <button className="text-button">Configure business</button>
          </div>
          <div className="pack-grid">
            {businessPacks.map((pack) => (
              <article className="pack-card" key={pack.name}>
                <div className="pack-icon">{pack.icon}</div>
                <strong>{pack.name}</strong>
                <span>{pack.detail}</span>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

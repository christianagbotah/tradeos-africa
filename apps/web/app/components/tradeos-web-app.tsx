"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CashbookExpenses } from "./cashbook-expenses";
import { PurchasesInventory } from "./purchases-inventory";
import { CustomersCredit } from "./customers-credit";
import { NetworkStatus } from "./network-status";
import { QuickSale, type QuickSaleItem } from "./quick-sale";
import { SalesAndReturns } from "./sales-returns";
import {
  getActiveBusinessId,
  getOrCreateClientId,
  setActiveBusinessId,
} from "../lib/offline-sync";

type Membership = {
  id: string;
  businessId: string;
  businessName: string;
  businessType: string;
  businessStatus: string;
  role: string;
  staffId: string | null;
};

type MePayload = {
  user: { id: string; displayName: string; email: string | null; phoneE164: string | null };
  client: { platform: string; deviceKey: string; appVersion: string };
  memberships: Membership[];
};

type BusinessContext = {
  business: {
    id: string;
    name: string;
    businessType: string;
    countryCode: string;
    currencyCode: string;
    timezone: string;
    status: string;
  };
  membership: { role: string; staffId: string | null };
  branches: Array<{ id: string; name: string; code: string; timezone: string; active: boolean }>;
};

type CatalogUnit = {
  code: string;
  label: string;
  canPurchase: boolean;
  canSell: boolean;
  canStock: boolean;
  defaultSalePriceMinor: number | null;
};

type CatalogItem = {
  id: string;
  sku: string | null;
  name: string;
  kind: "PRODUCT" | "SERVICE" | "PREPARED_PRODUCT";
  stockUnitCode: string | null;
  trackStock: boolean;
  taxCategory: string | null;
  active: boolean;
  units: CatalogUnit[];
  conversions: Array<{ fromUnitCode: string; toUnitCode: string; factor: number }>;
};

type AuthMode = "login" | "register";
type StarterMode = "simple" | "bulk" | "service";

const businessTypes = [
  ["RETAIL_HARDWARE", "Retail & hardware", "Provisions, nails, rods, cable, sandpaper and building materials"],
  ["FOOD", "Food & waakye", "Waakye, chop bar, restaurant, bakery and food vending"],
  ["SALON_BARBER", "Salon & barber", "Hair, barbering, beauty, nails and related services"],
  ["DRINKING_SPOT", "Drinking spot", "Drinks by crate, bottle, glass or shot"],
  ["WASHING_BAY", "Washing bay", "Vehicle wash services, attendants and consumables"],
  ["CAR_PARK", "Car park", "Entry/exit, time billing and shift cash"],
  ["DISTRIBUTION", "Distribution", "Wholesale, FMCG, cement and multi-unit distribution"],
  ["SERVICES", "Services", "Other appointment, job or service businesses"],
  ["OTHER", "Other", "Start with the common TradeOS core and configure your workflow"],
] as const;

export function TradeOSWebApp() {
  const [resolved, setResolved] = useState(false);
  const [session, setSession] = useState<MePayload | null>(null);
  const [context, setContext] = useState<BusinessContext | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSession = async () => {
    setError(null);
    try {
      const response = await fetch("/api/session/me", { cache: "no-store" });
      if (response.status === 401) {
        setSession(null);
        setContext(null);
        setCatalog([]);
        setBranchId(null);
        setActiveBusinessId(null);
        return;
      }
      const data = await readResponse<MePayload>(response);
      setSession(data);

      if (data.memberships.length === 0) {
        setContext(null);
        setCatalog([]);
        setBranchId(null);
        setActiveBusinessId(null);
        return;
      }

      const remembered = getActiveBusinessId();
      const membership = data.memberships.find((item) => item.businessId === remembered) ?? data.memberships[0]!;
      await loadBusiness(membership.businessId);
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setResolved(true);
    }
  };

  const loadBusiness = async (businessId: string) => {
    const business = await api<BusinessContext>(`/api/tradeos/v1/businesses/${businessId}/context`);
    const activeBranches = business.branches.filter((branch) => branch.active);
    const selectedBranch = activeBranches.find((branch) => branch.code === "MAIN") ?? activeBranches[0] ?? null;
    if (!selectedBranch) throw new Error("This business has no active branch.");

    const catalogData = await api<{ items: CatalogItem[] }>(`/api/tradeos/v1/catalog/items?businessId=${businessId}`);
    setContext(business);
    setBranchId(selectedBranch.id);
    setCatalog(catalogData.items);
    setActiveBusinessId(businessId);
  };

  useEffect(() => {
    void loadSession();
    // The initial session probe should run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!resolved) {
    return <LoadingScreen />;
  }

  if (!session) {
    return <AuthScreen onAuthenticated={() => void loadSession()} error={error} />;
  }

  if (!context) {
    return <BusinessOnboarding userName={session.user.displayName} onCreated={() => void loadSession()} onLogout={() => void logout(setSession)} />;
  }

  const activeBranch = context.branches.find((branch) => branch.id === branchId) ?? context.branches[0]!;
  const sellableItems: QuickSaleItem[] = catalog.flatMap((item) =>
    item.units
      .filter((unit) => item.active && unit.canSell && unit.defaultSalePriceMinor !== null)
      .map((unit) => ({
        key: `${item.id}:${unit.code}`,
        itemId: item.id,
        name: item.name,
        unitCode: unit.code,
        unitLabel: unit.label,
        priceMinor: unit.defaultSalePriceMinor!,
      })),
  );

  return (
    <BusinessWorkspace
      session={session}
      context={context}
      branchId={activeBranch.id}
      catalog={catalog}
      sellableItems={sellableItems}
      onCatalogChanged={() => void loadBusiness(context.business.id)}
      onBusinessChanged={(businessId) => void loadBusiness(businessId)}
      onBranchChanged={setBranchId}
      onLogout={() => void logout(setSession)}
    />
  );
}

function AuthScreen({ onAuthenticated, error }: { onAuthenticated: () => void; error: string | null }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [displayName, setDisplayName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(error);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setLocalError(null);
    try {
      const deviceKey = getOrCreateClientId();
      const common = { password, platform: "WEB", deviceKey, appVersion: webVersion() };
      const body = mode === "register"
        ? {
            ...common,
            displayName,
            ...(identifier.trim().startsWith("+") ? { phone: identifier.trim() } : { email: identifier.trim() }),
          }
        : { ...common, identifier: identifier.trim() };
      await api(`/api/session/${mode}`, { method: "POST", body: JSON.stringify(body) });
      onAuthenticated();
    } catch (reason) {
      setLocalError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="brand-lockup auth-brand">
          <div className="brand-mark">T</div>
          <div><strong>TradeOS</strong><span>Africa</span></div>
        </div>
        <p className="eyebrow">One operating system for everyday business</p>
        <h1>From a single chair or food stand to a multi-branch company.</h1>
        <p>Sell, track stock, manage services and credit, work offline, and understand what is happening in plain business language.</p>
        <div className="auth-points">
          <span>Offline-first</span><span>Bulk → unit selling</span><span>Services + consumables</span><span>Returns & refunds</span>
        </div>
      </section>

      <section className="auth-card">
        <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} type="button" onClick={() => setMode("login")}>Sign in</button>
          <button className={mode === "register" ? "active" : ""} type="button" onClick={() => setMode("register")}>Create account</button>
        </div>
        <div>
          <p className="eyebrow">{mode === "login" ? "Welcome back" : "Start your business"}</p>
          <h2>{mode === "login" ? "Sign in to TradeOS" : "Create your owner account"}</h2>
        </div>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {mode === "register" ? (
            <label>Full name<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Business owner name" /></label>
          ) : null}
          <label>Email or phone<input required value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="name@example.com or +233…" /></label>
          <label>Password<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></label>
          {localError ? <div className="form-error">{localError}</div> : null}
          <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}</button>
        </form>
        <small className="security-note">Your browser session uses HttpOnly cookies; TradeOS access tokens are not exposed to page JavaScript.</small>
      </section>
    </main>
  );
}

function BusinessOnboarding({ userName, onCreated, onLogout }: { userName: string; onCreated: () => void; onLogout: () => void }) {
  const [name, setName] = useState("");
  const [branchName, setBranchName] = useState("Main");
  const [businessType, setBusinessType] = useState<(typeof businessTypes)[number][0]>("RETAIL_HARDWARE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/tradeos/v1/onboarding/business", {
        method: "POST",
        body: JSON.stringify({ name, branchName, businessType }),
      });
      onCreated();
    } catch (reason) {
      setError(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="setup-shell">
      <header className="setup-topbar">
        <div className="brand-lockup"><div className="brand-mark">T</div><div><strong>TradeOS</strong><span>Africa</span></div></div>
        <button className="text-button" type="button" onClick={onLogout}>Sign out</button>
      </header>
      <section className="setup-card wide">
        <p className="eyebrow">Welcome, {userName}</p>
        <h1>Create your first business</h1>
        <p className="setup-copy">Choose what best describes the business. TradeOS will use the same strong commerce engine while tailoring the workflow and language.</p>
        <form onSubmit={(event) => void submit(event)}>
          <div className="form-row">
            <label>Business name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Akosua's Waakye" /></label>
            <label>Branch name<input required value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="Main" /></label>
          </div>
          <div className="business-type-grid">
            {businessTypes.map(([id, label, detail]) => (
              <button type="button" key={id} className={businessType === id ? "business-type selected" : "business-type"} onClick={() => setBusinessType(id)}>
                <strong>{label}</strong><span>{detail}</span>
              </button>
            ))}
          </div>
          {error ? <div className="form-error">{error}</div> : null}
          <button className="primary-button setup-submit" type="submit" disabled={busy}>{busy ? "Creating…" : "Create business"}</button>
        </form>
      </section>
    </main>
  );
}

function BusinessWorkspace(props: {
  session: MePayload;
  context: BusinessContext;
  branchId: string;
  catalog: CatalogItem[];
  sellableItems: QuickSaleItem[];
  onCatalogChanged: () => void;
  onBusinessChanged: (businessId: string) => void;
  onBranchChanged: (branchId: string) => void;
  onLogout: () => void;
}) {
  const { session, context, branchId, catalog, sellableItems } = props;
  const activeBranch = context.branches.find((branch) => branch.id === branchId)!;
  const trackedProducts = catalog.filter((item) => item.trackStock).length;
  const services = catalog.filter((item) => item.kind === "SERVICE").length;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><div className="brand-mark">T</div><div><strong>TradeOS</strong><span>Africa</span></div></div>
        <nav className="nav-stack" aria-label="Primary navigation">
          <a className="nav-item active" href="#dashboard">Overview</a>
          <a className="nav-item" href="#sell">Sell</a>
          <a className="nav-item" href="#cashbook">Cashbook & expenses</a>
          <a className="nav-item" href="#customers">Customers & credit</a>
          <a className="nav-item" href="#purchases">Purchases & inventory</a>
          <a className="nav-item" href="#catalog">Catalog & units</a>
          <a className="nav-item" href="#returns">Returns & refunds</a>
        </nav>
        <NetworkStatus />
        <button className="sidebar-signout" type="button" onClick={props.onLogout}>Sign out</button>
      </aside>

      <section className="workspace">
        <header className="topbar real-topbar">
          <div>
            <p className="eyebrow">{context.membership.role} · {activeBranch.name}</p>
            <h1>{context.business.name}</h1>
          </div>
          <div className="topbar-actions">
            {session.memberships.length > 1 ? (
              <select className="context-select" value={context.business.id} onChange={(event) => props.onBusinessChanged(event.target.value)}>
                {session.memberships.map((membership) => <option value={membership.businessId} key={membership.businessId}>{membership.businessName}</option>)}
              </select>
            ) : null}
            {context.branches.filter((branch) => branch.active).length > 1 ? (
              <select className="context-select" value={branchId} onChange={(event) => props.onBranchChanged(event.target.value)}>
                {context.branches.filter((branch) => branch.active).map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}
              </select>
            ) : null}
          </div>
        </header>

        <section className="metrics-grid" id="dashboard">
          <article className="metric-card"><span>Sellable choices</span><strong>{sellableItems.length}</strong><small>Across configured sale units</small></article>
          <article className="metric-card"><span>Tracked products</span><strong>{trackedProducts}</strong><small>Inventory-managed catalog items</small></article>
          <article className="metric-card"><span>Services</span><strong>{services}</strong><small>Service consumables can be added next</small></article>
          <article className="metric-card health-card"><span>Currency</span><strong>{context.business.currencyCode === "GHS" ? "₵ GHS" : context.business.currencyCode}</strong><small className="positive">{context.business.countryCode}</small></article>
        </section>

        <QuickSale businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} items={sellableItems} />

        <PurchasesInventory businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} catalog={props.catalog} />

        <CashbookExpenses businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} role={context.membership.role} />
        <CustomersCredit
          businessId={context.business.id}
          branchId={branchId}
          currencyCode={context.business.currencyCode}
          role={context.membership.role}
        />

        <CatalogStarter businessId={context.business.id} branchId={branchId} currencyCode={context.business.currencyCode} onCreated={props.onCatalogChanged} />

        <SalesAndReturns
          businessId={context.business.id}
          branchId={branchId}
          currencyCode={context.business.currencyCode}
        />
      </section>
    </main>
  );
}

function CatalogStarter({ businessId, branchId, currencyCode, onCreated }: { businessId: string; branchId: string; currencyCode: string; onCreated: () => void }) {
  const [mode, setMode] = useState<StarterMode>("simple");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [openingStock, setOpeningStock] = useState("");
  const [simpleUnit, setSimpleUnit] = useState("piece");
  const [purchaseUnit, setPurchaseUnit] = useState("bottle");
  const [stockUnit, setStockUnit] = useState("ml");
  const [saleUnit, setSaleUnit] = useState("glass");
  const [purchaseFactor, setPurchaseFactor] = useState("750");
  const [saleFactor, setSaleFactor] = useState("50");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const priceMinor = useMemo(() => moneyToMinor(price), [price]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      let payload: Record<string, unknown>;
      if (mode === "service") {
        payload = {
          businessId,
          name,
          kind: "SERVICE",
          units: [{ code: "service", label: "Service", canSell: true, defaultSalePriceMinor: priceMinor }],
        };
      } else if (mode === "simple") {
        const unit = normalizeUnit(simpleUnit);
        payload = {
          businessId,
          name,
          kind: "PRODUCT",
          trackStock: true,
          stockUnitCode: unit,
          units: [{ code: unit, label: titleUnit(unit), canPurchase: true, canSell: true, canStock: true, defaultSalePriceMinor: priceMinor }],
          ...(positiveNumber(openingStock) ? { openingStock: { branchId, quantity: Number(openingStock) } } : {}),
        };
      } else {
        const purchase = normalizeUnit(purchaseUnit);
        const stock = normalizeUnit(stockUnit);
        const sale = normalizeUnit(saleUnit);
        payload = {
          businessId,
          name,
          kind: "PRODUCT",
          trackStock: true,
          stockUnitCode: stock,
          units: mergeUnits([
            { code: purchase, label: titleUnit(purchase), canPurchase: true },
            { code: stock, label: titleUnit(stock), canStock: true },
            { code: sale, label: titleUnit(sale), canSell: true, defaultSalePriceMinor: priceMinor },
          ]),
          conversions: [
            ...(purchase !== stock ? [{ fromUnitCode: purchase, toUnitCode: stock, factor: Number(purchaseFactor) }] : []),
            ...(sale !== stock ? [{ fromUnitCode: sale, toUnitCode: stock, factor: Number(saleFactor) }] : []),
          ],
          ...(positiveNumber(openingStock) ? { openingStock: { branchId, quantity: Number(openingStock) } } : {}),
        };
      }

      await api("/api/tradeos/v1/catalog/items", { method: "POST", body: JSON.stringify(payload) });
      setName("");
      setPrice("");
      setOpeningStock("");
      setMessage("Item created. It is now available to the business.");
      onCreated();
    } catch (reason) {
      setMessage(messageFrom(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel catalog-starter" id="catalog">
      <div className="panel-heading"><div><p className="eyebrow">Real catalog</p><h2>Add a product or service</h2></div><span className="workflow-badge">Flexible units</span></div>
      <div className="starter-tabs">
        <button className={mode === "simple" ? "active" : ""} type="button" onClick={() => setMode("simple")}>Simple product</button>
        <button className={mode === "bulk" ? "active" : ""} type="button" onClick={() => setMode("bulk")}>Buy bulk · sell smaller</button>
        <button className={mode === "service" ? "active" : ""} type="button" onClick={() => setMode("service")}>Service</button>
      </div>
      <form className="catalog-form" onSubmit={(event) => void submit(event)}>
        <div className="form-row">
          <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder={mode === "service" ? "Standard haircut" : mode === "bulk" ? "750ml Whisky" : "Malt"} /></label>
          <label>Sale price ({currencyCode === "GHS" ? "₵" : currencyCode})<input required inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="18.00" /></label>
        </div>

        {mode === "simple" ? (
          <div className="form-row">
            <label>Unit<input required value={simpleUnit} onChange={(event) => setSimpleUnit(event.target.value)} placeholder="piece" /></label>
            <label>Opening stock (optional)<input inputMode="decimal" value={openingStock} onChange={(event) => setOpeningStock(event.target.value)} placeholder="24" /></label>
          </div>
        ) : null}

        {mode === "bulk" ? (
          <>
            <div className="form-row triple">
              <label>Buy as<input required value={purchaseUnit} onChange={(event) => setPurchaseUnit(event.target.value)} placeholder="bottle" /></label>
              <label>Track stock as<input required value={stockUnit} onChange={(event) => setStockUnit(event.target.value)} placeholder="ml" /></label>
              <label>Sell as<input required value={saleUnit} onChange={(event) => setSaleUnit(event.target.value)} placeholder="glass" /></label>
            </div>
            <div className="form-row triple">
              <label>1 {purchaseUnit || "purchase unit"} = how many {stockUnit || "stock units"}?<input required inputMode="decimal" value={purchaseFactor} onChange={(event) => setPurchaseFactor(event.target.value)} /></label>
              <label>1 {saleUnit || "sale unit"} = how many {stockUnit || "stock units"}?<input required inputMode="decimal" value={saleFactor} onChange={(event) => setSaleFactor(event.target.value)} /></label>
              <label>Opening stock in {stockUnit || "stock units"}<input inputMode="decimal" value={openingStock} onChange={(event) => setOpeningStock(event.target.value)} placeholder="750" /></label>
            </div>
            <p className="conversion-preview">Example: if you track whisky in ml, configure 1 bottle = 750 ml and 1 glass = 50 ml. Returning one glass will restore 50 ml—not one whole bottle.</p>
          </>
        ) : null}

        {mode === "service" ? <p className="conversion-preview">Services do not create stock themselves. Recipe/service consumables such as blades, shampoo or chemicals will be attached in the next catalog layer.</p> : null}
        {message ? <div className={message.startsWith("Item created") ? "form-success" : "form-error"}>{message}</div> : null}
        <button className="primary-button" type="submit" disabled={busy || priceMinor === null}>{busy ? "Saving…" : "Add to catalog"}</button>
      </form>
    </section>
  );
}

function LoadingScreen() {
  return <main className="loading-shell"><div className="brand-mark">T</div><strong>Loading TradeOS Africa…</strong></main>;
}

async function logout(setSession: (value: MePayload | null) => void) {
  try { await fetch("/api/session/logout", { method: "POST" }); } finally {
    setActiveBusinessId(null);
    setSession(null);
  }
}

async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  return readResponse<T>(response);
}

async function readResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) {
    const candidate = body as { message?: unknown } | null;
    throw new Error(typeof candidate?.message === "string" ? candidate.message : `Request failed (${response.status})`);
  }
  return body as T;
}

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Something went wrong. Please try again.";
}

function webVersion(): string {
  return process.env.NEXT_PUBLIC_TRADEOS_VERSION ?? "web-dev";
}

function moneyToMinor(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

function positiveNumber(value: string): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function normalizeUnit(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function titleUnit(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type DraftUnit = { code: string; label: string; canPurchase?: boolean; canSell?: boolean; canStock?: boolean; defaultSalePriceMinor?: number | null };

function mergeUnits(units: DraftUnit[]): DraftUnit[] {
  const merged = new Map<string, DraftUnit>();
  for (const unit of units) {
    const prior = merged.get(unit.code);
    merged.set(unit.code, {
      code: unit.code,
      label: prior?.label ?? unit.label,
      canPurchase: Boolean(prior?.canPurchase || unit.canPurchase),
      canSell: Boolean(prior?.canSell || unit.canSell),
      canStock: Boolean(prior?.canStock || unit.canStock),
      ...(unit.defaultSalePriceMinor !== undefined && unit.defaultSalePriceMinor !== null
        ? { defaultSalePriceMinor: unit.defaultSalePriceMinor }
        : prior?.defaultSalePriceMinor !== undefined && prior.defaultSalePriceMinor !== null
          ? { defaultSalePriceMinor: prior.defaultSalePriceMinor }
          : {}),
    });
  }
  return Array.from(merged.values());
}

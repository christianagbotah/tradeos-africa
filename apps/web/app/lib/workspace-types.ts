export type Membership = {
  id: string;
  businessId: string;
  businessName: string;
  businessType: string;
  businessStatus: string;
  role: string;
  staffId: string | null;
};

export type MePayload = {
  user: { id: string; displayName: string; email: string | null; phoneE164: string | null };
  client: { platform: string; deviceKey: string; appVersion: string };
  memberships: Membership[];
};

export type BusinessContext = {
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

export type CatalogUnit = {
  code: string;
  label: string;
  canPurchase: boolean;
  canSell: boolean;
  canStock: boolean;
  defaultSalePriceMinor: number | null;
};

export type CatalogItem = {
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

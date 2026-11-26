export interface AdminCurrencyAmount {
  currencyCode: string;
  amountMinor: number;
}

export interface AdminRecurringRevenue {
  currencyCode: string;
  mrrMinor: number;
  arrMinor: number;
}

export interface AdminPlatformMetrics {
  generatedAt: string;
  tenants: {
    total: number;
    active: number;
    suspended: number;
    closed: number;
  };
  subscriptions: {
    trialing: number;
    active: number;
    pastDue: number;
    paused: number;
    canceled: number;
    expired: number;
  };
  recurringRevenue: AdminRecurringRevenue[];
  invoices: {
    openCount: number;
    overdueCount: number;
    openBalanceByCurrency: AdminCurrencyAmount[];
    overdueBalanceByCurrency: AdminCurrencyAmount[];
  };
  collections: {
    succeededCount: number;
    failedCount: number;
    succeededByCurrency: AdminCurrencyAmount[];
    failedByCurrency: AdminCurrencyAmount[];
  };
  devices: {
    total: number;
    online: number;
    stale: number;
    unknown: number;
    syncRiskTenantCount: number;
  };
  releases: {
    draft: number;
    rollout: number;
    active: number;
    withdrawn: number;
  };
}

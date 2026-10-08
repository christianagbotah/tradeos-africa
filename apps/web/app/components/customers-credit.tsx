"use client";

import { CustomerWorkspace } from "./customers/customer-workspace";

export function CustomersCredit(props: {
  businessId: string;
  branchId: string;
  currencyCode: string;
  role: string;
}) {
  return <CustomerWorkspace {...props} />;
}

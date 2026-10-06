CREATE INDEX idx_sales_report_business_completed
  ON sales(business_id,completed_at DESC,id)
  WHERE completed_at IS NOT NULL AND status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED');
CREATE INDEX idx_sales_report_branch_completed
  ON sales(business_id,branch_id,completed_at DESC,id)
  WHERE completed_at IS NOT NULL AND status IN ('COMPLETED','PARTIALLY_REFUNDED','REFUNDED');
CREATE INDEX idx_returns_report_business_effective
  ON return_cases(business_id,(COALESCE(completed_at,created_at)) DESC,id)
  WHERE status IN ('PROCESSING','COMPLETED');
CREATE INDEX idx_returns_report_branch_effective
  ON return_cases(business_id,branch_id,(COALESCE(completed_at,created_at)) DESC,id)
  WHERE status IN ('PROCESSING','COMPLETED');
CREATE INDEX idx_cashbook_report_business_time
  ON cashbook_entries(business_id,occurred_at DESC,id);
CREATE INDEX idx_expenses_report_business_time
  ON expenses(business_id,occurred_at DESC,id);
CREATE INDEX idx_customer_account_report_business_time
  ON customer_account_entries(business_id,occurred_at DESC,id);
CREATE INDEX idx_supplier_payable_report_branch_time
  ON supplier_payable_ledger(business_id,branch_id,occurred_at DESC,id);
CREATE INDEX idx_supplier_payable_report_business_time
  ON supplier_payable_ledger(business_id,occurred_at DESC,id);
CREATE INDEX idx_purchase_returns_report_business_time
  ON purchase_return_cases(business_id,occurred_at DESC,id);
CREATE INDEX idx_purchase_returns_report_branch_time
  ON purchase_return_cases(business_id,branch_id,occurred_at DESC,id);

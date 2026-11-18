# Merchant Paystack and Flutterwave TEST verification workspace

Date: 18 November 2026. Scope: tenant owner/admin self-service access to previously internal-only, isolated TEST payment attempt preparation, independent status observation and safe closure.

## Merchant use

In Settings → Payments → Payment attempt audit, an OWNER/ADMIN can enter the UUID of an **existing OPEN sale with exactly one PENDING MoMo/card payment** and prepare a gateway TEST attempt. TradeOS uses the business's currently preferred Paystack or Flutterwave gateway, validates its securely stored TEST key, and issues an immutable TEST-only reference. This step does **not** send the reference to a gateway, create a hosted payment checkout, charge a customer or post cashbook/stock.

If the merchant has independently arranged a provider-sandbox transaction using the exact TEST reference, they can check its status. Paystack verifies by the original reference. Flutterwave additionally requires its numeric transaction ID. Status checks call the merchant's original encrypted TEST key revision and verify exact reference, amount, currency, payment method and provider transaction ID. A disputed/mismatched provider response is escalated to manual review. A TEST paid observation is immutable evidence only, not a TradeOS receipt.

Each attempt can be checked through the portal at most once per 60 seconds. Invalid provider identifiers do not consume this throttle. Merchants can mark a test attempt for review or cancel it; a final TEST attempt cannot reopen. All changes require current active OWNER/ADMIN business membership.

## Server and DB boundaries

- POST /v1/businesses/:businessId/payment-gateways/attempts (saleId + clientRequestId)
- POST /v1/businesses/:businessId/payment-gateways/attempts/:attemptId/verify-sandbox (providerTransactionId for Flutterwave)
- POST /v1/businesses/:businessId/payment-gateways/attempts/:attemptId/close (decision + reasonCode)
- GET /v1/businesses/:businessId/payment-gateways/attempts (already existing)

Migration 0052 adds atomic portal status polling cooldown and audit count to existing immutable TEST attempt rows. The underlying schema disallows LIVE environment, PAID attempt states, and posted-money transitions, and blocks a Hubtel and hosted-gateway attempt on the same sale. Provider status checks only use read-only GET requests. A provider TEST key is prefix-validated when stored; the LIVE key is never read by the TEST verification adapter.

## Go-live limitations

A prepared reference **is not a checkout**. This release does not implement Paystack/Flutterwave checkout initiation or full live collection settlement. A merchant may receive Unpaid until a matching provider TEST transaction actually exists; do not infer that a real payment failed. No real customer transactions or provider-hosted checkout URLs were generated in this release. TEST evidence never marks the sale paid, releases stock, creates a receipt, refund, payout or customer credit. Webhook signatures, payout beneficiary ownership, actual TEST checkout E2E, refunds, double-entry accounting and controlled LIVE activation remain future gates.

## Tests

Four new isolated PostgreSQL multi-tenant API tests cover idempotent preparation and no money changes; owner-only Paystack TEST verification and 60-second throttle; Flutterwave numeric ID validation and TEST observation; and irreversible closure with zero financial mutation. UI contract checks verify no POST to financial endpoints and no live collection suggestions. Full CI, Linux desktop-native and authenticated visual QA are mandatory before protected staging release.

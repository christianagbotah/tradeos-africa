# Hubtel status authorization and payment gates

- Transaction Status host: api-txnstatus.hubtel.com, GET /transactions/{collection-account}/status?clientReference=... .
- Use HTTP Basic with Payments API ID and API Key, never the SMS secrets or disbursement account.
- Hubtel must allowlist the VPS outbound IPv4 for the exact status service. On 2026-11-16 observed outbound IPv4 was 163.245.212.15, but operators must recheck it after network/VPS changes.
- If returned 401: verify API ID/Key ordering, account association and Payments/status permission (scope).
- If returned 403: verify source IP allowlist, status channel eligibility and account restrictions. 403 is NOT conclusive proof of one cause.
- A root-path anonymous 403 indicates basic host connectivity only, not permission to check a real reference.
- The status client now reports distinct AUTH_REJECTED vs ACCESS_DENIED errors without exposing credentials or provider bodies.
- Merchant reconcilers flag these conditions for manual review; neither status is treated as unpaid, and no cash/stock mutation is made.
- Server-side readiness probe: bash ops/hubtel/status-preflight.sh /path/to/private/staging.env . This prints key presence, observed egress IP, DNS and anonymous TLS only.
- After Hubtel engineers confirm access, configure the correct private server credentials, perform one legitimate test collection, then verify matching reference, amount, currency, provider ID and status from a server-origin request. Test failure/delay/refund and callback retries before allowing live commerce.
- Keep merchant collection and subscription collection separately scoped. No browser return or unauthenticated callback settles money.

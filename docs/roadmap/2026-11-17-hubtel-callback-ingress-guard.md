# Hubtel callback edge ingress gate (staging; does not activate any collection)

## What is protected
The publicly reachable but **unsigned** Hubtel Online Checkout v1 callback
POST /v1/payments/hubtel/notifications now has an exact-match Nginx configuration,
separate from the generic /v1/ catch-all.

- Source-IP normalization reads Cloudflare's CF-Connecting-IP ONLY if the TCP
  peer is in an explicit Cloudflare-published IPv4/IPv6 range; spoofed headers
  from direct origin clients are not accepted as authoritative.
- A 5 requests/second per verified visitor/source IP zone with 20 request burst
  and HTTP 429 on overflow reduces abusive ingress without modifying API traffic.
- Only HTTPS POST is accepted, with a 4 KiB body cap and 10 second ingress and
  origin timeouts. Route matches Fastify's existing 4096-byte cap.
- X-Forwarded-For is overwritten with the Nginx-normalized address, not extended
  with unauthenticated client-supplied values; the Fastify app does NOT trust
  forwarded headers for payment authorization.
- No payment, sale, receipt, refund, stock, account balance, wallet, cashbook,
  subscription, or credential-activation behavior is changed.
- Crucially, callback hints remain UNTRUSTED; inbox collection stays OFF unless
  TRADEOS_HUBTEL_NOTIFICATION_INBOX_ENABLED=true is separately authorized.

## Reviewed reference and risk
The CIDR snapshot was compared with Cloudflare's official list on 2026-11-17:
https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6 .
Before deployment, compare again and update both IPv4 and IPv6 lists if needed.
Cloudflare's own Nginx instructions use set_real_ip_from and
real_ip_header CF-Connecting-IP: see
https://developers.cloudflare.com/support/troubleshooting/restoring-visitor-ips/restoring-original-visitor-ips/ .
The trust list is **not** an IP allowlist. An origin firewall or authenticated
origin pull is an additional production perimeter decision. Do NOT use a
catch-all trusted proxy range, or assume Cloudflare source IP means a callback
was sent by Hubtel. Callbacks remain spoofable.

## Webuzo staging installation plan
Only on the authorized staging host, and only after GitHub CI, native packaging
and Visual QA have passed and operator checks Nginx module support:

1. Back up /var/webuzo-data/nginx/custom/domains/tradeosafrica.lightworldtech.com.conf
   and record nginx -T and current VPS release SHA without capturing secrets.
2. Copy the zone snippet to
   /usr/local/apps/nginx/etc/conf.d/00-tradeos-hubtel-callback-zone.conf
   (must be loaded exactly once in the Nginx http block).
3. Copy the trusted Cloudflare ranges snippet and callback exact-location
   snippet into /usr/local/apps/nginx/etc/conf.d/includes/ as separate files.
4. In the TradeOS domain custom config, add two server-scope includes for the
   trusted CIDRs and exact-location rules. Webuzo loads this file in both
   HTTP and HTTPS TradeOS vhosts; do not add to any other tenant domain.
5. Run nginx -t. If invalid, restore the original config and snippets without
   reloading. If valid, reload Nginx gracefully. Keep inbox flag OFF.
6. Check GET over HTTPS gives 403 for callback path; HTTPS POST with an
   invalid reference gets the generic 202, not a payment. Check body >4 KiB
   gets 413. Check /health, /, /sales and /settings still respond; verify
   Nginx config continues to proxy other /v1/ routes; review error logs.
7. Rollback is deleting the exact includes from the domain config, restoring
   the previous config and removing the zone file (then nginx -t + reload).
   On rollback, preserve the existing app release and never lose any DB records.

## Evidence required before enabling callback capture
- Confirm Hubtel's actual callback HTTP content type and maximum legitimate
  payload size from sandbox traffic before enforcing a strict proxy limit.
- Verify Cloudflare proxy trust end-to-end from actual different client
  addresses, including direct-origin spoofed CF-Connecting-IP and IPv6.
- Check 429 behavior does not discard normal Hubtel retries. If so, adjust
  per-source limits conservatively and retest.
- Validate a genuine Hubtel sandbox callback through HTTPS ingress and
  independent status query; callback SUCCESS alone may never mark PAID.
- Test bounded deduplication, late arrivals and stale account/credential
  revision behavior. Keep the collection_enabled=false DB guard intact.

Only then consider turning on the **hint-only** notification inbox. Merchant
LIVE collection, messaging send, and payment finality remain separate gates.

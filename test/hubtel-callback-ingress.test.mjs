import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const zone = read("ops/lightworld-vps/nginx/tradeos-hubtel-callback-zone.http.conf");
const realip = read("ops/lightworld-vps/nginx/tradeos-cloudflare-trusted-realip.server.conf");
const callback = read("ops/lightworld-vps/nginx/tradeos-hubtel-callback.location.conf");
const route = read("apps/api/src/commerce/hubtel-pos-routes.ts");
const inbox = read("apps/api/src/commerce/hubtel-pos-notification-inbox.ts");

test("Hubtel callback has a dedicated exact-match Nginx ingress with bounded request size", () => {
  assert.match(callback, /location = \/v1\/payments\/hubtel\/notifications\s*\{/);
  assert.match(callback, /limit_except POST\s*\{\s*deny all;/);
  assert.match(callback, /client_max_body_size 4k;/);
  assert.match(callback, /\$scheme != https/);
  assert.match(callback, /proxy_pass http:\/\/127\.0\.0\.1:4036;/);
  assert.match(route, /bodyLimit:4096/);
});

test("Hubtel callback has a dedicated bounded rate zone and hardened forwarded headers", () => {
  assert.match(zone, /limit_req_zone \$binary_remote_addr zone=tradeos_hubtel_callback_per_ip:10m rate=5r\/s;/);
  assert.match(callback, /limit_req zone=tradeos_hubtel_callback_per_ip burst=20 nodelay;/);
  assert.match(callback, /limit_req_status 429;/);
  assert.match(callback, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.doesNotMatch(callback, /\$proxy_add_x_forwarded_for/);
});

test("Cloudflare client IP is trusted only from explicit published proxy CIDRs", () => {
  assert.match(realip, /real_ip_header CF-Connecting-IP;/);
  assert.match(realip, /set_real_ip_from 173\.245\.48\.0\/20;/);
  assert.match(realip, /set_real_ip_from 2c0f:f248::\/32;/);
  assert.doesNotMatch(realip, /set_real_ip_from (?:0\.0\.0\.0\/0|::\/0|127\.0\.0\.1|10\.)/);
  assert.equal((realip.match(/^set_real_ip_from /gm) || []).length, 22);
});

test("Nginx cannot confer payment finality and untrusted inbox remains opt-in", () => {
  assert.match(inbox, /TRADEOS_HUBTEL_NOTIFICATION_INBOX_ENABLED==="true"/);
  assert.match(inbox, /UNTRUSTED/);
  assert.match(inbox, /MAX_HINTS_PER_ATTEMPT=12/);
  assert.match(route, /recordUntrustedHubtelNotification/);
  assert.doesNotMatch(callback, /collection_enabled|TRADEOS_HUBTEL_POS_ENABLED|paid\b/i);
});

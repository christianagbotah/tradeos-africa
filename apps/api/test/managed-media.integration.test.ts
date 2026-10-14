import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db.js";

process.env.DATABASE_URL ??= "postgresql://tradeos:tradeos@127.0.0.1:5432/tradeos_ci";
const pool = createPool();
const app = buildApp(pool);
const PASSWORD = "StrongPass2026!";
let mediaRoot = "";

beforeAll(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "tradeos-managed-media-"));
  process.env.TRADEOS_MEDIA_ROOT = mediaRoot;
  await app.ready();
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE app_users, businesses, managed_media CASCADE");
  for (const name of await readdir(mediaRoot)) await rm(join(mediaRoot, name), { force: true, recursive: true });
});

afterAll(async () => {
  await app.close();
  await pool.end();
  if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
});

const png = () => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("managed-png")]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("managed-jpeg")]);

describe("managed media HTTP lifecycle", () => {
  it("uploads, serves, replaces and removes the signed-in user's avatar", async () => {
    const owner = await register("avatar-owner@tradeos.test", "avatar-owner-device");
    const first = multipart("avatar.png", "image/png", png());
    const uploaded = await app.inject({ method: "POST", url: "/v1/me/avatar", headers: { ...bearer(owner.accessToken), ...first.headers }, payload: first.body });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const firstMedia = uploaded.json<{ media: { id: string; url: string; mimeType: string; sizeBytes: number } }>().media;
    expect(firstMedia.url).toBe(`/v1/media/${firstMedia.id}`);
    expect(firstMedia.mimeType).toBe("image/png");

    const me = await app.inject({ method: "GET", url: "/v1/me", headers: bearer(owner.accessToken) });
    expect(me.json<{ user: { avatarUrl: string | null } }>().user.avatarUrl).toBe(firstMedia.url);

    const publicRead = await app.inject({ method: "GET", url: firstMedia.url });
    expect(publicRead.statusCode).toBe(200);
    expect(publicRead.headers["content-type"]).toContain("image/png");
    expect(publicRead.headers["x-content-type-options"]).toBe("nosniff");
    expect(publicRead.headers["cache-control"]).toContain("immutable");
    expect(publicRead.rawPayload).toEqual(png());

    const second = multipart("avatar.jpg", "image/jpeg", jpeg());
    const replaced = await app.inject({ method: "POST", url: "/v1/me/avatar", headers: { ...bearer(owner.accessToken), ...second.headers }, payload: second.body });
    expect(replaced.statusCode, replaced.body).toBe(201);
    const secondMedia = replaced.json<{ media: { id: string; url: string } }>().media;
    expect(secondMedia.id).not.toBe(firstMedia.id);

    const firstRetired = await pool.query<{ retired_at: Date | null }>("SELECT retired_at FROM managed_media WHERE id=$1", [firstMedia.id]);
    expect(firstRetired.rows[0]?.retired_at).toBeInstanceOf(Date);
    expect((await app.inject({ method: "GET", url: firstMedia.url })).statusCode).toBe(404);

    const removed = await app.inject({ method: "DELETE", url: "/v1/me/avatar", headers: bearer(owner.accessToken) });
    expect(removed.statusCode).toBe(204);
    const afterRemove = await app.inject({ method: "GET", url: "/v1/me", headers: bearer(owner.accessToken) });
    expect(afterRemove.json<{ user: { avatarUrl: string | null } }>().user.avatarUrl).toBeNull();
    expect((await app.inject({ method: "GET", url: secondMedia.url })).statusCode).toBe(404);
  });

  it("lets the business OWNER manage its logo and denies an outsider before storing bytes", async () => {
    const owner = await register("logo-owner@tradeos.test", "logo-owner-device");
    const business = await onboard(owner.accessToken, "Logo Business");
    const outsider = await register("logo-outsider@tradeos.test", "logo-outsider-device");
    const file = multipart("logo.png", "image/png", png());

    const denied = await app.inject({ method: "POST", url: `/v1/businesses/${business.businessId}/logo`, headers: { ...bearer(outsider.accessToken), ...file.headers }, payload: file.body });
    expect(denied.statusCode).toBe(403);
    expect(await readdir(mediaRoot)).toHaveLength(0);

    const uploaded = await app.inject({ method: "POST", url: `/v1/businesses/${business.businessId}/logo`, headers: { ...bearer(owner.accessToken), ...file.headers }, payload: file.body });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const media = uploaded.json<{ media: { id: string; url: string } }>().media;
    const context = await app.inject({ method: "GET", url: `/v1/businesses/${business.businessId}/context`, headers: bearer(owner.accessToken) });
    expect(context.json<{ business: { logoUrl: string | null } }>().business.logoUrl).toBe(media.url);

    const audit = await pool.query<{ event_type: string; payload: Record<string, unknown> }>("SELECT event_type,payload FROM audit_events WHERE business_id=$1 AND event_type='BUSINESS_LOGO_UPDATED'", [business.businessId]);
    expect(audit.rowCount).toBe(1);
    expect(JSON.stringify(audit.rows[0]?.payload)).not.toContain("storage_name");

    const removed = await app.inject({ method: "DELETE", url: `/v1/businesses/${business.businessId}/logo`, headers: bearer(owner.accessToken) });
    expect(removed.statusCode).toBe(204);
  });

  it("rejects a spoofed upload and never creates media metadata", async () => {
    const owner = await register("spoof-owner@tradeos.test", "spoof-owner-device");
    const spoof = multipart("fake.jpg", "image/jpeg", png());
    const response = await app.inject({ method: "POST", url: "/v1/me/avatar", headers: { ...bearer(owner.accessToken), ...spoof.headers }, payload: spoof.body });
    expect(response.statusCode).toBe(415);
    expect(response.json<{ error: string }>().error).toBe("MEDIA_TYPE_MISMATCH");
    expect((await pool.query("SELECT 1 FROM managed_media")).rowCount).toBe(0);
  });
});

async function register(email: string, deviceKey: string) {
  const response = await app.inject({
    method: "POST", url: "/v1/auth/register",
    payload: { displayName: "Media Owner", email, password: PASSWORD, platform: "WEB", deviceKey, appVersion: "test-media" },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ user: { id: string }; session: { accessToken: string } }>().session;
}

async function onboard(accessToken: string, name: string) {
  const response = await app.inject({
    method: "POST", url: "/v1/onboarding/business", headers: bearer(accessToken),
    payload: { name, businessType: "SERVICES", branchName: "Main", countryCode: "GH", currencyCode: "GHS", timezone: "Africa/Accra" },
  });
  expect(response.statusCode, response.body).toBe(201);
  const body = response.json<{ business: { id: string } }>();
  return { businessId: body.business.id };
}

function bearer(accessToken: string) { return { authorization: `Bearer ${accessToken}` }; }

function multipart(filename: string, mimeType: string, bytes: Buffer) {
  const boundary = `----tradeos-${randomUUID()}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat([head, bytes, tail]) };
}

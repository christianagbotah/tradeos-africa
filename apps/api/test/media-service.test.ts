import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth/security.js";
import type { DatabasePool } from "../src/db.js";
import { replaceAvatar } from "../src/media/media-service.js";

let root = "";
const auth: AuthContext = {
  sessionId: "session-test",
  userId: "00000000-0000-4000-8000-000000000001",
  displayName: "Failure Test",
  email: "failure@test.local",
  phoneE164: null,
  avatarUrl: null,
  platform: "WEB",
  deviceKey: "failure-device",
  appVersion: "test",
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tradeos-media-service-"));
  process.env.TRADEOS_MEDIA_ROOT = root;
});

afterEach(async () => {
  delete process.env.TRADEOS_MEDIA_ROOT;
  if (root) await rm(root, { recursive: true, force: true });
});

describe("managed media transaction compensation", () => {
  it("deletes newly stored avatar bytes when the DB transaction fails", async () => {
    const client = {
      query: async (sql: string) => {
        if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
        if (sql.includes("SELECT storage_name")) return { rows: [], rowCount: 0 };
        if (sql.includes("INSERT INTO managed_media")) throw new Error("simulated DB failure");
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client } as unknown as DatabasePool;
    const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("rollback")]);

    await expect(replaceAvatar(pool, auth, { bytes: png, declaredMime: "image/png" }))
      .rejects.toThrow("simulated DB failure");
    expect(await readdir(root)).toEqual([]);
  });
});

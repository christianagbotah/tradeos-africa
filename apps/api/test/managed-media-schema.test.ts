import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../../../packages/db/migrations/0019_managed_media.sql", import.meta.url);

describe("managed media schema", () => {
  it("stores only managed metadata with constrained purpose, MIME and ownership", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain("CREATE TABLE managed_media");
    expect(sql).toContain("'AVATAR'");
    expect(sql).toContain("'BUSINESS_LOGO'");
    expect(sql).toContain("'image/jpeg'");
    expect(sql).toContain("'image/png'");
    expect(sql).toContain("'image/webp'");
    expect(sql).toContain("storage_name text NOT NULL UNIQUE");
    expect(sql).toContain("size_bytes bigint NOT NULL");
    expect(sql).toContain("retired_at timestamptz");
    expect(sql).toContain("CREATE UNIQUE INDEX uq_managed_media_owner_active");
    expect(sql).toContain("CREATE UNIQUE INDEX uq_managed_media_business_active");
    expect(sql).not.toMatch(/original_(?:name|filename)|client_(?:name|path)/i);
  });
});

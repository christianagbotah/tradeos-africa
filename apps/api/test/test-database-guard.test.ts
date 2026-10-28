import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertSafeTestDatabaseUrl } from "./test-database-guard.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.resolve(here, "../vitest.config.ts");

describe("destructive API test database guard", () => {
  it("accepts dedicated CI, test, and QA databases", () => {
    for (const database of ["tradeos_ci", "tradeos_test", "tradeos_qa", "feature-test-db"]) {
      expect(() => assertSafeTestDatabaseUrl(`postgresql://user:pass@127.0.0.1:5432/${database}`)).not.toThrow();
    }
  });

  it("refuses staging, production, and generic database names", () => {
    for (const database of ["tradeos_staging", "tradeos_prod", "tradeos", "customer_live"]) {
      expect(() => assertSafeTestDatabaseUrl(`postgresql://user:pass@127.0.0.1:5432/${database}`)).toThrow(/refusing destructive api tests/i);
    }
  });

  it("is installed as a Vitest setup file so direct vitest runs are guarded", () => {
    const source = fs.readFileSync(configPath, "utf8");
    expect(source).toContain('setupFiles: ["./test/test-database-guard-setup.ts"]');
  });
});

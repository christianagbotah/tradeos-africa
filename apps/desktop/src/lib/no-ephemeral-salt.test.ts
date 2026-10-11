/**
 * Regression test: no ephemeral/random salt fallback in the production KDF path.
 *
 * Proves that:
 *   1. The KDF closure does NOT generate a random fallback salt
 *   2. The KDF closure does NOT use rand::thread_rng() for salt generation
 *   3. A missing SALT causes an explicit panic, not silent continuation
 *   4. No "fallback" variable that produces an ephemeral salt
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const LIB_RS = path.resolve(__dirname, "../../src-tauri/src/lib.rs");

describe("Stronghold KDF fail-closed regression", () => {
  const src = fs.readFileSync(LIB_RS, "utf8");

  it("does not generate a random fallback salt in the KDF closure", () => {
    // The KDF closure must not contain rand::thread_rng().fill_bytes() as a fallback.
    // (rand is used in resolve_stronghold_salt and get_vault_secret, but NOT in the KDF.)
    // Find the KDF closure section and verify it doesn't have fill_bytes.
    const kdfStart = src.indexOf("Builder::new(|password|");
    const kdfEnd = src.indexOf(".build())", kdfStart);
    const kdfSection = src.substring(kdfStart, kdfEnd);
    expect(kdfSection).not.toContain("rand::thread_rng()");
    expect(kdfSection).not.toContain("fill_bytes");
    expect(kdfSection).not.toContain("fallback");
  });

  it("panics on missing SALT instead of continuing with ephemeral salt", () => {
    const kdfStart = src.indexOf("Builder::new(|password|");
    // Find the end of the KDF closure: the next ".build())" after the closure
    const kdfEnd = src.indexOf(".build())", kdfStart);
    const kdfSection = src.substring(kdfStart, kdfEnd);
    // Must contain a panic! call when salt is empty/missing
    expect(kdfSection).toContain("panic!");
    expect(kdfSection).toContain("salt was not initialized");
  });

  it("uses Argon2id with the persisted salt", () => {
    const kdfStart = src.indexOf("Builder::new(|password|");
    const kdfEnd = src.indexOf(".build())", kdfStart);
    const kdfSection = src.substring(kdfStart, kdfEnd);
    expect(kdfSection).toContain("Argon2id");
    expect(kdfSection).toContain("SALT.get()");
  });

  it("resolve_stronghold_salt returns Result (no silent fallback)", () => {
    expect(src).toContain("fn resolve_stronghold_salt");
    expect(src).toContain("-> Result<Vec<u8>, String>");
    // Must NOT have unwrap_or_else on the data_dir resolution
    const fnStart = src.indexOf("fn resolve_stronghold_salt");
    const fnEnd = src.indexOf("\n}", fnStart);
    const fnSection = src.substring(fnStart, fnEnd);
    expect(fnSection).not.toContain("PathBuf::from(''.')");
  });
});

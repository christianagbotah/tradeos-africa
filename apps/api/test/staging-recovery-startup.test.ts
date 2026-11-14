import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const startScript = fileURLToPath(new URL("../../../bin/start-api.sh", import.meta.url));
let dir: string;
let bin: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "tradeos-recovery-startup-"));
  bin = join(dir, "bin");
  mkdirSync(bin);
  const fakeNode = join(bin, "node");
  writeFileSync(fakeNode, [
    "#!/bin/sh",
    "printf '%s\\n' \"$TRADEOS_PASSWORD_RESET_FROM\"",
    "printf '%s\\n' \"$TRADEOS_PASSWORD_RESET_PUBLIC_ORIGIN\"",
    "printf '%s\\n' \"$TRADEOS_ADMIN_RESET_PUBLIC_ORIGIN\"",
    "",
  ].join("\n"));
  chmodSync(fakeNode, 0o755);
});
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

function runLauncher(file: string): string[] {
  const result = spawnSync("/bin/bash", [startScript], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      PATH: bin + ":" + (process.env.PATH ?? "/usr/bin:/bin"),
      TRADEOS_ENV_FILE: file,
    },
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim().split("\n");
}

describe("TradeOS staging password-reset mail launcher", () => {
  it("uses canonical fixed staging sender and public HTTPS domains when env file omits them", () => {
    const config = join(dir, "minimal.env");
    writeFileSync(config, "HOST=127.0.0.1\n");
    expect(runLauncher(config)).toEqual([
      "mail@lightworldtech.com",
      "https://tradeosafrica.lightworldtech.com",
      "https://tradeosadmin.lightworldtech.com",
    ]);
  });

  it("respects the VPS external environment file rather than overwriting configured email domains", () => {
    const config = join(dir, "overridden.env");
    writeFileSync(config, [
      "TRADEOS_PASSWORD_RESET_FROM=support@another.example",
      "TRADEOS_PASSWORD_RESET_PUBLIC_ORIGIN=https://staging.example.org",
      "TRADEOS_ADMIN_RESET_PUBLIC_ORIGIN=https://admins.example.org",
      "",
    ].join("\n"));
    expect(runLauncher(config)).toEqual([
      "support@another.example",
      "https://staging.example.org",
      "https://admins.example.org",
    ]);
  });
});

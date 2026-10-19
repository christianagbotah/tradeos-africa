import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const guardPath = resolve(ROOT, "app/components/workspace/deployment-update-guard.tsx");
const layoutPath = resolve(ROOT, "app/(workspace)/layout.tsx");
const versionRoutePath = resolve(ROOT, "app/client-build/route.ts");

function readIfPresent(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

describe("deployment update guard", () => {
  it("mounts a deployment update guard across authenticated workspace routes", () => {
    const layout = readFileSync(layoutPath, "utf8");
    expect(existsSync(guardPath)).toBe(true);
    expect(layout).toContain("DeploymentUpdateGuard");
    expect(layout).toContain("<DeploymentUpdateGuard");
  });

  it("serves the active Next build id with no-store caching in production", () => {
    const route = readIfPresent(versionRoutePath);
    expect(existsSync(versionRoutePath)).toBe(true);
    expect(route).toContain(".next");
    expect(route).toContain("BUILD_ID");
    expect(route).toContain("Cache-Control");
    expect(route).toContain("no-store");
    expect(route).toContain('process.env.NODE_ENV !== "production"');
    expect(route).toContain('buildId: "development"');
  });

  it("tracks a per-tab baseline and detects a newer deployment", () => {
    const guard = readIfPresent(guardPath);
    expect(existsSync(guardPath)).toBe(true);
    expect(guard).toContain("sessionStorage");
    expect(guard).toContain("/client-build");
    expect(guard).toContain('cache: "no-store"');
    expect(guard).toContain("visibilitychange");
    expect(guard).toContain("setInterval");
    expect(guard).toContain("window.location.reload()");
    expect(guard).toContain("TradeOS update available");
  });
});

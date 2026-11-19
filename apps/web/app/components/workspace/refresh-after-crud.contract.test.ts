import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const provider = source("./workspace-provider.tsx");
const settings = source("../settings/settings-workspace.tsx");
const api = source("../../../../api/src/businesses.ts");
const dialog = source("../ui/action-feedback.tsx");
const css = source("../../ui-primitives.css");

describe("CRUD refresh and modal backdrop regression", () => {
  it("never reports a refreshed branch when the server reload failed", () => {
    expect(provider).toContain('cache: "no-store"');
    expect(provider).toContain("throw error;");
    expect(provider).toContain("contextRequestSeq.current");
    expect(provider).toContain("requestId !== contextRequestSeq.current");
    expect(api).toContain('"Cache-Control", "private, no-store, max-age=0"');
    expect(settings).toContain('await onRefresh();');
    expect(settings).toContain('applyConfirmedBranch(session.businessId, result.branch);');
    expect(settings).toContain('applyConfirmedBusiness(result.business);');
    expect(settings).toContain('"The server did not return the updated branch."');
  });
  it("renders an accessible foreground dialog over a genuine dim backdrop", () => {
    expect(dialog).toContain('className="tos-action-feedback__backdrop"');
    expect(dialog).toContain('role="dialog" aria-modal="true"');
    expect(dialog).toContain('event.key === "Escape"');
    expect(dialog).toContain('event.key === "Tab"');
    expect(dialog).toContain('document.body.style.overflow = "hidden"');
    expect(css).toContain('.tos-action-feedback__backdrop {');
    expect(css).toContain('background: rgba(9, 20, 38, 0.58);');
    expect(css).toContain('backdrop-filter: blur(3px);');
  });
});

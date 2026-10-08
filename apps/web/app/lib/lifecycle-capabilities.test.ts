import { describe, expect, it } from "vitest";

async function loadCapabilities() {
  const modulePath = "./lifecycle-capabilities";
  try {
    return await import(/* @vite-ignore */ modulePath);
  } catch {
    return null;
  }
}

describe("catalog lifecycle capabilities", () => {
  it("gives OWNER and ADMIN the full catalog lifecycle", async () => {
    const module = await loadCapabilities();
    expect(module?.catalogCapabilities).toBeTypeOf("function");
    if (!module?.catalogCapabilities) return;

    for (const role of ["OWNER", "ADMIN"]) {
      expect(module.catalogCapabilities(role)).toEqual({
        canRead: true,
        canCreate: true,
        canEdit: true,
        canArchive: true,
        canReactivate: true,
        canDeleteUnused: true,
      });
    }
  });

  it("lets INVENTORY manage catalog records without permanent delete", async () => {
    const module = await loadCapabilities();
    expect(module?.catalogCapabilities).toBeTypeOf("function");
    if (!module?.catalogCapabilities) return;

    expect(module.catalogCapabilities("INVENTORY")).toEqual({
      canRead: true,
      canCreate: true,
      canEdit: true,
      canArchive: true,
      canReactivate: true,
      canDeleteUnused: false,
    });
  });

  it("keeps VIEWER read-only and fails unknown roles closed", async () => {
    const module = await loadCapabilities();
    expect(module?.catalogCapabilities).toBeTypeOf("function");
    if (!module?.catalogCapabilities) return;

    expect(module.catalogCapabilities("VIEWER")).toEqual({
      canRead: true,
      canCreate: false,
      canEdit: false,
      canArchive: false,
      canReactivate: false,
      canDeleteUnused: false,
    });
    expect(module.catalogCapabilities("UNKNOWN_ROLE")).toEqual({
      canRead: false,
      canCreate: false,
      canEdit: false,
      canArchive: false,
      canReactivate: false,
      canDeleteUnused: false,
    });
  });
});

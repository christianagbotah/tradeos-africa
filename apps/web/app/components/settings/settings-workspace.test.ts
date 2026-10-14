import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canCreateBusiness,
  canManageBusinessSettings,
  normalizeSettingsSection,
  SETTINGS_SECTIONS,
} from "./settings-workspace";

const workspaceSource = readFileSync(new URL("./settings-workspace.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../workspace/app-shell.tsx", import.meta.url), "utf8");
const navSource = readFileSync(new URL("../workspace/workspace-navigation.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../../(workspace)/settings/page.tsx", import.meta.url), "utf8");
const shellCssSource = readFileSync(new URL("../../workspace-shell.css", import.meta.url), "utf8");
const visualQaSource = readFileSync(new URL("../../../../../.github/workflows/visual-qa.yml", import.meta.url), "utf8");
const businessSectionSource = workspaceSource.slice(workspaceSource.indexOf("function BusinessSection"), workspaceSource.indexOf("function BranchesSection"));
const branchesSectionSource = workspaceSource.slice(workspaceSource.indexOf("function BranchesSection"), workspaceSource.indexOf("function TeamSection"));
const imagePickerSource = readFileSync(new URL("./image-picker.tsx", import.meta.url), "utf8");
const businessFieldsSource = readFileSync(new URL("./business-fields.tsx", import.meta.url), "utf8");
const teamAccessSource = readFileSync(new URL("./team-access.tsx", import.meta.url), "utf8");
const staffEditorSource = readFileSync(new URL("./staff-editor.tsx", import.meta.url), "utf8");

describe("settings navigation model", () => {
  it("provides all account/business control-center sections", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
      "profile",
      "security",
      "business",
      "branches",
      "team",
      "devices",
    ]);
    expect(normalizeSettingsSection("security")).toBe("security");
    expect(normalizeSettingsSection("unknown")).toBe("profile");
  });

  it("uses canonical query-string settings links and preserves legacy hash handling", () => {
    expect(shellSource).toContain('/settings?section=profile');
    expect(shellSource).toContain('/settings?section=security');
    expect(shellSource).toContain('/settings?section=business&action=create');
    expect(shellSource).toContain('/settings?section=branches&action=create');
    expect(workspaceSource).toContain("useSearchParams");
    expect(workspaceSource).toContain("URLSearchParams");
    expect(workspaceSource).toContain('addEventListener("hashchange"');
    expect(workspaceSource).toContain("history.replaceState");
  });

  it("keeps Business create/edit mutually exclusive and gives Create the complete profile contract", () => {
    expect(workspaceSource).toContain('type BusinessEditorMode = "view" | "edit" | "create"');
    expect(businessSectionSource).toContain('useState<BusinessEditorMode>("view")');
    expect(businessSectionSource).not.toContain('const [creating, setCreating]');
    expect(workspaceSource).not.toContain('const [editing, setEditing]');
    expect(workspaceSource).toContain('<BusinessFields');
    expect(workspaceSource).toContain('requestedAction === "create"');
    expect(workspaceSource).toContain('setBusinessMode("create")');
    expect(workspaceSource).toContain('interface NewBusinessFormState extends BusinessFormState');
    expect(workspaceSource).toContain('firstBranchName: string');
  });

  it("keeps Branch create/edit mutually exclusive and renders a full-width single-column editor", () => {
    expect(workspaceSource).toContain('type BranchEditorMode = { kind: "view" } | { kind: "create" } | { kind: "edit"; branchId: string }');
    expect(branchesSectionSource).toContain('useState<BranchEditorMode>({ kind: "view" })');
    expect(branchesSectionSource).not.toContain('const [creating, setCreating]');
    expect(branchesSectionSource).not.toContain('const [editingId, setEditingId]');
    expect(branchesSectionSource).toContain('requestedAction === "create"');
    expect(branchesSectionSource).toContain('setBranchMode({ kind: "create" })');
    expect(branchesSectionSource).toContain('tos-settings__branch-card-head');
    expect(branchesSectionSource).toContain('tos-settings__branch-editor-shell');
    expect(branchesSectionSource).toContain('<BranchFields');
    expect(shellCssSource).toContain('.tos-settings__branch-editor-shell');
    expect(shellCssSource).toContain('.tos-settings__grid--single');
  });

  it("uses real avatar and business-logo file pickers instead of URL text fields", () => {
    expect(imagePickerSource).toContain('type="file"');
    expect(imagePickerSource).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(imagePickerSource).toContain("5 * 1024 * 1024");
    expect(imagePickerSource).toContain("Choose photo");
    expect(imagePickerSource).toContain("Replace photo");
    expect(imagePickerSource).toContain("Remove photo");
    expect(imagePickerSource).toContain("Choose logo");
    expect(imagePickerSource).toContain("Replace logo");
    expect(imagePickerSource).toContain("Remove logo");
    expect(workspaceSource).toContain('"/v1/me/avatar"');
    expect(workspaceSource).toContain('/logo`');
    expect(workspaceSource).toContain("newBusinessLogo");
    expect(workspaceSource).toContain("FormData");
    expect(workspaceSource).not.toContain('label="Avatar URL"');
    expect(businessFieldsSource).not.toContain('label="Logo URL"');
  });

  it("renders the managed avatar in the workspace shell with initials as fallback", () => {
    expect(shellSource).toContain("account?.avatarUrl");
    expect(shellSource).toContain('className="tos-topbar__avatar-image"');
    expect(shellSource).toContain('className="tos-account-card__avatar-image"');
  });

  it("implements Team & access with role-aware directory and mutually exclusive editors", () => {
    expect(workspaceSource).toContain("<TeamAccess");
    expect(teamAccessSource).toContain('type TeamEditorMode = { kind: "view" } | { kind: "create" } | { kind: "edit"; staffId: string }');
    expect(teamAccessSource).toContain('useState<TeamEditorMode>({ kind: "view" })');
    expect(teamAccessSource).toContain('canReadTeam');
    expect(teamAccessSource).toContain('canMutateTeam');
    expect(teamAccessSource).toContain('canManageStaffRole');
    expect(teamAccessSource).toContain('role === "MANAGER"');
    expect(teamAccessSource).toContain('/v1/staff?businessId=');
    expect(teamAccessSource).toContain('/invitations`');
    expect(teamAccessSource).toContain('/v1/staff/${encodeURIComponent(member.id)}/${active ? \"reactivate\" : \"suspend\"}');
    expect(teamAccessSource).toContain('\"suspend\"');
    expect(teamAccessSource).toContain('\"reactivate\"');
    expect(staffEditorSource).toContain("StaffEditor");
  });

  it("keeps invitation secrets ephemeral and provides desktop/mobile team layouts", () => {
    expect(teamAccessSource).toContain("oneTimeInvite");
    expect(teamAccessSource).toContain("window.location.origin");
    expect(teamAccessSource).toContain("/invite/team#token=");
    expect(teamAccessSource).toContain("navigator.clipboard.writeText");
    expect(teamAccessSource).not.toMatch(/localStorage|sessionStorage/);
    expect(teamAccessSource).toContain("tos-team__table-wrap");
    expect(teamAccessSource).toContain("tos-team__cards");
    expect(shellCssSource).toContain(".tos-team__table-wrap");
    expect(shellCssSource).toContain(".tos-team__cards");
    expect(shellCssSource).toContain("@media (max-width: 768px)");
  });

  it("renders explicit Team loading, error and empty states without fake forbidden controls", () => {
    expect(teamAccessSource).toContain("Loading team members");
    expect(teamAccessSource).toContain("Team directory could not be loaded");
    expect(teamAccessSource).toContain("No staff members yet");
    expect(teamAccessSource).toContain("You do not have team-directory access");
    expect(teamAccessSource).toContain("Read-only team access");
    expect(teamAccessSource).toContain("Add staff");
    expect(teamAccessSource).toContain("Suspend");
    expect(teamAccessSource).toContain("Reactivate");
  });

  it("renders business summaries as spaced label colon value content", () => {
    expect(workspaceSource).toContain('tos-settings__summary-label');
    expect(workspaceSource).toContain('tos-settings__summary-separator');
    expect(workspaceSource).toContain('tos-settings__summary-value');
    expect(shellCssSource).toContain('.tos-settings__summary-separator');
  });

  it("restricts business and branch management to OWNER and ADMIN", () => {
    expect(canManageBusinessSettings("OWNER")).toBe(true);
    expect(canManageBusinessSettings("ADMIN")).toBe(true);
    for (const role of ["MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER"] as const) {
      expect(canManageBusinessSettings(role)).toBe(false);
    }
  });

  it("allows every authenticated account to create another business", () => {
    for (const role of ["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER"] as const) {
      expect(canCreateBusiness(role)).toBe(true);
    }
    expect(canCreateBusiness(null)).toBe(false);
  });
});

describe("settings production contract", () => {
  it("has a first-class workspace route and nav entry", () => {
    expect(routeSource).toContain("SettingsWorkspace");
    expect(navSource).toContain('segment: "settings"');
    expect(navSource).toContain('label: "Settings"');
  });

  it("connects profile, password, sessions, business and branch lifecycle APIs", () => {
    for (const contract of [
      '"/v1/me"',
      '"/v1/auth/change-password"',
      '"/v1/auth/sessions"',
      '"/v1/auth/sessions/revoke-others"',
      '"/v1/businesses"',
      '/branches',
      '/deactivate',
      '/reactivate',
    ]) {
      expect(workspaceSource).toContain(contract);
    }
  });

  it("renders Profile, Security, Business, Branches, Team and Devices as responsive sections", () => {
    for (const label of ["My Profile", "Security", "Business", "Branches", "Team & access", "Devices & sessions"]) {
      expect(workspaceSource).toContain(label);
    }
    expect(workspaceSource).toContain("tos-settings");
    expect(workspaceSource).toContain("tos-settings__nav");
    expect(workspaceSource).toContain("tos-settings__content");
  });

  it("uses shell account/context menus and never browser alert/prompt/confirm workflows", () => {
    expect(shellSource).toContain("Business & branch switcher");
    expect(shellSource).toContain("Account menu");
    expect(shellSource).toContain("switchBusiness");
    expect(shellSource).toContain("switchBranch");
    const forbidden = /\b(?:alert|prompt|confirm)\s*\(/;
    expect(workspaceSource).not.toMatch(forbidden);
    expect(shellSource).not.toMatch(forbidden);
  });

  it("defines a 390px-safe responsive settings contract", () => {
    expect(shellCssSource).toContain(".tos-settings__layout");
    expect(shellCssSource).toContain(".tos-settings__nav");
    expect(shellCssSource).toContain("@media (max-width: 768px)");
    expect(shellCssSource).toContain("@media (max-width: 420px)");
    expect(shellCssSource).toContain("overflow-x: auto");
    expect(shellCssSource).toContain("min-width: 0");
  });
  it("keeps authenticated Settings in visual QA at mobile, tablet, and desktop widths", () => {
    expect(visualQaSource).toContain('{ path: "/settings", marker: "Settings", name: "settings" }');
    expect(visualQaSource).toContain('settings: [390, 768, 1280]');
  });

});

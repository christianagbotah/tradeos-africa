# TradeOS Registry Drift Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make deployment fail closed when the checked-in process/localhost-health contract differs from the installed VPS registry.

**Architecture:** Add a literal-only contract reader in the shared deployment library and call it before canonical verification/build. Only `PROCESS_NAMES` and `LOCAL_HEALTH_URLS` are compared, and repositories without a matching contract template keep existing behavior.

**Tech Stack:** Bash, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-15-tradeos-registry-drift-hardening.md`

## Global Constraints
- Never source or eval repository-owned contract content.
- Fail before release preparation or process restart on mismatch.
- Preserve behavior for repositories with no matching contract file.

## Review Focus
- Duplicate contract keys must fail closed.
- Missing required keys in an existing contract file must fail closed.
- Shell metacharacters in contract values remain literal data.
- Matching process and health values pass.
- No contract file preserves current behavior.

---

### Task 1: Registry contract preflight

**Files:**
- Modify: `ops/lightworld-vps/lib/common.sh`
- Modify: `ops/lightworld-vps/libexec/lightworld-deploy`
- Test: `test/lightworld-vps-platform.test.mjs`

**Interfaces:**
- Produces: `assert_workspace_registry_contract(workspace, app, environment)` returning success only when the two tracked keys match.

- [ ] Add behavioral tests for matching, mismatched, duplicate, missing-key, literal-metacharacter, and no-contract cases.
- [ ] Run the focused tests and observe RED because the function does not exist.
- [ ] Implement literal-only parsing and the pre-build deploy call.
- [ ] Run focused tests and deployment configuration tests to GREEN.
- [ ] Run Bash syntax and diff checks.
- [ ] Commit the task.

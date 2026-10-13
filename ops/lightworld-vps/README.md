# Lightworld VPS deployment controls

This directory contains the repository copy of the fail-closed deployment controls used by Lightworld GitHub self-hosted runners.

The generic `libexec` commands are installed root-owned under `/usr/local/libexec/lightworld-deploy/` and are **not** directly sudoable by runner users. Repository/environment-specific root-owned shims under `/usr/local/sbin/` are the only privileged commands exposed through narrow sudoers rules.

Production configuration lives under `/etc/lightworld-deploy/apps.d/`. Configuration contains operational metadata only; application secrets and `.env` files remain on the VPS.

The initial rollout is staging-only and manual. Pull-request code must never run on the VPS runner.

## Reusable release modes

The default `SOURCE_MODE=workspace-archive` keeps the original TradeOS contract: the
verified runner checkout supplies only the canonical commit object and the root-owned
deployer materializes it with `git archive`.

Repositories that must remain Git-aware at runtime may opt into
`SOURCE_MODE=canonical-worktree` and set an absolute `SOURCE_REPO`. The deployer owns
that bare source mirror as root, fetches canonical `main` independently, creates the
release as a detached Git worktree, and verifies tracked files still match the
requested SHA after the build. The self-hosted runner checkout is never the source of
release file contents.

Mixed-runtime repositories may set `RUNTIME_FAMILY=adapter` plus an identifier-only
`BUILD_ADAPTER`. Optional `HEALTH_ADAPTER` identifiers extend activation verification.
Adapters are resolved only below `/usr/local/libexec/lightworld-deploy/adapters`, must
be regular executable root-owned files in production, and must not be group/other
writable. Build adapters execute as the configured application user; health adapters
execute from the trusted root-owned control plane.

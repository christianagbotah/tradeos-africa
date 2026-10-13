# Lightworld VPS deployment controls

This directory contains the repository copy of the fail-closed deployment controls used by Lightworld GitHub self-hosted runners.

The generic `libexec` commands are installed root-owned under `/usr/local/libexec/lightworld-deploy/` and are **not** directly sudoable by runner users. Repository/environment-specific root-owned shims under `/usr/local/sbin/` are the only privileged commands exposed through narrow sudoers rules.

Production configuration lives under `/etc/lightworld-deploy/apps.d/`. Configuration contains operational metadata only; application secrets and `.env` files remain on the VPS.

The initial rollout is staging-only and manual. Pull-request code must never run on the VPS runner.

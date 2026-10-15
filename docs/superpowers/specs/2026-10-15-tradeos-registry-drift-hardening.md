# TradeOS Registry Drift Hardening

## Problem
A canonical TradeOS release added `tradeos-staging-admin` and its localhost health endpoint, but the root-owned VPS registry still listed only API and Web. The deployment workflow therefore completed successfully without starting or health-checking System Admin.

## Requirement
When a repository contains `ops/lightworld-vps/apps/<app>.<environment>.conf.example`, deployment must fail before release preparation if the live registry differs from the repository contract for `PROCESS_NAMES` or `LOCAL_HEALTH_URLS`.

Repository contract files are unprivileged Git content and must be parsed as literal data. They must never be sourced, evaluated, or allowed to execute shell syntax. Repositories without a matching contract file retain existing behavior.

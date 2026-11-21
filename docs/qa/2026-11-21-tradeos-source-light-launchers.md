# TradeOS — CI-built source-light runtime launchers (pre-deployment milestone)

## Delivered

The existing exact-main source-light **pilot** now includes `bin/start-api.sh`, `bin/start-web.sh`, `bin/start-system-admin.sh` and `bin/runtime-env.sh`, so a compiled release can run from its own immutable directory without source checkouts, pnpm, `next start`, or another VPS compilation. These file names preserve the existing PM2 `PROCESS_SCRIPTS` contract.

- Each launcher finds the bundle root relative to its own `bin/` directory, requires Node **22**, and loads deployment environment variables from an **external** file named by `TRADEOS_ENV_FILE` (or the release-local `.env.staging` symlink to an external file). No `.env` is copied into the runtime archive. The parser exports literal `KEY=VALUE` data without evaluating its contents as commands and rejects invalid keys/lines. No credentials are logged.
- The API launcher executes `apps/api/dist/server.js` directly, uses `HOST=127.0.0.1` and `PORT=4036` by default, and retains the existing recovery sender, public origin and admin recovery-origin defaults. External values retain precedence.
- The web and admin launchers execute only the two allowed traced Next.js standalone entrypoints (`server.js` or `apps/<app>/server.js`), with default ports **3036** and **3038** respectively. All services refuse non-loopback bindings or invalid ports. `NODE_ENV=production` is enforced. Node version checks prevent running a traced bundle with a divergent major runtime.
- The pilot packager checks and copies these exact launchers; the read-only artifact intake now requires them as executable **regular files**. The separate guarded sandbox unpacker retains the executable bits.
- The GitHub CI smoke test uses these release-local launchers to start all three isolated services against a temporary *empty test environment file* on localhost ports **14036**, **13036** and **13038**. It checks the web/admin/API responses and anonymous financial endpoint 401s. Existing malicious archive unit tests and 13 new no-network launcher contract tests run on GitHub **before dependency installation**.

## Safe local checks

```bash
python3 -m unittest discover -s test -p test_source_light_launchers.py -v
python3 -m unittest discover -s test -p test_ci_artifact_intake.py -v
node --test test/ci-artifact-pilot-contract.test.mjs
```

No live VPS services or data are modified by these tests. The mock Node executable used in the unit tests never starts a listener or accesses the database.

## Cutover remains separately gated

This milestone deliberately leaves artifact manifest `deployable:false` and **does not** change the protected existing staging deployment workflow, the root-owned registry's `RUNTIME_FAMILY=pnpm-node`, or the active symlink. Before any production cutover, a separately authenticated **deployable** manifest and GitHub supply-chain provenance, root-owned promotion/extraction adapter, external environment link, migrations/ledger compatibility, payment/refund reconciliation, rollback and live PM2 restart/health acceptance remain mandatory. At shared-host capacity >=90%, full VPS builds remain on HOLD. Archive-only actions must honor the artifact preflight.

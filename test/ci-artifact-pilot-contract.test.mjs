import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(name)=>readFileSync(path.join(root,name),'utf8');

test('Next standalone output is restricted to GitHub artifact mode',()=>{
  for(const file of ['apps/web/next.config.ts','apps/system-admin/next.config.ts']){
    const config=read(file);
    assert.match(config,/process\.env\.TRADEOS_CI_ARTIFACT === "1"/);
    assert.match(config,/output: "standalone"/);
    assert.match(config,/outputFileTracingRoot:/);
    assert.match(config,/\.\.\.\(artifactPilot \?/);
  }
});

test('artifact pilot stays GitHub-only and cannot replace protected deploy',()=>{
  const workflow=read('.github/workflows/runtime-artifact-pilot.yml');
  const current=read('.github/workflows/deploy-staging.yml');
  assert.match(workflow,/runs-on: ubuntu-22\.04/);
  assert.match(workflow,/pnpm install --frozen-lockfile/);
  assert.match(workflow,/create-ci-artifact-pilot\.sh/);
  assert.match(workflow,/sha256sum --check/);
  assert.match(workflow,/retention-days: 3/);
  assert.doesNotMatch(workflow,/self-hosted|sudo\s|lightworld-deploy-tradeos-staging|curl.+lightworldtech\.com/);
  assert.match(current,/lightworld-vps-capacity-check build/);
  assert.ok(current.indexOf('lightworld-vps-capacity-check build') <
    current.indexOf('lightworld-deploy-tradeos-staging'),
    'legacy VPS build must be gated before any dependency installation');
  assert.match(current,/lightworld-deploy-tradeos-staging/);
  assert.match(current,/if: github\.ref == 'refs\/heads\/main'/);
});

test('release packaging forbids secrets, requires matching commit and marks pilot non-deployable',()=>{
  const script=read('ops/release/create-ci-artifact-pilot.sh');
  assert.match(script,/CI:-/);
  assert.match(script,/GITHUB_SHA/);
  assert.match(script,/RUNNER_TEMP/);
  assert.match(script,/deployable:false/);
  assert.match(script,/sha256sum --check/);
  assert.match(script,/--prod --legacy/);
  assert.match(script,/ops\/release\/runtime\/bin/);
  assert.match(script,/apps\/api\/dist\/server\.js/);
  assert.match(script,/apps\/api\/src/);
  assert.match(script,/TRADEOS_CI_RUNTIME_ARTIFACT_PILOT/);
  assert.doesNotMatch(script,/\/home\/lightworld\//);
  assert.doesNotMatch(script,/\brm -rf \/home\b/);
});


test('read-only VPS artifact intake is checksum, provenance and capacity guarded',()=>{
  const workflow=read('.github/workflows/runtime-artifact-pilot.yml');
  const inspector=read('ops/release/inspect-ci-artifact-pilot.py');
  const audit=read('ops/release/audit-github-artifact-pilot.sh');
  assert.match(workflow,/test_ci_artifact_intake\.py/);
  assert.match(workflow,/inspect-ci-artifact-pilot\.py/);
  assert.ok(workflow.indexOf('inspect-ci-artifact-pilot.py') < workflow.indexOf('Smoke test archive'));
  assert.match(inspector,/checksumVerified/);
  assert.match(inspector,/manifest\.get\('deployable'\) is not False/);
  assert.match(inspector,/MAX_EXPANDED/);
  assert.match(inspector,/symlink escapes archive root/);
  assert.match(inspector,/hardlink target missing from archive/);
  assert.doesNotMatch(inspector,/extractall\s*\(/);
  assert.match(audit,/\.head_sha == \$sha/);
  assert.match(audit,/\.event == "push" and \.head_branch == "main"/);
  assert.match(audit,/lightworld-vps-capacity-check artifact/);
  assert.match(audit,/gh run download/);
  assert.doesNotMatch(audit,/lightworld-deploy-tradeos-staging|systemctl|pm2|pnpm install|pnpm build|next build/);
  const rehearsal=read('ops/release/rehearse-ci-artifact-pilot.py');
  assert.match(workflow,/rehearse-ci-artifact-pilot\.py/);
  assert.match(workflow,/bash \"\$root\/bin\/start-api\.sh\"/);
  assert.match(workflow,/bash \"\$root\/bin\/start-web\.sh\"/);
  assert.match(workflow,/bash \"\$root\/bin\/start-system-admin\.sh\"/);
  assert.match(workflow,/\$GITHUB_WORKSPACE\/ops\/release\/rehearse-ci-artifact-pilot\.py/);
  assert.doesNotMatch(workflow,/tar -xzf \"\$archive\"/);
  assert.match(audit,/--rehearse/);
  assert.match(rehearsal,/O_NOFOLLOW/);
  assert.match(rehearsal,/inspect_mod\.inspect\(sha, folder\)/);
  assert.match(rehearsal,/verify_archive_structure/);
  assert.match(rehearsal,/productionReleaseTouched/);
  assert.match(rehearsal,/shutil\.rmtree\(destination\)/);
  assert.doesNotMatch(rehearsal,/extractall|subprocess|pnpm build|pm2/);
});


test('source-light launchers are part of the artifact while main remains nondeployable',()=>{
  const script=read('ops/release/create-ci-artifact-pilot.sh');
  const inspector=read('ops/release/inspect-ci-artifact-pilot.py');
  const smoke=read('.github/workflows/runtime-artifact-pilot.yml');
  for(const app of ['api','web','system-admin']){
    const launcher=read(`ops/release/runtime/bin/start-${app}.sh`);
    assert.match(launcher,/source "\$SCRIPT_DIR\/runtime-env\.sh"/);
    assert.match(launcher,/exec "\$TRADEOS_RUNTIME_NODE" "\$entry"/);
    assert.match(launcher,/tradeos_check_loopback_host/);
    assert.match(smoke,new RegExp(`bash "\\$root/bin/start-${app}\\.sh"`));
    assert.match(inspector,new RegExp(`bin/start-${app}\\.sh`));
  }
  const loader=read('ops/release/runtime/bin/runtime-env.sh');
  assert.match(loader,/TRADEOS_ENV_FILE/);
  assert.match(loader,/process\.versions\.node/);
  assert.match(loader,/export NODE_ENV=production/);
  assert.doesNotMatch(loader,/\beval\b|\bsource "\$TRADEOS_RUNTIME_ENV"/);
  assert.match(script,/deployable:false/);
  assert.match(script,/ops\/release\/runtime\/bin/);
  assert.match(smoke,/test_source_light_launchers\.py/);
  assert.doesNotMatch(smoke,/self-hosted|lightworld-deploy-tradeos-staging/);
});


test('main-only cryptographic artifact provenance is required before any VPS rehearsal',()=>{
  const workflow=read('.github/workflows/runtime-artifact-pilot.yml');
  const audit=read('ops/release/audit-github-artifact-pilot.sh');
  const verifier=read('ops/release/verify-attested-artifact-pilot.sh');
  assert.match(workflow,/id-token: write/);
  assert.match(workflow,/attestations: write/);
  assert.match(workflow,/uses: actions\/attest@v4/);
  assert.match(workflow,/if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/subject-path: \$\{\{ runner\.temp \}\}\/tradeos-release-artifact\/tradeos-runtime-pilot-/);
  assert.ok(workflow.indexOf('Smoke test archive after clean extraction') <
    workflow.indexOf('Sign provenance of tested archive'));
  assert.ok(workflow.indexOf('Sign provenance of tested archive') <
    workflow.indexOf('Publish short-lived, non-deployable pilot archive'));
  assert.match(workflow,/test_ci_signed_provenance\.py/);
  assert.match(audit,/verify-attested-artifact-pilot\.sh/);
  assert.ok(audit.indexOf('verify-attested-artifact-pilot.sh') <
    audit.indexOf('inspect-ci-artifact-pilot.py'),
    'verify signed origin before any inspection/extraction');
  assert.match(verifier,/gh attestation verify/);
  assert.match(verifier,/--signer-workflow/);
  assert.match(verifier,/--source-ref 'refs\/heads\/main'/);
  assert.match(verifier,/--source-digest "\$sha"/);
  assert.match(verifier,/--predicate-type 'https:\/\/slsa\.dev\/provenance\/v1'/);
  assert.match(verifier,/type == "array" and length > 0/);
  assert.doesNotMatch(verifier,/pm2|systemctl|next build|pnpm install|tar -x|lightworld-deploy-tradeos-staging/);
  assert.match(read('ops/release/create-ci-artifact-pilot.sh'),/deployable:false/);
});


test('migration prepromotion review reads ledger only and grants no live activation',()=>{
  const audit=read('ops/release/audit-github-artifact-pilot.sh');
  const gate=read('ops/release/check-promotion-migrations.mjs');
  const workflow=read('.github/workflows/runtime-artifact-pilot.yml');
  assert.match(workflow,/node --test test\/read-only-promotion-gate\.test\.mjs/);
  assert.match(audit,/--ledger-readonly/);
  assert.match(audit,/"\$#" -ge 4/);
  assert.match(audit,/EUID != 0/);
  assert.match(audit,/runuser -u lightworld/);
  assert.match(audit,/\/usr\/bin\/env -i PATH=\/usr\/bin:\/bin HOME=\/home\/lightworld/);
  assert.match(audit,/8#\$env_mode & 0077/);
  assert.match(audit,/check-promotion-migrations\.mjs/);
  assert.ok(audit.indexOf('verify-attested-artifact-pilot.sh') <
    audit.indexOf('check-promotion-migrations.mjs'));
  assert.ok(audit.indexOf('rehearse-ci-artifact-pilot.py') <
    audit.indexOf('check-promotion-migrations.mjs'));
  assert.match(gate,/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(gate,/SELECT migration_name, checksum_sha256, state FROM lightworld_schema_migrations/);
  assert.match(gate,/client\.query\('ROLLBACK'\)/);
  assert.match(gate,/authorizedToDeploy: false/);
  assert.match(gate,/manifest\.deployable !== false/);
  assert.doesNotMatch(gate,/applyMigrations|\.query\(['"`]INSERT|\.query\(['"`]UPDATE|\.query\(['"`]DELETE|\.query\(['"`]CREATE/);
});


test('root-owned temp sealing stays nondeployable and follows signed ledger checks',()=>{
  const audit=read('ops/release/audit-github-artifact-pilot.sh');
  const seal=read('ops/release/seal-ci-artifact-candidate.py');
  const workflow=read('.github/workflows/runtime-artifact-pilot.yml');
  assert.match(workflow,/test_ci_candidate_seal\.py/);
  assert.match(audit,/--seal-candidate/);
  assert.match(audit,/"\$#" -eq 5/);
  assert.ok(audit.indexOf('verify-attested-artifact-pilot.sh') <
    audit.indexOf('rehearse-ci-artifact-pilot.py'));
  assert.ok(audit.indexOf('check-promotion-migrations.mjs') <
    audit.indexOf('seal-ci-artifact-candidate.py'));
  assert.match(audit,/PYTHONDONTWRITEBYTECODE=1 python3 -B/);
  assert.match(seal,/get\(\)euid|geteuid/);
  assert.match(seal,/candidateSealed/);
  assert.match(seal,/authorizedToDeploy': False/);
  assert.match(seal,/manifest\.get\('deployable'\) is not False/);
  assert.match(seal,/parent\.parent != Path\('\/tmp'\)/);
  assert.match(seal,/runtimeSha256/);
  assert.doesNotMatch(seal,/pm2|systemctl|subprocess|run_release_migrations|activate_release_target|chown\(/);
});


test('root-installed candidate auditor has its own CI fail-closed contract',()=>{
  const workflow=read('.github/workflows/runtime-artifact-pilot.yml');
  const launcher=read('ops/release/root-candidate-audit-entrypoint.sh');
  const installer=read('ops/release/install-root-candidate-auditor.sh');
  assert.match(workflow,/node --test test\/root-candidate-auditor\.test\.mjs/);
  assert.match(workflow,/test\/root-candidate-auditor\.test\.mjs/);
  assert.match(workflow,/gh api|install-root-candidate-auditor\.sh/);
  assert.match(launcher,/INSTALL_DIR='\/usr\/local\/libexec\/lightworld-deploy\/tradeos-candidate-audit'/);
  assert.match(launcher,/--rehearse --ledger-readonly --seal-candidate/);
  assert.match(launcher,/sha256sum -c --status SHA256SUMS/);
  assert.match(launcher,/flock -n/);
  assert.match(installer,/no overwrite or auto-upgrade allowed/);
  assert.ok(workflow.indexOf('Check exact-main install source identity') < workflow.indexOf('Verify source-only and immutable deployment boundaries'));
  assert.match(installer,/--check/);
  assert.match(installer,/--install/);
  assert.doesNotMatch(launcher,/activate_release_target|restart_configured_processes|run_release_migrations|pm2|systemctl/);
  assert.doesNotMatch(installer,/activate_release_target|restart_configured_processes|run_release_migrations|pm2|systemctl/);
});


test('approved-only root auditor upgrade is protected by CI and never activates the app',()=>{
  const workflow=read('.github/workflows/runtime-artifact-pilot.yml');
  const upgrade=read('ops/release/upgrade-root-candidate-auditor.sh');
  const audit=read('ops/release/audit-github-artifact-pilot.sh');
  assert.match(workflow,/test\/root-candidate-auditor-upgrade\.test\.mjs/);
  assert.match(upgrade,/trap restore_old_auditor EXIT/);
  assert.match(upgrade,/flock -n/);
  assert.match(upgrade,/sha256sum -c --status SHA256SUMS/);
  assert.match(upgrade,/old_auditor_preserved/);
  assert.match(audit,/\/usr\/sbin\/runuser -u lightworld/);
  assert.doesNotMatch(upgrade,/pm2|systemctl|activate_release_target|restart_configured_processes|run_release_migrations|rm -rf/);
});

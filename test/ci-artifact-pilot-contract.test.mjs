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

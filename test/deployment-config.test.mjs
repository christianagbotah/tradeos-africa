import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const ecosystemPath = path.join(repoRoot, 'ecosystem.config.cjs');
const apiScriptPath = path.join(repoRoot, 'bin', 'start-api.sh');
const webScriptPath = path.join(repoRoot, 'bin', 'start-web.sh');
const adminScriptPath = path.join(repoRoot, 'bin', 'start-system-admin.sh');

test('deployment contract defines the three TradeOS PM2 apps with safe ownership', () => {
  assert.equal(fs.existsSync(ecosystemPath), true, 'ecosystem.config.cjs must be tracked at repo root');

  const require = createRequire(import.meta.url);
  const config = require(ecosystemPath);
  assert.ok(Array.isArray(config.apps));
  assert.deepEqual(config.apps.map((app) => app.name), ['tradeos-staging-api', 'tradeos-staging-web', 'tradeos-staging-admin']);

  for (const app of config.apps) {
    assert.equal(app.cwd, repoRoot);
    assert.equal(app.interpreter, '/bin/bash');
    assert.equal(app.uid, 'lightworld');
    assert.equal(app.gid, 'lightworld');
    assert.equal(app.autorestart, true);
  }

  assert.equal(config.apps[0].script, './bin/start-api.sh');
  assert.equal(config.apps[1].script, './bin/start-web.sh');
  assert.equal(config.apps[2].script, './bin/start-system-admin.sh');
});

test('tracked launch scripts resolve the repo root and treat dotenv values as literal data', () => {
  assert.equal(fs.existsSync(apiScriptPath), true, 'bin/start-api.sh must be tracked');
  assert.equal(fs.existsSync(webScriptPath), true, 'bin/start-web.sh must be tracked');
  assert.equal(fs.existsSync(adminScriptPath), true, 'bin/start-system-admin.sh must be tracked');

  const api = fs.readFileSync(apiScriptPath, 'utf8');
  const web = fs.readFileSync(webScriptPath, 'utf8');
  const admin = fs.readFileSync(adminScriptPath, 'utf8');
  const combined = `${api}\n${web}\n${admin}`;

  for (const script of [api, web, admin]) {
    assert.match(script, /^#!\/usr\/bin\/env bash/m);
    assert.match(script, /set -euo pipefail/);
    assert.match(script, /BASH_SOURCE\[0\]/);
    assert.match(script, /\.env\.staging/);
    assert.doesNotMatch(script, /source "\$ENV_FILE"/);
    assert.match(script, /while IFS= read -r line/);
    assert.match(script, /export "\$key=\$value"/);
  }

  assert.match(api, /PORT=.*4036/);
  assert.match(api, /apps\/api\/dist\/server\.js/);
  assert.match(web, /WEB_PORT=.*3036/);
  assert.match(admin, /ADMIN_PORT=.*3038/);
  assert.match(admin, /apps\/system-admin\/node_modules\/next\/dist\/bin\/next.*start/);
  assert.match(web, /apps\/web\/node_modules\/next\/dist\/bin\/next.*start/);
  assert.doesNotMatch(combined, /\/home\/lightworld\/webapps\/tradeos-staging/);
  assert.doesNotMatch(combined, /(DATABASE_URL|JWT_SECRET|PASSWORD)=['\"][^$]/);
});

test('web launcher starts Next from apps/web so the production .next directory resolves correctly', () => {
  const web = fs.readFileSync(webScriptPath, 'utf8');
  assert.match(web, /cd "\$ROOT_DIR\/apps\/web"/);
  assert.doesNotMatch(web, /cd "\$ROOT_DIR"\nexec .*apps\/web\/node_modules\/next\/dist\/bin\/next.*start/);
});

for (const [name, scriptPath] of [
  ['API', apiScriptPath],
  ['web', webScriptPath],
  ['system admin', adminScriptPath],
]) {
  test(`${name} launcher preserves dotenv metacharacters without shell evaluation`, () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tradeos-dotenv-'));
    try {
      const fakeBin = path.join(tempRoot, 'bin');
      const envPath = path.join(tempRoot, '.env.staging');
      const capturePath = path.join(tempRoot, 'capture.txt');
      fs.mkdirSync(fakeBin);
      fs.writeFileSync(
        envPath,
        [
          '# dotenv values are data, not shell source',
          'DATABASE_URL=postgresql://tradeos:p@host/db?sslmode=require&application_name=tradeos',
          'SAFE_LITERAL=$HOME',
          'EQUALS_VALUE=left=middle=right',
          '',
        ].join('\n'),
      );
      const fakeNode = path.join(fakeBin, 'node');
      fs.writeFileSync(
        fakeNode,
        '#!/usr/bin/env bash\nset -euo pipefail\nprintf "%s\\n%s\\n%s\\n" "${DATABASE_URL-}" "${SAFE_LITERAL-}" "${EQUALS_VALUE-}" > "$CAPTURE_FILE"\n',
      );
      fs.chmodSync(fakeNode, 0o755);

      const result = spawnSync('/bin/bash', [scriptPath], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          TRADEOS_ENV_FILE: envPath,
          CAPTURE_FILE: capturePath,
        },
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.deepEqual(fs.readFileSync(capturePath, 'utf8').trimEnd().split('\n'), [
        'postgresql://tradeos:p@host/db?sslmode=require&application_name=tradeos',
        '$HOME',
        'left=middle=right',
      ]);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
}

test('runtime launchers do not depend on Corepack or pnpm bootstrapping', () => {
  const api = fs.readFileSync(apiScriptPath, 'utf8');
  const web = fs.readFileSync(webScriptPath, 'utf8');
  const admin = fs.readFileSync(adminScriptPath, 'utf8');
  assert.doesNotMatch(api, /\bpnpm\b/);
  assert.doesNotMatch(web, /\bpnpm\b/);
  assert.doesNotMatch(admin, /\bpnpm\b/);
  assert.match(api, /node.*apps\/api\/dist\/server\.js/);
  assert.match(web, /node.*apps\/web\/node_modules\/next\/dist\/bin\/next.*start/);
  assert.match(admin, /node.*apps\/system-admin\/node_modules\/next\/dist\/bin\/next.*start/);
});

test('staging deployment keeps manual dispatch and supports an explicit main-branch marker trigger', () => {
  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'deploy-staging.yml');
  const markerPath = path.join(repoRoot, '.github', 'deploy-staging-request');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /workflow_dispatch:/, 'manual staging deployment must remain available');
  assert.match(workflow, /["']push["']:\s*\n\s*branches:\s*\[main\]/, 'marker deployments must be restricted to main');
  assert.match(workflow, /paths:\s*\n\s*- ['"]?\.github\/deploy-staging-request['"]?/, 'push deploys must require the explicit marker file');
  assert.equal(fs.existsSync(markerPath), true, 'the explicit staging deployment marker must be tracked');
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/, 'deployment job must retain the main-branch guard');
});

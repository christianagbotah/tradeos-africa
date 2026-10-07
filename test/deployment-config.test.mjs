import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const ecosystemPath = path.join(repoRoot, 'ecosystem.config.cjs');
const apiScriptPath = path.join(repoRoot, 'bin', 'start-api.sh');
const webScriptPath = path.join(repoRoot, 'bin', 'start-web.sh');

test('deployment contract defines the two TradeOS PM2 apps with safe ownership', () => {
  assert.equal(fs.existsSync(ecosystemPath), true, 'ecosystem.config.cjs must be tracked at repo root');

  const require = createRequire(import.meta.url);
  const config = require(ecosystemPath);
  assert.ok(Array.isArray(config.apps));
  assert.deepEqual(config.apps.map((app) => app.name), ['tradeos-staging-api', 'tradeos-staging-web']);

  for (const app of config.apps) {
    assert.equal(app.cwd, repoRoot);
    assert.equal(app.interpreter, '/bin/bash');
    assert.equal(app.uid, 'lightworld');
    assert.equal(app.gid, 'lightworld');
    assert.equal(app.autorestart, true);
  }

  assert.equal(config.apps[0].script, './bin/start-api.sh');
  assert.equal(config.apps[1].script, './bin/start-web.sh');
});

test('tracked launch scripts resolve the repo root and keep staging secrets external', () => {
  assert.equal(fs.existsSync(apiScriptPath), true, 'bin/start-api.sh must be tracked');
  assert.equal(fs.existsSync(webScriptPath), true, 'bin/start-web.sh must be tracked');

  const api = fs.readFileSync(apiScriptPath, 'utf8');
  const web = fs.readFileSync(webScriptPath, 'utf8');
  const combined = `${api}\n${web}`;

  for (const script of [api, web]) {
    assert.match(script, /^#!\/usr\/bin\/env bash/m);
    assert.match(script, /set -euo pipefail/);
    assert.match(script, /BASH_SOURCE\[0\]/);
    assert.match(script, /\.env\.staging/);
    assert.match(script, /source "\$ENV_FILE"/);
  }

  assert.match(api, /PORT=.*4036/);
  assert.match(api, /@tradeos\/api start/);
  assert.match(web, /WEB_PORT=.*3036/);
  assert.match(web, /@tradeos\/web exec next start/);
  assert.doesNotMatch(combined, /\/home\/lightworld\/webapps\/tradeos-staging/);
  assert.doesNotMatch(combined, /(DATABASE_URL|JWT_SECRET|PASSWORD)=['\"][^$]/);
});

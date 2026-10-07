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

test('tracked launch scripts resolve the repo root and treat dotenv values as literal data', () => {
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
    assert.doesNotMatch(script, /source "\$ENV_FILE"/);
    assert.match(script, /while IFS= read -r line/);
    assert.match(script, /export "\$key=\$value"/);
  }

  assert.match(api, /PORT=.*4036/);
  assert.match(api, /@tradeos\/api start/);
  assert.match(web, /WEB_PORT=.*3036/);
  assert.match(web, /@tradeos\/web exec next start/);
  assert.doesNotMatch(combined, /\/home\/lightworld\/webapps\/tradeos-staging/);
  assert.doesNotMatch(combined, /(DATABASE_URL|JWT_SECRET|PASSWORD)=['\"][^$]/);
});

for (const [name, scriptPath] of [
  ['API', apiScriptPath],
  ['web', webScriptPath],
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
      const fakePnpm = path.join(fakeBin, 'pnpm');
      fs.writeFileSync(
        fakePnpm,
        '#!/usr/bin/env bash\nset -euo pipefail\nprintf "%s\\n%s\\n%s\\n" "${DATABASE_URL-}" "${SAFE_LITERAL-}" "${EQUALS_VALUE-}" > "$CAPTURE_FILE"\n',
      );
      fs.chmodSync(fakePnpm, 0o755);

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

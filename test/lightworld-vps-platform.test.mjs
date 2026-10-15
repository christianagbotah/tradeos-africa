import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const opsRoot = path.join(repoRoot, 'ops', 'lightworld-vps');
const commonPath = path.join(opsRoot, 'lib', 'common.sh');
const deployPath = path.join(opsRoot, 'libexec', 'lightworld-deploy');
const statusPath = path.join(opsRoot, 'libexec', 'lightworld-status');
const rollbackPath = path.join(opsRoot, 'libexec', 'lightworld-rollback');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
    env: { ...process.env, ...(options.env ?? {}) },
  });
}

function git(cwd, ...args) {
  const result = run('git', args, { cwd });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function writeRegistry(fixture, overrides = {}) {
  const values = {
    GITHUB_REPO: 'acme/demo',
    CANONICAL_MAIN_URL: fixture.bare,
    MAIN_VERIFY_MODE: 'public-ls-remote',
    APP_USER: os.userInfo().username,
    RUNNER_USER: os.userInfo().username,
    RELEASE_ROOT: fixture.releases,
    CURRENT_LINK: fixture.currentLink,
    ENV_FILE: fixture.envFile,
    PROCESS_MANAGER: 'test',
    PROCESS_NAMES: 'demo-api demo-web',
    LOCAL_HEALTH_URLS: 'test://local',
    PUBLIC_HEALTH_URLS: 'test://public',
    RUNTIME_FAMILY: 'test',
    MIGRATION_MODE: 'manual',
    SOURCE_MODE: 'workspace-archive',
    ...overrides,
  };
  const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  fs.writeFileSync(
    path.join(fixture.registry, 'demo.staging.conf'),
    `${Object.entries(values).map(([key, value]) => `${key}=${quote(value)}`).join('\n')}\n`,
    { mode: 0o600 },
  );
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lightworld-vps-'));
  const workspace = path.join(root, 'workspace');
  const bare = path.join(root, 'canonical.git');
  const registry = path.join(root, 'registry');
  const releases = path.join(root, 'releases');
  const currentLink = path.join(root, 'current');
  const envFile = path.join(root, 'server.env');
  const marker = path.join(root, 'action.marker');
  const restartLog = path.join(root, 'restart.log');
  const lockRoot = path.join(root, 'locks');
  const sourceRepo = path.join(root, 'source.git');
  const adapterRoot = path.join(root, 'adapters');
  fs.mkdirSync(workspace);
  fs.mkdirSync(registry);
  fs.mkdirSync(releases);
  fs.mkdirSync(lockRoot);
  fs.mkdirSync(adapterRoot);
  fs.writeFileSync(envFile, 'SUPER_SECRET=do-not-print\n', { mode: 0o600 });
  git(workspace, 'init', '-b', 'main');
  git(workspace, 'config', 'user.email', 'ops-test@example.invalid');
  git(workspace, 'config', 'user.name', 'Ops Test');
  fs.writeFileSync(path.join(workspace, 'README.md'), 'fixture\n');
  git(workspace, 'add', 'README.md');
  git(workspace, 'commit', '-m', 'fixture');
  const firstSha = git(workspace, 'rev-parse', 'HEAD');
  git(root, 'init', '--bare', bare);
  git(workspace, 'remote', 'add', 'origin', 'https://github.com/acme/demo.git');
  git(workspace, 'remote', 'add', 'canonical', bare);
  git(workspace, 'push', 'canonical', 'HEAD:refs/heads/main');

  const fixture = { root, workspace, bare, registry, releases, currentLink, envFile, marker, restartLog, lockRoot, sourceRepo, adapterRoot, firstSha };
  writeRegistry(fixture);
  fixture.env = {
    LIGHTWORLD_TEST_MODE: '1',
    LIGHTWORLD_REGISTRY_ROOT: registry,
    LIGHTWORLD_TEST_ACTION_MARKER: marker,
    LIGHTWORLD_TEST_RESTART_LOG: restartLog,
    LIGHTWORLD_LOCK_ROOT: lockRoot,
    LIGHTWORLD_ADAPTER_ROOT: adapterRoot,
  };
  return fixture;
}

function cleanup(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

function commitNext(fixture, message = 'next') {
  fs.appendFileSync(path.join(fixture.workspace, 'README.md'), `${message}\n`);
  git(fixture.workspace, 'add', 'README.md');
  git(fixture.workspace, 'commit', '-m', message);
  return git(fixture.workspace, 'rev-parse', 'HEAD');
}

function pushCanonical(fixture) {
  git(fixture.workspace, 'push', '--force', 'canonical', 'HEAD:refs/heads/main');
}

function deploy(fixture, sha, env = {}) {
  return run(deployPath, ['demo', 'staging', sha, fixture.workspace], {
    env: { ...fixture.env, ...env },
  });
}

function writeWorkspaceContract(fixture, content) {
  const dir = path.join(fixture.workspace, 'ops', 'lightworld-vps', 'apps');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'demo.staging.conf.example'), content);
}

function checkWorkspaceContract(fixture, processNames, localHealthUrls) {
  return run('bash', ['-c', [
    'source "$1"',
    'PROCESS_NAMES="$2"',
    'LOCAL_HEALTH_URLS="$3"',
    'assert_workspace_registry_contract "$4" demo staging',
  ].join('; '), 'bash', commonPath, processNames, localHealthUrls, fixture.workspace]);
}

test('workspace registry contract accepts matching process and local-health values', () => {
  const fixture = makeFixture();
  try {
    writeWorkspaceContract(fixture, [
      "PROCESS_NAMES='demo-api demo-web demo-admin'",
      "LOCAL_HEALTH_URLS='test://api test://web test://admin'",
      '',
    ].join('\n'));
    const result = checkWorkspaceContract(fixture, 'demo-api demo-web demo-admin', 'test://api test://web test://admin');
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { cleanup(fixture); }
});

test('workspace registry contract rejects process or local-health drift', () => {
  const fixture = makeFixture();
  try {
    writeWorkspaceContract(fixture, [
      "PROCESS_NAMES='demo-api demo-web demo-admin'",
      "LOCAL_HEALTH_URLS='test://api test://web test://admin'",
      '',
    ].join('\n'));
    for (const [processNames, urls, key] of [
      ['demo-api demo-web', 'test://api test://web test://admin', 'PROCESS_NAMES'],
      ['demo-api demo-web demo-admin', 'test://api test://web', 'LOCAL_HEALTH_URLS'],
    ]) {
      const result = checkWorkspaceContract(fixture, processNames, urls);
      assert.notEqual(result.status, 0);
      assert.match(`${result.stderr}\n${result.stdout}`, new RegExp(key));
    }
  } finally { cleanup(fixture); }
});

test('workspace registry contract fails closed on duplicate or missing required keys', () => {
  const fixture = makeFixture();
  try {
    for (const content of [
      "PROCESS_NAMES='one'\nPROCESS_NAMES='two'\nLOCAL_HEALTH_URLS='test://local'\n",
      "PROCESS_NAMES='one'\n",
    ]) {
      writeWorkspaceContract(fixture, content);
      const result = checkWorkspaceContract(fixture, 'one', 'test://local');
      assert.notEqual(result.status, 0);
      assert.match(`${result.stderr}\n${result.stdout}`, /contract|PROCESS_NAMES|LOCAL_HEALTH_URLS/i);
    }
  } finally { cleanup(fixture); }
});

test('workspace registry contract treats metacharacters as literal data and never executes them', () => {
  const fixture = makeFixture();
  try {
    const marker = path.join(fixture.root, 'must-not-exist');
    const processNames = `demo-api $HOME ; $(touch ${marker})`;
    writeWorkspaceContract(fixture, [
      `PROCESS_NAMES='${processNames}'`,
      "LOCAL_HEALTH_URLS='test://local?x=$HOME&y=1;echo-nope'",
      '',
    ].join('\n'));
    const result = checkWorkspaceContract(fixture, processNames, 'test://local?x=$HOME&y=1;echo-nope');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(marker), false);
  } finally { cleanup(fixture); }
});

test('workspace registry contract preserves existing behavior when no contract file is tracked', () => {
  const fixture = makeFixture();
  try {
    const result = checkWorkspaceContract(fixture, 'demo-api demo-web', 'test://local');
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally { cleanup(fixture); }
});

test('PM2 reconciliation recreates opted-in processes from the stable current link', () => {
  const fixture = makeFixture();
  try {
    const fakeBin = path.join(fixture.root, 'fake-bin');
    const pm2Log = path.join(fixture.root, 'pm2.log');
    fs.mkdirSync(fakeBin);
    fs.mkdirSync(fixture.currentLink, { recursive: true });
    for (const script of ['bin/start-api.sh', 'bin/start-web.sh']) {
      const target = path.join(fixture.currentLink, script);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, '#!/usr/bin/env bash\n', { mode: 0o755 });
    }
    const fakePm2 = path.join(fakeBin, 'pm2');
    fs.writeFileSync(fakePm2, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> ${JSON.stringify(pm2Log)}
if [[ "\${1-}" == pid ]]; then printf '4321\\n'; fi
`, { mode: 0o755 });

    const result = run('bash', ['-c', [
      'source "$1"',
      'APP_USER="$(id -un)"',
      'CURRENT_LINK="$2"',
      'PROCESS_MANAGER=pm2',
      "PROCESS_NAMES='demo-api demo-web'",
      "PROCESS_SCRIPTS='bin/start-api.sh bin/start-web.sh'",
      "PROCESS_MAX_MEMORY='450M 500M'",
      "PROCESS_INTERPRETER='/bin/bash'",
      "PROCESS_RESTART_DELAY='2000'",
      'restart_configured_processes',
    ].join('; '), 'bash', commonPath, fixture.currentLink], {
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const log = fs.readFileSync(pm2Log, 'utf8');
    assert.match(log, /pid demo-api/);
    assert.match(log, /delete demo-api/);
    assert.match(log, new RegExp(`start ${fixture.currentLink.replaceAll('/', '\\/')}\/bin\/start-api\\.sh --name demo-api`));
    assert.match(log, new RegExp(`--cwd ${fixture.currentLink.replaceAll('/', '\\/')}`));
    assert.match(log, /--interpreter \/bin\/bash/);
    assert.match(log, /--max-memory-restart 450M/);
    assert.match(log, /--restart-delay 2000/);
    assert.match(log, /pid demo-web/);
    assert.match(log, /delete demo-web/);
    assert.match(log, /--max-memory-restart 500M/);
    assert.match(log, /^save$/m);
  } finally { cleanup(fixture); }
});

test('PM2 reconciliation contract rejects misaligned process metadata before touching PM2', () => {
  const fixture = makeFixture();
  try {
    const fakeBin = path.join(fixture.root, 'fake-bin');
    const pm2Log = path.join(fixture.root, 'pm2.log');
    fs.mkdirSync(fakeBin);
    const fakePm2 = path.join(fakeBin, 'pm2');
    fs.writeFileSync(fakePm2, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${JSON.stringify(pm2Log)}\n`, { mode: 0o755 });
    const result = run('bash', ['-c', [
      'source "$1"',
      'APP_USER="$(id -un)"',
      'CURRENT_LINK="$2"',
      'PROCESS_MANAGER=pm2',
      "PROCESS_NAMES='demo-api demo-web'",
      "PROCESS_SCRIPTS='bin/start-api.sh'",
      "PROCESS_MAX_MEMORY='450M 500M'",
      "PROCESS_INTERPRETER='/bin/bash'",
      "PROCESS_RESTART_DELAY='2000'",
      'restart_configured_processes',
    ].join('; '), 'bash', commonPath, fixture.currentLink], {
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /PROCESS_SCRIPTS|process/i);
    assert.equal(fs.existsSync(pm2Log), false, 'invalid contract must fail before invoking PM2');
  } finally { cleanup(fixture); }
});

async function waitForFile(file, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${file}`);
}

function waitForChild(child) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ status: code, stdout, stderr }));
  });
}

test('health check retries initial connection refusal during bounded service startup', async () => {
  const probe = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', `
      const http = require('node:http');
      const probe = http.createServer((req, res) => { res.end('probe'); });
      probe.listen(0, '127.0.0.1', () => {
        const port = probe.address().port;
        process.stdout.write(String(port) + '\\n');
        probe.close(() => process.exit(0));
      });
      probe.on('error', (error) => { console.error(error); process.exit(1); });
    `], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr || `port probe exited ${code}`));
      else resolve(Number(stdout.trim()));
    });
  });

  const delayedServer = spawn(process.execPath, ['-e', `
    const http = require('node:http');
    setTimeout(() => {
      const server = http.createServer((req, res) => { res.statusCode = 200; res.end('ok'); });
      server.listen(${probe}, '127.0.0.1');
      setTimeout(() => server.close(() => process.exit(0)), 5000);
    }, 1200);
  `], { stdio: 'ignore' });

  try {
    const started = Date.now();
    const result = run('bash', ['-c', 'source "$1"; health_check_url "$2"', 'bash', commonPath, `http://127.0.0.1:${probe}/`]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(Date.now() - started >= 1000, 'health check should have observed the delayed startup');
  } finally {
    delayedServer.kill('SIGTERM');
  }
});

test('internal deployment executables have a fail-closed Bash contract', () => {
  for (const file of [commonPath, deployPath, statusPath, rollbackPath]) {
    assert.equal(fs.existsSync(file), true, `${path.relative(repoRoot, file)} must exist`);
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /^#!\/usr\/bin\/env bash\nset -euo pipefail/m);
    assert.doesNotMatch(source, /\beval\b/);
  }
  const deploySource = fs.readFileSync(deployPath, 'utf8');
  assert.match(deploySource, /usage: lightworld-deploy <app> <environment> <sha> <workspace>/);
  assert.doesNotMatch(deploySource, /<command>|command_to_run|arbitrary/i);
  assert.match(fs.readFileSync(statusPath, 'utf8'), /usage: lightworld-status <app> <environment>/);
  assert.match(fs.readFileSync(rollbackPath, 'utf8'), /usage: lightworld-rollback <app> <environment>/);
});

test('commands reject undocumented arity', () => {
  const fixture = makeFixture();
  try {
    for (const [file, args] of [
      [deployPath, ['demo', 'staging', fixture.firstSha]],
      [deployPath, ['demo', 'staging', fixture.firstSha, fixture.workspace, 'extra']],
      [statusPath, ['demo']], [statusPath, ['demo', 'staging', 'extra']],
      [rollbackPath, ['demo']], [rollbackPath, ['demo', 'staging', 'extra']],
    ]) {
      const result = run(file, args, { env: fixture.env });
      assert.notEqual(result.status, 0, `${path.basename(file)} should reject args ${args.join(' ')}`);
    }
  } finally { cleanup(fixture); }
});

test('deploy rejects invalid identifiers and SHA before privileged action', () => {
  const fixture = makeFixture();
  try {
    for (const args of [
      ['../other-app', 'staging', fixture.firstSha, fixture.workspace],
      ['demo', 'prod;id', fixture.firstSha, fixture.workspace],
      ['demo', 'staging', 'not-a-sha', fixture.workspace],
    ]) {
      fs.rmSync(fixture.marker, { force: true });
      const result = run(deployPath, args, { env: fixture.env });
      assert.notEqual(result.status, 0);
      assert.equal(fs.existsSync(fixture.marker), false);
    }
  } finally { cleanup(fixture); }
});

test('deploy rejects a workspace whose origin does not match configured repository', () => {
  const fixture = makeFixture();
  try {
    git(fixture.workspace, 'remote', 'set-url', 'origin', 'https://github.com/evil/demo.git');
    const result = deploy(fixture, fixture.firstSha);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /origin|repository/i);
    assert.equal(fs.existsSync(fixture.marker), false);
  } finally { cleanup(fixture); }
});

test('deploy release content comes from the canonical commit object, not mutable worktree files', () => {
  const fixture = makeFixture();
  try {
    const readme = path.join(fixture.workspace, 'README.md');
    fs.writeFileSync(readme, 'tampered-but-hidden-from-status\n');
    git(fixture.workspace, 'update-index', '--skip-worktree', 'README.md');
    assert.equal(git(fixture.workspace, 'status', '--porcelain'), '', 'probe must hide the worktree tamper from normal status');

    const result = deploy(fixture, fixture.firstSha);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const releasedReadme = fs.readFileSync(path.join(fixture.releases, fixture.firstSha, 'README.md'), 'utf8');
    assert.equal(releasedReadme, 'fixture\n');
  } finally { cleanup(fixture); }
});

test('canonical-worktree source mode creates a Git-aware release from the canonical source mirror', () => {
  const fixture = makeFixture();
  try {
    const readme = path.join(fixture.workspace, 'README.md');
    fs.writeFileSync(readme, 'tampered-runner-worktree\n');
    git(fixture.workspace, 'update-index', '--skip-worktree', 'README.md');
    writeRegistry(fixture, {
      SOURCE_MODE: 'canonical-worktree',
      SOURCE_REPO: fixture.sourceRepo,
    });

    const result = deploy(fixture, fixture.firstSha);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const release = path.join(fixture.releases, fixture.firstSha);
    assert.equal(fs.readFileSync(path.join(release, 'README.md'), 'utf8'), 'fixture\n');
    assert.equal(fs.existsSync(path.join(release, '.git')), true, 'canonical worktree release must retain Git metadata');
    assert.equal(git(release, 'rev-parse', 'HEAD'), fixture.firstSha);
  } finally { cleanup(fixture); }
});

test('adapter runtime executes only an identifier-resolved deployment adapter', () => {
  const fixture = makeFixture();
  try {
    const adapterMarker = path.join(fixture.root, 'adapter.marker');
    const adapter = path.join(fixture.adapterRoot, 'demo-build');
    fs.writeFileSync(adapter, `#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\n' \"$PWD\" > ${JSON.stringify(adapterMarker)}\n`, { mode: 0o700 });
    writeRegistry(fixture, {
      RUNTIME_FAMILY: 'adapter',
      BUILD_ADAPTER: 'demo-build',
    });
    const result = deploy(fixture, fixture.firstSha);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(adapterMarker), true);
    assert.equal(fs.readFileSync(adapterMarker, 'utf8').trim(), path.join(fixture.releases, fixture.firstSha));

    writeRegistry(fixture, {
      RUNTIME_FAMILY: 'adapter',
      BUILD_ADAPTER: '../escape',
    });
    const rejected = deploy(fixture, fixture.firstSha);
    assert.notEqual(rejected.status, 0);
    assert.match(`${rejected.stderr}\n${rejected.stdout}`, /adapter|invalid/i);
  } finally { cleanup(fixture); }
});

test('canonical-worktree deployment rejects tracked source drift introduced by the build adapter', () => {
  const fixture = makeFixture();
  try {
    const adapter = path.join(fixture.adapterRoot, 'mutating-build');
    fs.writeFileSync(adapter, '#!/usr/bin/env bash\nset -euo pipefail\nprintf "mutated\\n" > README.md\n', { mode: 0o700 });
    writeRegistry(fixture, {
      SOURCE_MODE: 'canonical-worktree',
      SOURCE_REPO: fixture.sourceRepo,
      RUNTIME_FAMILY: 'adapter',
      BUILD_ADAPTER: 'mutating-build',
    });
    const result = deploy(fixture, fixture.firstSha);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /tracked|source|drift|canonical/i);
    assert.equal(fs.existsSync(fixture.currentLink), false, 'drifted release must never activate');
  } finally { cleanup(fixture); }
});

test('optional health adapter participates in deployment verification', () => {
  const fixture = makeFixture();
  try {
    const marker = path.join(fixture.root, 'health-adapter.marker');
    const adapter = path.join(fixture.adapterRoot, 'demo-health');
    fs.writeFileSync(adapter, `#!/usr/bin/env bash\nset -euo pipefail\nprintf 'checked\\n' > ${JSON.stringify(marker)}\n`, { mode: 0o700 });
    writeRegistry(fixture, { HEALTH_ADAPTER: 'demo-health' });
    const result = deploy(fixture, fixture.firstSha);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'checked\n');
  } finally { cleanup(fixture); }
});

test('production adapter and canonical-worktree contracts are fail-closed and root-owned by design', () => {
  const source = fs.readFileSync(commonPath, 'utf8');
  assert.match(source, /SOURCE_MODE/);
  assert.match(source, /canonical-worktree/);
  assert.match(source, /SOURCE_REPO/);
  assert.match(source, /BUILD_ADAPTER/);
  assert.match(source, /HEALTH_ADAPTER/);
  assert.match(source, /\/usr\/local\/libexec\/lightworld-deploy\/adapters/);
  assert.doesNotMatch(source, /\beval\b/);
});

test('production workspace Git inspection is bound to a configured non-root runner identity', () => {
  const source = fs.readFileSync(commonPath, 'utf8');
  assert.match(source, /RUNNER_USER/);
  assert.match(source, /runuser\s+-u\s+"\$RUNNER_USER"\s+--\s+git/);
});

test('deploy rejects a SHA that is not the independently resolved canonical main head', () => {
  const fixture = makeFixture();
  try {
    const secondSha = commitNext(fixture, 'second');
    const result = deploy(fixture, secondSha);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /canonical|main/i);
    assert.equal(fs.existsSync(fixture.marker), false);
  } finally { cleanup(fixture); }
});

test('deploy reaches the test action marker only after all Task 1 validation succeeds', () => {
  const fixture = makeFixture();
  try {
    const result = deploy(fixture, fixture.firstSha);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(fs.readFileSync(fixture.marker, 'utf8'), new RegExp(fixture.firstSha));
  } finally { cleanup(fixture); }
});

test('concurrent deploy attempts cannot both acquire the same application lock', async () => {
  const fixture = makeFixture();
  try {
    const ready = path.join(fixture.root, 'lock-ready');
    const first = spawn(deployPath, ['demo', 'staging', fixture.firstSha, fixture.workspace], {
      env: { ...process.env, ...fixture.env, LIGHTWORLD_TEST_HOLD_LOCK_SECONDS: '1', LIGHTWORLD_TEST_LOCK_READY_MARKER: ready },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForFile(ready);
    const second = deploy(fixture, fixture.firstSha);
    assert.notEqual(second.status, 0);
    assert.match(`${second.stderr}\n${second.stdout}`, /lock/i);
    const firstResult = await waitForChild(first);
    assert.equal(firstResult.status, 0, firstResult.stderr || firstResult.stdout);
  } finally { cleanup(fixture); }
});

test('build failure leaves the prior active release unchanged', () => {
  const fixture = makeFixture();
  try {
    const first = deploy(fixture, fixture.firstSha);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const activeBefore = fs.realpathSync(fixture.currentLink);

    const secondSha = commitNext(fixture, 'build-failure-candidate');
    pushCanonical(fixture);
    const failed = deploy(fixture, secondSha, { LIGHTWORLD_TEST_BUILD_FAIL: '1' });
    assert.notEqual(failed.status, 0);
    assert.match(`${failed.stderr}\n${failed.stdout}`, /build/i);
    assert.equal(fs.realpathSync(fixture.currentLink), activeBefore);
  } finally { cleanup(fixture); }
});

test('activation health failure restores the prior active release', () => {
  const fixture = makeFixture();
  try {
    assert.equal(deploy(fixture, fixture.firstSha).status, 0);
    const activeBefore = fs.realpathSync(fixture.currentLink);
    const secondSha = commitNext(fixture, 'health-failure-candidate');
    pushCanonical(fixture);
    const failed = deploy(fixture, secondSha, { LIGHTWORLD_TEST_HEALTH_FAIL: '1' });
    assert.notEqual(failed.status, 0);
    assert.match(`${failed.stderr}\n${failed.stdout}`, /health/i);
    assert.equal(fs.realpathSync(fixture.currentLink), activeBefore);
  } finally { cleanup(fixture); }
});

test('canonical-main lookup failure fails closed without using workspace refs', () => {
  const fixture = makeFixture();
  try {
    writeRegistry(fixture, { CANONICAL_MAIN_URL: path.join(fixture.root, 'missing.git') });
    const result = deploy(fixture, fixture.firstSha);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /canonical main/i);
    assert.equal(fs.existsSync(fixture.currentLink), false);
  } finally { cleanup(fixture); }
});

test('status reports bounded release state without environment contents and rollback uses recorded previous release', () => {
  const fixture = makeFixture();
  try {
    const first = deploy(fixture, fixture.firstSha);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const secondSha = commitNext(fixture, 'second-success');
    pushCanonical(fixture);
    const second = deploy(fixture, secondSha);
    assert.equal(second.status, 0, second.stderr || second.stdout);

    const status = run(statusPath, ['demo', 'staging'], { env: fixture.env });
    assert.equal(status.status, 0, status.stderr || status.stdout);
    assert.match(status.stdout, new RegExp(`active=${secondSha}`));
    assert.match(status.stdout, new RegExp(`previous=${fixture.firstSha}`));
    assert.match(status.stdout, /processes=demo-api demo-web/);
    assert.doesNotMatch(status.stdout, /SUPER_SECRET|do-not-print/);

    const rollback = run(rollbackPath, ['demo', 'staging'], { env: fixture.env });
    assert.equal(rollback.status, 0, rollback.stderr || rollback.stdout);
    assert.equal(path.basename(fs.realpathSync(fixture.currentLink)), fixture.firstSha);
    const restartLog = fs.readFileSync(fixture.restartLog, 'utf8');
    assert.match(restartLog, /demo-api/);
    assert.match(restartLog, /demo-web/);
  } finally { cleanup(fixture); }
});

const bootstrapPath = path.join(opsRoot, 'install', 'bootstrap-host.sh');
const installerPath = path.join(opsRoot, 'install', 'install-platform-files.sh');
const sudoersPath = path.join(opsRoot, 'sudoers', 'lwrun_tradeos');
const shimRoot = path.join(opsRoot, 'shims', 'tradeos-staging');
const statusShimPath = path.join(shimRoot, 'lightworld-status-tradeos-staging');
const deployShimPath = path.join(shimRoot, 'lightworld-deploy-tradeos-staging');
const rollbackShimPath = path.join(shimRoot, 'lightworld-rollback-tradeos-staging');
const diagnosticWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'vps-runner-diagnostic.yml');


test('installed flat libexec layout resolves the shared runtime library', () => {
  const installedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lightworld-installed-libexec-'));
  try {
    fs.copyFileSync(commonPath, path.join(installedRoot, 'common.sh'));
    for (const sourcePath of [deployPath, statusPath, rollbackPath]) {
      const installedPath = path.join(installedRoot, path.basename(sourcePath));
      fs.copyFileSync(sourcePath, installedPath);
      fs.chmodSync(installedPath, 0o755);
      const result = run(installedPath, []);
      assert.equal(
        result.status,
        64,
        `${path.basename(sourcePath)} must reach its usage guard in the flat installed layout; stderr=${result.stderr}`,
      );
      assert.match(result.stderr, /usage:/i);
      assert.doesNotMatch(result.stderr, /No such file or directory/i);
    }
  } finally {
    fs.rmSync(installedRoot, { recursive: true, force: true });
  }
});

test('TradeOS sudoers policy grants only the three application-specific staging shims', () => {
  assert.equal(fs.existsSync(sudoersPath), true, 'TradeOS sudoers template must exist');
  const source = fs.readFileSync(sudoersPath, 'utf8');
  assert.match(source, /^lwrun_tradeos\s+ALL=\(root\)\s+NOPASSWD:/m);
  for (const command of [
    '/usr/local/sbin/lightworld-status-tradeos-staging',
    '/usr/local/sbin/lightworld-deploy-tradeos-staging',
    '/usr/local/sbin/lightworld-rollback-tradeos-staging',
  ]) {
    assert.match(source, new RegExp(command.replaceAll('/', '\\/')));
  }
  assert.doesNotMatch(source, /\/usr\/local\/libexec\/lightworld-deploy/);
  assert.doesNotMatch(source, /ALL=\(ALL\)\s+ALL/);
  assert.doesNotMatch(source, /\/bin\/(?:ba)?sh|\b(?:npm|pnpm|yarn|apt|dnf|yum|vi|vim|nano)\b/);
  assert.doesNotMatch(source, /\*|\?/);
  const nonCommentLines = source.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));
  assert.equal(nonCommentLines.length, 1, 'sudoers template must be a single narrow command grant');
});

test('TradeOS staging shims hardcode application and environment and expose no target selector', () => {
  for (const file of [statusShimPath, deployShimPath, rollbackShimPath]) {
    assert.equal(fs.existsSync(file), true, `${path.relative(repoRoot, file)} must exist`);
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /^#!\/usr\/bin\/env bash\nset -euo pipefail/m);
    assert.match(source, /tradeos-africa/);
    assert.match(source, /staging/);
    assert.doesNotMatch(source, /<app>|<environment>|APP=\$|ENVIRONMENT=\$/i);
    assert.doesNotMatch(source, /\beval\b/);
  }
  assert.match(fs.readFileSync(statusShimPath, 'utf8'), /\[\[ "\$#" -ne 0 \]\]/);
  assert.match(fs.readFileSync(rollbackShimPath, 'utf8'), /\[\[ "\$#" -ne 0 \]\]/);
  const deploy = fs.readFileSync(deployShimPath, 'utf8');
  assert.match(deploy, /\[\[ "\$#" -ne 2 \]\]/);
  assert.match(deploy, /lightworld-deploy['"]?\s+tradeos-africa\s+staging\s+"\$1"\s+"\$2"/);
});

test('host bootstrap assets are root-gated, repository-isolated and syntax-oriented', () => {
  for (const file of [bootstrapPath, installerPath]) {
    assert.equal(fs.existsSync(file), true, `${path.relative(repoRoot, file)} must exist`);
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /^#!\/usr\/bin\/env bash\nset -euo pipefail/m);
    assert.match(source, /EUID/);
    assert.doesNotMatch(source, /\beval\b/);
  }
  const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
  assert.match(bootstrap, /\/opt\/github-runners/);
  assert.match(bootstrap, /\/etc\/lightworld-deploy\/apps\.d/);
  assert.match(bootstrap, /\/var\/lib\/lightworld-deploy/);
  assert.match(bootstrap, /\/var\/lock\/lightworld-deploy/);
  assert.match(bootstrap, /lwrun_tradeos/);
  assert.match(bootstrap, /christianagbotah\/tradeos-africa\/staging/);
  assert.doesNotMatch(bootstrap, /lightworldrunner/);

  const installer = fs.readFileSync(installerPath, 'utf8');
  assert.match(installer, /\/usr\/local\/libexec\/lightworld-deploy/);
  assert.match(installer, /\/usr\/local\/sbin\/lightworld-deploy-tradeos-staging/);
  assert.match(installer, /visudo\s+-cf/);
  assert.match(installer, /bash\s+-n/);
  assert.match(installer, /root:root/);
});

test('VPS runner diagnostic workflow is manual, read-only and does not checkout repository code', () => {
  assert.equal(fs.existsSync(diagnosticWorkflowPath), true, 'diagnostic workflow must exist');
  const source = fs.readFileSync(diagnosticWorkflowPath, 'utf8');
  assert.match(source, /^name:\s*VPS Runner Diagnostic/m);
  assert.match(source, /\bon:\s*\n\s+workflow_dispatch:\s*$/m);
  assert.doesNotMatch(source, /pull_request|push:/);
  assert.match(source, /permissions:\s*\n\s+contents:\s*read/m);
  assert.match(source, /runs-on:\s*\[self-hosted,\s*linux,\s*x64,\s*lightworld-vps,\s*staging,\s*tradeos-staging\]/m);
  assert.doesNotMatch(source, /actions\/checkout/);
  assert.doesNotMatch(source, /secrets\.|printenv|env\s*\|/i);
  assert.match(source, /whoami/);
  assert.match(source, /df\s+-h/);
  assert.match(source, /free\s+-m/);
  assert.match(source, /sudo\s+-n\s+\/usr\/local\/sbin\/lightworld-status-tradeos-staging/);
});

const tradeosProfilePath = path.join(opsRoot, 'apps', 'tradeos-africa.staging.conf.example');
const deployWorkflowPath = path.join(repoRoot, '.github', 'workflows', 'deploy-staging.yml');

test('TradeOS staging registry template pins canonical operational metadata without secrets', () => {
  assert.equal(fs.existsSync(tradeosProfilePath), true, 'TradeOS staging registry template must exist');
  const source = fs.readFileSync(tradeosProfilePath, 'utf8');
  assert.match(source, /^GITHUB_REPO=['"]christianagbotah\/tradeos-africa['"]$/m);
  assert.match(source, /^CANONICAL_MAIN_URL=['"]https:\/\/github\.com\/christianagbotah\/tradeos-africa\.git['"]$/m);
  assert.match(source, /^MAIN_VERIFY_MODE=['"]public-ls-remote['"]$/m);
  assert.match(source, /^APP_USER=['"]lightworld['"]$/m);
  assert.match(source, /^RUNNER_USER=['"]lwrun_tradeos['"]$/m);
  assert.match(source, /^RELEASE_ROOT=['"]\/home\/lightworld\/releases\/tradeos-staging['"]$/m);
  assert.match(source, /^PROCESS_MANAGER=['"]pm2['"]$/m);
  assert.match(source, /^PROCESS_NAMES=['"]tradeos-staging-api tradeos-staging-web tradeos-staging-admin['"]$/m);
  assert.match(source, /^PROCESS_SCRIPTS=['"]bin\/start-api\.sh bin\/start-web\.sh bin\/start-system-admin\.sh['"]$/m);
  assert.match(source, /^PROCESS_MAX_MEMORY=['"]450M 500M 400M['"]$/m);
  assert.match(source, /^PROCESS_INTERPRETER=['"]\/bin\/bash['"]$/m);
  assert.match(source, /^PROCESS_RESTART_DELAY=['"]2000['"]$/m);
  assert.match(source, /^RUNTIME_FAMILY=['"]pnpm-node['"]$/m);
  assert.match(source, /^MIGRATION_MODE=['"]manual['"]$/m);
  assert.match(source, /http:\/\/127\.0\.0\.1:4036\/health/);
  assert.match(source, /http:\/\/127\.0\.0\.1:3036\//);
  assert.match(source, /http:\/\/127\.0\.0\.1:3038\//);
  assert.match(source, /^CURRENT_LINK=['"]__SET_FROM_LIVE_VPS__['"]$/m);
  assert.match(source, /^ENV_FILE=['"]__SET_FROM_LIVE_VPS__['"]$/m);
  assert.match(source, /^PUBLIC_HEALTH_URLS=['"]__SET_FROM_LIVE_VPS__['"]$/m);
  assert.doesNotMatch(source, /(?:PASSWORD|JWT_SECRET|DATABASE_URL|API_KEY|TOKEN)=['"][^_]/i);
});

test('TradeOS staging deploy workflow is manual, main-only, serialized and narrowly privileged', () => {
  assert.equal(fs.existsSync(deployWorkflowPath), true, 'TradeOS staging deployment workflow must exist');
  const source = fs.readFileSync(deployWorkflowPath, 'utf8');
  assert.match(source, /^name:\s*Deploy TradeOS Staging/m);
  assert.match(source, /\bon:\s*\n\s+workflow_dispatch:\s*$/m);
  assert.doesNotMatch(source, /pull_request|push:/);
  assert.match(source, /permissions:\s*\n\s+contents:\s*read/m);
  assert.match(source, /concurrency:\s*\n\s+group:\s*tradeos-staging\s*\n\s+cancel-in-progress:\s*false/m);
  assert.match(source, /if:\s*github\.ref\s*==\s*['"]refs\/heads\/main['"]/m);
  assert.match(source, /runs-on:\s*\[self-hosted,\s*linux,\s*x64,\s*lightworld-vps,\s*staging,\s*tradeos-staging\]/m);
  assert.match(source, /uses:\s*actions\/checkout@v4/m);
  assert.match(source, /persist-credentials:\s*false/m);
  const sudoLines = source.split('\n').filter((line) => /\bsudo\b/.test(line));
  assert.deepEqual(sudoLines.map((line) => line.trim()), [
    'sudo -n /usr/local/sbin/lightworld-deploy-tradeos-staging "$GITHUB_SHA" "$GITHUB_WORKSPACE"',
  ]);
  assert.doesNotMatch(source, /workflow_dispatch:\s*\n\s+inputs:/m);
  assert.doesNotMatch(source, /secrets\.|persist-credentials:\s*true/i);
});

const systemAdminNginxPath = path.join(opsRoot, 'nginx', 'tradeos-system-admin.location.conf');

test('TradeOS System Admin nginx snippet proxies the dedicated host root to localhost admin runtime', () => {
  assert.equal(fs.existsSync(systemAdminNginxPath), true, 'System Admin nginx snippet must exist');
  const source = fs.readFileSync(systemAdminNginxPath, 'utf8');
  assert.match(source, /error_page 418 = @tradeosadmin_root;/);
  assert.match(source, /if \(\$request_uri = "\/"\) \{/);
  assert.match(source, /location @tradeosadmin_root \{/);
  assert.match(source, /location \^~ \/\s*\{/);
  assert.match(source, /proxy_pass http:\/\/127\.0\.0\.1:3038;/);
  assert.match(source, /X-Forwarded-Proto \$scheme/);
  assert.match(source, /X-Robots-Tag "noindex, nofollow, nosnippet" always/);
  assert.doesNotMatch(source, /system-admin\//);
  assert.doesNotMatch(source, /\blisten\b|ssl_certificate|server_name/);
  assert.doesNotMatch(source, /3038.*0\.0\.0\.0|3038.*\[::\]/);
});

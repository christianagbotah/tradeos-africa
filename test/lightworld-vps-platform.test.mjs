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
    RELEASE_ROOT: fixture.releases,
    CURRENT_LINK: fixture.currentLink,
    ENV_FILE: fixture.envFile,
    PROCESS_MANAGER: 'test',
    PROCESS_NAMES: 'demo-api demo-web',
    LOCAL_HEALTH_URLS: 'test://local',
    PUBLIC_HEALTH_URLS: 'test://public',
    RUNTIME_FAMILY: 'test',
    MIGRATION_MODE: 'manual',
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
  fs.mkdirSync(workspace);
  fs.mkdirSync(registry);
  fs.mkdirSync(releases);
  fs.mkdirSync(lockRoot);
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

  const fixture = { root, workspace, bare, registry, releases, currentLink, envFile, marker, restartLog, lockRoot, firstSha };
  writeRegistry(fixture);
  fixture.env = {
    LIGHTWORLD_TEST_MODE: '1',
    LIGHTWORLD_REGISTRY_ROOT: registry,
    LIGHTWORLD_TEST_ACTION_MARKER: marker,
    LIGHTWORLD_TEST_RESTART_LOG: restartLog,
    LIGHTWORLD_LOCK_ROOT: lockRoot,
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
  assert.match(source, /^RELEASE_ROOT=['"]\/home\/lightworld\/releases\/tradeos-staging['"]$/m);
  assert.match(source, /^PROCESS_MANAGER=['"]pm2['"]$/m);
  assert.match(source, /^PROCESS_NAMES=['"]tradeos-staging-api tradeos-staging-web['"]$/m);
  assert.match(source, /^RUNTIME_FAMILY=['"]pnpm-node['"]$/m);
  assert.match(source, /^MIGRATION_MODE=['"]manual['"]$/m);
  assert.match(source, /http:\/\/127\.0\.0\.1:4036\/health/);
  assert.match(source, /http:\/\/127\.0\.0\.1:3036\//);
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

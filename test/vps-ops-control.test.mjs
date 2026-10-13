import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'vps-ops-control.yml');

test('VPS ops issue-comment workflow is owner-only, read-only, and allow-listed', () => {
  assert.equal(fs.existsSync(workflowPath), true, 'vps-ops-control.yml must exist');
  const source = fs.readFileSync(workflowPath, 'utf8');

  assert.match(source, /name:\s*VPS Ops Control/);
  assert.match(source, /issue_comment:\s*\n\s*types:\s*\[created\]/);
  assert.match(source, /issues:\s*write/);
  assert.match(source, /contents:\s*read/);
  assert.match(source, /github\.event\.issue\.number\s*==\s*67/);
  assert.match(source, /github\.actor\s*==\s*'christianagbotah'/);
  assert.match(source, /github\.event\.comment\.author_association\s*==\s*'OWNER'/);
  assert.match(source, /runs-on:\s*\[self-hosted,\s*linux,\s*x64,\s*lightworld-vps,\s*staging,\s*tradeos-staging\]/);

  for (const command of ['status', 'health', 'disk', 'runner-status']) {
    assert.match(source, new RegExp(`/${command.replace('-', '\\-')}\\b|${command.replace('-', '\\-')}\\)`));
  }

  assert.match(source, /lightworld-status-tradeos-staging/);
  assert.doesNotMatch(source, /\beval\b/);
  assert.doesNotMatch(source, /bash\s+-c/);
  assert.doesNotMatch(source, /\bssh\b|STAGING_SSH_|SSH_PRIVATE_KEY/);
  assert.doesNotMatch(source, /secrets\./);
  assert.doesNotMatch(source, /lightworld-deploy-tradeos-staging|lightworld-rollback-tradeos-staging/);
  assert.doesNotMatch(source, /pm2\s+(restart|stop|delete|start)/);
});

test('VPS ops workflow never interpolates untrusted comment text directly into shell source', () => {
  assert.equal(fs.existsSync(workflowPath), true, 'vps-ops-control.yml must exist');
  const source = fs.readFileSync(workflowPath, 'utf8');
  assert.doesNotMatch(source, /run:[\s\S]{0,2500}\$\{\{\s*github\.event\.comment\.body\s*\}\}/);
  assert.match(source, /COMMENT_BODY:\s*\$\{\{\s*github\.event\.comment\.body\s*\}\}/);
  assert.match(source, /case\s+"\$COMMENT_BODY"\s+in/);
});

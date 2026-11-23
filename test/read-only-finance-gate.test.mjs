import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { FINANCE_QUERIES, assessFinanceSnapshot,
         queryFinanceSnapshotReadOnly } from '../ops/release/check-promotion-finance.mjs';

const emptyCounts = () => Object.fromEntries(FINANCE_QUERIES.map(([key]) => [key,0]));
const makePool = (respond) => {
  const commands = [];
  let released = false;
  const pool = { connect: async () => ({
    query: async sql => {
      commands.push(sql);
      if (sql.startsWith('SELECT')) return respond(sql, commands.length);
      return { rows: [] };
    },
    release: () => { released = true; },
  })};
  return {pool, commands, released:()=>released};
};

test('nine fixed finance probes are aggregates only and use allowlisted table names', () => {
  assert.equal(FINANCE_QUERIES.length,9);
  const expectedTables = ['payments','refund_transactions','hubtel_sale_checkout_attempts',
    'subscription_checkout_attempts','subscription_payment_refunds','sync_mutations',
    'outbox_events'];
  for(const [,sql] of FINANCE_QUERIES) {
    assert.match(sql,/^SELECT COUNT\(\*\)::text AS total FROM /);
    assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|RETURNING|FOR UPDATE)\b/i);
    assert.doesNotMatch(sql,/SELECT\s+\*/i);
    assert.ok(expectedTables.some(table => sql.includes('FROM '+table)));
  }
  assert.equal(new Set(FINANCE_QUERIES.map(([key])=>key)).size,9);
});

test('zero backlog is informational and NEVER grants deployment permission',()=>{
  const result=assessFinanceSnapshot(emptyCounts());
  assert.equal(result.reviewedFinanceBacklogClear,true);
  assert.equal(result.authorizedToDeploy,false);
  assert.equal(result.aggregateCountsOnly,true);
  assert.deepEqual(result.blockers,[]);
});

test('in-flight sale/refund/provider/offline/outbox work fails finance readiness',()=>{
  for(const [key] of FINANCE_QUERIES) {
    const counts=emptyCounts();
    counts[key]=3;
    const result=assessFinanceSnapshot(counts);
    assert.equal(result.reviewedFinanceBacklogClear,false,key);
    assert.deepEqual(result.blockers,[{check:key,count:3}]);
    assert.equal(result.authorizedToDeploy,false);
  }
});

test('missing, unexpected, negative, decimal and unsafe counts fail closed',()=>{
  const good=emptyCounts();
  const key=FINANCE_QUERIES[0][0];
  for(const bad of [null,[],{}, {...good, extra:0}, {...good,[key]:-1},
    {...good,[key]:1.5}, {...good,[key]:NaN},
    {...good,[key]:Number.MAX_SAFE_INTEGER+1}, {...good,[key]:'1'}]) {
    assert.throws(()=>assessFinanceSnapshot(bad),/finance readiness/i);
  }
});

test('single stable read-only snapshot, aggregates and unconditional rollback',async()=>{
  const p=makePool(()=>({rows:[{total:'0'}]}));
  const result=await queryFinanceSnapshotReadOnly(p.pool);
  assert.equal(result.authorizedToDeploy,false);
  assert.equal(p.commands[0],'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(p.commands.at(-1),'ROLLBACK');
  assert.equal(p.commands.length,FINANCE_QUERIES.length+2);
  assert.equal(p.released(),true);
  assert.ok(p.commands.slice(1,-1).every(sql=>sql.startsWith('SELECT COUNT(*)::text')));
});

test('read-only snapshot preserves nonzero counts but not sensitive fields',async()=>{
  let seen=0;
  const p=makePool(()=>({rows:[{total:String(++seen)}]}));
  const result=await queryFinanceSnapshotReadOnly(p.pool);
  assert.equal(result.counts.pendingSalePayments,1);
  assert.equal(result.counts.unreferencedExternalRefunds,9);
  assert.equal(result.blockers.length,9);
  assert.equal(JSON.stringify(result).includes('providerReference'),false);
  assert.equal(p.commands.at(-1),'ROLLBACK');
});

test('invalid SQL results fail closed and still rollback/release',async()=>{
  for(const response of [{rows:[]},{rows:[{total:'-2'}]},{rows:[{total:'NaN'}]},
    {rows:[{total:'9007199254740992'}]},{rows:[{total:'1'},{total:'2'}]}]) {
    const p=makePool(()=>response);
    await assert.rejects(queryFinanceSnapshotReadOnly(p.pool),/aggregate|precision/);
    assert.equal(p.commands.at(-1),'ROLLBACK');
    assert.equal(p.released(),true);
  }
});

test('database SELECT rejection and rollback failure never yield success',async()=>{
  const p=makePool(()=>{throw new Error('test simulated database failure')});
  await assert.rejects(queryFinanceSnapshotReadOnly(p.pool),/simulated/);
  assert.equal(p.commands.at(-1),'ROLLBACK');
  assert.equal(p.released(),true);
  const commands=[]; let released=false;
  const pool={connect: async()=>({query: async sql=>{
    commands.push(sql);
    if(sql==='ROLLBACK') throw new Error('rollback not confirmed');
    if(sql.startsWith('SELECT')) return {rows:[{total:'0'}]};
  },release:()=>{released=true}})};
  await assert.rejects(queryFinanceSnapshotReadOnly(pool),/rollback not confirmed/);
  assert.equal(released,true);
  assert.equal(commands.at(-1),'ROLLBACK');
});

test('finance preflight source cannot run migrations, touch app services or expose secrets',()=>{
  const source=readFileSync(new URL('../ops/release/check-promotion-finance.mjs',import.meta.url),'utf8');
  assert.match(source,/validateBundleIdentity\(runtimeRoot, sha\)/);
  assert.match(source,/createRequire\(path.join\(runtimeRoot, 'apps\/api\/package.json'\)\)/);
  assert.doesNotMatch(source,/\b(systemctl|pm2|pnpm|next build|applyMigrations|console\.log\(error)/);
  assert.match(source,/process\.env\.DATABASE_URL/);
  assert.match(source,/authorizedToDeploy: false/);
  assert.match(source,/console\.error\('finance-preflight-blocked: '/);
});

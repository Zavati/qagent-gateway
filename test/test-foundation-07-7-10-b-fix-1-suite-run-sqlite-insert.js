import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createSuiteRunRoot } from '../src/repositories/suiteRunRepository.js';

class D1PreparedShim {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1PreparedShim(this.db, this.sql, params); }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(result.changes ?? 0) } };
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.params) ?? null;
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params) };
  }
}

class D1DatabaseShim {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1PreparedShim(this.db, sql); }
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys = ON;');
const migration = fs.readFileSync(new URL('../migrations/0015_foundation_07_7_10_b_suite_run_orchestration.sql', import.meta.url), 'utf8');
sqlite.exec(migration);

const env = { QAGENT_DB: new D1DatabaseShim(sqlite) };
const suiteRun = {
  suiteRunId: 'srun_fix1_12345678',
  organizationId: 'org_fix1',
  projectId: 'prj_fix1',
  contractVersion: 'qagent.suite-run.v1',
  suiteId: 'suite_fix1',
  suiteVersionId: 'suitev_fix1_12345678',
  suiteVersion: 2,
  suiteInventoryFingerprint: 'f'.repeat(64),
  environmentId: 'env_fix1',
  endpointCount: 4,
  scenarioCount: 21,
  confirmDiscoveredRuntime: true,
  idempotencyKey: 'suite-fix1-key',
  requestFingerprint: 'a'.repeat(64),
  createdByUserId: 'usr_fix1',
  createdAt: '2026-08-25T17:00:00.000Z',
  updatedAt: '2026-08-25T17:00:00.000Z'
};

const created = await createSuiteRunRoot(env, { suiteRun });
assert.equal(created.suiteRun.suiteRunId, suiteRun.suiteRunId);
assert.equal(created.suiteRun.status, 'CREATED');
assert.equal(created.suiteRun.endpointCount, 4);
assert.equal(created.suiteRun.scenarioCount, 21);
assert.equal(created.dispatch.status, 'PENDING');
assert.equal(created.dispatch.cursor, 0);

const row = sqlite.prepare('SELECT COUNT(*) AS count FROM suite_runs WHERE suite_run_id = ?').get(suiteRun.suiteRunId);
assert.equal(Number(row.count), 1);

console.log('Foundation 07.7.10-B FIX-1 real SQLite Suite Run INSERT: PASS ✅');

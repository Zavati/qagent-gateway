import { requireDataDb } from './dataDb.js';
import { scopeValues, executionError } from '../services/uiExecutionContract.js';

const SCOPE = 'organization_id=? AND project_id=? AND environment_id=?';
export class UiExecutionRepository {
  constructor(env) { this.db = requireDataDb(env); }
  statement(sql, args = []) { return this.db.prepare(sql).bind(...args); }
  async batch(scope, id) {
    return this.statement(`SELECT * FROM ui_execution_batches WHERE ${SCOPE} AND batch_id=?`, [...scopeValues(scope), id]).first();
  }
  async byOperation(scope, id) {
    return this.statement(`SELECT * FROM ui_execution_batches WHERE ${SCOPE} AND operation_id=?`, [...scopeValues(scope), id]).first();
  }
  async item(scope, batchId, itemId) {
    return this.statement(`SELECT * FROM ui_execution_items WHERE ${SCOPE} AND batch_id=? AND item_id=?`, [...scopeValues(scope), batchId, itemId]).first();
  }
  async items(scope, batchId) {
    return (await this.statement(`SELECT * FROM ui_execution_items WHERE ${SCOPE} AND batch_id=? ORDER BY ordinal`, [...scopeValues(scope), batchId]).all()).results;
  }
  async list(scope, limit, cursor) {
    const query = cursor ? ' AND (created_at < ? OR (created_at = ? AND batch_id < ?))' : '';
    return (await this.statement(`SELECT * FROM ui_execution_batches WHERE ${SCOPE}${query} ORDER BY created_at DESC,batch_id DESC LIMIT ?`,
      [...scopeValues(scope), ...(cursor ? [cursor.at, cursor.at, cursor.id] : []), limit + 1]).all()).results;
  }
  async insert(scope, batch, items) {
    // One D1 transaction admits every item or none. A racing operation can only
    // install its own immutable snapshot; it cannot mix items into the winner.
    const statements = [this.statement(`INSERT INTO ui_execution_batches
      (batch_id,organization_id,project_id,environment_id,operation_id,request_hash,snapshot_key,snapshot_hash,profile_id,target_build_ref,item_count,created_at,updated_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,project_id,environment_id,operation_id) DO NOTHING`,
    [batch.id, ...scopeValues(scope), batch.operationId, batch.requestHash, batch.snapshotKey, batch.snapshotHash, batch.profileId, batch.targetBuildRef, items.length, batch.now, batch.now, batch.actor])];
    for (const item of items) statements.push(this.statement(`INSERT INTO ui_execution_items
      (item_id,batch_id,organization_id,project_id,environment_id,ordinal,capture_id,test_design_id,test_design_version_id,version,source_json,design_key,design_hash,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ui_execution_batches WHERE batch_id=? AND snapshot_hash=?)
      ON CONFLICT(item_id) DO NOTHING`, [item.id, batch.id, ...scopeValues(scope), item.ordinal, item.source.captureId, item.testDesignId, item.testDesignVersionId,
      item.version, JSON.stringify(item.source), item.designKey, item.designHash, batch.now, batch.id, batch.snapshotHash]));
    await this.db.batch(statements);
    const found = await this.byOperation(scope, batch.operationId);
    if (found.request_hash !== batch.requestHash) throw executionError('IDEMPOTENCY_CONFLICT', 409);
    return found;
  }
  async sweep(scope, now, batchId = null) {
    // Expiry is a terminal technical result, not a requeue: blindly repeating a
    // Live interaction could repeat a destructive operation on the target.
    await this.statement(`UPDATE ui_execution_items SET
      status=CASE WHEN EXISTS(SELECT 1 FROM ui_execution_batches b WHERE b.batch_id=ui_execution_items.batch_id AND b.cancel_requested=1) THEN 'CANCELLED' ELSE 'ERROR' END,
      error_code=CASE WHEN EXISTS(SELECT 1 FROM ui_execution_batches b WHERE b.batch_id=ui_execution_items.batch_id AND b.cancel_requested=1) THEN 'UI_EXECUTION_CANCELLED' ELSE 'UI_EXECUTION_LEASE_EXPIRED' END,
      gate='INCOMPLETE',updated_at=? WHERE ${SCOPE} AND status='RUNNING' AND lease_expires_at<=?${batchId ? ' AND batch_id=?' : ''}`,
    [now, ...scopeValues(scope), now, ...(batchId ? [batchId] : [])]).run();
  }
  async claim(scope, batchId, workerId, tokenHash, now, leaseMs) {
    // Selection and ownership transfer share a single statement. There is no
    // read-then-write window and concurrent workers never acquire the same item.
    return this.statement(`UPDATE ui_execution_items SET status='RUNNING',worker_id=?,claim_token_hash=?,claimed_at=?,lease_expires_at=?,updated_at=?
      WHERE item_id=(SELECT i.item_id FROM ui_execution_items i JOIN ui_execution_batches b ON b.batch_id=i.batch_id
      WHERE i.organization_id=? AND i.project_id=? AND i.environment_id=? AND i.batch_id=? AND i.status='QUEUED' AND b.cancel_requested=0
      ORDER BY i.ordinal LIMIT 1) AND status='QUEUED' RETURNING *`,
    [workerId, tokenHash, now, now + leaseMs, now, ...scopeValues(scope), batchId]).first();
  }
  async heartbeat(scope, batchId, itemId, tokenHash, now, leaseMs) {
    return this.statement(`UPDATE ui_execution_items SET lease_expires_at=CASE WHEN EXISTS(SELECT 1 FROM ui_execution_batches b WHERE b.batch_id=ui_execution_items.batch_id AND b.cancel_requested=1)
      THEN lease_expires_at ELSE ? END,updated_at=? WHERE ${SCOPE} AND batch_id=? AND item_id=? AND status='RUNNING' AND claim_token_hash=? AND lease_expires_at>? RETURNING *`,
    [now + leaseMs, now, ...scopeValues(scope), batchId, itemId, tokenHash, now]).first();
  }
  async failClaim(scope, batchId, itemId, tokenHash, code, now) {
    await this.statement(`UPDATE ui_execution_items SET status='ERROR',error_code=?,gate='INCOMPLETE',updated_at=? WHERE ${SCOPE} AND batch_id=? AND item_id=? AND status='RUNNING' AND claim_token_hash=?`,
      [code, now, ...scopeValues(scope), batchId, itemId, tokenHash]).run();
  }
  async cancel(scope, batchId, now) {
    await this.db.batch([
      this.statement(`UPDATE ui_execution_batches SET cancel_requested=1,updated_at=? WHERE ${SCOPE} AND batch_id=?`, [now, ...scopeValues(scope), batchId]),
      this.statement(`UPDATE ui_execution_items SET status='CANCELLED',error_code='UI_EXECUTION_CANCELLED',updated_at=? WHERE ${SCOPE} AND batch_id=? AND status='QUEUED'`, [now, ...scopeValues(scope), batchId]),
      this.statement(`UPDATE ui_execution_items SET lease_expires_at=MIN(lease_expires_at,?),updated_at=? WHERE ${SCOPE} AND batch_id=? AND status='RUNNING'`, [now + 30000, now, ...scopeValues(scope), batchId]),
    ]);
  }
  async finalize(scope, item, tokenHash, result, now) {
    return this.statement(`UPDATE ui_execution_items SET status='COMPLETED',result_key=?,result_hash=?,gate=?,updated_at=?
      WHERE ${SCOPE} AND batch_id=? AND item_id=? AND status='RUNNING' AND claim_token_hash=? AND lease_expires_at>? RETURNING *`,
    [result.key, result.hash, result.gate, now, ...scopeValues(scope), item.batch_id, item.item_id, tokenHash, now]).first();
  }
  async evidence(scope, batchId, itemId, evidenceId) {
    return this.statement(`SELECT * FROM ui_execution_evidence WHERE ${SCOPE} AND batch_id=? AND item_id=? AND evidence_id=?`, [...scopeValues(scope), batchId, itemId, evidenceId]).first();
  }
  async evidenceList(scope, batchId, itemId) {
    return (await this.statement(`SELECT * FROM ui_execution_evidence WHERE ${SCOPE} AND batch_id=? AND item_id=?`, [...scopeValues(scope), batchId, itemId]).all()).results;
  }
  async recordEvidence(scope, item, tokenHash, evidence, now) {
    await this.statement(`INSERT INTO ui_execution_evidence
      (item_id,evidence_id,batch_id,organization_id,project_id,environment_id,claim_token_hash,object_key,sha256,byte_length,content_type,page_stats_json,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ui_execution_items WHERE ${SCOPE} AND batch_id=? AND item_id=? AND status='RUNNING' AND claim_token_hash=? AND lease_expires_at>?)
      ON CONFLICT(item_id,evidence_id) DO NOTHING`,
    [item.item_id, evidence.id, item.batch_id, ...scopeValues(scope), tokenHash, evidence.key, evidence.hash, evidence.size, evidence.type, evidence.stats ? JSON.stringify(evidence.stats) : null, now,
      ...scopeValues(scope), item.batch_id, item.item_id, tokenHash, now]).run();
    return this.evidence(scope, item.batch_id, item.item_id, evidence.id);
  }
}

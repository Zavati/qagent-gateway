import { executionError, executionId, isHash, object, textValue, canonical } from './uiExecutionContract.js';

const countsKeys = ['actionsPlanned', 'actionsExecuted', 'checkpointsPlanned', 'checkpointsReached', 'checksPassed', 'checksFailed', 'checksPending', 'fixturesConsumed', 'requestsObserved'];
const statuses = ['PASSED', 'FAILED', 'BLOCKED', 'ERROR', 'CANCELLED', 'INCOMPLETE'];
function validCheck(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.id !== 'string' || !value.id || typeof value.kind !== 'string'
    || !['PASSED', 'FAILED', 'PENDING'].includes(value.status)) throw executionError('CHECK_INVALID');
}
/** Statistics are measured from uploaded bytes, not accepted from client claims. */
export function ndjsonStats(bytes) {
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw executionError('PAGE_INVALID'); }
  const stats = { rows: 0, checks: 0, passed: 0, failed: 0, pending: 0 }, ids = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let value; try { value = JSON.parse(line); } catch { throw executionError('PAGE_INVALID'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw executionError('PAGE_INVALID');
    // Reject unsafe JSON/complexity per bounded page. The entire logical result
    // has no row ceiling; runners split it into any number of pages.
    canonical(value); stats.rows++;
    if (typeof value.id === 'string' && typeof value.kind === 'string' && ['PASSED', 'FAILED', 'PENDING'].includes(value.status)) {
      validCheck(value); if (ids.has(value.id)) throw executionError('DUPLICATE_CHECK'); ids.add(value.id);
      stats.checks++; stats[value.status.toLowerCase()]++;
    }
  }
  return stats;
}

/** Check pages may overlap even when their complete bytes differ. Validate IDs
 * across every page of each mode before committing its result. IDs stay in R2;
 * D1 keeps only measured counters, immutable refs and the final gate. */
export async function assertUniquePageChecks(result, records, readPage) {
  const indexed = new Map(records.map(row => [row.evidence_id, row]));
  for (const mode of result.modes) {
    const ids = new Set();
    for (const page of mode.reportPages ?? []) if (page.collection === 'checks') {
      const bytes = await readPage(indexed.get(page.evidenceId));
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      for (const line of text.split('\n')) if (line.trim()) {
        const check = JSON.parse(line); validCheck(check);
        if (ids.has(check.id)) throw executionError('DUPLICATE_CHECK', 409); ids.add(check.id);
      }
    }
  }
}
function inlineStats(mode) {
  const stats = { rows: 0, passed: 0, failed: 0, pending: 0 }, ids = new Set();
  for (const check of mode.checks) {
    validCheck(check); if (ids.has(check.id)) throw executionError('DUPLICATE_CHECK'); ids.add(check.id);
    stats.rows++; stats[check.status.toLowerCase()]++;
  }
  for (const row of [...mode.network, ...mode.pending]) if (!row || typeof row !== 'object' || Array.isArray(row)) throw executionError('RESULT_INVALID');
  return { ...stats, pendingRows: mode.pending.length, networkRows: mode.network.length };
}
function evidenceRef(value, records, claimHash) {
  object(value, ['evidenceId', 'sha256', 'byteLength', 'contentType', 'mode', 'kind'], ['evidenceId', 'sha256', 'byteLength', 'contentType']);
  executionId(value.evidenceId);
  if (!isHash(value.sha256) || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0) throw executionError('EVIDENCE_REF_INVALID');
  if (value.mode !== undefined && !['UI_REPLAY', 'UI_LIVE'].includes(value.mode)) throw executionError('EVIDENCE_REF_INVALID');
  const row = records.get(value.evidenceId);
  if (!row || row.claim_token_hash !== claimHash || row.sha256 !== value.sha256 || row.byte_length !== value.byteLength || row.content_type !== value.contentType) throw executionError('EVIDENCE_REF_MISMATCH', 409);
  return row;
}
export function validatePairResult(result, design, rows, claimHash) {
  object(result, ['contractVersion', 'runnerVersion', 'startedAt', 'completedAt', 'executionPerformed', 'modes', 'evidence']);
  if (result.contractVersion !== 'qagent.ui-execution-pair-result.v1' || typeof result.executionPerformed !== 'boolean'
    || !Array.isArray(result.modes) || result.modes.length !== 2 || !Array.isArray(result.evidence)) throw executionError('RESULT_INVALID');
  textValue(result.runnerVersion, 128);
  if (typeof result.startedAt !== 'string' || typeof result.completedAt !== 'string' || !Number.isFinite(Date.parse(result.startedAt))
    || !Number.isFinite(Date.parse(result.completedAt)) || Date.parse(result.completedAt) < Date.parse(result.startedAt)) throw executionError('RESULT_TIME_INVALID');
  const records = new Map(rows.map(row => [row.evidence_id, row])), refs = new Map(), usedPages = new Set();
  for (const ref of result.evidence) {
    evidenceRef(ref, records, claimHash);
    if (refs.has(ref.evidenceId)) throw executionError('EVIDENCE_REF_DUPLICATE'); refs.set(ref.evidenceId, ref);
  }
  const coverage = design.compilation.specification.coverage;
  let anyExecuted = false, failed = false, incomplete = false;
  for (let index = 0; index < 2; index++) {
    const mode = result.modes[index];
    object(mode, ['mode', 'status', 'reasonCodes', 'executionPerformed', 'counts', 'checks', 'pending', 'network', 'externalized', 'reportPages'],
      ['mode', 'status', 'reasonCodes', 'executionPerformed', 'counts', 'checks', 'pending', 'network']);
    if (mode.mode !== ['UI_REPLAY', 'UI_LIVE'][index] || !statuses.includes(mode.status) || typeof mode.executionPerformed !== 'boolean'
      || !Array.isArray(mode.reasonCodes) || mode.reasonCodes.some(v => typeof v !== 'string' || !/^[A-Z0-9_]{1,160}$/.test(v))
      || !Array.isArray(mode.checks) || !Array.isArray(mode.pending) || !Array.isArray(mode.network)) throw executionError('RESULT_INVALID');
    object(mode.counts, countsKeys);
    if (countsKeys.some(k => !Number.isSafeInteger(mode.counts[k]) || mode.counts[k] < 0)) throw executionError('COUNTS_INVALID');
    const c = mode.counts;
    if (c.actionsPlanned !== coverage.actionsTotal || c.checkpointsPlanned !== coverage.checkpointsTotal
      || c.actionsExecuted > c.actionsPlanned || c.checkpointsReached > c.checkpointsPlanned) throw executionError('PLAN_COUNTS_MISMATCH', 409);
    let stats;
    if (mode.externalized === true) {
      if (!Array.isArray(mode.reportPages) || mode.checks.length || mode.pending.length || mode.network.length) throw executionError('PAGE_REF_INVALID');
      stats = { rows: 0, passed: 0, failed: 0, pending: 0, pendingRows: 0, networkRows: 0 };
      for (const page of mode.reportPages) {
        object(page, ['evidenceId', 'collection', 'count', 'sha256', 'byteLength', 'contentType']);
        if (!['checks', 'pending', 'network'].includes(page.collection) || !Number.isSafeInteger(page.count) || page.count < 1 || page.contentType !== 'application/x-ndjson'
          || usedPages.has(page.evidenceId)) throw executionError('PAGE_REF_INVALID');
        const ref = refs.get(page.evidenceId);
        if (!ref || ref.sha256 !== page.sha256 || ref.byteLength !== page.byteLength || ref.contentType !== page.contentType || (ref.mode && ref.mode !== mode.mode)) throw executionError('PAGE_REF_MISMATCH', 409);
        const row = records.get(page.evidenceId), measured = row?.page_stats_json ? JSON.parse(row.page_stats_json) : null;
        if (!measured || measured.rows !== page.count) throw executionError('PAGE_COUNTS_MISMATCH', 409);
        usedPages.add(page.evidenceId);
        if (page.collection === 'checks') {
          if (measured.checks !== measured.rows) throw executionError('PAGE_CHECKS_INVALID');
          stats.rows += measured.rows; stats.passed += measured.passed; stats.failed += measured.failed; stats.pending += measured.pending;
        } else if (page.collection === 'pending') stats.pendingRows += measured.rows;
        else stats.networkRows += measured.rows;
      }
    } else {
      if ((mode.externalized !== undefined && mode.externalized !== false) || (mode.reportPages && mode.reportPages.length)) throw executionError('PAGE_REF_INVALID');
      stats = inlineStats(mode);
    }
    if (stats.passed !== c.checksPassed || stats.failed !== c.checksFailed || stats.pending !== c.checksPending || stats.networkRows !== c.requestsObserved) throw executionError('RESULT_COUNTS_MISMATCH', 409);
    if (!mode.executionPerformed && (c.actionsExecuted || c.checkpointsReached || c.requestsObserved || c.fixturesConsumed)) throw executionError('EXECUTION_CLAIM_INVALID');
    const eligiblePass = mode.executionPerformed && c.checksPassed > 0 && !c.checksFailed && !c.checksPending && !stats.pendingRows
      && c.actionsExecuted === c.actionsPlanned && c.checkpointsReached === c.checkpointsPlanned;
    if (mode.status === 'PASSED' && !eligiblePass) throw executionError('PASS_GATE_INVALID', 409);
    if (mode.status === 'FAILED' && !c.checksFailed) throw executionError('FAIL_GATE_INVALID', 409);
    if (c.checksFailed && mode.status === 'PASSED') throw executionError('PASS_GATE_INVALID', 409);
    anyExecuted ||= mode.executionPerformed;
    failed ||= c.checksFailed > 0 || mode.status === 'FAILED';
    incomplete ||= mode.status !== 'PASSED' || !eligiblePass;
  }
  if (result.executionPerformed !== anyExecuted) throw executionError('EXECUTION_CLAIM_INVALID');
  return failed ? 'FAILED' : incomplete ? 'INCOMPLETE' : 'PASSED';
}

function xml(value) { return String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); }
/** Two testcases per observation are present even before execution starts. A
 * pending batch is an error report, never an empty green JUnit test suite. */
export function junitReport(batch) {
  const cases = []; let failures = 0, errors = 0;
  for (const item of batch.items) for (const modeName of ['UI_REPLAY', 'UI_LIVE']) {
    const mode = item.result?.modes?.find(m => m.mode === modeName);
    const passed = batch.status !== 'CANCELLED' && item.status === 'COMPLETED' && mode?.status === 'PASSED';
    let outcome = '';
    if (!passed) {
      const failed = mode?.counts?.checksFailed > 0;
      if (failed) failures++; else errors++;
      const tag = failed ? 'failure' : 'error';
      const reason = item.errorCode || mode?.reasonCodes?.join(', ') || (batch.status === 'CANCELLED' ? 'UI_EXECUTION_CANCELLED' : 'UI_EXECUTION_INCOMPLETE');
      outcome = `<${tag} type="${failed ? 'assertion' : 'incomplete'}" message="${xml(reason)}">${xml(JSON.stringify(mode?.counts ?? {}))}</${tag}>`;
    }
    cases.push(`<testcase classname="${xml(item.captureId)}" name="${xml(modeName + ' ' + item.testDesignVersionId)}">${outcome}<system-out>${xml(JSON.stringify({ itemId: item.itemId, status: mode?.status ?? item.status, counts: mode?.counts ?? null, reportPages: mode?.reportPages ?? [] }))}</system-out></testcase>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><testsuites><testsuite name="QAgent UI ${xml(batch.batchId)}" tests="${cases.length}" failures="${failures}" errors="${errors}" skipped="0">${cases.join('')}</testsuite></testsuites>`;
}

import { requireConsoleTenant } from '../services/tenantContextService.js';
import { projectExecutionProfiles } from '../services/uiExecutionProjectProfiles.js';
import { getProjectEnvironment } from '../services/environmentService.js';
import { getOrganizationById } from '../repositories/organizationRepository.js';
import { UiExecutionRepository } from '../repositories/uiExecutionRepository.js';
import { requestUiDesignService, uiScopeQuery, assertUiCompilation, assertUiVersionReceipt, assertUiDesignPage, assertUiSource, uiSourceRequest } from '../services/uiTestDesignClient.js';
import { EXECUTION_LEASE_MS, RESULT_MAX_BYTES, EVIDENCE_MAX_BYTES, canonical, hashBytes, executionError, executionId, scopeValues, sameScope,
  object, textValue, isHash, machineAuthority, executionProfiles, readJson, readBytes } from '../services/uiExecutionContract.js';
import { executionBucket, putJson, getJson, objectPrefix, executionSourceRequest } from '../services/uiExecutionStorage.js';
import { enqueueUiWake, hostingState } from '../services/uiRunnerDispatch.js';
import { ndjsonStats, validatePairResult, assertUniquePageChecks, junitReport } from '../services/uiExecutionResults.js';

export const uiExecutionDependencies = overrides => ({ tenant: requireConsoleTenant, environment: getProjectEnvironment, organization: getOrganizationById,
  request: requestUiDesignService, source: uiSourceRequest, executionSource: executionSourceRequest, now: Date.now, ...overrides });
const json = (data, status = 200) => new Response(JSON.stringify({ status: 'ok', data }), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' } });
async function mapBounded(values, operation) {
  const output = new Array(values.length); let position = 0;
  const settled = await Promise.allSettled(Array.from({ length: Math.min(4, values.length) }, async () => {
    while (position < values.length) { const index = position++; output[index] = await operation(values[index], index); }
  }));
  const rejected = settled.find(row => row.status === 'rejected'); if (rejected) throw rejected.reason;
  return output;
}
export async function uiExecutionAuthority(req, env, params, deps) {
  executionId(params.projectId); executionId(params.environmentId);
  const permission = req.method === 'GET' ? 'read' : params.action === 'cancel' || (params.resource === 'batches' && !params.batchId) ? 'create' : 'execute';
  let authorized;
  if (params.surface === 'automation') {
    authorized = await machineAuthority(req, env, params, permission);
    const org = await deps.organization(env, authorized.scope.organizationId);
    if (!org || org.status !== 'active') throw executionError('ORGANIZATION_UNAVAILABLE', 403);
  } else {
    if (permission === 'execute') throw executionError('MACHINE_AUTH_REQUIRED', 403);
    const tenant = await deps.tenant(req, env);
    if (permission !== 'read' && !['owner', 'admin', 'member'].includes(tenant.organizationRole)) throw executionError('READ_ONLY', 403);
    authorized = { scope: { organizationId: executionId(tenant.organizationId), projectId: params.projectId, environmentId: params.environmentId }, actor: tenant.user?.userId ?? null };
  }
  await deps.environment(env, ...scopeValues(authorized.scope));
  return authorized;
}
function sameSource(actual, expected, scope) {
  assertUiSource(actual, scope, expected.bundleVersionId);
  if (canonical(actual) !== canonical(expected)) throw executionError('SOURCE_MISMATCH', 409);
}
async function loadDesign(env, scope, versionId, deps, activeSource = true) {
  executionId(versionId);
  const value = await deps.request({ env, service: 'registry', scope,
    path: `/v1/test-registry/ui-test-designs/versions/${encodeURIComponent(versionId)}?${uiScopeQuery(scope)}` });
  await assertUiCompilation(value?.compilation, scope);
  assertUiVersionReceipt(value, value.compilation.specificationHash);
  if (value.testDesignVersionId !== versionId || value.compilation.outcome !== 'COMPILED') throw executionError('REGISTRY_VERSION_MISMATCH', 502);
  sameSource(value.source, value.compilation.source, scope);
  if (activeSource) {
    const receipt = await deps.source(env, scope, value.source.bundleVersionId, value.source.manifestHash);
    sameSource(receipt?.source, value.source, scope);
  }
  return { testDesignId: value.testDesignId, testDesignVersionId: value.testDesignVersionId, version: value.version,
    contentHash: value.contentHash, source: value.source, compilation: value.compilation };
}
async function inventory(env, scope, deps) {
  let cursor = null; const visited = new Set(), latest = new Map();
  do {
    const query = uiScopeQuery({ organizationId: scope.organizationId, environmentId: scope.environmentId }, { limit: 50, ...(cursor ? { cursor } : {}) });
    const page = assertUiDesignPage(await deps.request({ env, service: 'registry', scope, path: `/v1/test-registry/projects/${encodeURIComponent(scope.projectId)}/ui-test-designs?${query}` }), scope);
    for (const value of page.items) {
      const previous = latest.get(value.testDesignId);
      if (!previous || previous.version < value.version) latest.set(value.testDesignId, value);
      else if (previous.version === value.version && previous.testDesignVersionId !== value.testDesignVersionId) throw executionError('REGISTRY_VERSION_CONFLICT', 502);
    }
    cursor = page.nextCursor;
    if (cursor !== null) { if (!cursor || visited.has(cursor)) throw executionError('INVENTORY_CURSOR_CYCLE', 502); visited.add(cursor); }
  } while (cursor !== null);
  const items = await mapBounded([...latest.values()].sort((a, b) => a.testDesignId.localeCompare(b.testDesignId)), async summary => {
    try {
      const design = await loadDesign(env, scope, summary.testDesignVersionId, deps);
      const contractVersion = design.compilation.specification.contractVersion, executable = contractVersion === 'qagent.ui-test-design.v2';
      return { ...summary, contractVersion, executable, diagnostics: executable ? [] : ['UI_EXECUTION_LEGACY_DESIGN_UNSUPPORTED'] };
    } catch (error) {
      // Revoked/expired/legacy sources are visible as unavailable, but transient
      // transport errors cannot masquerade as a complete executable inventory.
      if (![404, 409, 410, 422].includes(error.status)) throw error;
      return { ...summary, executable: false, diagnostics: [error.code || 'UI_EXECUTION_SOURCE_UNAVAILABLE'] };
    }
  });
  return { items, inventoryComplete: true };
}
function batchSummary(row, items) {
  const counts = { total: row.item_count, queued: 0, running: 0, completed: 0, error: 0, cancelled: 0, passed: 0, failed: 0, incomplete: 0 };
  for (const item of items) {
    counts[item.status.toLowerCase()]++;
    counts[item.gate === 'PASSED' ? 'passed' : item.gate === 'FAILED' ? 'failed' : 'incomplete']++;
  }
  if (items.length !== row.item_count) throw executionError('BATCH_RECONCILIATION_REQUIRED', 503);
  const status = row.cancel_requested ? 'CANCELLED' : counts.queued === counts.total ? 'QUEUED' : counts.queued || counts.running ? 'RUNNING' : 'COMPLETED';
  const gate = counts.failed ? 'FAILED' : status === 'COMPLETED' && counts.passed === counts.total ? 'PASSED' : 'INCOMPLETE';
  return { contractVersion: 'qagent.ui-execution-batch.v1', batchId: row.batch_id,
    scope: { organizationId: row.organization_id, projectId: row.project_id, environmentId: row.environment_id }, status, gate,
    itemCount: row.item_count, profileId: row.profile_id, targetBuildRef: row.target_build_ref,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(Math.max(row.updated_at, ...items.map(item => item.updated_at))).toISOString(), counts };
}
async function requireBatch(repo, scope, id) {
  executionId(id); const row = await repo.batch(scope, id); if (!row) throw executionError('BATCH_NOT_FOUND', 404); return row;
}
export async function uiExecutionDetail(env, repo, scope, id, now) {
  const row = await requireBatch(repo, scope, id); await repo.sweep(scope, now, id);
  const rows = await repo.items(scope, id), summary = batchSummary(row, rows);
  return { ...summary, hosting: await hostingState(env, scope, id), items: await mapBounded(rows, async item => {
    const result = item.result_key ? await getJson(env, item.result_key, item.result_hash, RESULT_MAX_BYTES) : null;
    const evidence = (await repo.evidenceList(scope, id, item.item_id)).map(row => ({ evidenceId: row.evidence_id, sha256: row.sha256, byteLength: row.byte_length, contentType: row.content_type, ...(row.page_stats_json ? JSON.parse(row.page_stats_json).labels ?? {} : {}) }));
    return { itemId: item.item_id, ordinal: item.ordinal, captureId: item.capture_id, testDesignId: item.test_design_id,
      testDesignVersionId: item.test_design_version_id, version: item.version, source: JSON.parse(item.source_json),
      bundleVersionId: JSON.parse(item.source_json).bundleVersionId, status: item.status, result,
      evidence, partialEvidence: result === null && evidence.length > 0, errorCode: item.error_code };
  }) };
}
async function frozenDesign(env, item, scope) {
  const design = await getJson(env, item.design_key, item.design_hash);
  await assertUiCompilation(design.compilation, scope); assertUiVersionReceipt({ ...design, domain: 'UI' }, design.compilation.specificationHash);
  if (design.testDesignVersionId !== item.test_design_version_id || design.testDesignId !== item.test_design_id || design.version !== item.version) throw executionError('SNAPSHOT_MISMATCH', 503);
  sameSource(design.source, JSON.parse(item.source_json), scope);
  return design;
}
async function requireClaim(repo, scope, batchId, itemId, claimToken, now, { completed = false } = {}) {
  executionId(itemId); executionId(claimToken);
  const item = await repo.item(scope, batchId, itemId), tokenHash = await hashBytes(claimToken);
  if (!item) throw executionError('ITEM_NOT_FOUND', 404);
  if (item.claim_token_hash !== tokenHash || !(item.status === 'RUNNING' && item.lease_expires_at > now || completed && item.status === 'COMPLETED')) throw executionError('STALE_CLAIM', 409);
  return { item, tokenHash };
}
export function normalizeUiExecutionAdmission(raw) {
  const input = object(raw, ['operationId', 'testDesignVersionIds', 'profileId', 'targetBuildRef', 'trigger'], ['operationId', 'testDesignVersionIds', 'profileId', 'targetBuildRef']);
  executionId(input.operationId); executionId(input.profileId); textValue(input.targetBuildRef, 512);
  if (!Array.isArray(input.testDesignVersionIds) || !input.testDesignVersionIds.length || new Set(input.testDesignVersionIds).size !== input.testDesignVersionIds.length) throw executionError('DESIGN_SELECTION_INVALID');
  input.testDesignVersionIds.forEach(executionId);
  if (input.trigger !== undefined) {
    object(input.trigger, ['kind', 'provider', 'commitSha', 'branch', 'pipelineRunId'], ['kind']);
    if (input.trigger.kind !== 'CI') throw executionError('TRIGGER_INVALID');
    for (const [key, value] of Object.entries(input.trigger)) textValue(value, key === 'branch' ? 512 : 160);
  }
  return input;
}
export async function createUiExecutionBatch(env, scope, actor, raw, injected = {}) {
  const deps = uiExecutionDependencies(injected), repo = new UiExecutionRepository(env);
  executionBucket(env);
  const input = normalizeUiExecutionAdmission(raw);
  const requestHash = await hashBytes(canonical(input)), previous = await repo.byOperation(scope, input.operationId);
  if (previous) {
    if (previous.request_hash !== requestHash) throw executionError('IDEMPOTENCY_CONFLICT', 409);
    await enqueueUiWake(env, scope, previous.batch_id, deps);
    return { ...await uiExecutionDetail(env, repo, scope, previous.batch_id, deps.now()), reused: true };
  }
  const profile = (await (deps.profiles ?? projectExecutionProfiles)(env, scope)).find(value => value.profileId === input.profileId);
  if (!profile) throw executionError('PROFILE_NOT_FOUND', 404);
  const id = 'uieb_' + await hashBytes(canonical({ scope, operationId: input.operationId }));
  const prefix = objectPrefix(scope) + '/' + id;
  const designs = await mapBounded(input.testDesignVersionIds, async (versionId, ordinal) => {
    const design = await loadDesign(env, scope, versionId, deps);
    if (design.compilation.specification.contractVersion !== 'qagent.ui-test-design.v2') throw executionError('LEGACY_DESIGN_UNSUPPORTED', 422);
    const stored = await putJson(env, prefix + '/designs', design);
    return { ...design, ordinal, id: 'uiei_' + await hashBytes(id + '\n' + versionId), designKey: stored.key, designHash: stored.hash };
  });
  const snapshot = await putJson(env, prefix + '/snapshot', { scope, ...input, profile });
  const row = await repo.insert(scope, { id, ...input, requestHash, snapshotKey: snapshot.key, snapshotHash: snapshot.hash, now: deps.now(), actor }, designs);
  await enqueueUiWake(env, scope, row.batch_id, deps);
  return { ...await uiExecutionDetail(env, repo, scope, row.batch_id, deps.now()), reused: false };
}
function pagination(url) {
  const limit = url.searchParams.get('limit') ?? '20';
  if (!/^\d{1,2}$/.test(limit) || Number(limit) < 1 || Number(limit) > 50) throw executionError('PAGINATION_INVALID');
  let cursor = null;
  if (url.searchParams.has('cursor')) {
    try { const encoded = url.searchParams.get('cursor'); if (encoded.length > 512) throw new Error(); cursor = JSON.parse(atob(encoded));
      object(cursor, ['at', 'id']); if (!Number.isSafeInteger(cursor.at) || cursor.at < 0) throw new Error(); executionId(cursor.id);
    } catch { throw executionError('PAGINATION_INVALID'); }
  }
  return { limit: Number(limit), cursor };
}
/** Independent UI control plane. No endpoint enters the existing API runner. */
export async function uiExecutions(req, env, params, injected = {}) {
  const deps = uiExecutionDependencies(injected), { scope, actor } = await uiExecutionAuthority(req, env, params, deps);
  const { resource, batchId, itemId, action, artifactId, evidenceId } = params, url = new URL(req.url);
  if (resource === 'profiles') return json({ items: await (deps.profiles ?? projectExecutionProfiles)(env, scope) });
  if (resource === 'inventory') return json(await inventory(env, scope, deps));
  const repo = new UiExecutionRepository(env);
  if (!batchId && req.method === 'POST') { const result = await createUiExecutionBatch(env, scope, actor, await readJson(req), deps); return json(result, result.reused ? 200 : 202); }
  if (!batchId) {
    const { limit, cursor } = pagination(url); await repo.sweep(scope, deps.now());
    const rows = await repo.list(scope, limit, cursor), chosen = rows.slice(0, limit);
    return json({ items: await mapBounded(chosen, async row => batchSummary(row, await repo.items(scope, row.batch_id))),
      nextCursor: rows.length > limit ? btoa(JSON.stringify({ at: chosen.at(-1).created_at, id: chosen.at(-1).batch_id })) : null });
  }
  const batch = await requireBatch(repo, scope, batchId); await repo.sweep(scope, deps.now(), batchId);
  if (!action) return json(await uiExecutionDetail(env, repo, scope, batchId, deps.now()));
  if (action === 'cancel') {
    object(await readJson(req, 1024), []); await repo.cancel(scope, batchId, deps.now());
    return json(await uiExecutionDetail(env, repo, scope, batchId, deps.now()));
  }
  if (action === 'report') {
    const format = url.searchParams.get('format') ?? 'json'; if (!['json', 'junit'].includes(format)) throw executionError('REPORT_FORMAT_INVALID');
    const report = await uiExecutionDetail(env, repo, scope, batchId, deps.now());
    // References are route-local and authenticated; R2 keys and signed URLs are
    // never published. JSON/NDJSON pages conserve the complete result ledger.
    for (const item of report.items) if (item.result) for (const ref of item.result.evidence) {
      ref.downloadPath = url.pathname.replace(/\/report$/, '') + `/items/${item.itemId}/evidence/${ref.evidenceId}`;
    }
    return new Response(format === 'junit' ? junitReport(report) : JSON.stringify(report), { headers: {
      'Content-Type': format === 'junit' ? 'application/xml; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${batchId}.${format === 'junit' ? 'xml' : 'json'}"`, 'Cache-Control': 'private, no-store' } });
  }
  if (action === 'claim') {
    const input = object(await readJson(req, 1024), ['workerId']); executionId(input.workerId);
    const claimToken = 'uiclaim_' + crypto.randomUUID() + '_' + crypto.randomUUID(), tokenHash = await hashBytes(claimToken);
    const item = await repo.claim(scope, batchId, input.workerId, tokenHash, deps.now(), EXECUTION_LEASE_MS);
    if (!item) return json({ claim: null });
    try {
      const [snapshot, design] = await Promise.all([getJson(env, batch.snapshot_key, batch.snapshot_hash), frozenDesign(env, item, scope)]);
      if (!sameScope(snapshot.scope, scope)) throw executionError('SNAPSHOT_MISMATCH', 503);
      return json({ claim: { contractVersion: 'qagent.ui-execution-claim.v1', batchId, itemId: item.item_id, claimToken,
        leaseExpiresAt: item.lease_expires_at, scope, profile: snapshot.profile, targetBuildRef: snapshot.targetBuildRef,
        design: { testDesignVersionId: design.testDesignVersionId, version: design.version, compilation: design.compilation }, cancelRequested: false } });
    } catch (error) { await repo.failClaim(scope, batchId, item.item_id, tokenHash, 'UI_EXECUTION_CLAIM_PREPARATION_FAILED', deps.now()); throw error; }
  }
  if (action === 'evidence' && req.method === 'GET') {
    executionId(itemId); executionId(evidenceId);
    const row = await repo.evidence(scope, batchId, itemId, evidenceId);
    if (!row) throw executionError('EVIDENCE_NOT_FOUND', 404);
    const stored = await executionBucket(env).get(row.object_key); if (!stored) throw executionError('EVIDENCE_UNAVAILABLE', 503);
    // An untrusted HTML/SVG attachment cannot become executable Console origin
    // content, even if opened directly instead of downloaded by the UI.
    return new Response(stored.body, { headers: { 'Content-Type': row.content_type, 'Content-Length': String(row.byte_length),
      'Content-Disposition': `attachment; filename="${evidenceId}"`, 'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'X-QAgent-SHA256': row.sha256 } });
  }
  if (action === 'evidence') {
    executionId(evidenceId);
    const { item, tokenHash } = await requireClaim(repo, scope, batchId, itemId, req.headers.get('X-QAgent-Claim-Token'), deps.now(), { completed: true });
    const hash = req.headers.get('X-QAgent-SHA256'), type = req.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!isHash(hash) || !type || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type)) throw executionError('EVIDENCE_METADATA_INVALID');
    const labels = {}, mode = req.headers.get('X-QAgent-Evidence-Mode'), kind = req.headers.get('X-QAgent-Evidence-Kind');
    if (mode !== null) { if (!['UI_REPLAY', 'UI_LIVE'].includes(mode)) throw executionError('EVIDENCE_METADATA_INVALID'); labels.mode = mode; }
    if (kind !== null) { if (!/^[A-Z0-9_]{1,128}$/.test(kind)) throw executionError('EVIDENCE_METADATA_INVALID'); labels.kind = kind; }
    const bytes = await readBytes(req, EVIDENCE_MAX_BYTES); if (await hashBytes(bytes) !== hash) throw executionError('EVIDENCE_HASH_MISMATCH', 409);
    const existing = await repo.evidence(scope, batchId, itemId, evidenceId);
    const matching = row => row && row.claim_token_hash === tokenHash && row.sha256 === hash && row.byte_length === bytes.length && row.content_type === type && canonical(row.page_stats_json ? JSON.parse(row.page_stats_json).labels ?? {} : {}) === canonical(labels);
    if (existing && !matching(existing)) throw executionError('EVIDENCE_CONFLICT', 409);
    if (!existing) {
      if (item.status !== 'RUNNING') throw executionError('STALE_CLAIM', 409);
      const stats = type === 'application/x-ndjson' ? ndjsonStats(bytes) : Object.keys(labels).length ? {} : null;
      if (stats && Object.keys(labels).length) stats.labels = labels;
      const key = objectPrefix(scope) + '/' + batchId + '/' + itemId + '/evidence/' + evidenceId + '/' + hash;
      await executionBucket(env).put(key, bytes, { httpMetadata: { contentType: type }, customMetadata: { sha256: hash } });
      const published = await repo.recordEvidence(scope, item, tokenHash, { id: evidenceId, key, hash, size: bytes.length, type, stats }, deps.now());
      if (!matching(published)) throw executionError(published ? 'EVIDENCE_CONFLICT' : 'STALE_CLAIM', 409);
    }
    return json({ evidenceId, sha256: hash, byteLength: bytes.length, contentType: type });
  }
  const input = object(await readJson(req, action === 'result' ? RESULT_MAX_BYTES : 1024), action === 'result' ? ['claimToken', 'result'] : ['claimToken']);
  const { item, tokenHash } = await requireClaim(repo, scope, batchId, itemId, input.claimToken, deps.now(), { completed: action === 'result' });
  if (action === 'heartbeat') {
    const extended = await repo.heartbeat(scope, batchId, itemId, tokenHash, deps.now(), EXECUTION_LEASE_MS);
    if (!extended) throw executionError('STALE_CLAIM', 409);
    const current = await repo.batch(scope, batchId);
    return json({ cancelRequested: !!current.cancel_requested, leaseExpiresAt: extended.lease_expires_at });
  }
  if (action === 'source' || action === 'artifacts') {
    if (batch.cancel_requested) throw executionError('CANCELLED', 409);
    if (artifactId) executionId(artifactId);
    const design = await frozenDesign(env, item, scope), output = await deps.executionSource(env, scope, design, artifactId ?? null);
    await requireClaim(repo, scope, batchId, itemId, input.claimToken, deps.now());
    if ((await repo.batch(scope, batchId)).cancel_requested) throw executionError('CANCELLED', 409);
    if (artifactId) return output;
    if (output?.contractVersion !== 'qagent.ui-execution-source.v1' || output.specificationHash !== design.compilation.specificationHash) throw executionError('SOURCE_RESPONSE_INVALID', 502);
    sameSource(output.source, design.source, scope);
    return json(output);
  }
  if (action === 'result') {
    const digest = await hashBytes(canonical(input.result));
    if (item.result_hash) {
      if (item.result_hash !== digest) throw executionError('RESULT_CONFLICT', 409);
      return json(await uiExecutionDetail(env, repo, scope, batchId, deps.now()));
    }
    const design = await frozenDesign(env, item, scope), evidence = await repo.evidenceList(scope, batchId, itemId);
    const gate = validatePairResult(input.result, design, evidence, tokenHash);
    await assertUniquePageChecks(input.result, evidence, async row => {
      const stored = await executionBucket(env).get(row.object_key); if (!stored) throw executionError('EVIDENCE_UNAVAILABLE', 503);
      const bytes = await readBytes(new Response(stored.body), EVIDENCE_MAX_BYTES);
      if (bytes.length !== row.byte_length || await hashBytes(bytes) !== row.sha256) throw executionError('EVIDENCE_HASH_MISMATCH', 409);
      return bytes;
    });
    const stored = await putJson(env, objectPrefix(scope) + '/' + batchId + '/' + itemId + '/results', input.result);
    const completed = await repo.finalize(scope, item, tokenHash, { ...stored, gate }, deps.now());
    if (!completed) {
      const current = await repo.item(scope, batchId, itemId);
      if (current?.claim_token_hash !== tokenHash || current.result_hash !== digest) throw executionError(current?.result_hash ? 'RESULT_CONFLICT' : 'STALE_CLAIM', 409);
    }
    return json(await uiExecutionDetail(env, repo, scope, batchId, deps.now()));
  }
  throw executionError('ROUTE_NOT_FOUND', 404);
}

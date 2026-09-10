/** 08.1.6 FIX-1: metadata-only readiness reads. No runtime decision or artifact mutation. */
export const READINESS_CONTRACT = 'qagent.project-test-readiness.v1';
export const READINESS_DETAIL_CONTRACT = 'qagent.test-readiness-scenarios.v1';
export const READINESS_PROJECTION_VERSION = 'qagent.test-readiness-projection.v1';
export const READINESS_STATES = ['READY', 'NEEDS_DATA', 'REVIEW_REQUIRED', 'NEEDS_AUTH', 'NEEDS_ENVIRONMENT'];
export const GENERATION_CLASSES = ['OBSERVED_BASELINE', 'AI_EXPLORATORY', 'LEGACY'];
export const BASELINE_GAPS = ['RESPONSE_PARTIAL', 'REQUEST_PARTIAL', 'BOTH_PARTIAL', 'OTHER'];
export const BASELINE_BUCKETS = ['READY', 'RESPONSE_PARTIAL', 'REQUEST_PARTIAL', 'BOTH_PARTIAL', 'OTHER', 'REVIEW_REQUIRED', 'NEEDS_AUTH', 'NEEDS_ENVIRONMENT', 'UNKNOWN'];
export class TestReadinessError extends Error {
  constructor(code, message, status = 400) {
    super(message); this.name = 'TestReadinessError'; this.code = code; this.status = status; this.retryable = false;
  }
}
export function readinessError(code, message, status = 400) { return new TestReadinessError(code, message, status); }
const invalid = () => readinessError('TEST_READINESS_QUERY_INVALID', 'Filtros de prontidão inválidos.');
export const isReadinessId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const fields = ['view', 'readiness', 'generationClass', 'baselineGap', 'q', 'method', 'apiServiceKey', 'baselineEnvironmentId', 'limit', 'cursor'];
export function parseTestReadinessQuery(params, { detail = false } = {}) {
  const input = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  const allowed = detail ? [...fields.filter(k => k !== 'view'), 'testDesignVersionId'] : fields;
  for (const k of input.keys()) if (!allowed.includes(k) || input.getAll(k).length !== 1) throw invalid();
  function single(k, max = 200) {
    const v = input.get(k); if (v == null) return '';
    if (v.length > max || /[\u0000-\u001f\u007f]/u.test(v) || !v.trim()) throw invalid();
    return v.trim();
  }
  function values(k, choices) {
    const raw = single(k, 240); if (!raw) return [];
    const list = raw.split(',').map(v => v.trim());
    if (list.length > choices.length || list.some(v => !choices.includes(v))) throw invalid();
    return [...new Set(list)].sort();
  }
  const readiness = values('readiness', READINESS_STATES);
  const generationClass = values('generationClass', GENERATION_CLASSES);
  const baselineGap = single('baselineGap', 40);
  if (baselineGap && (!BASELINE_GAPS.includes(baselineGap) || readiness.length !== 1 || readiness[0] !== 'NEEDS_DATA' || generationClass.length !== 1 || generationClass[0] !== 'OBSERVED_BASELINE')) throw invalid();
  const baselineEnvironmentId = single('baselineEnvironmentId', 160);
  if (baselineEnvironmentId && (!isReadinessId(baselineEnvironmentId) || generationClass.length !== 1 || generationClass[0] !== 'OBSERVED_BASELINE')) throw invalid();
  const apiServiceKey = single('apiServiceKey', 160);
  if (apiServiceKey && !isReadinessId(apiServiceKey)) throw invalid();
  const method = single('method', 16).toUpperCase();
  if (method && !/^[A-Z][A-Z0-9_-]{0,15}$/.test(method)) throw invalid();
  const limitValue = single('limit', 3);
  if (limitValue && !/^[1-9][0-9]*$/.test(limitValue)) throw invalid();
  const limit = limitValue ? Number(limitValue) : detail ? 50 : 25;
  if (limit > 100) throw invalid();
  const cursor = single('cursor', 3000) || null;
  const view = detail ? 'scenarios' : single('view', 16) || 'endpoints';
  if (!detail && !['summary', 'endpoints'].includes(view)) throw invalid();
  if (view === 'summary' && cursor) throw invalid();
  const testDesignVersionId = detail ? single('testDesignVersionId', 160) : null;
  if (detail && !isReadinessId(testDesignVersionId)) throw invalid();
  return { view, filters: { readiness, generationClass, baselineGap: baselineGap || null, q: single('q', 120), method: method || null, apiServiceKey: apiServiceKey || null, baselineEnvironmentId: baselineEnvironmentId || null }, limit, cursor, testDesignVersionId };
}
export function buildTestReadinessQuery(query, { detail = false } = {}) {
  const p = new URLSearchParams(); if (!detail) p.set('view', query.view || 'endpoints');
  for (const k of ['readiness', 'generationClass']) if (query.filters[k]?.length) p.set(k, query.filters[k].join(','));
  for (const k of ['baselineGap', 'q', 'method', 'apiServiceKey', 'baselineEnvironmentId']) if (query.filters[k]) p.set(k, query.filters[k]);
  p.set('limit', String(query.limit)); if (query.cursor) p.set('cursor', query.cursor);
  if (detail) p.set('testDesignVersionId', query.testDesignVersionId);
  return p;
}
export function baselineGapOf(s) {
  if (s.generationClass !== 'OBSERVED_BASELINE' || s.readiness !== 'NEEDS_DATA') return null;
  if (s.requestCoverage === 'PARTIAL' && s.responseCoverage === 'PARTIAL') return 'BOTH_PARTIAL';
  if (s.requestCoverage === 'COMPLETE' && s.responseCoverage === 'PARTIAL') return 'RESPONSE_PARTIAL';
  if (s.requestCoverage === 'PARTIAL' && ['COMPLETE', 'NO_BODY'].includes(s.responseCoverage)) return 'REQUEST_PARTIAL';
  return 'OTHER';
}
export function baselineBucketOf(s) {
  if (s.generationClass !== 'OBSERVED_BASELINE') return null;
  return baselineGapOf(s) || (READINESS_STATES.includes(s.readiness) ? s.readiness : 'UNKNOWN');
}
export function matchesReadiness(s, f) {
  return (!f.readiness.length || f.readiness.includes(s.readiness)) && (!f.generationClass.length || f.generationClass.includes(s.generationClass))
    && (!f.baselineGap || baselineGapOf(s) === f.baselineGap) && (!f.baselineEnvironmentId || s.environmentId === f.baselineEnvironmentId);
}
export async function readinessHash(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** Cursor checksum is integrity checking, not authorization. The authenticated scope is always authoritative. */
export async function encodeReadinessCursor(payload) {
  const body = JSON.stringify(payload);
  const raw = JSON.stringify({ payload, checksum: await readinessHash(body) });
  return btoa(String.fromCharCode(...new TextEncoder().encode(raw))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export async function decodeReadinessCursor(cursor, expected) {
  if (!cursor) return null;
  try {
    if (cursor.length > 3000 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw Error();
    const value = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cursor.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))));
    if (Object.keys(value).sort().join(',') !== 'checksum,payload' || value.checksum !== await readinessHash(JSON.stringify(value.payload))) throw Error();
    const p = value.payload;
    if (Object.keys(p).sort().join(',') !== 'filterHash,kind,last,limit,organizationId,projectId,revision,version,versionId' || p.version !== 1 || !isReadinessId(p.last) || !/^rrev_[a-f0-9]{64}$/.test(p.revision)) throw Error();
    for (const [k, v] of Object.entries(expected)) if (p[k] !== v) throw Error();
    return p;
  } catch { throw readinessError('TEST_READINESS_CURSOR_INVALID', 'Cursor inválido para este projeto ou conjunto de filtros.'); }
}
/** Titles are user/model text. Never emit arbitrary blocker text or raw request data in this read model. */
export function safeReadinessText(value, max = 200) {
  if (typeof value !== 'string') return null;
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[URL]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.:-]+/gi, '[REDACTED]')
    .replace(/\b(?:qag_(?:test|live)_|sk-)[A-Za-z0-9_-]+/gi, '[REDACTED]')
    .replace(/\b(?:password|senha|token|secret|cookie|api[_-]?key|authorization)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .slice(0, max).trim() || null;
}
export function safeReadinessPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > 2048 || /[?#\r\n]/.test(value)) return null;
  return safeReadinessText(value, 2048);
}
export const COVERAGE_REASONS = [
  'REQUEST_QUERY_UNAVAILABLE','REPEATED_QUERY_UNAVAILABLE','REQUEST_BODY_UNAVAILABLE','REQUEST_BODY_TRUNCATED','REQUEST_DATA_UNSAFE_OR_UNSUPPORTED','REQUEST_PATH_UNAVAILABLE','REPEATED_PATH_UNSUPPORTED','REQUEST_LIMIT','BODY_ON_SAFE_METHOD','RESPONSE_UNAVAILABLE','PARTIAL_CAPTURE','UNKNOWN_STRUCTURE','SANITIZED_VALUE','UNSUPPORTED_VALUE','DEPTH_LIMIT','PROPERTY_LIMIT','ARRAY_SAMPLE_LIMIT','SANITIZED_CONTAINER','BODY_TRUNCATED','UNSUPPORTED_PROPERTY','PROFILE_LIMIT','AUTH_CONTEXT_UNAVAILABLE',
];
export const READINESS_BLOCKERS = [
  'OBSERVED_BASELINE_RUNTIME_REQUIRED','OBSERVED_BASELINE_AUTH_REQUIRED','OBSERVED_BASELINE_SOURCE_UNAVAILABLE','OBSERVED_BASELINE_SOURCE_EXPIRED','OBSERVED_BASELINE_REQUEST_INCOMPLETE','OBSERVED_BASELINE_RESPONSE_INCOMPLETE','OBSERVED_BASELINE_SELF_CHECK_FAILED','OBSERVED_BASELINE_SELF_CHECK_INCOMPLETE',
  'AUTH_PROFILE_REQUIRED','AUTH_CONFIGURATION_REQUIRED','RUNTIME_ENVIRONMENT_REQUIRED','API_SERVICE_REQUIRED','TEST_DATA_REQUIRED','REQUEST_DATA_REQUIRED','INSUFFICIENT_EVIDENCE','SCHEMA_EVIDENCE_INCOMPLETE','UNOBSERVED_STATUS','UNOBSERVED_RESPONSE','MUTATION_REVIEW_REQUIRED','MUTATION_EXECUTION_DISABLED',
];
export function safeReasonCodes(value, choices) { return Array.isArray(value) ? [...new Set(value.filter(v => typeof v === 'string' && choices.includes(v)))].slice(0, 24) : []; }

/** Strict allowlists on the service boundary: an upstream cannot smuggle a spec/request into triage. */
export function validateTestReadinessEnvelope(body, scope, { detail = false, query = null } = {}) {
  function assert(ok) { if (!ok) throw readinessError('TEST_READINESS_RESPONSE_INVALID','Resposta de prontidão inválida ou incompatível.',502); }
  const plain = v => v && typeof v === 'object' && !Array.isArray(v);
  const exact = (v, keys) => plain(v) && Object.keys(v).every(k => keys.includes(k));
  const int = v => Number.isSafeInteger(v) && v >= 0;
  const nullableText = (v,max) => v===null || (typeof v==='string'&&v.length<=max);
  const counterMap = (v, keys) => exact(v,keys) && keys.every(k=>int(v[k]));
  assert(body?.status==='ok'); const d=body.data;
  assert(exact(d,detail?
    ['contractVersion','organizationId','projectId','endpointId','testDesignId','testDesignVersionId','testDesignVersion','isLatest','latestTestDesignVersionId','readinessRevision','computedAt','filters','method','path','matchingScenarioCount','page','items']:
    ['contractVersion','organizationId','projectId','view','readinessRevision','computedAt','readinessBasis','filters','projectSummary','filteredSummary','integrity','page','items']));
  assert(d.contractVersion===(detail?READINESS_DETAIL_CONTRACT:READINESS_CONTRACT)&&d.organizationId===scope.organizationId&&d.projectId===scope.projectId);
  assert(/^rrev_[a-f0-9]{64}$/.test(d.readinessRevision)&&typeof d.computedAt==='string'&&d.computedAt.length<=40&&Number.isFinite(Date.parse(d.computedAt)));
  assert(exact(d.filters,['readiness','generationClass','baselineGap','q','method','apiServiceKey','baselineEnvironmentId']));
  if(query)assert(JSON.stringify(d.filters)===JSON.stringify(query.filters));
  assert(exact(d.page,['limit','hasMore','nextCursor'])&&Number.isInteger(d.page.limit)&&d.page.limit>=1&&d.page.limit<=100&&typeof d.page.hasMore==='boolean'&&nullableText(d.page.nextCursor,3000));
  assert(d.page.hasMore?Boolean(d.page.nextCursor):d.page.nextCursor===null);
  if(query)assert(d.page.limit===query.limit);
  assert(Array.isArray(d.items)&&d.items.length<=d.page.limit);
  if(detail){
    assert(d.matchingScenarioCount>=d.items.length);
    assert(d.endpointId===scope.endpointId&&d.testDesignVersionId===scope.testDesignVersionId&&isReadinessId(d.testDesignId)&&Number.isInteger(d.testDesignVersion)&&d.testDesignVersion>=1&&isReadinessId(d.latestTestDesignVersionId)&&typeof d.isLatest==='boolean'&&int(d.matchingScenarioCount));
    assert(nullableText(d.method,16)&&nullableText(d.path,2048)&&d.isLatest===(d.testDesignVersionId===d.latestTestDesignVersionId));
    for(const s of d.items){
      assert(exact(s,['scenarioId','title','generationClass','readiness','baselineGap','baseline','blockers','requestReasons','responseReasons','diagnosticsOmitted','detailAvailable','sourceExpired','navigationAction']));
      assert(isReadinessId(s.scenarioId)&&nullableText(s.title,200)&&GENERATION_CLASSES.concat('UNKNOWN').includes(s.generationClass)&&READINESS_STATES.concat('UNKNOWN').includes(s.readiness));
      assert(s.baselineGap===null||BASELINE_GAPS.includes(s.baselineGap));
      for(const [k,choices] of [['blockers',READINESS_BLOCKERS],['requestReasons',COVERAGE_REASONS],['responseReasons',COVERAGE_REASONS]])assert(Array.isArray(s[k])&&s[k].length<=24&&s[k].every(v=>choices.includes(v)));
      for(const k of ['diagnosticsOmitted','detailAvailable','sourceExpired'])assert(typeof s[k]==='boolean');
      assert(s.navigationAction==='OPEN_TEST_DESIGN');
      if(s.baseline!==null){
        const b=s.baseline;
        assert(s.generationClass==='OBSERVED_BASELINE'&&exact(b,['baselineId','environmentId','sourceEventId','sourceEvidenceId','observationSessionId','observedAt','expiresAt','schemaVersionId','schemaHash','comparisonMode','requestCoverage','responseCoverage','selfCheck']));
        for(const k of ['baselineId','environmentId','sourceEventId','sourceEvidenceId','observationSessionId','schemaVersionId','schemaHash'])assert(b[k]===null||isReadinessId(b[k]));
        for(const k of ['observedAt','expiresAt'])assert(b[k]===null||(typeof b[k]==='string'&&b[k].length<=40&&Number.isFinite(Date.parse(b[k]))));
        assert(b.comparisonMode===null||['STRUCTURE','CONTROLLED_STATE'].includes(b.comparisonMode));
        assert(b.requestCoverage===null||['COMPLETE','PARTIAL'].includes(b.requestCoverage));
        assert(b.responseCoverage===null||['COMPLETE','PARTIAL','NO_BODY'].includes(b.responseCoverage));
        assert(b.selfCheck===null||['PASSED','PARTIAL','FAILED','NO_BODY'].includes(b.selfCheck));
      }
    }
    assert(new Set(d.items.map(s=>s.scenarioId)).size===d.items.length);
  }else{
    assert(['summary','endpoints'].includes(d.view)&&(!query||d.view===query.view)&&d.readinessBasis==='LATEST_PERSISTED_TEST_DESIGN');
    const summaryFields=['testDesignCount','scenarioCount','observedBaselineScenarioCount','aiExploratoryScenarioCount','legacyScenarioCount','readyScenarioCount','needsDataScenarioCount','reviewRequiredScenarioCount','needsAuthScenarioCount','needsEnvironmentScenarioCount','unknownReadinessScenarioCount','unknownOriginScenarioCount','pendingScenarioCount','executionEligibleScenarioCount','policyBlockedReadyScenarioCount'];
    const p=d.projectSummary;assert(exact(p,[...summaryFields,'eligibilityPolicyVersion','eligibilityBasis','baselineBuckets'])&&summaryFields.every(k=>int(p[k])));
    assert(p.eligibilityPolicyVersion==='qagent.suite-execution-eligibility.v1'&&p.eligibilityBasis==='INVENTORY_POLICY_NOT_RUNTIME_AUTHORIZATION');
    assert(p.scenarioCount===p.observedBaselineScenarioCount+p.aiExploratoryScenarioCount+p.legacyScenarioCount+p.unknownOriginScenarioCount);
    assert(p.scenarioCount===p.readyScenarioCount+p.pendingScenarioCount+p.unknownReadinessScenarioCount);
    assert(p.pendingScenarioCount===p.needsDataScenarioCount+p.reviewRequiredScenarioCount+p.needsAuthScenarioCount+p.needsEnvironmentScenarioCount);
    assert(p.readyScenarioCount===p.executionEligibleScenarioCount+p.policyBlockedReadyScenarioCount);
    assert(Array.isArray(p.baselineBuckets)&&p.baselineBuckets.length===BASELINE_BUCKETS.length);
    for(const b of p.baselineBuckets){
      assert(exact(b,['key','readiness','baselineGap','scenarioCount','endpointCount','requestCoverageCounts','responseCoverageCounts','selfCheckCounts'])&&BASELINE_BUCKETS.includes(b.key)&&int(b.scenarioCount)&&int(b.endpointCount)&&b.endpointCount<=b.scenarioCount);
      assert(b.readiness===(BASELINE_GAPS.includes(b.key)?'NEEDS_DATA':b.key)&&b.baselineGap===(BASELINE_GAPS.includes(b.key)?b.key:null));
      assert(counterMap(b.requestCoverageCounts,['COMPLETE','PARTIAL','UNKNOWN'])&&counterMap(b.responseCoverageCounts,['COMPLETE','PARTIAL','NO_BODY','UNKNOWN'])&&counterMap(b.selfCheckCounts,['PASSED','PARTIAL','FAILED','NO_BODY','UNKNOWN']));
      for(const k of ['requestCoverageCounts','responseCoverageCounts','selfCheckCounts'])assert(Object.values(b[k]).reduce((a,v)=>a+v,0)===b.scenarioCount);
    }
    assert(new Set(p.baselineBuckets.map(b=>b.key)).size===BASELINE_BUCKETS.length&&p.baselineBuckets.reduce((a,b)=>a+b.scenarioCount,0)===p.observedBaselineScenarioCount);
    assert(exact(d.filteredSummary,['matchingEndpointCount','matchingScenarioCount','readinessCounts'])&&int(d.filteredSummary.matchingEndpointCount)&&int(d.filteredSummary.matchingScenarioCount)&&counterMap(d.filteredSummary.readinessCounts,READINESS_STATES.concat('UNKNOWN')));
    assert(Object.values(d.filteredSummary.readinessCounts).reduce((a,v)=>a+v,0)===d.filteredSummary.matchingScenarioCount);
    assert(d.filteredSummary.matchingScenarioCount<=p.scenarioCount&&d.filteredSummary.matchingEndpointCount<=p.testDesignCount);
    assert(exact(d.integrity,['fallbackVersionCount','unknownReadinessScenarioCount','unknownOriginScenarioCount','incompleteBaselineMetadataCount'])&&Object.values(d.integrity).every(int));
    if(d.view==='summary')assert(d.items.length===0&&!d.page.hasMore);
    for(const r of d.items){
      assert(exact(r,['endpointId','method','path','apiServiceKey','testDesignId','testDesignVersionId','testDesignVersion','title','createdAt','matchingScenarioCount','matchingScenarioIds','scenarioPreviewTruncated','matchedReadinessCounts','matchedOriginCounts','coverageSignals']));
      assert([r.endpointId,r.testDesignId,r.testDesignVersionId].every(isReadinessId)&&Number.isInteger(r.testDesignVersion)&&r.testDesignVersion>=1&&nullableText(r.title,200)&&nullableText(r.method,16)&&nullableText(r.path,2048)&&nullableText(r.apiServiceKey,160));
      assert(int(r.matchingScenarioCount)&&Array.isArray(r.matchingScenarioIds)&&r.matchingScenarioIds.length<=5&&r.matchingScenarioIds.every(isReadinessId)&&typeof r.scenarioPreviewTruncated==='boolean');
      assert(counterMap(r.matchedReadinessCounts,READINESS_STATES.concat('UNKNOWN'))&&counterMap(r.matchedOriginCounts,GENERATION_CLASSES.concat('UNKNOWN')));
      assert(r.matchingScenarioCount>0&&r.matchingScenarioIds.length===Math.min(r.matchingScenarioCount,5)&&new Set(r.matchingScenarioIds).size===r.matchingScenarioIds.length&&r.scenarioPreviewTruncated===(r.matchingScenarioCount>5));
      assert(Object.values(r.matchedReadinessCounts).reduce((a,v)=>a+v,0)===r.matchingScenarioCount&&Object.values(r.matchedOriginCounts).reduce((a,v)=>a+v,0)===r.matchingScenarioCount);
      assert(Array.isArray(r.coverageSignals)&&r.coverageSignals.length<=4&&r.coverageSignals.every(v=>BASELINE_GAPS.includes(v)));
    }
    assert(new Set(d.items.map(r=>r.endpointId)).size===d.items.length);
  }
  return d;
}

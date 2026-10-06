/** 08.1.7-C-FIX-2: isolated, evidence-backed STATUS addition.
 * This module does not execute requests, infer credentials or choose a default
 * status. It is identical at the three existing trust boundaries. Older numeric
 * / pagination proofs retain coverageAssertions.js and their original meaning.
 */
import { assertionCoverageGaps } from './coverageAssertions.js';
import { negativePreparationGate } from './negativeRequestStrategy.js';
import { validateScenarioReadinessV2 } from './readiness/scenarioReadinessV2.js';
import { collectScenarioReadinessIssues } from './readiness/scenarioReadinessFacts.js';

export const STATUS_COVERAGE_CONTRACT = 'qagent.status-coverage-extension.v1';
const plain = v => v && typeof v === 'object' && !Array.isArray(v);
const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const authName = n => /^(authorization|proxy-authorization|cookie|x-api-key|api-key|dolapikey|x-auth-token)$/i.test(n || '');
const reject = code => { throw Object.assign(new Error('A extensão de STATUS requer evidência positiva compatível e revisão.'), { code, status: 409 }); };
const successStatus = n => Number.isInteger(n) && n >= 200 && n < 300 && ![204, 205, 206].includes(n);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const jsonContentType = v => typeof v === 'string' && /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json$/i.test(v.split(';')[0].trim());

export function isStatusCoverageProof(proof) {
  return proof?.statusCoverageContractVersion === STATUS_COVERAGE_CONTRACT;
}

/** Diagnostic only. This does not authorize a proposal or an execution. */
export function missingStatusCoverageGap(scenario) {
  const assertions = scenario?.spec?.assertions;
  return Array.isArray(assertions) && assertions.length && !assertions.some(a => a?.type === 'STATUS')
    ? { kind: 'STATUS', code: 'ASSERTION_STATUS_REQUIRED' } : null;
}

/** Bounded positive contract scope. Other objectives retain their existing paths.
 * Narrative can veto an ambiguous/negative case, never authorize a status value.
 * The later execution check requires every original assertion to have passed.
 */
export function assertStatusCoverageSource(source) {
  if (!source || source.baseline != null || source.generationClass === 'OBSERVED_BASELINE') reject('LEARNING_STATUS_BASELINE_PROTECTED');
  const spec = source.spec || {};
  if (!['GET','HEAD','OPTIONS'].includes(spec.target?.method)) reject('LEARNING_MUTATION_NOT_ALLOWED');
  if (spec.dslVersion !== 'qagent.api-test-dsl.v1' || spec.type !== 'api') reject('LEARNING_STATUS_SOURCE_UNSUPPORTED');
  if (!missingStatusCoverageGap(source)) reject('LEARNING_STATUS_ALREADY_PRESENT');
  if (source.learning || source.requestManagement?.phase === 'PENDING_VERIFICATION' || source.scenarioLifecycle?.kind === 'SCENARIO_CLONE') reject('LEARNING_STATUS_DERIVATION_PENDING');
  if (!['HAPPY_PATH','SCHEMA_CONTRACT'].includes(source.category) || spec.negativeStrategy != null
      || !['REQUIRED','NONE'].includes(spec.auth?.requirement)) reject('LEARNING_STATUS_INTENT_UNSUPPORTED');
  const intent = normalize(`${source.title || ''} ${source.objective || ''}`);
  if (/\b(?:sem|without|missing|absent|absence|empty|invalid\w*|inexist\w*|vazi[oa]\w*|ausen\w*|negativ\w*|erro\w*|error\w*|falha\w*|fault\w*|timeout|expir\w*)\b/.test(intent)) reject('LEARNING_STATUS_INTENT_UNSUPPORTED');
  const negative = negativePreparationGate(source);
  if (!negative.allowed || negative.required) reject('LEARNING_STATUS_INTENT_UNSUPPORTED');
  let snapshot;
  try { snapshot = validateScenarioReadinessV2(source.readinessV2); }
  catch { reject('SCENARIO_READINESS_V2_INVALID'); }
  if (snapshot.basis !== 'NATIVE_V2' || snapshot.evaluationScope !== 'TEST_DESIGN_ONLY'
      || !['UNKNOWN','HYPOTHESIS','EVIDENCED'].includes(snapshot.expectation.status)) reject('LEARNING_STATUS_NATIVE_SOURCE_REQUIRED');
  const issues = [...snapshot.issues, ...collectScenarioReadinessIssues(source)];
  if (snapshot.execution.status !== 'READY' || snapshot.review.status === 'HUMAN_REQUIRED'
      || issues.some(i => i.blocksExecution || i.humanRequired || i.kind === 'UNSUPPORTED_CAPABILITY')) reject('LEARNING_STATUS_SOURCE_BLOCKED');
  if (snapshot.coverage.status !== 'PARTIAL' || !snapshot.coverage.gapCodes.includes('ASSERTION_STATUS_REQUIRED')
      || issues.some(i => i.kind === 'ASSERTION_COVERAGE' && i.code !== 'ASSERTION_STATUS_REQUIRED')
      || assertionCoverageGaps(source).length) reject('LEARNING_STATUS_OTHER_COVERAGE_REQUIRED');
  const assertions = spec.assertions;
  if (assertions.length >= 30) reject('LEARNING_COVERAGE_ADDITION_LIMIT');
  const indexes = assertions.flatMap((a,i) => a?.type === 'SCHEMA' && typeof a.schemaRef === 'string'
      && /^[A-Za-z0-9_.:-]{1,240}$/.test(a.schemaRef) ? [i] : []);
  if (!indexes.length) reject('LEARNING_STATUS_SCHEMA_REQUIRED');
  if (spec.auth.requirement === 'NONE' && spec.auth.authProfileRef != null) reject('LEARNING_STATUS_AUTH_MISMATCH');
  return indexes;
}

/** Closed summary: status + indexes only. No response bodies or request values. */
export function validateStatusCoverageObservation(o, execution) {
  const keys = ['kind','actualStatusCode','schemaAssertionIndexes'];
  if (!plain(o) || Object.keys(o).length !== keys.length || Object.keys(o).some(k => !keys.includes(k))
      || o.kind !== 'STATUS' || !successStatus(o.actualStatusCode)
      || execution?.admissionBasis !== 'STRUCTURED_READINESS_V2'
      || o.actualStatusCode !== execution.actualStatusCode
      || !Array.isArray(o.schemaAssertionIndexes) || !o.schemaAssertionIndexes.length
      || o.schemaAssertionIndexes.length > 29
      || o.schemaAssertionIndexes.some((n,i,a) => !Number.isInteger(n) || n < 0 || n >= execution.assertionCount || (i > 0 && n <= a[i-1]))) reject('LEARNING_STATUS_PROOF_INVALID');
  return structuredClone(o);
}

export function deriveStatusCoverageAdditions(source, execution, observations) {
  const indexes = assertStatusCoverageSource(source);
  if (!Array.isArray(observations) || observations.length !== 1) reject('LEARNING_STATUS_PROOF_INVALID');
  const o = validateStatusCoverageObservation(observations[0], execution);
  if (!same(indexes, o.schemaAssertionIndexes)) reject('LEARNING_STATUS_PROOF_MISMATCH');
  // A declared status in the objective is a constraint, not an observation.
  const declared = `${source.title || ''} ${source.objective || ''}`.match(/\b[1-5][0-9]{2}\b/g) || [];
  if (declared.some(n => Number(n) !== o.actualStatusCode)) reject('LEARNING_STATUS_INTENT_CONFLICT');
  return [{ type: 'STATUS', expectedStatusCodes: [o.actualStatusCode] }];
}

function uniqueNames(items, lower = false) {
  if (!Array.isArray(items) || items.some(i => !i || typeof i.name !== 'string' || !i.name)) return false;
  const names = items.map(i => lower ? i.name.toLowerCase() : i.name);
  return new Set(names).size === names.length;
}
function usableValue(value) {
  return ['string','number','boolean'].includes(typeof value) && String(value) !== ''
    && (typeof value !== 'number' || Number.isFinite(value)) && !/\[REDACTED\]|\[TRUNCATED\]|[{}]/.test(String(value));
}

/** Invoked only AFTER buildLearningExecutionProof validates original assertions,
 * literals, auth intent and hashes. Additional checks below bind a STATUS-only
 * proposal to an unambiguous, successful JSON/schema execution. Nothing is
 * inferred from a passing status alone and no synthetic assertion is evaluated.
 */
export function statusCoverageObservationFromExecution(input, execution) {
  const rs = input.resultSet, result = input.scenario, version = input.sourceVersion;
  const source = version?.specification?.scenarios?.find(s => s.scenarioId === result?.scenarioId);
  const indexes = assertStatusCoverageSource(source), spec = source.spec;
  if (!rs || !version || !result || rs.testDesignVersionId !== (version.id || version.testDesignVersionId)
      || rs.testDesignId !== version.testDesignId || rs.endpointId !== version.endpointId
      || rs.organizationId !== version.organizationId || rs.projectId !== version.projectId
      || !Number.isInteger(rs.testDesignVersion) || rs.testDesignVersion !== version.version
      || !rs.environmentId || result.scenarioId !== execution.scenarioId
      || result.scenarioResultId !== execution.scenarioResultId
      || rs.runId !== execution.runId || rs.resultSetId !== execution.resultSetId
      || rs.environmentId !== execution.environmentId) reject('LEARNING_STATUS_EVIDENCE_SCOPE_MISMATCH');
  if (version.createdAt && (!Number.isFinite(Date.parse(version.createdAt)) || Date.parse(rs.completedAt) < Date.parse(version.createdAt))) reject('LEARNING_STATUS_EVIDENCE_BEFORE_VERSION');
  const http = result.http, e = result.evidence, req = e?.request, res = e?.response;
  if (result.outcome !== 'PASSED' || e?.contractVersion !== 'qagent.sanitized-execution-evidence.v1'
      || e.executionPurpose !== 'LEARNING') reject('LEARNING_STATUS_EXECUTION_REQUIRED');
  if (http?.outcome !== 'RESPONSE' || !successStatus(http.statusCode) || http.statusCode !== execution.actualStatusCode
      || http.errorCode || http.redirectCount !== 0 || http.truncated !== false
      || !jsonContentType(http.contentType) || !res || res.suppressionReason || res.previewTruncated === true
      || (res.contentType != null && !jsonContentType(res.contentType))) reject('LEARNING_STATUS_RESPONSE_UNUSABLE');
  const n = spec.assertions.length;
  if (result.assertionCount !== n || result.assertionPassedCount !== n || result.assertionFailedCount !== 0
      || result.assertionNotEvaluatedCount !== 0 || result.assertions.length !== n) reject('LEARNING_STATUS_ASSERTIONS_INCOMPLETE');
  if (result.assertions.some(a => a.outcome !== 'PASSED' || a.errorCode || a.diagnostics?.schemaTruncated === true)) reject('LEARNING_STATUS_ASSERTIONS_INCOMPLETE');
  if (!uniqueNames(req?.query) || !uniqueNames(req?.pathParams) || !uniqueNames(req?.headers, true)
      || req.path !== http.path || /[{}?#\s]/.test(req.path)
      || !Array.isArray(req.bodyFields) || req.bodyFields.length || (req.bodyBytes != null && req.bodyBytes !== 0)) reject('LEARNING_STATUS_REQUEST_MISMATCH');
  const bindings = spec.testData?.bindings || [];
  const queryNames = new Set([...Object.keys(spec.request?.query || {}), ...bindings.filter(b => b.target === 'QUERY').map(b => b.selector)]);
  if (req.query.length !== queryNames.size || req.query.some(q => !queryNames.has(q.name) || q.redacted
      || !Array.isArray(q.values) || !q.values.length || q.values.some(v => !usableValue(v)))) reject('LEARNING_STATUS_REQUEST_MISMATCH');
  const pathNames = [...spec.target.path.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
  if (new Set(pathNames).size !== pathNames.length || req.pathParams.length !== pathNames.length
      || req.pathParams.some(p => !pathNames.includes(p.name) || p.redacted || !usableValue(p.value))) reject('LEARNING_STATUS_REQUEST_MISMATCH');
  const path = spec.target.path.replace(/\{([^}]+)\}/g, (_, name) => encodeURIComponent(String(req.pathParams.find(p => p.name === name)?.value)));
  if (http.path !== path) reject('LEARNING_STATUS_REQUEST_MISMATCH');
  const auth = req.headers.filter(h => authName(h.name) || h.source === 'AUTH_RUNTIME');
  if (req.query.some(q => authName(q.name) || q.source === 'AUTH_RUNTIME')
      || (spec.auth.requirement === 'NONE' && (auth.length || (http.headerNames || []).some(authName)))
      || (spec.auth.requirement === 'REQUIRED' && !auth.some(h => h.source === 'AUTH_RUNTIME' && h.redacted === true))) reject('LEARNING_STATUS_AUTH_MISMATCH');
  // Do not silently accept a runtime-added query/body or an unrelated binding.
  const expectedBindings = e.expected?.testDataBindings || [];
  if (!Array.isArray(expectedBindings) || expectedBindings.length !== bindings.length
      || expectedBindings.some(b => !bindings.some(x => x.target === b.target && x.selector === b.selector))) reject('LEARNING_STATUS_BINDING_MISMATCH');
  const observation = { kind: 'STATUS', actualStatusCode: http.statusCode, schemaAssertionIndexes: indexes };
  deriveStatusCoverageAdditions(source, execution, [observation]);
  return validateStatusCoverageObservation(observation, execution);
}

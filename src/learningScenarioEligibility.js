/** FIX-2.1: distinguish an unverified expectation from an unresolved request.
 * Pure, shared with Runner. No credential access, execution, or readiness mutation.
 * Unknown review reasons fail closed. Never use model text as authorization.
 */
import { assertionCoverageGaps, assertionCoverageRequirements } from './coverageAssertions.js';
export const EXPLORATORY_LEARNING_ADMISSION = 'qagent.exploratory-learning-admission.v1';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const STATES = new Set(['READY', 'REVIEW_REQUIRED', 'NEEDS_DATA']);
const DEFERRED = new Set(['LEARNING_EXPECTATION_NOT_OBSERVED', 'LEARNING_HYPOTHESIS_UNVERIFIED',
  'LEARNING_LITERAL_EXPECTATION_UNVERIFIED', 'LEARNING_PATH_DATA_TO_RESOLVE', 'LEARNING_UNAUTHENTICATED_INTENT',
  'LEARNING_ASSERTION_COVERAGE_GAP', 'LEARNING_RESPONSE_KNOWLEDGE_REQUIRED']);
const CONDITIONAL = new Set(['LEARNING_NONEXISTENT_RESOURCE_NOT_ESTABLISHED', 'LEARNING_EMPTY_STATE_NOT_ESTABLISHED']);
const codePattern = /^[A-Z][A-Z0-9_:-]{0,119}$/;
const text = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function learningBlockerCodes(scenario) {
  const codes = [];
  for (const blocker of scenario?.automation?.blockers || []) {
    if (typeof blocker !== 'string') { codes.push('LEARNING_REVIEW_REASON_UNCLASSIFIED'); continue; }
    if (codePattern.test(blocker)) { codes.push(blocker); continue; }
    const b = text(blocker);
    if (/^(o status http \d{3} nao foi observado|status.*not observed)/.test(b)) codes.push('LEARNING_EXPECTATION_NOT_OBSERVED');
    else if (b === 'o cenario contem hipotese que precisa de revisao humana.') codes.push('LEARNING_HYPOTHESIS_UNVERIFIED');
    else if (b.startsWith('o valor literal esperado nao e provado por const/enum')) codes.push('LEARNING_LITERAL_EXPECTATION_UNVERIFIED');
    else if (b === 'valores de path params precisam ser fornecidos por massa de teste/runtime.' || /^test data: configure (fixed|observed) para path_param [a-z0-9_.-]+ no escopo apropriado\.$/.test(b)) codes.push('LEARNING_PATH_DATA_TO_RESOLVE');
    else if (invalidAuthIntent(scenario) && /(?:autenticacao|authentication|credential|credencial).{0,30}(?:invalid|expirad)|(?:invalid|expired).{0,30}(?:authentication|credential)/.test(b)) codes.push('LEARNING_AUTH_STRATEGY_NOT_MODELED');
    else if (b.startsWith('o objetivo afirma tipo ') && b.includes('json_path_exists so prova presenca')) codes.push('LEARNING_ASSERTION_COVERAGE_GAP');
    else if (/^(?:necessario|precisa|requer)(?:\s+de)?\s+(?:revisar|observar|analisar|validar)\b/.test(b) && !/credencial|segredo|secret|producao|autorizacao|permissao|aprovacao|fixture|massa|configur|token|cookie|invalida/.test(b) && /(?:comportamento|resposta)/.test(b) && (scenario?.spec?.auth?.requirement==='UNAUTHENTICATED'&&/sem autenticacao/.test(b) || assertionCoverageRequirements(scenario).some(r=>r.kind==='PAGINATION_BOUND')&&/(?:limite|pagin)/.test(b))) codes.push('LEARNING_RESPONSE_KNOWLEDGE_REQUIRED');
    else if (b === 'dados de teste seguro para autenticacao.' && scenario?.spec?.auth?.requirement === 'UNAUTHENTICATED') codes.push('LEARNING_UNAUTHENTICATED_INTENT');
    else if (/^dados de teste seguro para .*inexistente/.test(b)) codes.push('LEARNING_NONEXISTENT_RESOURCE_NOT_ESTABLISHED');
    else if (/^dados de teste seguro para .*vazi/.test(b)) codes.push('LEARNING_EMPTY_STATE_NOT_ESTABLISHED');
    else codes.push('LEARNING_REVIEW_REASON_UNCLASSIFIED');
  }
  // Structured fields are explanatory only: never let an externally supplied code
  // erase a blocker. Recompute from the persisted DSL and bounded legacy interpretation.
  if (invalidAuthIntent(scenario)) codes.push('LEARNING_AUTH_STRATEGY_NOT_MODELED');
  return [...new Set(codes)];
}

function invalidAuthIntent(scenario) {
  return /(?:autenticacao|credencia(?:l|is)|authentication|credential|token|cookie).{0,30}(?:invalid|expirad)|(?:invalid|expired).{0,30}(?:authentication|credential|token|cookie)/.test(text(`${scenario?.title||''} ${scenario?.objective||''}`));
}

export function assessExploratoryLearning(scenario) {
  const spec = scenario?.spec || {}, readiness = scenario?.automation?.readiness;
  const blockers = learningBlockerCodes(scenario);
  const deny = reason => ({ allowed: false, reason, blockers: [...new Set([reason, ...blockers.filter(x => !DEFERRED.has(x))])], knowledgeWarnings: blockers.filter(x => DEFERRED.has(x) && x !== 'LEARNING_PATH_DATA_TO_RESOLVE') });
  if (scenario?.generationClass === 'OBSERVED_BASELINE' || scenario?.baseline != null) return deny('LEARNING_BASELINE_REQUIRES_EXISTING_POLICY');
  if (!SAFE_METHODS.has(spec.target?.method)) return deny('LEARNING_MUTATION_NOT_ALLOWED');
  if (!STATES.has(readiness)) return deny(readiness === 'NEEDS_AUTH' ? 'LEARNING_AUTH_CONFIGURATION_REQUIRED' : readiness === 'NEEDS_ENVIRONMENT' ? 'LEARNING_RUNTIME_CONFIGURATION_REQUIRED' : 'LEARNING_READINESS_UNSUPPORTED');
  if (!spec.target?.apiServiceKey) return deny('LEARNING_RUNTIME_CONFIGURATION_REQUIRED');
  if (spec.auth?.requirement === 'REQUIRED' && !spec.auth.authProfileRef) return deny('LEARNING_AUTH_CONFIGURATION_REQUIRED');
  // An unauthenticated probe must stay unauthenticated, not borrow login/cookies.
  if (spec.auth?.requirement === 'UNAUTHENTICATED' && spec.auth.authProfileRef) return deny('LEARNING_AUTH_INTENT_CONFLICT');
  if (blockers.includes('LEARNING_AUTH_STRATEGY_NOT_MODELED')) return deny('LEARNING_AUTH_STRATEGY_NOT_MODELED');
  const condition = blockers.find(x => CONDITIONAL.has(x));
  if (condition) return deny(condition);
  if (blockers.some(x => !DEFERRED.has(x))) return deny('LEARNING_REVIEW_REASON_UNCLASSIFIED');
  if (readiness !== 'READY' && !blockers.length) return deny('LEARNING_REVIEW_REASON_UNCLASSIFIED');
  // Unresolved path for a negative cannot borrow a successful identifier and then claim non-existence.
  const special = scenario?.category === 'NEGATIVE' && (spec.assertions || []).some(a =>
    (a.type === 'STATUS' && (a.expectedStatusCodes || []).includes(404)) ||
    (a.type === 'JSON_PATH_EQUALS' && Array.isArray(a.expected) && a.expected.length === 0));
  if (special && blockers.includes('LEARNING_PATH_DATA_TO_RESOLVE')) return deny('LEARNING_CONDITION_DATA_REQUIRED');
  const coverageGaps=assertionCoverageGaps(scenario);
  return { allowed: true, reason: null, blockers: [],
    knowledgeWarnings: [...new Set([...blockers.filter(x => x !== 'LEARNING_PATH_DATA_TO_RESOLVE'),...(coverageGaps.length?['LEARNING_ASSERTION_COVERAGE_GAP']:[])])],
    coverageGaps, confirmationRequiresCoverage:coverageGaps.length>0,
    deferredBlockers: blockers };
}

/** The materializer emits this only after resolving data. Stored Test Design is unchanged. */
export function buildExploratoryLearningAdmission(scenario) {
  const assessment = assessExploratoryLearning(scenario);
  if (!assessment.allowed) return null;
  return { contractVersion: EXPLORATORY_LEARNING_ADMISSION,
    sourceReadiness: scenario.automation.readiness, deferredBlockers: assessment.deferredBlockers };
}

export function validExploratoryLearningAdmission(scenario) {
  const a = scenario?.learningAdmission;
  if (!a || Object.keys(a).some(k => !['contractVersion','sourceReadiness','deferredBlockers'].includes(k)) ||
      a.contractVersion !== EXPLORATORY_LEARNING_ADMISSION || a.sourceReadiness !== scenario.readiness ||
      !Array.isArray(a.deferredBlockers) || a.deferredBlockers.length > 20 || a.deferredBlockers.some(x => !DEFERRED.has(x))) return false;
  return assessExploratoryLearning({ ...scenario, automation: { readiness: a.sourceReadiness, blockers: a.deferredBlockers } }).allowed;
}

/** Machine-readable explanation consumed by Console and future orchestration.
 * It is recomputed, not trusted as an admission from model output/client input. */
export function learningReadinessDiagnostics(scenario) {
 const assessment=assessExploratoryLearning(scenario);
 const codes=learningBlockerCodes(scenario);
 const gaps=assertionCoverageGaps(scenario);
 const items=codes.map(code=>({code,kind:DEFERRED.has(code)?(code==='LEARNING_PATH_DATA_TO_RESOLVE'?'DATA_DEPENDENCY':code==='LEARNING_ASSERTION_COVERAGE_GAP'?'ASSERTION_COVERAGE':'EXPECTATION_KNOWLEDGE'):code==='LEARNING_AUTH_STRATEGY_NOT_MODELED'?'AUTH_STRATEGY':'OPERATIONAL_BLOCKER'}));
 for(const gap of gaps)items.push({code:gap.kind==='PAGINATION_BOUND'?'LEARNING_PAGINATION_ASSERTION_REQUIRED':'LEARNING_TYPE_ASSERTION_REVIEW',...gap,coverageKind:gap.kind,kind:'ASSERTION_COVERAGE'});
 return {contractVersion:'qagent.semantic-readiness-diagnostics.v1',basis:'SYSTEM_DSL_AND_LEGACY_REASON_ANALYSIS',currentReadiness:scenario?.automation?.readiness||null,canInvestigate:assessment.allowed,issues:items.slice(0,30),coverageLimited:gaps.length>0};
}

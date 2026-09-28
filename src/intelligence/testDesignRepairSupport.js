import { TestDesignContractError, validateTestDesignModelOutputV1 } from './testDesignContract.js';

export const TEST_DESIGN_ASSERTION_DIAGNOSTICS_VERSION = 'qagent.test-design-assertion-diagnostics.v1';
const MAX_SCENARIOS = 20;
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(value, (_, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (a, b) => canonical(a) === canonical(b);
const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Diagnostic only. The existing full contract remains the validation authority.
 * No payload, objective, arbitrary key or model-supplied id is exposed in these issues.
 */
export function collectAssertionRepairDiagnostics(output) {
  const scenarios = Array.isArray(output?.scenarios) ? output.scenarios : [];
  const issues = [];
  for (let index = 0; index < Math.min(scenarios.length, MAX_SCENARIOS); index++) {
    const scenario = scenarios[index];
    if (!plain(scenario)) continue;
    const assertions = scenario.assertions;
    let code = null;
    if (assertions == null) code = 'ASSERTIONS_REQUIRED';
    else if (!Array.isArray(assertions)) code = 'ASSERTIONS_NOT_ARRAY';
    else if (!assertions.length) code = 'ASSERTIONS_EMPTY';
    else if (assertions.length > 30) code = 'ASSERTIONS_LIMIT_EXCEEDED';
    if (code) issues.push({ code, path: `modelOutput.scenarios[${index}].assertions`, scenarioIndex: index, minItems: 1, maxItems: 30 });
  }
  return {
    diagnosticVersion: TEST_DESIGN_ASSERTION_DIAGNOSTICS_VERSION,
    issueCount: issues.length, scannedScenarioCount: Math.min(scenarios.length, MAX_SCENARIOS),
    truncated: scenarios.length > MAX_SCENARIOS, issues,
  };
}

function requestView(request) {
  return { pathParams: request?.pathParams ?? {}, query: request?.query ?? {}, headers: request?.headers ?? {}, body: request?.body ?? null };
}
function isValidScenario(scenario, output, context) {
  try { validateTestDesignModelOutputV1({ title: output.title, objective: output.objective, scenarios: [scenario] }, context); return true; }
  catch (error) { if (error instanceof TestDesignContractError) return false; throw error; }
}
function statusCodes(scenario) {
  return (scenario.assertions || []).filter(a => a.type === 'STATUS').flatMap(a => a.expectedStatusCodes || []);
}
function isSequenceIntent(text) {
  return /(?:multiplos|multiple|varios|various).{0,160}(?:em sequencia|in sequence|sequential|sequencial)/.test(text)
    || /(?:sequencia de (?:requests|requisicoes|chamadas)|sequence of (?:requests|calls))/.test(text);
}
function isCountCorrectnessIntent(text) {
  return /(?:total|contagem|quantidade|count).{0,100}(?:corret[oa]|correspon|equival|tamanho|length|matches)/.test(text)
    || /(?:correct|corret[oa]).{0,60}(?:count|total|contagem)/.test(text);
}
function isCountRelationIntent(text) {
  return /(?:total|contagem|quantidade|count).{0,100}(?:correspon|equival|tamanho|length|matches)/.test(text);
}
function hasGroundedCountLiteral(scenario, context) {
  // A fixed number can be checked only when the supplied response schema explicitly
  // constrains that same path to that literal. This does NOT implement a relation.
  return scenario.assertions.some(assertion => {
    if (assertion.type !== 'JSON_PATH_EQUALS' || typeof assertion.expected !== 'number'
      || !/^\$(?:\.[A-Za-z_][A-Za-z0-9_-]*)+$/.test(assertion.path || '')
      || !/(?:total|count|contagem|quantidade)$/i.test(assertion.path)) return false;
    const keys = assertion.path.slice(2).split('.');
    return (context?.schemas || []).some(track => {
      if (track.direction !== 'RESPONSE' || (statusCodes(scenario).length && !statusCodes(scenario).includes(track.statusCode))) return false;
      let node = track.schema;
      for (const key of keys) node = node?.properties?.[key];
      return node?.const === assertion.expected || (Array.isArray(node?.enum) && node.enum.length === 1 && node.enum[0] === assertion.expected);
    });
  });
}

/** Narrow integrity check for a contract repair involving invalid assertion lists.
 * It never writes assertions, runs requests, interprets readiness or promotes evidence.
 * General semantic completeness still belongs to the existing system guards.
 */
export function validateAssertionRepairIntegrity(before, after, context, diagnostics = collectAssertionRepairDiagnostics(before)) {
  if (!diagnostics.issueCount) return { checked: false };
  const original = before?.scenarios;
  if (!Array.isArray(original)) return { checked: false };
  const repaired = after?.scenarios || [];
  const issues = [];
  const add = (code, index, field) => {
    if (issues.length < 40) issues.push({ code, path: index == null ? `modelOutput.${field}` : `modelOutput.scenarios[${index}].${field}` });
  };
  if (original.length !== repaired.length) add('REPAIR_SCENARIO_SET_CHANGED', null, 'scenarios');
  for (const field of ['title', 'objective']) if (!same(before[field], after[field])) add('REPAIR_INTENT_CHANGED', null, field);
  const affected = new Set(diagnostics.issues.map(issue => issue.scenarioIndex));
  original.slice(0, MAX_SCENARIOS).forEach((source, index) => {
    const target = repaired[index];
    if (!plain(source) || !plain(target)) return;
    if (source.scenarioId !== target.scenarioId) { add('REPAIR_SCENARIO_SET_CHANGED', index, 'scenarioId'); return; }
    for (const field of ['title', 'objective', 'category', 'authRequirement']) {
      if (typeof source[field] === 'string' && !same(source[field], target[field])) add('REPAIR_INTENT_CHANGED', index, field);
    }
    if (!same(requestView(source.request), requestView(target.request))) add('REPAIR_REQUEST_CHANGED', index, 'request');
    if (!same(source.preconditions ?? [], target.preconditions ?? [])) add('REPAIR_INTENT_CHANGED', index, 'preconditions');
    if (source.grounding?.level === 'ASSUMED') {
      if (target.grounding?.level !== 'ASSUMED') add('REPAIR_HYPOTHESIS_PROMOTED', index, 'grounding');
      const ranks = { LOW: 0, MEDIUM: 1, HIGH: 2 };
      if ((ranks[target.confidence] ?? 0) > (ranks[source.confidence] ?? 1)) add('REPAIR_HYPOTHESIS_PROMOTED', index, 'confidence');
      for (const field of ['evidenceRefs', 'schemaRefs']) {
        if ((target.grounding?.[field] || []).some(ref => !(source.grounding?.[field] || []).includes(ref))) add('REPAIR_HYPOTHESIS_PROMOTED', index, `grounding.${field}`);
      }
    }
    // A repair for a different scenario must not erase/weaken existing valid checks.
    if (!affected.has(index) && isValidScenario(source, before, context)) {
      for (const assertion of source.assertions) if (!target.assertions.some(item => same(assertion, item))) add('REPAIR_ASSERTION_CHANGED', index, 'assertions');
    }
    if (!affected.has(index)) return;
    const text = fold(`${source.title}\n${source.objective}`).slice(0, 1500);
    const statuses = statusCodes(target);
    if (isSequenceIntent(text)) add('REPAIR_SEQUENCE_NOT_REPRESENTABLE', index, 'assertions');
    if (isCountCorrectnessIntent(text) && (isCountRelationIntent(text) || !hasGroundedCountLiteral(target, context))) add('REPAIR_COUNT_RULE_UNAVAILABLE', index, 'assertions');
    if (['DATA_VARIATION', 'SCHEMA_CONTRACT'].includes(source.category) && target.assertions.every(a => a.type === 'STATUS')) add('REPAIR_STATUS_ONLY_INSUFFICIENT', index, 'assertions');
    const rejectionIntent = source.category === 'NEGATIVE'
      || (source.authRequirement === 'UNAUTHENTICATED' && context?.runtime?.authObservation?.status === 'REQUIRED');
    if (rejectionIntent && statuses.some(code => code >= 200 && code < 400)) add('REPAIR_NEGATIVE_INTENT_WEAKENED', index, 'assertions');
    if (new Set(statuses.map(code => Math.floor(code / 100))).size > 1) add('REPAIR_STATUS_CLASSES_BROADENED', index, 'assertions');
  });
  if (issues.length) {
    throw new TestDesignContractError('O reparo de assertions alterou a intenção ou não consegue comprová-la com o contexto e a DSL disponíveis.', {
      code: 'TEST_DESIGN_REPAIR_INTEGRITY_INVALID', path: issues[0].path, details: { repairIssues: issues },
    });
  }
  return { checked: true };
}

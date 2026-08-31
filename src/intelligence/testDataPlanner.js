import { isSensitiveTestDataSelector, sanitizeTestDataGeneratorConfig, scopeRank } from '../lib/testDataPolicy.js';

export const TEST_DATA_PLANNER_VERSION = 'qagent.test-data-planner.v1.2.2';
export const TEST_DATA_BINDINGS_CONTRACT_VERSION = 'qagent.test-data-bindings.v1';

const GENERIC_BODY_NEEDS_DATA = 'O formato do body é modelado, mas seus valores precisam ser fornecidos por massa de teste controlada.';
const PATH_NEEDS_DATA = 'Valores de path params precisam ser fornecidos por massa de teste/runtime.';
const SECRET_GUARD_PREFIX = 'QAgent Secret Guard:';
const OBSERVED_RUNTIME_REASON_PREFIX = 'QAgent Observed Test Data:';
const POSITIVE_BASELINE_CATEGORIES = new Set(['HAPPY_PATH', 'BOUNDARY', 'SCHEMA_CONTRACT', 'STATUS_BEHAVIOR', 'DATA_VARIATION', 'REGRESSION_CANDIDATE']);
const INTENT_AWARE_CATEGORIES = new Set(['NEGATIVE', 'BOUNDARY', 'DATA_VARIATION', 'REGRESSION_CANDIDATE']);
const PLANNER_OWNED_SEMANTIC_CODES = new Set(['SEMANTIC_REQUEST_BODY_NEEDS_DATA', 'SEMANTIC_PATH_PARAM_NEEDS_DATA']);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function plain(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function unique(values) { return [...new Set((values || []).filter(Boolean))]; }

function requestSchema(context) {
  const tracks = (context?.schemas || []).filter((track) => track?.direction === 'REQUEST' && plain(track?.schema));
  return tracks[0]?.schema || null;
}

function nodeAtBodySelector(schema, selector) {
  if (!schema || !selector?.startsWith('$.')) return null;
  const tokens = selector.slice(2).split('.').filter(Boolean);
  let node = schema;
  for (const token of tokens) {
    if (!plain(node?.properties?.[token])) return null;
    node = node.properties[token];
  }
  return node;
}

function bodyLeaves(value, prefix = '$') {
  const out = [];
  if (!plain(value)) return out;
  for (const [key, child] of Object.entries(value)) {
    const selector = `${prefix}.${key}`;
    if (plain(child) && Object.keys(child).length) out.push(...bodyLeaves(child, selector));
    else out.push({ selector, value: child });
  }
  return out;
}

function requiredBodySelectors(schema, prefix = '$', depth = 0) {
  if (!plain(schema) || depth > 8) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const out = [];
  for (const key of required) {
    const node = schema?.properties?.[key];
    if (!plain(node)) continue;
    const selector = `${prefix}.${key}`;
    const nestedRequired = Array.isArray(node.required) && node.required.length > 0 && plain(node.properties);
    if (nestedRequired) out.push(...requiredBodySelectors(node, selector, depth + 1));
    else out.push({ selector, node });
  }
  return out;
}

function sanitizerSelectors(secretSafeDiagnostics, index, target) {
  const field = target === 'BODY' ? 'body' : target === 'QUERY' ? 'query' : 'pathParams';
  const prefix = `modelOutput.scenarios[${index}].request.${field}.`;
  const values = (secretSafeDiagnostics?.sanitizedPaths || [])
    .filter((path) => String(path).startsWith(prefix))
    .map((path) => String(path).slice(prefix.length))
    .filter((value) => value && !value.includes('['));
  if (target === 'BODY') {
    return values.map((value) => `$.${value}`).filter((selector) => /^\$\.[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(selector));
  }
  return values.filter((selector) => /^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/.test(selector));
}

function fieldName(selector) { return String(selector || '').split('.').pop() || ''; }
function lowerName(selector) { return fieldName(selector).replace(/[-_.]/g, '').toLowerCase(); }
function looksReferential(selector) {
  const name = fieldName(selector);
  return /(^id$|Id$|ID$|_id$|_uuid$|Uuid$|UUID$)/.test(name)
    || /^(customer|user|account|order|product|model|make|school|classroom|tenant|organization|project|store|company|vehicle|invoice|payment|employee|emp|leaveType|location|department|payGrade|jobTitle|subunit)(id|uuid)$/i.test(name)
    || /^(emp|employee)Number$/i.test(name);
}

function looksEnumLike(selector, node) {
  if (Array.isArray(node?.enum) && node.enum.length > 0) return true;
  if (Object.prototype.hasOwnProperty.call(node || {}, 'const')) return true;
  const name = lowerName(selector);
  return /^(type|status|state|role|currency|currencytype|countrycode|language|category|kind)$/.test(name);
}

function statusCodes(scenario) {
  const out = [];
  for (const assertion of scenario?.assertions || []) {
    if (assertion?.type !== 'STATUS') continue;
    for (const code of assertion?.expectedStatusCodes || []) if (Number.isInteger(Number(code))) out.push(Number(code));
  }
  return out;
}

function isSuccessOrientedScenario(scenario) {
  if (!POSITIVE_BASELINE_CATEGORIES.has(String(scenario?.category || '').toUpperCase())) return false;
  return statusCodes(scenario).some((code) => code >= 200 && code < 300);
}

const INTENT_REASON_PREFIX = 'QAgent Scenario Intent:';
const MUTATION_MARKERS = [
  /\binvalid(?:o|a|os|as)?\b/, /\binvalid\b/, /\binexistente(?:s)?\b/, /\bnao existe(?:m)?\b/,
  /\bmalformad(?:o|a|os|as)\b/, /\bmalformed\b/, /\bfora do intervalo\b/, /\bout of range\b/,
  /\bausente(?:s)?\b/, /\bmissing\b/, /\bomit(?:ted|ting)?\b/, /\bsem\b/,
];
const OMISSION_MARKERS = [/\bausente(?:s)?\b/, /\bmissing\b/, /\bomit(?:ted|ting)?\b/, /\bsem\b/];
const DUPLICATE_MARKERS = [/\bduplicad(?:o|a|os|as)\b/, /\bduplicate(?:d)?\b/, /\bja existente\b/, /\balready exists?\b/, /\balready existing\b/];
const NON_EXISTENT_MARKERS = [/\binexistente(?:s)?\b/, /\bnao existe(?:m)?\b/, /\bnot found\b/, /\bnon existent\b/, /\bnonexistent\b/];
const REQUIRED_FIELDS_OMISSION_MARKERS = [
  /\bcampos? obrigatorios? (?:ausentes?|faltantes?)\b/,
  /\bsem (?:os )?campos? obrigatorios?\b/,
  /\bmissing required fields?\b/,
  /\brequired fields? missing\b/,
  /\bomit(?:ted|ting)? required fields?\b/,
];
const GENERIC_INTENT_TOKENS = new Set(['id', 'type', 'tipo', 'number', 'numero']);
const INTENT_TOKEN_ALIASES = {
  leave: ['leave', 'licenca', 'licencas', 'ausencia', 'ausencias', 'ferias'],
  type: ['type', 'tipo', 'tipos'],
  emp: ['emp', 'employee', 'funcionario', 'funcionaria', 'funcionarios', 'empregado', 'colaborador'],
  employee: ['employee', 'emp', 'funcionario', 'funcionaria', 'funcionarios', 'empregado', 'colaborador'],
  number: ['number', 'numero', 'numeros'],
  from: ['from', 'start', 'inicio', 'inicial'],
  to: ['to', 'end', 'fim', 'final'],
  date: ['date', 'dates', 'data', 'datas'],
  duration: ['duration', 'duracao'],
  comment: ['comment', 'comentario', 'comentarios'],
  status: ['status', 'estado'],
  role: ['role', 'papel', 'perfil'],
  category: ['category', 'categoria'],
  product: ['product', 'produto'],
  customer: ['customer', 'cliente'],
  user: ['user', 'usuario', 'usuaria'],
  account: ['account', 'conta'],
  order: ['order', 'pedido'],
  location: ['location', 'local', 'localizacao'],
  department: ['department', 'departamento'],
  project: ['project', 'projeto'],
};

function normalizeIntentText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function identifierTokens(value) {
  return normalizeIntentText(String(value || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2')).split(' ').filter(Boolean);
}

function scenarioIntentText(scenario) {
  return normalizeIntentText([scenario?.title, scenario?.objective].filter(Boolean).join(' '));
}

function hasMutationMarker(text) {
  return MUTATION_MARKERS.some((pattern) => pattern.test(text));
}

function hasOmissionMarker(text) {
  return OMISSION_MARKERS.some((pattern) => pattern.test(text));
}

function tokenMatchesIntent(token, textWords) {
  const aliases = INTENT_TOKEN_ALIASES[token] || [token];
  return aliases.some((alias) => textWords.has(normalizeIntentText(alias)));
}

function selectorIntentTokens(selector) {
  const segments = String(selector || '').replace(/^\$\./, '').split('.').filter(Boolean);
  const leafTokens = identifierTokens(segments.at(-1));
  const leafNeedsParent = leafTokens.length > 0 && leafTokens.every((token) => token === 'id' || GENERIC_INTENT_TOKENS.has(token));
  if (leafNeedsParent && segments.length > 1) return [...identifierTokens(segments.at(-2)), ...leafTokens];
  return leafTokens;
}

function selectorIntentScore(selector, intentText) {
  const compactIntent = intentText.replace(/\s+/g, '');
  const tokens = selectorIntentTokens(selector);
  const compactSelector = tokens.join('');
  if (compactSelector.length >= 5 && compactIntent.includes(compactSelector)) return 100;

  const words = new Set(intentText.split(' ').filter(Boolean));
  const relevantTokens = tokens.filter((token) => token !== 'id');
  let score = 0;
  let semanticMatches = 0;
  let matchedTokens = 0;
  for (const token of relevantTokens) {
    if (!tokenMatchesIntent(token, words)) continue;
    matchedTokens += 1;
    if (GENERIC_INTENT_TOKENS.has(token)) score += 4;
    else { score += 20; semanticMatches += 1; }
  }
  if (semanticMatches === 0) return 0;
  if (relevantTokens.length > 1 && matchedTokens < 2) return 0;
  return score;
}

function scenarioSupportsMutationIntent(scenario) {
  return INTENT_AWARE_CATEGORIES.has(String(scenario?.category || '').toUpperCase());
}

function hasDuplicateMarker(text) {
  return DUPLICATE_MARKERS.some((pattern) => pattern.test(text));
}

function hasNonExistentMarker(text) {
  return NON_EXISTENT_MARKERS.some((pattern) => pattern.test(text));
}

function hasRequiredFieldsOmissionMarker(text) {
  return REQUIRED_FIELDS_OMISSION_MARKERS.some((pattern) => pattern.test(text));
}

function inferGeneralBodyMutationIntent(scenario) {
  if (!scenarioSupportsMutationIntent(scenario)) return null;
  const intentText = scenarioIntentText(scenario);
  if (!intentText) return null;
  if (hasRequiredFieldsOmissionMarker(intentText)) return { kind: 'OMIT_REQUIRED_FIELDS', score: 100 };
  return null;
}

function inferBodyMutationIntentTargets(scenario, selectors) {
  if (!scenarioSupportsMutationIntent(scenario)) return new Map();
  const intentText = scenarioIntentText(scenario);
  if (!intentText || (!hasMutationMarker(intentText) && !hasDuplicateMarker(intentText))) return new Map();
  if (hasRequiredFieldsOmissionMarker(intentText)) return new Map();
  const targets = new Map();
  for (const selector of selectors) {
    const score = selectorIntentScore(selector, intentText);
    if (score < 20) continue;
    let kind;
    if (hasDuplicateMarker(intentText)) kind = looksReferential(selector) ? 'DUPLICATE_REFERENCE' : 'DUPLICATE_VALUE';
    else if (hasOmissionMarker(intentText)) kind = 'OMIT';
    else if (hasNonExistentMarker(intentText) && looksReferential(selector)) kind = 'INVALID_REFERENCE';
    else kind = 'INVALID_VALUE';
    targets.set(selector, { kind, score });
  }
  return targets;
}

function observedEnvironmentIds(context) {
  return unique((context?.environments || []).map((item) => item?.environmentId));
}

function observedCoverage(observedTestData, context, target, selector) {
  const environmentIds = observedEnvironmentIds(context);
  const values = (observedTestData?.values || []).filter((item) => (
    item?.target === target
    && item?.selector === selector
    && Number(item?.successCount || 0) > 0
  ));
  const seenEnvironments = new Set(values.map((item) => item?.environmentId).filter(Boolean));
  const complete = environmentIds.length
    ? environmentIds.every((environmentId) => seenEnvironments.has(environmentId))
    : values.length > 0;
  return {
    any: values.length > 0,
    complete,
    valueType: unique(values.map((item) => item?.valueType)).length === 1 ? values[0]?.valueType : null,
  };
}

function baselineObservedSelectors(observedTestData, context) {
  const environmentIds = observedEnvironmentIds(context);
  const samples = (observedTestData?.samples || []).filter((item) => Number(item?.successCount || 0) > 0);
  const selectedSamples = [];
  if (environmentIds.length) {
    for (const environmentId of environmentIds) {
      const sample = samples.find((item) => item?.environmentId === environmentId);
      if (!sample) return [];
      selectedSamples.push(sample);
    }
  } else if (samples.length) selectedSamples.push(samples[0]);
  if (!selectedSamples.length) return [];

  let common = new Map((selectedSamples[0].selectors || []).map((item) => [item.selector, item.valueType]));
  for (const sample of selectedSamples.slice(1)) {
    const available = new Map((sample.selectors || []).map((item) => [item.selector, item.valueType]));
    common = new Map([...common.entries()].filter(([selector, valueType]) => available.get(selector) === valueType));
  }
  return [...common.entries()].map(([selector, valueType]) => ({ selector, valueType }));
}

function generatorFor(selector, node, sampleValue) {
  const name = lowerName(selector);
  const type = String(node?.type || (Array.isArray(sampleValue) ? 'array' : typeof sampleValue)).toLowerCase();
  const format = String(node?.format || '').toLowerCase();
  if (/cpf/.test(name)) return 'BR_CPF';
  if (/cnpj/.test(name)) return 'BR_CNPJ';
  if (/cep|postalcode|zipcode/.test(name)) return 'BR_CEP';
  if (/email/.test(name) || format === 'email') return 'EMAIL';
  if (/firstname|primeironome/.test(name)) return 'FIRST_NAME';
  if (/lastname|sobrenome/.test(name)) return 'LAST_NAME';
  if ((/^name$/.test(name) || /fullname|nomecompleto/.test(name))) return 'FULL_NAME';
  if (/phone|mobile|telefone|celular/.test(name)) return 'PHONE';
  if (/uuid|guid/.test(name) || format === 'uuid') return 'UUID';
  if (format === 'date-time' || /datetime|timestamp|createdat|updatedat/.test(name)) return 'DATE_TIME';
  if (format === 'date' || /(^|_)date$|birthdate|birthday|data/.test(name)) return 'DATE';
  if (/comment|message|description|note|observation|reason|title|text|coment|mensagem|descricao|descrição|observacao|observação/.test(name)) return 'TEXT_SENTENCE';
  if (type === 'boolean') return 'BOOLEAN';
  if (type === 'integer') return 'INTEGER';
  if (type === 'number') return 'NUMBER';
  if (type === 'array') {
    const itemType = String(node?.items?.type || (Array.isArray(sampleValue) && sampleValue.length ? typeof sampleValue[0] : 'string')).toLowerCase();
    if (itemType === 'integer') return 'INTEGER_LIST';
    if (itemType === 'number') return 'NUMBER_LIST';
    if (itemType === 'boolean') return 'BOOLEAN_LIST';
    if (itemType === 'string') return 'STRING_LIST';
    return 'JSON_SCHEMA';
  }
  if (type === 'object') return 'JSON_SCHEMA';
  return 'TEXT';
}

function valueTypeFor(node, sampleValue) {
  const type = String(node?.type || (Array.isArray(sampleValue) ? 'array' : typeof sampleValue)).toLowerCase();
  if (type === 'integer') return 'INTEGER';
  if (type === 'number') return 'NUMBER';
  if (type === 'boolean') return 'BOOLEAN';
  if (type === 'array' || type === 'object') return 'JSON';
  return 'STRING';
}

function stableConfig(value) {
  try { return JSON.stringify(value || {}); } catch { return '{}'; }
}

function effectiveBindingForEnvironment(matches, environmentId) {
  const candidates = matches.filter((item) => {
    const scopeType = String(item?.scopeType || 'ENDPOINT').toUpperCase();
    if (scopeType === 'PROJECT') return true;
    return item?.environmentId === environmentId;
  });
  if (!candidates.length) return null;
  return candidates.reduce((best, item) => !best || scopeRank(item.scopeType || 'ENDPOINT') > scopeRank(best.scopeType || 'ENDPOINT') ? item : best, null);
}

function explicitBinding(context, target, selector) {
  const all = context?.testData?.configuredBindings || [];
  const matches = all.filter((item) => item?.target === target && item?.selector === selector);
  if (!matches.length) return null;
  const environmentIds = unique(context?.environments?.map((item) => item.environmentId));
  let effective;
  if (environmentIds.length) {
    effective = environmentIds.map((environmentId) => effectiveBindingForEnvironment(matches, environmentId));
    if (effective.some((item) => !item)) return { ambiguous: true, incompleteCoverage: true };
  } else {
    const projectMatches = matches.filter((item) => String(item?.scopeType || '').toUpperCase() === 'PROJECT');
    effective = projectMatches.length ? [projectMatches[0]] : matches;
  }
  const signatures = unique(effective.map((item) => `${item.sourceType}|${item.valueType}|${item.generatorKind || ''}|${stableConfig(item.generatorConfig)}|${item.sourceType === 'SECRET' ? item.secretConfigured === true : ''}`));
  if (signatures.length !== 1) return { ambiguous: true, incompleteCoverage: false };
  return { ...effective[0], ambiguous: false };
}

function stripReason(scenario, predicate) {
  const reasons = scenario?.automationHints?.reasons || [];
  scenario.automationHints.reasons = reasons.filter((reason) => !predicate(String(reason)));
}

function addReason(scenario, reason) {
  if (!scenario.automationHints) scenario.automationHints = {};
  if (!Array.isArray(scenario.automationHints.reasons)) scenario.automationHints.reasons = [];
  if (!scenario.automationHints.reasons.includes(reason) && scenario.automationHints.reasons.length < 10) scenario.automationHints.reasons.push(reason);
}

function deleteBodySelector(body, selector) {
  if (!plain(body) || !selector.startsWith('$.')) return;
  const parts = selector.slice(2).split('.');
  let cursor = body;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!plain(cursor?.[parts[i]])) return;
    cursor = cursor[parts[i]];
  }
  delete cursor[parts[parts.length - 1]];
}

function bindingDescriptor({ target, selector, source, node, sampleValue, explicit, observedValueType = null }) {
  const base = {
    target,
    selector,
    source,
    valueType: explicit?.valueType || observedValueType || valueTypeFor(node, sampleValue),
  };
  if (source === 'GENERATED') {
    const explicitKind = String(explicit?.generatorKind || '').toUpperCase();
    return {
      ...base,
      generator: {
        kind: explicitKind && explicitKind !== 'AUTO' ? explicitKind : generatorFor(selector, node, sampleValue),
        config: sanitizeTestDataGeneratorConfig(
          explicitKind || generatorFor(selector, node, sampleValue),
          explicit?.generatorConfig || (node ? { schema: clone(node) } : {}),
          { valueType: base.valueType, selectorPath: target === 'BODY' ? selector : '$' },
        ),
      },
    };
  }
  return { ...base, bindingKey: `${target}:${selector}` };
}

function pathPlaceholderNames(path) {
  const out = [];
  for (const match of String(path || '').matchAll(/\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g)) out.push(match[1]);
  return unique(out);
}

function semanticNeedsDataIssues(semanticDiagnostics, scenarioId) {
  return (semanticDiagnostics?.issues || []).filter((issue) => issue?.scenarioId === scenarioId && issue?.action === 'NEEDS_DATA');
}

function canPlannerClearNeedsData({ scenario, scenarioId, semanticDiagnostics, originalReasons }) {
  const issues = semanticNeedsDataIssues(semanticDiagnostics, scenarioId);
  if (issues.length) return issues.every((issue) => PLANNER_OWNED_SEMANTIC_CODES.has(issue.code));
  if (scenario?.automationHints?.needsData !== true) return true;
  return originalReasons.every((reason) => (
    reason === GENERIC_BODY_NEEDS_DATA
    || reason === PATH_NEEDS_DATA
    || String(reason).startsWith(SECRET_GUARD_PREFIX)
  ));
}

function classifySource(target, selector, node, sampleValue, explicit, isSanitizedSensitive, observed) {
  const sensitive = isSanitizedSensitive || isSensitiveTestDataSelector(target, selector);
  if (sensitive) {
    if (explicit && explicit.sourceType !== 'SECRET') return { source: 'SECRET', securityMismatch: true };
    return { source: 'SECRET', securityMismatch: false };
  }
  if (explicit) return { source: explicit.sourceType, securityMismatch: false };
  const observedPreferred = target === 'BODY' && (looksReferential(selector) || looksEnumLike(selector, node));
  if (observedPreferred && observed?.any) {
    return { source: 'OBSERVED', securityMismatch: false, coverageIncomplete: observed.complete !== true };
  }
  if (looksReferential(selector)) return { source: 'FIXED', securityMismatch: false };
  if (node || sampleValue !== undefined || observed?.any) return { source: 'GENERATED', securityMismatch: false };
  return { source: 'FIXED', securityMismatch: false };
}

export function applyTestDataPlannerV1(modelOutput, context, {
  secretSafeDiagnostics = null,
  semanticDiagnostics = null,
  observedTestData = null,
  observedRuntimeEnabled = false,
} = {}) {
  const output = clone(modelOutput);
  const schema = requestSchema(context);
  const plansByScenarioId = {};
  const baselineSelectors = baselineObservedSelectors(observedTestData, context);
  const diagnostics = {
    plannerVersion: TEST_DATA_PLANNER_VERSION,
    strategy: 'HYBRID',
    plannedScenarioCount: 0,
    bindingCount: 0,
    generatedCount: 0,
    fixedCount: 0,
    secretCount: 0,
    observedCount: 0,
    observedRuntimePendingCount: 0,
    observedCoverageIncompleteCount: 0,
    intentAwareScenarioCount: 0,
    intentTargetCount: 0,
    intentBlockedAutoBindingCount: 0,
    intentBlockedObservedCount: 0,
    intentBlockedGeneratedCount: 0,
    intentDuplicateObservedReuseCount: 0,
    intentOmissionSatisfiedCount: 0,
    intentTargets: [],
    observedValueMetadataCount: Array.isArray(observedTestData?.values) ? observedTestData.values.length : 0,
    observedSampleMetadataCount: Array.isArray(observedTestData?.samples) ? observedTestData.samples.length : 0,
    baselineObservedSelectorCount: baselineSelectors.length,
    unresolvedCount: 0,
    readyDataScenarioCount: 0,
    byGeneratorKind: {},
    plannedPaths: [],
    observedPlannedPaths: [],
    unresolvedPaths: [],
  };

  output.scenarios.forEach((scenario, index) => {
    if (!scenario.automationHints) scenario.automationHints = {};
    if (!Array.isArray(scenario.automationHints.reasons)) scenario.automationHints.reasons = [];
    const originalReasons = [...scenario.automationHints.reasons];
    const bindings = [];
    const unresolved = [];
    const runtimePending = [];

    let body = plain(scenario?.request?.body) ? scenario.request.body : null;
    if (!body && isSuccessOrientedScenario(scenario) && baselineSelectors.length) {
      if (!scenario.request || typeof scenario.request !== 'object') scenario.request = {};
      scenario.request.body = {};
      body = scenario.request.body;
    }
    const leaves = body ? bodyLeaves(body) : [];
    const sensitiveBodySelectors = sanitizerSelectors(secretSafeDiagnostics, index, 'BODY');
    const requiredSelectors = requiredBodySelectors(schema);
    const observedMetadataSelectors = unique((observedTestData?.values || [])
      .filter((item) => item?.target === 'BODY' && item?.selector)
      .map((item) => item.selector));
    const intentSelectorUniverse = unique([
      ...leaves.map((item) => item.selector),
      ...sensitiveBodySelectors,
      ...requiredSelectors.map((item) => item.selector),
      ...baselineSelectors.map((item) => item.selector),
      ...observedMetadataSelectors,
    ]);
    const generalMutationIntent = inferGeneralBodyMutationIntent(scenario);
    const mutationIntentTargets = inferBodyMutationIntentTargets(scenario, intentSelectorUniverse);

    if (generalMutationIntent || mutationIntentTargets.size) {
      diagnostics.intentAwareScenarioCount += 1;
      if (generalMutationIntent) {
        diagnostics.intentTargetCount += 1;
        diagnostics.intentOmissionSatisfiedCount += 1;
        if (diagnostics.intentTargets.length < 80) diagnostics.intentTargets.push(`${scenario.scenarioId}:BODY:$:${generalMutationIntent.kind}`);
      }
      diagnostics.intentTargetCount += mutationIntentTargets.size;
      for (const [selector, intent] of mutationIntentTargets) {
        if (diagnostics.intentTargets.length < 80) diagnostics.intentTargets.push(`${scenario.scenarioId}:BODY:${selector}:${intent.kind}`);
      }
    }

    const candidates = new Map(leaves.map((item) => [item.selector, {
      value: item.value,
      node: nodeAtBodySelector(schema, item.selector),
      observedSeed: false,
    }]));
    for (const selector of sensitiveBodySelectors) {
      if (!candidates.has(selector)) candidates.set(selector, { value: undefined, node: nodeAtBodySelector(schema, selector), observedSeed: false });
    }
    if (body && scenario.automationHints.needsData === true && !generalMutationIntent) {
      for (const item of requiredSelectors) {
        if (!candidates.has(item.selector)) candidates.set(item.selector, { value: undefined, node: item.node, observedSeed: false });
      }
    }
    if (body && isSuccessOrientedScenario(scenario) && !generalMutationIntent) {
      for (const item of baselineSelectors) {
        if (!candidates.has(item.selector)) {
          candidates.set(item.selector, {
            value: undefined,
            node: nodeAtBodySelector(schema, item.selector),
            observedSeed: true,
            observedValueType: item.valueType,
          });
        }
      }
    }
    for (const [selector] of mutationIntentTargets) {
      if (!candidates.has(selector)) {
        const baseline = baselineSelectors.find((item) => item.selector === selector);
        candidates.set(selector, {
          value: undefined,
          node: nodeAtBodySelector(schema, selector),
          observedSeed: Boolean(baseline),
          observedValueType: baseline?.valueType || null,
        });
      }
    }

    for (const [selector, candidate] of candidates) {
      const sampleValue = candidate.value;
      const node = candidate.node;
      const explicit = explicitBinding(context, 'BODY', selector);
      const observed = observedCoverage(observedTestData, context, 'BODY', selector);
      if (explicit?.ambiguous) {
        unresolved.push({ target: 'BODY', selector, source: isSensitiveTestDataSelector('BODY', selector) ? 'SECRET' : 'FIXED', code: explicit.incompleteCoverage ? 'TEST_DATA_BINDING_COVERAGE_INCOMPLETE' : 'TEST_DATA_BINDING_AMBIGUOUS' });
        deleteBodySelector(body, selector);
        continue;
      }
      const sensitiveSelector = sensitiveBodySelectors.includes(selector) || isSensitiveTestDataSelector('BODY', selector);
      let classified = classifySource('BODY', selector, node, sampleValue, explicit, sensitiveSelector, observed);
      const mutationIntent = mutationIntentTargets.get(selector);
      if (mutationIntent && !explicit && mutationIntent.kind === 'OMIT') {
        diagnostics.intentOmissionSatisfiedCount += 1;
        deleteBodySelector(body, selector);
        continue;
      }
      if (mutationIntent && !explicit && mutationIntent.kind.startsWith('DUPLICATE_') && !sensitiveSelector) {
        if (observed?.any && observed.complete === true) {
          classified = { source: 'OBSERVED', securityMismatch: false, coverageIncomplete: false };
          diagnostics.intentDuplicateObservedReuseCount += 1;
        } else {
          diagnostics.intentBlockedAutoBindingCount += 1;
          unresolved.push({
            target: 'BODY', selector, source: 'MUTATION', code: 'TEST_DATA_DUPLICATE_INTENT_REQUIRES_OBSERVED_OR_EXPLICIT_STRATEGY',
            mutationKind: mutationIntent.kind, blockedSource: classified.source,
          });
          deleteBodySelector(body, selector);
          continue;
        }
      }
      const source = classified.source;
      if (mutationIntent && !explicit && !mutationIntent.kind.startsWith('DUPLICATE_') && (source === 'OBSERVED' || source === 'GENERATED')) {
        diagnostics.intentBlockedAutoBindingCount += 1;
        if (source === 'OBSERVED') diagnostics.intentBlockedObservedCount += 1;
        if (source === 'GENERATED') diagnostics.intentBlockedGeneratedCount += 1;
        unresolved.push({
          target: 'BODY', selector, source: 'MUTATION', code: 'TEST_DATA_MUTATION_INTENT_REQUIRES_EXPLICIT_STRATEGY',
          mutationKind: mutationIntent.kind, blockedSource: source,
        });
        deleteBodySelector(body, selector);
        continue;
      }
      if (classified.securityMismatch) {
        unresolved.push({ target: 'BODY', selector, source: 'SECRET', code: 'TEST_DATA_SECRET_SOURCE_REQUIRED' });
        deleteBodySelector(body, selector);
        continue;
      }
      if (source === 'OBSERVED' && classified.coverageIncomplete) {
        diagnostics.observedCoverageIncompleteCount += 1;
        unresolved.push({ target: 'BODY', selector, source: 'OBSERVED', code: 'TEST_DATA_OBSERVED_COVERAGE_INCOMPLETE' });
        deleteBodySelector(body, selector);
        continue;
      }
      if ((source === 'FIXED' || source === 'SECRET') && !explicit) {
        unresolved.push({ target: 'BODY', selector, source, code: `TEST_DATA_${source}_REQUIRED` });
        deleteBodySelector(body, selector);
        continue;
      }
      if (source === 'SECRET' && explicit?.secretConfigured !== true) {
        unresolved.push({ target: 'BODY', selector, source, code: 'TEST_DATA_SECRET_NOT_CONFIGURED' });
        deleteBodySelector(body, selector);
        continue;
      }
      bindings.push(bindingDescriptor({
        target: 'BODY',
        selector,
        source,
        node,
        sampleValue,
        explicit,
        observedValueType: observed.valueType || candidate.observedValueType || null,
      }));
      if (source === 'OBSERVED' && observedRuntimeEnabled !== true) runtimePending.push({ target: 'BODY', selector });
      deleteBodySelector(body, selector);
    }

    const pathNames = unique([
      ...Object.keys(scenario?.request?.pathParams || {}),
      ...pathPlaceholderNames(context?.endpoint?.normalizedPath),
      ...sanitizerSelectors(secretSafeDiagnostics, index, 'PATH_PARAM'),
    ]);
    for (const name of pathNames) {
      const explicit = explicitBinding(context, 'PATH_PARAM', name);
      const sampleValue = scenario?.request?.pathParams?.[name];
      if (explicit?.ambiguous) unresolved.push({ target: 'PATH_PARAM', selector: name, source: 'FIXED', code: explicit.incompleteCoverage ? 'TEST_DATA_BINDING_COVERAGE_INCOMPLETE' : 'TEST_DATA_BINDING_AMBIGUOUS' });
      else {
        const classified = classifySource('PATH_PARAM', name, null, sampleValue, explicit, false, null);
        if (classified.securityMismatch) unresolved.push({ target: 'PATH_PARAM', selector: name, source: 'SECRET', code: 'TEST_DATA_SECRET_SOURCE_REQUIRED' });
        else if (!explicit && classified.source !== 'GENERATED') unresolved.push({ target: 'PATH_PARAM', selector: name, source: classified.source, code: `TEST_DATA_${classified.source}_REQUIRED` });
        else if (classified.source === 'SECRET' && explicit?.secretConfigured !== true) unresolved.push({ target: 'PATH_PARAM', selector: name, source: 'SECRET', code: 'TEST_DATA_SECRET_NOT_CONFIGURED' });
        else bindings.push(bindingDescriptor({ target: 'PATH_PARAM', selector: name, source: classified.source, node: null, sampleValue, explicit }));
      }
      if (scenario?.request?.pathParams) delete scenario.request.pathParams[name];
    }

    const queryNames = unique([
      ...Object.keys(scenario?.request?.query || {}),
      ...sanitizerSelectors(secretSafeDiagnostics, index, 'QUERY'),
    ]);
    for (const name of queryNames) {
      const explicit = explicitBinding(context, 'QUERY', name);
      const sampleValue = scenario?.request?.query?.[name];
      if (explicit?.ambiguous) unresolved.push({ target: 'QUERY', selector: name, source: 'FIXED', code: explicit.incompleteCoverage ? 'TEST_DATA_BINDING_COVERAGE_INCOMPLETE' : 'TEST_DATA_BINDING_AMBIGUOUS' });
      else {
        const classified = classifySource('QUERY', name, null, sampleValue, explicit, sanitizerSelectors(secretSafeDiagnostics, index, 'QUERY').includes(name), null);
        if (classified.securityMismatch) unresolved.push({ target: 'QUERY', selector: name, source: 'SECRET', code: 'TEST_DATA_SECRET_SOURCE_REQUIRED' });
        else if ((classified.source === 'FIXED' || classified.source === 'SECRET') && !explicit) unresolved.push({ target: 'QUERY', selector: name, source: classified.source, code: `TEST_DATA_${classified.source}_REQUIRED` });
        else if (classified.source === 'SECRET' && explicit?.secretConfigured !== true) unresolved.push({ target: 'QUERY', selector: name, source: 'SECRET', code: 'TEST_DATA_SECRET_NOT_CONFIGURED' });
        else bindings.push(bindingDescriptor({ target: 'QUERY', selector: name, source: classified.source, node: null, sampleValue, explicit }));
      }
      if (scenario?.request?.query) delete scenario.request.query[name];
    }

    if (bindings.length || unresolved.length) {
      diagnostics.plannedScenarioCount += 1;
      plansByScenarioId[scenario.scenarioId] = { contractVersion: TEST_DATA_BINDINGS_CONTRACT_VERSION, bindings };
    }
    for (const binding of bindings) {
      diagnostics.bindingCount += 1;
      if (binding.source === 'GENERATED') {
        diagnostics.generatedCount += 1;
        diagnostics.byGeneratorKind[binding.generator.kind] = (diagnostics.byGeneratorKind[binding.generator.kind] || 0) + 1;
      } else if (binding.source === 'FIXED') diagnostics.fixedCount += 1;
      else if (binding.source === 'SECRET') diagnostics.secretCount += 1;
      else if (binding.source === 'OBSERVED') {
        diagnostics.observedCount += 1;
        diagnostics.observedPlannedPaths.push(`${scenario.scenarioId}:${binding.target}:${binding.selector}`);
      }
      diagnostics.plannedPaths.push(`${scenario.scenarioId}:${binding.target}:${binding.selector}`);
    }
    for (const item of unresolved) {
      diagnostics.unresolvedCount += 1;
      diagnostics.unresolvedPaths.push(`${scenario.scenarioId}:${item.target}:${item.selector}:${item.source}`);
      if (item.code === 'TEST_DATA_OBSERVED_COVERAGE_INCOMPLETE') {
        addReason(scenario, `QAgent Observed Test Data: ${item.target} ${item.selector} não possui massa 2xx segura em todos os Environments observados; capture massa nesse Environment ou configure FIXED.`);
      } else if (item.code === 'TEST_DATA_MUTATION_INTENT_REQUIRES_EXPLICIT_STRATEGY') {
        scenario.automationHints.reviewRequired = true;
        addReason(scenario, `${INTENT_REASON_PREFIX} ${item.target} ${item.selector} é o alvo provável de ${item.mutationKind}; o Planner não reutilizou massa 2xx nem gerou um valor válido automaticamente. Configure uma massa/mutação explícita ou revise o cenário.`);
      } else if (item.code === 'TEST_DATA_DUPLICATE_INTENT_REQUIRES_OBSERVED_OR_EXPLICIT_STRATEGY') {
        scenario.automationHints.reviewRequired = true;
        addReason(scenario, `${INTENT_REASON_PREFIX} ${item.target} ${item.selector} é o alvo provável de ${item.mutationKind}; não há valor observado 2xx com cobertura suficiente para reproduzir a duplicidade. Capture uma massa existente ou configure FIXED explicitamente.`);
      } else {
        addReason(scenario, `Test Data: configure ${item.source} para ${item.target} ${item.selector} no escopo apropriado.`);
      }
    }
    for (const item of runtimePending) {
      diagnostics.observedRuntimePendingCount += 1;
      addReason(scenario, `${OBSERVED_RUNTIME_REASON_PREFIX} ${item.target} ${item.selector} está disponível no Reservoir e será resolvido no runtime.`);
    }

    if (bindings.length && unresolved.length === 0 && runtimePending.length === 0) {
      stripReason(scenario, (reason) => reason === GENERIC_BODY_NEEDS_DATA || reason === PATH_NEEDS_DATA || reason.startsWith(SECRET_GUARD_PREFIX) || reason.startsWith(OBSERVED_RUNTIME_REASON_PREFIX) || reason.startsWith(INTENT_REASON_PREFIX));
      if (canPlannerClearNeedsData({ scenario, scenarioId: scenario.scenarioId, semanticDiagnostics, originalReasons })) {
        scenario.automationHints.needsData = false;
        diagnostics.readyDataScenarioCount += 1;
      }
    } else if (unresolved.length > 0 || runtimePending.length > 0) {
      scenario.automationHints.needsData = true;
    }
  });

  diagnostics.plannedPaths = diagnostics.plannedPaths.slice(0, 80);
  diagnostics.observedPlannedPaths = diagnostics.observedPlannedPaths.slice(0, 80);
  diagnostics.intentTargets = diagnostics.intentTargets.slice(0, 80);
  diagnostics.unresolvedPaths = diagnostics.unresolvedPaths.slice(0, 80);
  return { output, plansByScenarioId, diagnostics };
}

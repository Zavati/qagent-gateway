export const TEST_DATA_PLANNER_VERSION = 'qagent.test-data-planner.v1';
export const TEST_DATA_BINDINGS_CONTRACT_VERSION = 'qagent.test-data-bindings.v1';

const GENERIC_BODY_NEEDS_DATA = 'O formato do body é modelado, mas seus valores precisam ser fornecidos por massa de teste controlada.';
const SECRET_GUARD_PREFIX = 'QAgent Secret Guard:';

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

function sensitivePathsForScenario(secretSafeDiagnostics, index) {
  const prefix = `modelOutput.scenarios[${index}].request.body.`;
  return (secretSafeDiagnostics?.sanitizedPaths || [])
    .filter((path) => String(path).startsWith(prefix))
    .map((path) => `$.${String(path).slice(prefix.length)}`)
    .filter((selector) => /^\$\.[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(selector));
}

function fieldName(selector) { return String(selector || '').split('.').pop() || ''; }
function lowerName(selector) { return fieldName(selector).replace(/[-_.]/g, '').toLowerCase(); }
function looksReferential(selector) {
  const name = fieldName(selector);
  return /(^id$|Id$|ID$|_id$|_uuid$|Uuid$|UUID$)/.test(name)
    || /^(customer|user|account|order|product|model|make|school|classroom|tenant|organization|project|store|company|vehicle|invoice|payment)(id|uuid)$/i.test(name);
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

function explicitBinding(context, target, selector) {
  const all = context?.testData?.configuredBindings || [];
  const matches = all.filter((item) => item?.target === target && item?.selector === selector);
  if (!matches.length) return null;
  const environmentIds = unique(context?.environments?.map((item) => item.environmentId));
  const eligible = environmentIds.length ? matches.filter((item) => environmentIds.includes(item.environmentId)) : matches;
  const source = eligible.length ? eligible : matches;
  const signatures = unique(source.map((item) => `${item.sourceType}|${item.valueType}|${item.generatorKind || ''}`));
  if (signatures.length !== 1) return { ambiguous: true };
  return { ...source[0], ambiguous: false };
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

function bindingDescriptor({ target, selector, source, node, sampleValue, explicit }) {
  const base = {
    target,
    selector,
    source,
    valueType: explicit?.valueType || valueTypeFor(node, sampleValue),
  };
  if (source === 'GENERATED') {
    return {
      ...base,
      generator: {
        kind: explicit?.generatorKind || generatorFor(selector, node, sampleValue),
        config: clone(explicit?.generatorConfig || (node ? { schema: clone(node) } : {})),
      },
    };
  }
  return { ...base, bindingKey: `${target}:${selector}` };
}

export function applyTestDataPlannerV1(modelOutput, context, { secretSafeDiagnostics = null } = {}) {
  const output = clone(modelOutput);
  const schema = requestSchema(context);
  const plansByScenarioId = {};
  const diagnostics = {
    plannerVersion: TEST_DATA_PLANNER_VERSION,
    plannedScenarioCount: 0,
    bindingCount: 0,
    generatedCount: 0,
    fixedCount: 0,
    secretCount: 0,
    unresolvedCount: 0,
    readyDataScenarioCount: 0,
    byGeneratorKind: {},
    plannedPaths: [],
    unresolvedPaths: [],
  };

  output.scenarios.forEach((scenario, index) => {
    if (!scenario.automationHints) scenario.automationHints = {};
    if (!Array.isArray(scenario.automationHints.reasons)) scenario.automationHints.reasons = [];
    const bindings = [];
    const unresolved = [];
    const body = plain(scenario?.request?.body) ? scenario.request.body : null;
    const leaves = body ? bodyLeaves(body) : [];
    const sensitiveSelectors = sensitivePathsForScenario(secretSafeDiagnostics, index);
    const candidates = new Map(leaves.map((item) => [item.selector, item.value]));
    for (const selector of sensitiveSelectors) if (!candidates.has(selector)) candidates.set(selector, undefined);

    for (const [selector, sampleValue] of candidates) {
      const node = nodeAtBodySelector(schema, selector);
      const explicit = explicitBinding(context, 'BODY', selector);
      if (explicit?.ambiguous) {
        unresolved.push({ target: 'BODY', selector, source: 'FIXED', code: 'TEST_DATA_BINDING_AMBIGUOUS' });
        continue;
      }
      const isSensitive = sensitiveSelectors.includes(selector);
      let source;
      if (explicit) source = explicit.sourceType;
      else if (isSensitive) source = 'SECRET';
      else if (looksReferential(selector)) source = 'FIXED';
      else if (node || sampleValue !== undefined) source = 'GENERATED';
      else source = 'FIXED';

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
      bindings.push(bindingDescriptor({ target: 'BODY', selector, source, node, sampleValue, explicit }));
      deleteBodySelector(body, selector);
    }

    for (const [name] of Object.entries(scenario?.request?.pathParams || {})) {
      const explicit = explicitBinding(context, 'PATH_PARAM', name);
      if (!explicit || explicit.ambiguous) unresolved.push({ target: 'PATH_PARAM', selector: name, source: 'FIXED', code: explicit?.ambiguous ? 'TEST_DATA_BINDING_AMBIGUOUS' : 'TEST_DATA_FIXED_REQUIRED' });
      else if (explicit.sourceType === 'SECRET' && explicit.secretConfigured !== true) unresolved.push({ target: 'PATH_PARAM', selector: name, source: 'SECRET', code: 'TEST_DATA_SECRET_NOT_CONFIGURED' });
      else bindings.push(bindingDescriptor({ target: 'PATH_PARAM', selector: name, source: explicit.sourceType, node: null, sampleValue: scenario.request.pathParams[name], explicit }));
      delete scenario.request.pathParams[name];
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
      diagnostics.plannedPaths.push(`${scenario.scenarioId}:${binding.target}:${binding.selector}`);
    }
    for (const item of unresolved) {
      diagnostics.unresolvedCount += 1;
      diagnostics.unresolvedPaths.push(`${scenario.scenarioId}:${item.target}:${item.selector}:${item.source}`);
      addReason(scenario, `Test Data: configure ${item.source} para ${item.target} ${item.selector} no Environment.`);
    }

    if (bindings.length && unresolved.length === 0) {
      stripReason(scenario, (reason) => reason === GENERIC_BODY_NEEDS_DATA || reason.startsWith(SECRET_GUARD_PREFIX) || reason.includes('Valores de path params precisam ser fornecidos'));
      const remainingReasons = scenario.automationHints.reasons || [];
      const dataReasonLeft = remainingReasons.some((reason) => /massa de teste|Test Data: configure|Secret Guard|path params/i.test(reason));
      if (!dataReasonLeft) scenario.automationHints.needsData = false;
      diagnostics.readyDataScenarioCount += 1;
    } else if (unresolved.length > 0) {
      scenario.automationHints.needsData = true;
    }
  });

  diagnostics.plannedPaths = diagnostics.plannedPaths.slice(0, 80);
  diagnostics.unresolvedPaths = diagnostics.unresolvedPaths.slice(0, 80);
  return { output, plansByScenarioId, diagnostics };
}

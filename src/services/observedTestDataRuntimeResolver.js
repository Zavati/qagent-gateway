import {
  getCatalogObservedRequestSamplesForTestDesign,
  getCatalogObservedTestDataForTestDesign,
} from '../intelligence/catalogKnowledgeClient.js';
import { isSensitiveTestDataSelector } from '../lib/testDataPolicy.js';

export const OBSERVED_TEST_DATA_RUNTIME_RESOLUTION_VERSION = 'qagent.observed-test-data-runtime-resolution.v1';

const BODY_SELECTOR = /^\$\.[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/;
const FORBIDDEN_MARKERS = ['[REDACTED]', '[TRUNCATED]', '__qagent_redacted__', '__qagent_truncated__'];
const VALUE_TYPES = new Set(['STRING', 'INTEGER', 'NUMBER', 'BOOLEAN', 'JSON']);

function runtimeError(message, code, status = 409, publicDetails = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (publicDetails) error.publicDetails = publicDetails;
  throw error;
}

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function safeSelector(target, selector) {
  const normalizedTarget = String(target || '').trim().toUpperCase();
  const normalizedSelector = text(selector);
  if (normalizedTarget !== 'BODY' || !normalizedSelector || !BODY_SELECTOR.test(normalizedSelector)) return null;
  if (isSensitiveTestDataSelector(normalizedTarget, normalizedSelector)) return null;
  return normalizedSelector;
}

function normalizedValueType(value) {
  const type = String(value || '').trim().toUpperCase();
  return VALUE_TYPES.has(type) ? type : null;
}

function containsForbiddenMarker(value) {
  if (typeof value !== 'string') return false;
  return FORBIDDEN_MARKERS.some((marker) => value.includes(marker));
}

function serializedByteLength(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function valueMatchesType(value, valueType) {
  if (value == null) return false;
  if (containsForbiddenMarker(value)) return false;
  if (valueType === 'STRING') return typeof value === 'string' && new TextEncoder().encode(value).byteLength <= 4096;
  if (valueType === 'INTEGER') return typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value);
  if (valueType === 'NUMBER') return typeof value === 'number' && Number.isFinite(value);
  if (valueType === 'BOOLEAN') return typeof value === 'boolean';
  if (valueType === 'JSON') return typeof value === 'object' && serializedByteLength(value) <= 16_384;
  return false;
}

function valuesEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }
  return false;
}

function bindingKey(binding) {
  return String(binding?.bindingKey || `${binding?.target}:${binding?.selector}`).trim();
}

function collectObservedScenarioBindings(selectedScenarios) {
  const groups = [];
  const descriptors = new Map();
  for (let index = 0; index < selectedScenarios.length; index += 1) {
    const scenario = selectedScenarios[index];
    const scenarioId = String(scenario?.scenarioId || '').trim();
    const observed = [];
    for (const binding of scenario?.spec?.testData?.bindings || []) {
      if (String(binding?.source || '').trim().toUpperCase() !== 'OBSERVED') continue;
      const target = String(binding?.target || '').trim().toUpperCase();
      const selector = safeSelector(target, binding?.selector);
      const valueType = normalizedValueType(binding?.valueType);
      const key = bindingKey(binding);
      if (!selector || !valueType || key !== `${target}:${selector}`) {
        runtimeError('Binding OBSERVED inválido para resolução de runtime.', 'RUN_OBSERVED_TEST_DATA_BINDING_INVALID', 409, {
          scenarioId: scenarioId || null,
          bindingKey: key || null,
        });
      }
      const descriptor = { scenarioId, target, selector, valueType, bindingKey: key };
      const existing = descriptors.get(key);
      if (existing && (existing.selector !== selector || existing.valueType !== valueType || existing.target !== target)) {
        runtimeError('Binding OBSERVED possui definição inconsistente entre cenários.', 'RUN_OBSERVED_TEST_DATA_BINDING_CONFLICT', 409, {
          bindingKey: key,
        });
      }
      descriptors.set(key, existing || descriptor);
      observed.push(existing || descriptor);
    }
    if (observed.length) groups.push({ scenarioId, scenarioIndex: index, bindings: observed });
  }
  groups.sort((a, b) => b.bindings.length - a.bindings.length || a.scenarioIndex - b.scenarioIndex);
  return { groups, descriptors };
}

function normalizeSample(sample, environmentId) {
  if (text(sample?.environmentId) !== environmentId || nonNegativeInteger(sample?.successCount) <= 0) return null;
  const values = new Map();
  for (const item of Array.isArray(sample?.values) ? sample.values : []) {
    const target = String(item?.target || '').trim().toUpperCase();
    const selector = safeSelector(target, item?.selector);
    const valueType = normalizedValueType(item?.valueType);
    if (!selector || !valueType || !valueMatchesType(item?.value, valueType)) continue;
    values.set(`${target}:${selector}`, { target, selector, valueType, value: structuredClone(item.value) });
  }
  if (!values.size) return null;
  return {
    sampleFingerprint: text(sample?.sampleFingerprint),
    environmentId,
    encoding: text(sample?.encoding)?.toUpperCase() || null,
    observationCount: nonNegativeInteger(sample?.observationCount),
    successCount: nonNegativeInteger(sample?.successCount),
    lastSeenAt: text(sample?.lastSeenAt),
    values,
  };
}

function sampleMatchesGroup(sample, group, frozenByBindingKey) {
  for (const descriptor of group.bindings) {
    const candidate = sample.values.get(descriptor.bindingKey);
    if (!candidate || candidate.valueType !== descriptor.valueType) return false;
    const frozen = frozenByBindingKey[descriptor.bindingKey];
    if (frozen && !valuesEqual(frozen.value, candidate.value)) return false;
  }
  return true;
}

function freezeFromSample({ sample, group, frozenByBindingKey, provenanceByBindingKey }) {
  for (const descriptor of group.bindings) {
    if (frozenByBindingKey[descriptor.bindingKey]) continue;
    const candidate = sample.values.get(descriptor.bindingKey);
    frozenByBindingKey[descriptor.bindingKey] = {
      target: descriptor.target,
      selector: descriptor.selector,
      valueType: descriptor.valueType,
      value: structuredClone(candidate.value),
    };
    provenanceByBindingKey[descriptor.bindingKey] = {
      source: 'OBSERVED',
      resolutionMode: 'CORRELATED_SAMPLE',
      environmentId: sample.environmentId,
      sampleFingerprint: sample.sampleFingerprint,
      encoding: sample.encoding,
      observationCount: sample.observationCount,
      successCount: sample.successCount,
      lastSeenAt: sample.lastSeenAt,
    };
  }
}

function normalizeScalarCandidate(item, descriptor, environmentId) {
  const target = String(item?.target || '').trim().toUpperCase();
  const selector = safeSelector(target, item?.selector);
  const valueType = normalizedValueType(item?.valueType);
  if (
    text(item?.environmentId) !== environmentId
    || nonNegativeInteger(item?.successCount) <= 0
    || target !== descriptor.target
    || selector !== descriptor.selector
    || valueType !== descriptor.valueType
    || !valueMatchesType(item?.value, valueType)
  ) return null;
  return {
    value: structuredClone(item.value),
    valueFingerprint: text(item?.valueFingerprint),
    observationCount: nonNegativeInteger(item?.observationCount),
    successCount: nonNegativeInteger(item?.successCount),
    lastSeenAt: text(item?.lastSeenAt),
  };
}

export async function resolveObservedTestDataForRun({
  env,
  organizationId,
  projectId,
  endpointId,
  environmentId,
  selectedScenarios = [],
  loadSamples = getCatalogObservedRequestSamplesForTestDesign,
  loadValues = getCatalogObservedTestDataForTestDesign,
} = {}) {
  const startedAt = Date.now();
  const { groups, descriptors } = collectObservedScenarioBindings(selectedScenarios);
  if (!descriptors.size) {
    return {
      contractVersion: OBSERVED_TEST_DATA_RUNTIME_RESOLUTION_VERSION,
      frozenByBindingKey: {},
      provenanceByBindingKey: {},
      resolvedCount: 0,
      correlatedSampleBindingCount: 0,
      scalarFallbackBindingCount: 0,
      durationMs: Math.max(0, Date.now() - startedAt),
    };
  }

  const rawSamples = await loadSamples({
    env,
    organizationId,
    projectId,
    endpointId,
    environmentId,
    outcomeClass: 'HTTP_2XX',
    limit: 100,
  });
  const samples = (Array.isArray(rawSamples) ? rawSamples : [])
    .map((sample) => normalizeSample(sample, environmentId))
    .filter(Boolean);

  const frozenByBindingKey = {};
  const provenanceByBindingKey = {};
  let correlatedSampleBindingCount = 0;
  let scalarFallbackBindingCount = 0;

  for (const group of groups) {
    if (group.bindings.every((descriptor) => frozenByBindingKey[descriptor.bindingKey])) continue;
    const sample = samples.find((candidate) => sampleMatchesGroup(candidate, group, frozenByBindingKey));
    if (sample) {
      const before = Object.keys(frozenByBindingKey).length;
      freezeFromSample({ sample, group, frozenByBindingKey, provenanceByBindingKey });
      correlatedSampleBindingCount += Object.keys(frozenByBindingKey).length - before;
      continue;
    }

    const unresolved = group.bindings.filter((descriptor) => !frozenByBindingKey[descriptor.bindingKey]);
    if (group.bindings.length > 1 || unresolved.length > 1) {
      runtimeError(
        'Não existe request sample 2xx correlacionado capaz de resolver todos os bindings OBSERVED do cenário.',
        'RUN_OBSERVED_TEST_DATA_CORRELATED_SAMPLE_MISSING',
        409,
        { scenarioId: group.scenarioId || null, bindingKeys: group.bindings.map((item) => item.bindingKey).sort() },
      );
    }

    const descriptor = unresolved[0];
    if (!descriptor) continue;
    const candidates = await loadValues({
      env,
      organizationId,
      projectId,
      endpointId,
      environmentId,
      selector: descriptor.selector,
      outcomeClass: 'HTTP_2XX',
      limit: 50,
    });
    const selected = (Array.isArray(candidates) ? candidates : [])
      .map((item) => normalizeScalarCandidate(item, descriptor, environmentId))
      .find(Boolean);
    if (!selected) {
      runtimeError(
        'Não existe valor 2xx seguro no Reservoir para o binding OBSERVED requerido pelo Run.',
        'RUN_OBSERVED_TEST_DATA_UNAVAILABLE',
        409,
        { scenarioId: group.scenarioId || null, bindingKey: descriptor.bindingKey },
      );
    }
    frozenByBindingKey[descriptor.bindingKey] = {
      target: descriptor.target,
      selector: descriptor.selector,
      valueType: descriptor.valueType,
      value: structuredClone(selected.value),
    };
    provenanceByBindingKey[descriptor.bindingKey] = {
      source: 'OBSERVED',
      resolutionMode: 'SCALAR_FALLBACK',
      environmentId,
      valueFingerprint: selected.valueFingerprint,
      observationCount: selected.observationCount,
      successCount: selected.successCount,
      lastSeenAt: selected.lastSeenAt,
    };
    scalarFallbackBindingCount += 1;
  }

  for (const descriptor of descriptors.values()) {
    if (!frozenByBindingKey[descriptor.bindingKey]) {
      runtimeError('Binding OBSERVED não foi resolvido de forma determinística.', 'RUN_OBSERVED_TEST_DATA_UNAVAILABLE', 409, {
        bindingKey: descriptor.bindingKey,
      });
    }
  }

  return {
    contractVersion: OBSERVED_TEST_DATA_RUNTIME_RESOLUTION_VERSION,
    frozenByBindingKey,
    provenanceByBindingKey,
    resolvedCount: Object.keys(frozenByBindingKey).length,
    correlatedSampleBindingCount,
    scalarFallbackBindingCount,
    durationMs: Math.max(0, Date.now() - startedAt),
  };
}

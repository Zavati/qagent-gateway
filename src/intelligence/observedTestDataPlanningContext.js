import { isSensitiveTestDataSelector } from '../lib/testDataPolicy.js';

export const OBSERVED_TEST_DATA_PLANNING_CONTEXT_VERSION = 'qagent.observed-test-data-planning-context.v1';

const VALUE_TYPES = new Set(['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'JSON']);
const ENCODINGS = new Set(['JSON', 'FORM_URLENCODED']);

function nullableString(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && Number.isInteger(number) && number >= 0 ? number : 0;
}

function safeBodySelector(value) {
  const selector = nullableString(value);
  if (!selector || !/^\$\.[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(selector)) return null;
  if (isSensitiveTestDataSelector('BODY', selector)) return null;
  return selector;
}

function safeValueType(value) {
  const type = nullableString(value)?.toUpperCase() || null;
  return type && VALUE_TYPES.has(type) ? type : null;
}

function allowedEnvironment(environmentId, allowed) {
  return !allowed.size || allowed.has(environmentId);
}

function valueMetadata(item, allowedEnvironments) {
  const environmentId = nullableString(item?.environmentId);
  const selector = safeBodySelector(item?.selector);
  const valueType = safeValueType(item?.valueType);
  if (!environmentId || !selector || !valueType || !allowedEnvironment(environmentId, allowedEnvironments)) return null;
  return {
    environmentId,
    target: 'BODY',
    selector,
    valueType,
    observationCount: nonNegativeInteger(item?.observationCount),
    successCount: nonNegativeInteger(item?.successCount),
    clientErrorCount: nonNegativeInteger(item?.clientErrorCount),
    serverErrorCount: nonNegativeInteger(item?.serverErrorCount),
    lastSeenAt: nullableString(item?.lastSeenAt),
  };
}

function sampleMetadata(item, allowedEnvironments) {
  const environmentId = nullableString(item?.environmentId);
  const encoding = nullableString(item?.encoding)?.toUpperCase() || null;
  if (!environmentId || !allowedEnvironment(environmentId, allowedEnvironments) || !ENCODINGS.has(encoding)) return null;
  const selectors = [];
  const seen = new Set();
  for (const value of Array.isArray(item?.values) ? item.values : []) {
    const selector = safeBodySelector(value?.selector);
    const valueType = safeValueType(value?.valueType);
    if (!selector || !valueType || seen.has(selector)) continue;
    seen.add(selector);
    selectors.push({ target: 'BODY', selector, valueType });
  }
  if (!selectors.length) return null;
  selectors.sort((a, b) => a.selector.localeCompare(b.selector));
  return {
    environmentId,
    encoding,
    selectors,
    observationCount: nonNegativeInteger(item?.observationCount),
    successCount: nonNegativeInteger(item?.successCount),
    clientErrorCount: nonNegativeInteger(item?.clientErrorCount),
    serverErrorCount: nonNegativeInteger(item?.serverErrorCount),
    lastSeenAt: nullableString(item?.lastSeenAt),
  };
}

function rankObserved(a, b) {
  return b.successCount - a.successCount
    || b.observationCount - a.observationCount
    || String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || ''));
}

export function buildObservedTestDataPlanningContext({ values = [], samples = [], environmentIds = [] } = {}) {
  const allowedEnvironments = new Set((environmentIds || []).map(nullableString).filter(Boolean));
  const mappedValues = (Array.isArray(values) ? values : [])
    .map((item) => valueMetadata(item, allowedEnvironments))
    .filter(Boolean)
    .sort(rankObserved)
    .slice(0, 100);
  const mappedSamples = (Array.isArray(samples) ? samples : [])
    .map((item) => sampleMetadata(item, allowedEnvironments))
    .filter(Boolean)
    .sort(rankObserved)
    .slice(0, 50);

  return {
    contractVersion: OBSERVED_TEST_DATA_PLANNING_CONTEXT_VERSION,
    values: mappedValues,
    samples: mappedSamples,
  };
}

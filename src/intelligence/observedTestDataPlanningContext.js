import { isSensitiveTestDataSelector } from '../lib/testDataPolicy.js';

export const OBSERVED_TEST_DATA_PLANNING_CONTEXT_VERSION = 'qagent.observed-test-data-planning-context.v1';

const VALUE_TYPES = new Set(['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'JSON']);
const TARGETS = new Set(['BODY', 'QUERY', 'PATH_PARAM']);
const ENCODINGS = new Set(['JSON', 'FORM_URLENCODED', 'QUERY', 'PATH']);

function nullableString(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && Number.isInteger(number) && number >= 0 ? number : 0;
}

function safeTarget(value) {
  // Rolling compatibility:
  // C2-D antigo é BODY-only e pode chegar sem target explícito.
  const target = nullableString(value)?.toUpperCase() || 'BODY';
  return TARGETS.has(target) ? target : null;
}

function safeBodySelector(value) {
  const selector = nullableString(value);
  if (!selector || !/^\$\.[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(selector)) return null;
  if (isSensitiveTestDataSelector('BODY', selector)) return null;
  return selector;
}

function safeQuerySelector(value) {
  const selector = nullableString(value);
  if (!selector || !/^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/.test(selector)) return null;
  if (isSensitiveTestDataSelector('QUERY', selector)) return null;
  return selector;
}

function safePathSelector(value) {
  const selector = nullableString(value);
  if (!selector || !/^(?:id|uuid|objectId|ulid)$/.test(selector)) return null;
  if (isSensitiveTestDataSelector('PATH_PARAM', selector)) return null;
  return selector;
}

function safeSelector(target, value) {
  if (target === 'BODY') return safeBodySelector(value);
  if (target === 'QUERY') return safeQuerySelector(value);
  if (target === 'PATH_PARAM') return safePathSelector(value);
  return null;
}

function strictNonNegativeInteger(value, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= max
    ? number
    : null;
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
  const target = safeTarget(item?.target);
  const selector = target ? safeSelector(target, item?.selector) : null;
  const valueType = safeValueType(item?.valueType);

  if (
    !environmentId
    || !target
    || !selector
    || !valueType
    || !allowedEnvironment(environmentId, allowedEnvironments)
  ) {
    return null;
  }

  return {
    environmentId,
    target,
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

  if (
    !environmentId
    || !allowedEnvironment(environmentId, allowedEnvironments)
    || !ENCODINGS.has(encoding)
  ) {
    return null;
  }

  const selectors = [];
  const seen = new Set();

  for (const value of Array.isArray(item?.values) ? item.values : []) {
    const target = safeTarget(value?.target);
    const selector = target ? safeSelector(target, value?.selector) : null;
    const valueType = safeValueType(value?.valueType);

    if (!target || !selector || !valueType) continue;

    let segmentIndex = null;
    let occurrence = null;
    let key = `${target}:${selector}`;

    if (target === 'PATH_PARAM') {
      segmentIndex =
        strictNonNegativeInteger(
          value?.segmentIndex,
          255,
        );

      occurrence =
        strictNonNegativeInteger(
          value?.occurrence,
          47,
        );

      if (
        segmentIndex == null
        || occurrence == null
        || valueType !== 'STRING'
      ) {
        continue;
      }

      key =
        `${target}:${selector}@${segmentIndex}:${occurrence}`;
    }

    if (seen.has(key)) continue;
    seen.add(key);

    selectors.push({
      target,
      selector,
      valueType,
      ...(target === 'PATH_PARAM'
        ? {
          segmentIndex,
          occurrence,
        }
        : {}),
    });
  }

  if (!selectors.length) return null;

  selectors.sort((a, b) => (
    a.target.localeCompare(b.target)
    || (
      a.target === 'PATH_PARAM'
      && b.target === 'PATH_PARAM'
        ? (
          Number(a.segmentIndex) - Number(b.segmentIndex)
          || Number(a.occurrence) - Number(b.occurrence)
        )
        : 0
    )
    || a.selector.localeCompare(b.selector)
  ));

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

export function buildObservedTestDataPlanningContext({
  values = [],
  samples = [],
  environmentIds = [],
} = {}) {
  const allowedEnvironments = new Set(
    (environmentIds || [])
      .map(nullableString)
      .filter(Boolean),
  );

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
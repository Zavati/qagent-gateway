import {
  getCatalogObservedRequestSamplesForTestDesign,
  getCatalogObservedTestDataForTestDesign,
} from '../intelligence/catalogKnowledgeClient.js';
import { isSensitiveTestDataSelector } from '../lib/testDataPolicy.js';

export const OBSERVED_TEST_DATA_RUNTIME_RESOLUTION_VERSION = 'qagent.observed-test-data-runtime-resolution.v1';

const BODY_SELECTOR = /^\$\.[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/;
const QUERY_SELECTOR = /^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/;
const PATH_SELECTOR = /^(?:id|uuid|objectId|ulid)$/;
const POSITIONAL_PATH_BINDING_KEY = /^PATH_PARAM:([A-Za-z_][A-Za-z0-9_.-]{0,119})@(\d{1,3}):(\d{1,2})$/;
const TARGETS = new Set(['BODY', 'QUERY', 'PATH_PARAM']);
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

/**
 * 07.7.8-C2-E — Observed QUERY Runtime
 *
 * Bindings novos precisam declarar BODY ou QUERY explicitamente.
 *
 * Registros históricos do C2-D podem não possuir target porque o Reservoir
 * originalmente era BODY-only. Nesses casos, legacyBody=true mantém
 * compatibilidade durante rolling deploy sem transformar bindings novos
 * incompletos em BODY silenciosamente.
 */
function normalizedTarget(value, { legacyBody = false } = {}) {
  const raw = text(value)?.toUpperCase() || null;
  if (!raw && legacyBody) return 'BODY';
  return raw && TARGETS.has(raw) ? raw : null;
}

/**
 * Aceita selectors seguros para os dois targets suportados pelo Reservoir.
 *
 * BODY:
 *   $.employee.id
 *
 * QUERY:
 *   fromDate
 *   toDate
 *   page
 *   filter.status
 *
 * Selectors sensíveis continuam bloqueados pela política central existente.
 */
function safeSelector(target, selector) {
  const resolvedTarget = normalizedTarget(target);
  const normalizedSelector = text(selector);

  if (!resolvedTarget || !normalizedSelector) return null;
  if (resolvedTarget === 'BODY' && !BODY_SELECTOR.test(normalizedSelector)) return null;
  if (resolvedTarget === 'QUERY' && !QUERY_SELECTOR.test(normalizedSelector)) return null;
  if (resolvedTarget === 'PATH_PARAM' && !PATH_SELECTOR.test(normalizedSelector)) return null;
  if (isSensitiveTestDataSelector(resolvedTarget, normalizedSelector)) return null;

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

  if (valueType === 'STRING') {
    return typeof value === 'string'
      && new TextEncoder().encode(value).byteLength <= 4096;
  }

  if (valueType === 'INTEGER') {
    return typeof value === 'number'
      && Number.isInteger(value)
      && Number.isSafeInteger(value);
  }

  if (valueType === 'NUMBER') {
    return typeof value === 'number'
      && Number.isFinite(value);
  }

  if (valueType === 'BOOLEAN') {
    return typeof value === 'boolean';
  }

  if (valueType === 'JSON') {
    return typeof value === 'object'
      && serializedByteLength(value) <= 16_384;
  }

  return false;
}

function valuesEqual(a, b) {
  if (Object.is(a, b)) return true;

  if (a && b && typeof a === 'object' && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  return false;
}

function bindingKey(binding) {
  return String(
    binding?.bindingKey || `${binding?.target}:${binding?.selector}`,
  ).trim();
}

function positionalPathIdentity(
  key,
  selector,
) {
  const match =
    POSITIONAL_PATH_BINDING_KEY
      .exec(
        String(key || ''),
      );

  if (
    !match
    || match[1] !== selector
  ) {
    return null;
  }

  const segmentIndex =
    Number(match[2]);

  const occurrence =
    Number(match[3]);

  if (
    !Number.isInteger(segmentIndex)
    || segmentIndex < 0
    || segmentIndex > 255
    || !Number.isInteger(occurrence)
    || occurrence < 0
    || occurrence > 47
  ) {
    return null;
  }

  return {
    segmentIndex,
    occurrence,
  };
}

function sampleBindingKey({
  target,
  selector,
  segmentIndex = null,
  occurrence = null,
}) {
  if (target === 'PATH_PARAM') {
    if (
      !Number.isInteger(segmentIndex)
      || !Number.isInteger(occurrence)
    ) {
      return null;
    }

    return `PATH_PARAM:${selector}@${segmentIndex}:${occurrence}`;
  }

  return `${target}:${selector}`;
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

      const target = normalizedTarget(binding?.target);
      const selector = safeSelector(target, binding?.selector);
      const valueType = normalizedValueType(binding?.valueType);
      const key = bindingKey(binding);

      let pathIdentity = null;

      if (target === 'PATH_PARAM') {
        pathIdentity =
          positionalPathIdentity(
            key,
            selector,
          );
      }

      const expectedKey =
        target === 'PATH_PARAM'
          ? (
            pathIdentity
              ? sampleBindingKey({
                target,
                selector,
                ...pathIdentity,
              })
              : null
          )
          : `${target}:${selector}`;

      if (
        !target
        || !selector
        || !valueType
        || !expectedKey
        || key !== expectedKey
      ) {
        runtimeError(
          'Binding OBSERVED inválido para resolução de runtime.',
          'RUN_OBSERVED_TEST_DATA_BINDING_INVALID',
          409,
          {
            scenarioId: scenarioId || null,
            bindingKey: key || null,
          },
        );
      }

      const descriptor = {
        scenarioId,
        target,
        selector,
        valueType,
        bindingKey: key,
        ...(pathIdentity || {}),
      };

      const existing = descriptors.get(key);

      if (
        existing
        && (
          existing.selector !== selector
          || existing.valueType !== valueType
          || existing.target !== target
          || existing.segmentIndex !== descriptor.segmentIndex
          || existing.occurrence !== descriptor.occurrence
        )
      ) {
        runtimeError(
          'Binding OBSERVED possui definição inconsistente entre cenários.',
          'RUN_OBSERVED_TEST_DATA_BINDING_CONFLICT',
          409,
          {
            bindingKey: key,
          },
        );
      }

      descriptors.set(key, existing || descriptor);
      observed.push(existing || descriptor);
    }

    if (observed.length) {
      groups.push({
        scenarioId,
        scenarioIndex: index,
        bindings: observed,
      });
    }
  }

  groups.sort(
    (a, b) =>
      b.bindings.length - a.bindings.length
      || a.scenarioIndex - b.scenarioIndex,
  );

  return {
    groups,
    descriptors,
  };
}

function normalizeSample(sample, environmentId) {
  if (
    text(sample?.environmentId) !== environmentId
    || nonNegativeInteger(sample?.successCount) <= 0
  ) {
    return null;
  }

  const values = new Map();

  for (const item of Array.isArray(sample?.values) ? sample.values : []) {
    const target = normalizedTarget(item?.target, { legacyBody: true });
    const selector = safeSelector(target, item?.selector);
    const valueType = normalizedValueType(item?.valueType);

    let key = null;
    let segmentIndex = null;
    let occurrence = null;

    if (target === 'PATH_PARAM') {
      segmentIndex =
        Number(item?.segmentIndex);

      occurrence =
        Number(item?.occurrence);

      if (
        !Number.isInteger(segmentIndex)
        || segmentIndex < 0
        || segmentIndex > 255
        || !Number.isInteger(occurrence)
        || occurrence < 0
        || occurrence > 47
      ) {
        continue;
      }

      key =
        sampleBindingKey({
          target,
          selector,
          segmentIndex,
          occurrence,
        });
    } else if (target && selector) {
      key =
        sampleBindingKey({
          target,
          selector,
        });
    }

    if (
      !target
      || !selector
      || !valueType
      || !key
      || !valueMatchesType(item?.value, valueType)
    ) {
      continue;
    }

    values.set(key, {
      target,
      selector,
      valueType,
      value: structuredClone(item.value),
      ...(target === 'PATH_PARAM'
        ? {
          segmentIndex,
          occurrence,
        }
        : {}),
    });
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

    if (!candidate || candidate.valueType !== descriptor.valueType) {
      return false;
    }

    const frozen = frozenByBindingKey[descriptor.bindingKey];

    if (frozen && !valuesEqual(frozen.value, candidate.value)) {
      return false;
    }
  }

  return true;
}

function freezeFromSample({
  sample,
  group,
  frozenByBindingKey,
  provenanceByBindingKey,
}) {
  for (const descriptor of group.bindings) {
    if (frozenByBindingKey[descriptor.bindingKey]) continue;

    const candidate = sample.values.get(descriptor.bindingKey);

    frozenByBindingKey[descriptor.bindingKey] = {
      target: descriptor.target,
      selector: descriptor.selector,
      valueType: descriptor.valueType,
      value: structuredClone(candidate.value),
      ...(descriptor.target === 'PATH_PARAM'
        ? {
          segmentIndex: descriptor.segmentIndex,
          occurrence: descriptor.occurrence,
        }
        : {}),
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
  /**
   * Valores escalares históricos também podem não ter target.
   * Nesses casos continuam sendo BODY.
   */
  const target = normalizedTarget(item?.target, { legacyBody: true });
  const selector = safeSelector(target, item?.selector);
  const valueType = normalizedValueType(item?.valueType);

  if (
    text(item?.environmentId) !== environmentId
    || nonNegativeInteger(item?.successCount) <= 0
    || target !== descriptor.target
    || selector !== descriptor.selector
    || valueType !== descriptor.valueType
    || !valueMatchesType(item?.value, valueType)
  ) {
    return null;
  }

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

  const {
    groups,
    descriptors,
  } = collectObservedScenarioBindings(selectedScenarios);

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

  /**
   * Não aplicamos filtro de target na busca por samples.
   *
   * Isso é proposital.
   *
   * Um único request sample pode correlacionar:
   *
   *   BODY:$.leaveTypeId
   *   QUERY:fromDate
   *   QUERY:toDate
   *
   * e queremos preservar essa relação.
   */
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
    if (
      group.bindings.every(
        (descriptor) => frozenByBindingKey[descriptor.bindingKey],
      )
    ) {
      continue;
    }

    const sample = samples.find(
      (candidate) =>
        sampleMatchesGroup(
          candidate,
          group,
          frozenByBindingKey,
        ),
    );

    if (sample) {
      const before = Object.keys(frozenByBindingKey).length;

      freezeFromSample({
        sample,
        group,
        frozenByBindingKey,
        provenanceByBindingKey,
      });

      correlatedSampleBindingCount +=
        Object.keys(frozenByBindingKey).length - before;

      continue;
    }

    const unresolved = group.bindings.filter(
      (descriptor) =>
        !frozenByBindingKey[descriptor.bindingKey],
    );

    /**
     * Regra importante de correlação.
     *
     * Para mais de um binding OBSERVED no cenário não usamos fallback
     * escalar independente, porque isso poderia misturar valores de
     * requests diferentes.
     *
     * Exemplo proibido:
     *
     * request A:
     *   fromDate=2026-01-01
     *   toDate=2026-01-31
     *
     * request B:
     *   fromDate=2026-08-01
     *   toDate=2026-08-31
     *
     * Resultado incorreto:
     *   fromDate=2026-01-01
     *   toDate=2026-08-31
     *
     * Com dois bindings OBSERVED exigimos um request sample correlacionado.
     */
    if (
      group.bindings.length > 1
      || unresolved.length > 1
    ) {
      runtimeError(
        'Não existe request sample 2xx correlacionado capaz de resolver todos os bindings OBSERVED do cenário.',
        'RUN_OBSERVED_TEST_DATA_CORRELATED_SAMPLE_MISSING',
        409,
        {
          scenarioId: group.scenarioId || null,
          bindingKeys: group.bindings
            .map((item) => item.bindingKey)
            .sort(),
        },
      );
    }

    const descriptor = unresolved[0];

    if (!descriptor) continue;

    /*
     * C2-F:
     *
     * PATH_PARAM is sample-only. Even a single path identifier
     * represents referential data and must come from a successful
     * correlated request sample. The Catalog deliberately does not
     * scalarize PATH_PARAM.
     */
    if (descriptor.target === 'PATH_PARAM') {
      runtimeError(
        'Não existe request sample 2xx correlacionado para resolver o PATH_PARAM observado.',
        'RUN_OBSERVED_TEST_DATA_CORRELATED_SAMPLE_MISSING',
        409,
        {
          scenarioId: group.scenarioId || null,
          bindingKeys: group.bindings
            .map((item) => item.bindingKey)
            .sort(),
        },
      );
    }

    /**
     * Fallback escalar.
     *
     * C2-E adiciona target à busca.
     *
     * Isso impede colisão entre, por exemplo:
     *
     *   BODY:status
     *   QUERY:status
     *
     * catalogKnowledgeClient.js será ajustado para propagar target
     * até a rota existente do Catalog.
     */
    const candidates = await loadValues({
      env,
      organizationId,
      projectId,
      endpointId,
      environmentId,
      target: descriptor.target,
      selector: descriptor.selector,
      outcomeClass: 'HTTP_2XX',
      limit: 50,
    });

    const selected = (Array.isArray(candidates) ? candidates : [])
      .map(
        (item) =>
          normalizeScalarCandidate(
            item,
            descriptor,
            environmentId,
          ),
      )
      .find(Boolean);

    if (!selected) {
      runtimeError(
        'Não existe valor 2xx seguro no Reservoir para o binding OBSERVED requerido pelo Run.',
        'RUN_OBSERVED_TEST_DATA_UNAVAILABLE',
        409,
        {
          scenarioId: group.scenarioId || null,
          bindingKey: descriptor.bindingKey,
        },
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

  /**
   * Defesa final: todo binding OBSERVED solicitado pelo Test Design
   * precisa sair congelado antes da criação/execução do Run.
   */
  for (const descriptor of descriptors.values()) {
    if (!frozenByBindingKey[descriptor.bindingKey]) {
      runtimeError(
        'Binding OBSERVED não foi resolvido de forma determinística.',
        'RUN_OBSERVED_TEST_DATA_UNAVAILABLE',
        409,
        {
          bindingKey: descriptor.bindingKey,
        },
      );
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
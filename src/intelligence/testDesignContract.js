import { discoveredRuntimeServiceKey, normalizeObservedOrigin } from './discoveredRuntime.js';
import { isSensitiveTestDataSelector } from '../lib/testDataPolicy.js';

export const TEST_DESIGN_CONTRACT_VERSION = 'qagent.test-design.v1';
export const TEST_SPECIFICATION_VERSION = 'qagent.test-spec.v1';
export const API_TEST_DSL_VERSION = 'qagent.api-test-dsl.v1';

export const TEST_SCENARIO_CATEGORIES = Object.freeze([
  'HAPPY_PATH',
  'NEGATIVE',
  'BOUNDARY',
  'SCHEMA_CONTRACT',
  'AUTHORIZATION',
  'STATUS_BEHAVIOR',
  'REGRESSION_CANDIDATE',
  'DATA_VARIATION',
]);

export const TEST_PRIORITIES = Object.freeze(['HIGH', 'MEDIUM', 'LOW']);
export const TEST_GROUNDING_LEVELS = Object.freeze(['OBSERVED', 'INFERRED', 'ASSUMED']);
export const TEST_CONFIDENCE_LEVELS = Object.freeze(['HIGH', 'MEDIUM', 'LOW']);
export const AUTOMATION_READINESS_LEVELS = Object.freeze([
  'READY',
  'NEEDS_DATA',
  'NEEDS_AUTH',
  'NEEDS_ENVIRONMENT',
  'REVIEW_REQUIRED',
]);
export const AUTH_REQUIREMENTS = Object.freeze(['NONE', 'REQUIRED', 'UNAUTHENTICATED']);
export const ASSERTION_TYPES = Object.freeze([
  'STATUS',
  'SCHEMA',
  'JSON_PATH_EXISTS',
  'JSON_PATH_EQUALS',
  'HEADER_EXISTS',
  'CONTENT_TYPE',
]);
export const EXTRACT_SOURCES = Object.freeze(['JSON_PATH', 'HEADER']);

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
]);

const SENSITIVE_REQUEST_KEY_RE = /(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|client[_-]?secret)/i;
const SENSITIVE_SELECTOR_KEYS = new Set([
  'password', 'passwd', 'newpassword', 'currentpassword', 'passwordconfirmation', 'newpasswordconfirmation',
  'secret', 'clientsecret', 'apikey', 'authorization', 'cookie', 'credential', 'privatekey',
  'accesstoken', 'refreshtoken', 'idtoken', 'bearertoken', 'sessiontoken',
]);

function isSensitiveSelector(selector) {
  const tokens = String(selector || '').match(/[A-Za-z_][A-Za-z0-9_-]*/g) || [];
  return tokens.some((token) => SENSITIVE_SELECTOR_KEYS.has(token.replace(/[_-]/g, '').toLowerCase()));
}

const MODEL_OUTPUT_KEYS = new Set(['title', 'objective', 'assumptions', 'scenarios']);
const MODEL_SCENARIO_KEYS = new Set([
  'scenarioId',
  'title',
  'objective',
  'category',
  'priority',
  'confidence',
  'grounding',
  'preconditions',
  'authRequirement',
  'request',
  'assertions',
  'extract',
  'automationHints',
]);

export class TestDesignContractError extends Error {
  constructor(message, { code = 'TEST_DESIGN_CONTRACT_INVALID', path = null, details = null } = {}) {
    super(message);
    this.name = 'TestDesignContractError';
    this.code = code;
    this.status = 422;
    this.path = path;
    this.details = details;
  }
}

function fail(message, path, code = 'TEST_DESIGN_CONTRACT_INVALID', details = null) {
  throw new TestDesignContractError(message, { code, path, details });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainObject(value, path) {
  if (!isPlainObject(value)) fail('Objeto esperado.', path);
}

function assertString(value, path, { min = 1, max = 500 } = {}) {
  if (typeof value !== 'string') fail('String esperada.', path);
  const trimmed = value.trim();
  if (trimmed.length < min) fail('Valor obrigatório.', path);
  if (trimmed.length > max) fail(`Valor excede ${max} caracteres.`, path);
  return trimmed;
}

function assertNullableString(value, path, { max = 500 } = {}) {
  if (value == null) return null;
  return assertString(value, path, { min: 1, max });
}

function assertFiniteNumber(value, path, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('Número finito esperado.', path);
  if (value < min || value > max) fail(`Número fora do intervalo permitido (${min}..${max}).`, path);
  return value;
}

function assertInteger(value, path, { min = -Infinity, max = Infinity } = {}) {
  if (!Number.isInteger(value)) fail('Inteiro esperado.', path);
  if (value < min || value > max) fail(`Inteiro fora do intervalo permitido (${min}..${max}).`, path);
  return value;
}

function assertEnum(value, allowed, path) {
  if (!allowed.includes(value)) {
    const receivedType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const details = { allowed: [...allowed], receivedType };
    if (['string', 'number', 'boolean'].includes(receivedType)) {
      const text = String(value);
      if (text.length <= 64) details.receivedValue = value;
    }
    fail(`Valor inválido. Permitidos: ${allowed.join(', ')}.`, path, 'TEST_DESIGN_CONTRACT_INVALID', details);
  }
  return value;
}

function assertArray(value, path, { max = 50 } = {}) {
  if (!Array.isArray(value)) fail('Array esperado.', path);
  if (value.length > max) fail(`Array excede ${max} itens.`, path);
  return value;
}

function assertStringArray(value, path, { maxItems = 20, maxLength = 500 } = {}) {
  const arr = assertArray(value ?? [], path, { max: maxItems });
  return arr.map((item, index) => assertString(item, `${path}[${index}]`, { max: maxLength }));
}

function assertKnownKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`Campo não permitido: ${key}.`, `${path}.${key}`, 'TEST_DESIGN_UNKNOWN_FIELD');
  }
}

function assertUniqueStrings(values, path) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) fail(`Referência duplicada: ${value}.`, path, 'TEST_DESIGN_DUPLICATE_REFERENCE');
    seen.add(value);
  }
}

function assertJsonValue(value, path, depth = 0) {
  if (depth > 12) fail('JSON excede profundidade máxima.', path, 'TEST_DESIGN_JSON_TOO_DEEP');
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('Número JSON inválido.', path);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) fail('Array JSON excede 100 itens.', path);
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > 100) fail('Objeto JSON excede 100 propriedades.', path);
    for (const key of keys) {
      if (key.length > 160) fail('Nome de propriedade excede limite.', `${path}.${key}`);
      assertJsonValue(value[key], `${path}.${key}`, depth + 1);
    }
    return;
  }
  fail('Valor não é JSON serializável.', path);
}

function assertNoSensitiveRequestKeys(value, path, depth = 0) {
  if (depth > 12 || value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveRequestKeys(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_REQUEST_KEY_RE.test(key)) {
      fail(`Campo sensível não pode ser materializado pelo Test Design: ${key}.`, `${path}.${key}`, 'TEST_DESIGN_SECRET_MATERIAL_FORBIDDEN');
    }
    assertNoSensitiveRequestKeys(child, `${path}.${key}`, depth + 1);
  }
}

function assertRelativePath(pathValue, path = 'endpoint.normalizedPath') {
  const value = assertString(pathValue, path, { max: 1000 });
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('//')) {
    fail('Host/base URL não é permitido no Test DSL.', path, 'TEST_DESIGN_ABSOLUTE_URL_FORBIDDEN');
  }
  if (!value.startsWith('/')) fail('Path precisa começar com /.', path, 'TEST_DESIGN_TARGET_INVALID');
  if (value.includes('#')) fail('Fragmento de URL não é permitido no path.', path, 'TEST_DESIGN_TARGET_INVALID');
  return value;
}

function normalizeMethod(value, path = 'endpoint.method') {
  const method = assertString(value, path, { max: 16 }).toUpperCase();
  if (!HTTP_METHODS.has(method)) fail('Método HTTP não suportado.', path, 'TEST_DESIGN_METHOD_INVALID');
  return method;
}

function validateRequestObject(request, path) {
  assertPlainObject(request, path);
  assertKnownKeys(request, new Set(['pathParams', 'query', 'headers', 'body']), path);

  for (const field of ['pathParams', 'query', 'headers']) {
    const value = request[field] ?? {};
    assertPlainObject(value, `${path}.${field}`);
    if (Object.keys(value).length > 50) fail(`${field} excede 50 entradas.`, `${path}.${field}`);
    for (const [key, item] of Object.entries(value)) {
      assertString(key, `${path}.${field}.<key>`, { max: 160 });
      if (field === 'headers' && SENSITIVE_HEADER_NAMES.has(key.trim().toLowerCase())) {
        fail(`Header sensível não pode ser definido pela IA: ${key}.`, `${path}.headers.${key}`, 'TEST_DESIGN_SECRET_MATERIAL_FORBIDDEN');
      }
      assertJsonValue(item, `${path}.${field}.${key}`);
      if (field !== 'headers') assertNoSensitiveRequestKeys({ [key]: item }, `${path}.${field}`);
    }
  }

  if ('body' in request) {
    assertJsonValue(request.body, `${path}.body`);
    assertNoSensitiveRequestKeys(request.body, `${path}.body`);
  }
}

function validateAssertion(assertion, path, schemaRefs) {
  assertPlainObject(assertion, path);
  const type = assertEnum(assertion.type, ASSERTION_TYPES, `${path}.type`);

  if (type === 'STATUS') {
    assertKnownKeys(assertion, new Set(['type', 'expectedStatusCodes']), path);
    const codes = assertArray(assertion.expectedStatusCodes, `${path}.expectedStatusCodes`, { max: 12 });
    if (!codes.length) fail('STATUS precisa de ao menos um status code.', `${path}.expectedStatusCodes`);
    codes.forEach((code, index) => assertInteger(code, `${path}.expectedStatusCodes[${index}]`, { min: 100, max: 599 }));
    return;
  }

  if (type === 'SCHEMA') {
    assertKnownKeys(assertion, new Set(['type', 'schemaRef']), path);
    const ref = assertString(assertion.schemaRef, `${path}.schemaRef`, { max: 160 });
    if (!schemaRefs.has(ref)) fail('schemaRef não existe no contexto fornecido.', `${path}.schemaRef`, 'TEST_DESIGN_GROUNDING_REFERENCE_UNKNOWN');
    return;
  }

  if (type === 'JSON_PATH_EXISTS') {
    assertKnownKeys(assertion, new Set(['type', 'path']), path);
    const selector = assertString(assertion.path, `${path}.path`, { max: 500 });
    if (isSensitiveSelector(selector)) {
      fail('Assertion sobre material sensível não é permitida.', `${path}.path`, 'TEST_DESIGN_SECRET_MATERIAL_FORBIDDEN');
    }
    return;
  }

  if (type === 'JSON_PATH_EQUALS') {
    assertKnownKeys(assertion, new Set(['type', 'path', 'expected']), path);
    const selector = assertString(assertion.path, `${path}.path`, { max: 500 });
    if (isSensitiveSelector(selector)) {
      fail('Assertion sobre material sensível não é permitida.', `${path}.path`, 'TEST_DESIGN_SECRET_MATERIAL_FORBIDDEN');
    }
    assertJsonValue(assertion.expected, `${path}.expected`);
    return;
  }

  if (type === 'HEADER_EXISTS') {
    assertKnownKeys(assertion, new Set(['type', 'name']), path);
    const headerName = assertString(assertion.name, `${path}.name`, { max: 160 });
    if (SENSITIVE_HEADER_NAMES.has(headerName.toLowerCase())) {
      fail('Assertions sobre headers sensíveis não são permitidas no draft de IA.', `${path}.name`, 'TEST_DESIGN_SECRET_MATERIAL_FORBIDDEN');
    }
    return;
  }

  if (type === 'CONTENT_TYPE') {
    assertKnownKeys(assertion, new Set(['type', 'expected']), path);
    const expected = assertStringArray(assertion.expected, `${path}.expected`, { maxItems: 10, maxLength: 160 });
    if (!expected.length) fail('CONTENT_TYPE precisa de ao menos um valor.', `${path}.expected`);
  }
}

function validateExtract(extract, path) {
  assertPlainObject(extract, path);
  assertKnownKeys(extract, new Set(['name', 'source', 'selector']), path);
  assertString(extract.name, `${path}.name`, { max: 120 });
  assertEnum(extract.source, EXTRACT_SOURCES, `${path}.source`);
  const selector = assertString(extract.selector, `${path}.selector`, { max: 500 });
  if (extract.source === 'HEADER' && (SENSITIVE_HEADER_NAMES.has(selector.toLowerCase()) || SENSITIVE_REQUEST_KEY_RE.test(selector))) {
    fail('Extração de headers sensíveis não é permitida.', `${path}.selector`, 'TEST_DESIGN_SECRET_MATERIAL_FORBIDDEN');
  }
  if (extract.source === 'JSON_PATH' && isSensitiveSelector(selector)) {
    fail('Extração de material sensível por JSON path não é permitida.', `${path}.selector`, 'TEST_DESIGN_SECRET_MATERIAL_FORBIDDEN');
  }
}

function collectContextReferences(context) {
  const evidenceRefs = new Set();
  const schemaRefs = new Set();

  for (const evidence of context.evidence || []) {
    if (typeof evidence?.evidenceId === 'string' && evidence.evidenceId) evidenceRefs.add(evidence.evidenceId);
  }

  for (const schema of context.schemas || []) {
    for (const candidate of [schema?.trackId, schema?.currentVersionId, schema?.currentSchemaHash]) {
      if (typeof candidate === 'string' && candidate) schemaRefs.add(candidate);
    }
    for (const version of schema?.versions || []) {
      for (const candidate of [version?.versionId, version?.schemaHash]) {
        if (typeof candidate === 'string' && candidate) schemaRefs.add(candidate);
      }
    }
  }

  return { evidenceRefs, schemaRefs };
}

export function validateCatalogTestDesignContextV1(context) {
  assertPlainObject(context, 'context');
  assertKnownKeys(context, new Set([
    'contractVersion',
    'organizationId',
    'projectId',
    'endpoint',
    'schemas',
    'evidence',
    'environments',
    'runtime',
    'testData',
  ]), 'context');

  if (context.contractVersion !== TEST_DESIGN_CONTRACT_VERSION) {
    fail(
      `contractVersion deve ser ${TEST_DESIGN_CONTRACT_VERSION}.`,
      'context.contractVersion',
      'TEST_DESIGN_VERSION_UNSUPPORTED',
    );
  }

  assertString(context.organizationId, 'context.organizationId', { max: 128 });
  assertString(context.projectId, 'context.projectId', { max: 128 });

  assertPlainObject(context.endpoint, 'context.endpoint');
  assertKnownKeys(context.endpoint, new Set([
    'endpointId',
    'serviceId',
    'serviceName',
    'classification',
    'classificationConfidence',
    'method',
    'normalizedPath',
    'discoveryConfidenceScore',
    'discoveryConfidenceLevel',
    'lifecycleState',
    'observationCount',
    'sessionCount',
    'environmentCount',
    'successRatePct',
    'latencyAvgMs',
    'firstSeenAt',
    'lastSeenAt',
    'queryParameters',
  ]), 'context.endpoint');

  assertString(
    context.endpoint.endpointId,
    'context.endpoint.endpointId',
    { max: 160 },
  );

  assertNullableString(
    context.endpoint.serviceId,
    'context.endpoint.serviceId',
    { max: 160 },
  );

  assertNullableString(
    context.endpoint.serviceName,
    'context.endpoint.serviceName',
    { max: 260 },
  );

  normalizeMethod(
    context.endpoint.method,
    'context.endpoint.method',
  );

  assertRelativePath(
    context.endpoint.normalizedPath,
    'context.endpoint.normalizedPath',
  );

  if (context.endpoint.classification != null) {
    assertString(
      context.endpoint.classification,
      'context.endpoint.classification',
      { max: 80 },
    );
  }

  if (context.endpoint.classificationConfidence != null) {
    assertFiniteNumber(
      context.endpoint.classificationConfidence,
      'context.endpoint.classificationConfidence',
      { min: 0, max: 100 },
    );
  }

  if (context.endpoint.discoveryConfidenceScore != null) {
    assertFiniteNumber(
      context.endpoint.discoveryConfidenceScore,
      'context.endpoint.discoveryConfidenceScore',
      { min: 0, max: 100 },
    );
  }

  if (context.endpoint.discoveryConfidenceLevel != null) {
    assertString(
      context.endpoint.discoveryConfidenceLevel,
      'context.endpoint.discoveryConfidenceLevel',
      { max: 40 },
    );
  }

  if (context.endpoint.lifecycleState != null) {
    assertString(
      context.endpoint.lifecycleState,
      'context.endpoint.lifecycleState',
      { max: 40 },
    );
  }

  for (const field of [
    'observationCount',
    'sessionCount',
    'environmentCount',
  ]) {
    if (context.endpoint[field] != null) {
      assertInteger(
        context.endpoint[field],
        `context.endpoint.${field}`,
        {
          min: 0,
          max: Number.MAX_SAFE_INTEGER,
        },
      );
    }
  }

  if (context.endpoint.successRatePct != null) {
    assertFiniteNumber(
      context.endpoint.successRatePct,
      'context.endpoint.successRatePct',
      { min: 0, max: 100 },
    );
  }

  if (context.endpoint.latencyAvgMs != null) {
    assertFiniteNumber(
      context.endpoint.latencyAvgMs,
      'context.endpoint.latencyAvgMs',
      { min: 0, max: 86_400_000 },
    );
  }

  /*
   * 07.7.8-C2-E — Observed Query Shape Integration
   *
   * O Catalog Context pode informar somente o shape seguro da query:
   * nomes + metadata agregada.
   *
   * Valores observados de query NÃO fazem parte deste contrato.
   */
  if (context.endpoint.queryParameters !== undefined) {
    const queryParameters = assertArray(
      context.endpoint.queryParameters,
      'context.endpoint.queryParameters',
      { max: 64 },
    );

    const queryNames = [];

    queryParameters.forEach((item, index) => {
      const path =
        `context.endpoint.queryParameters[${index}]`;

      assertPlainObject(item, path);

      assertKnownKeys(item, new Set([
        'name',
        'observationCount',
        'successCount',
        'successShapeObservationCount',
        'environmentCount',
        'firstSeenAt',
        'lastSeenAt',
        'baselineEligible',
      ]), path);

      const name = assertString(
        item.name,
        `${path}.name`,
        { max: 120 },
      );

      /*
       * Defesa em profundidade:
       * - formato limitado;
       * - selectors sensíveis continuam fora do Catalog Context.
       */
      if (
        !/^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/.test(name)
        || isSensitiveTestDataSelector('QUERY', name)
      ) {
        fail(
          'Query parameter modelado inválido ou sensível.',
          `${path}.name`,
          'TEST_DESIGN_SECRET_MATERIAL_FORBIDDEN',
        );
      }

      queryNames.push(name);

      for (const field of [
        'observationCount',
        'successCount',
        'successShapeObservationCount',
        'environmentCount',
      ]) {
        if (item[field] != null) {
          assertInteger(
            item[field],
            `${path}.${field}`,
            {
              min: 0,
              max: Number.MAX_SAFE_INTEGER,
            },
          );
        }
      }

      if (item.firstSeenAt != null) {
        assertString(
          item.firstSeenAt,
          `${path}.firstSeenAt`,
          { max: 64 },
        );
      }

      if (item.lastSeenAt != null) {
        assertString(
          item.lastSeenAt,
          `${path}.lastSeenAt`,
          { max: 64 },
        );
      }

      if (typeof item.baselineEligible !== 'boolean') {
        fail(
          'Boolean esperado.',
          `${path}.baselineEligible`,
        );
      }
    });

    assertUniqueStrings(
      queryNames,
      'context.endpoint.queryParameters',
    );
  }

  const schemas = assertArray(
    context.schemas ?? [],
    'context.schemas',
    { max: 30 },
  );

  schemas.forEach((schema, index) => {
    const path = `context.schemas[${index}]`;

    assertPlainObject(schema, path);

    assertKnownKeys(schema, new Set([
      'trackId',
      'direction',
      'statusCode',
      'currentVersionId',
      'currentSchemaHash',
      'contentTypes',
      'schema',
      'versions',
    ]), path);

    assertString(
      schema.trackId,
      `${path}.trackId`,
      { max: 160 },
    );

    assertEnum(
      schema.direction,
      ['REQUEST', 'RESPONSE'],
      `${path}.direction`,
    );

    if (schema.statusCode != null) {
      assertInteger(
        schema.statusCode,
        `${path}.statusCode`,
        { min: 100, max: 599 },
      );
    }

    assertNullableString(
      schema.currentVersionId,
      `${path}.currentVersionId`,
      { max: 160 },
    );

    assertNullableString(
      schema.currentSchemaHash,
      `${path}.currentSchemaHash`,
      { max: 256 },
    );

    assertStringArray(
      schema.contentTypes ?? [],
      `${path}.contentTypes`,
      { maxItems: 20, maxLength: 160 },
    );

    if ('schema' in schema) {
      assertJsonValue(
        schema.schema,
        `${path}.schema`,
      );
    }

    const versions = assertArray(
      schema.versions ?? [],
      `${path}.versions`,
      { max: 20 },
    );

    versions.forEach((version, versionIndex) => {
      const vPath =
        `${path}.versions[${versionIndex}]`;

      assertPlainObject(version, vPath);

      assertKnownKeys(version, new Set([
        'versionId',
        'schemaHash',
        'observationCount',
        'introducedAt',
      ]), vPath);

      assertString(
        version.versionId,
        `${vPath}.versionId`,
        { max: 160 },
      );

      assertString(
        version.schemaHash,
        `${vPath}.schemaHash`,
        { max: 256 },
      );

      if (version.observationCount != null) {
        assertInteger(
          version.observationCount,
          `${vPath}.observationCount`,
          {
            min: 0,
            max: Number.MAX_SAFE_INTEGER,
          },
        );
      }

      if (version.introducedAt != null) {
        assertString(
          version.introducedAt,
          `${vPath}.introducedAt`,
          { max: 64 },
        );
      }
    });
  });

  const evidence = assertArray(
    context.evidence ?? [],
    'context.evidence',
    { max: 50 },
  );

  evidence.forEach((item, index) => {
    const path = `context.evidence[${index}]`;

    assertPlainObject(item, path);

    assertKnownKeys(item, new Set([
      'evidenceId',
      'observedAt',
      'environmentId',
      'outcome',
      'statusCode',
      'latencyMs',
      'sourceHost',
      'sessionId',
      'requestSchemaVersionId',
      'responseSchemaVersionId',
      'authObserved',
      'authScheme',
    ]), path);

    assertString(
      item.evidenceId,
      `${path}.evidenceId`,
      { max: 160 },
    );

    assertString(
      item.observedAt,
      `${path}.observedAt`,
      { max: 64 },
    );

    assertNullableString(
      item.environmentId,
      `${path}.environmentId`,
      { max: 160 },
    );

    assertNullableString(
      item.outcome,
      `${path}.outcome`,
      { max: 80 },
    );

    if (item.statusCode != null) {
      assertInteger(
        item.statusCode,
        `${path}.statusCode`,
        { min: 100, max: 599 },
      );
    }

    if (item.latencyMs != null) {
      assertFiniteNumber(
        item.latencyMs,
        `${path}.latencyMs`,
        { min: 0, max: 86_400_000 },
      );
    }

    assertNullableString(
      item.sourceHost,
      `${path}.sourceHost`,
      { max: 500 },
    );

    assertNullableString(
      item.sessionId,
      `${path}.sessionId`,
      { max: 160 },
    );

    assertNullableString(
      item.requestSchemaVersionId,
      `${path}.requestSchemaVersionId`,
      { max: 160 },
    );

    assertNullableString(
      item.responseSchemaVersionId,
      `${path}.responseSchemaVersionId`,
      { max: 160 },
    );

    if (
      item.authObserved != null
      && typeof item.authObserved !== 'boolean'
    ) {
      fail(
        'authObserved deve ser boolean ou null.',
        `${path}.authObserved`,
      );
    }

    if (item.authScheme != null) {
      assertEnum(
        item.authScheme,
        [
          'BEARER',
          'BASIC',
          'API_KEY',
          'COOKIE',
          'UNKNOWN',
        ],
        `${path}.authScheme`,
      );
    }

    if (
      item.authObserved !== true
      && item.authScheme != null
    ) {
      fail(
        'authScheme só pode existir quando authObserved=true.',
        `${path}.authScheme`,
        'TEST_DESIGN_AUTH_SIGNAL_INCONSISTENT',
      );
    }
  });

  const environments = assertArray(
    context.environments ?? [],
    'context.environments',
    { max: 30 },
  );

  environments.forEach((environment, index) => {
    const path =
      `context.environments[${index}]`;

    assertPlainObject(environment, path);

    assertKnownKeys(environment, new Set([
      'environmentId',
      'name',
      'observationCount',
      'successRatePct',
      'lastSeenAt',
    ]), path);

    assertString(
      environment.environmentId,
      `${path}.environmentId`,
      { max: 160 },
    );

    assertNullableString(
      environment.name,
      `${path}.name`,
      { max: 160 },
    );

    if (environment.observationCount != null) {
      assertInteger(
        environment.observationCount,
        `${path}.observationCount`,
        {
          min: 0,
          max: Number.MAX_SAFE_INTEGER,
        },
      );
    }

    if (environment.successRatePct != null) {
      assertFiniteNumber(
        environment.successRatePct,
        `${path}.successRatePct`,
        { min: 0, max: 100 },
      );
    }

    if (environment.lastSeenAt != null) {
      assertString(
        environment.lastSeenAt,
        `${path}.lastSeenAt`,
        { max: 64 },
      );
    }
  });

  const testData =
    context.testData
    ?? { configuredBindings: [] };

  assertPlainObject(
    testData,
    'context.testData',
  );

  assertKnownKeys(
    testData,
    new Set(['configuredBindings']),
    'context.testData',
  );

  const configuredBindings = assertArray(
    testData.configuredBindings ?? [],
    'context.testData.configuredBindings',
    { max: 200 },
  );

  configuredBindings.forEach((binding, index) => {
    const path =
      `context.testData.configuredBindings[${index}]`;

    assertPlainObject(binding, path);

    assertKnownKeys(binding, new Set([
      'bindingId',
      'scopeType',
      'environmentId',
      'target',
      'selector',
      'sourceType',
      'valueType',
      'generatorKind',
      'generatorConfig',
      'secretConfigured',
    ]), path);

    assertString(
      binding.bindingId,
      `${path}.bindingId`,
      { max: 160 },
    );

    assertEnum(
      binding.scopeType,
      ['PROJECT', 'ENVIRONMENT', 'ENDPOINT'],
      `${path}.scopeType`,
    );

    assertNullableString(
      binding.environmentId,
      `${path}.environmentId`,
      { max: 160 },
    );

    if (
      binding.scopeType === 'PROJECT'
      && binding.environmentId != null
    ) {
      fail(
        'PROJECT Test Data não usa environmentId.',
        `${path}.environmentId`,
        'TEST_DATA_SCOPE_INVALID',
      );
    }

    if (
      binding.scopeType !== 'PROJECT'
      && !binding.environmentId
    ) {
      fail(
        `${binding.scopeType} Test Data exige environmentId.`,
        `${path}.environmentId`,
        'TEST_DATA_SCOPE_INVALID',
      );
    }

    assertEnum(
      binding.target,
      ['BODY', 'PATH_PARAM', 'QUERY'],
      `${path}.target`,
    );

    assertString(
      binding.selector,
      `${path}.selector`,
      { max: 320 },
    );

    assertEnum(
      binding.sourceType,
      ['GENERATED', 'FIXED', 'SECRET'],
      `${path}.sourceType`,
    );

    if (
      isSensitiveTestDataSelector(
        binding.target,
        binding.selector,
      )
      && binding.sourceType !== 'SECRET'
    ) {
      fail(
        'Campo sensível de Test Data deve usar SECRET.',
        `${path}.sourceType`,
        'TEST_DATA_SECRET_SOURCE_REQUIRED',
      );
    }

    assertEnum(
      binding.valueType,
      [
        'STRING',
        'NUMBER',
        'INTEGER',
        'BOOLEAN',
        'JSON',
      ],
      `${path}.valueType`,
    );

    assertNullableString(
      binding.generatorKind,
      `${path}.generatorKind`,
      { max: 64 },
    );

    if (binding.generatorConfig != null) {
      assertJsonValue(
        binding.generatorConfig,
        `${path}.generatorConfig`,
      );
    }

    if (
      binding.secretConfigured != null
      && typeof binding.secretConfigured !== 'boolean'
    ) {
      fail(
        'secretConfigured deve ser boolean.',
        `${path}.secretConfigured`,
      );
    }
  });

  const runtime = context.runtime ?? {};

  assertPlainObject(
    runtime,
    'context.runtime',
  );

  assertKnownKeys(runtime, new Set([
    'apiServiceKey',
    'resolutionSource',
    'resolutionConfidence',
    'requiresExecutionConfirmation',
    'discoveredOrigin',
    'defaultAuthProfileRef',
    'availableAuthProfileRefs',
    'authObservation',
  ]), 'context.runtime');

  assertNullableString(
    runtime.apiServiceKey,
    'context.runtime.apiServiceKey',
    { max: 120 },
  );

  if (runtime.resolutionSource != null) {
    assertEnum(
      runtime.resolutionSource,
      [
        'EXPLICIT_CONFIG',
        'DISCOVERED_OBSERVATION',
        'ORIGIN',
      ],
      'context.runtime.resolutionSource',
    );
  }

  if (runtime.resolutionConfidence != null) {
    assertEnum(
      runtime.resolutionConfidence,
      [
        'CONFIRMED',
        'HIGH',
        'MEDIUM',
        'LOW',
      ],
      'context.runtime.resolutionConfidence',
    );
  }

  if (
    runtime.requiresExecutionConfirmation != null
    && typeof runtime.requiresExecutionConfirmation
    !== 'boolean'
  ) {
    fail(
      'requiresExecutionConfirmation deve ser boolean.',
      'context.runtime.requiresExecutionConfirmation',
    );
  }

  assertNullableString(
    runtime.discoveredOrigin,
    'context.runtime.discoveredOrigin',
    { max: 500 },
  );

  if (
    runtime.resolutionSource
    === 'DISCOVERED_OBSERVATION'
  ) {
    const normalizedOrigin =
      normalizeObservedOrigin(
        runtime.discoveredOrigin,
      );

    if (!normalizedOrigin) {
      fail(
        'Runtime descoberto exige origin HTTPS público e seguro.',
        'context.runtime.discoveredOrigin',
        'TEST_DESIGN_DISCOVERED_RUNTIME_INVALID',
      );
    }

    if (
      runtime.apiServiceKey
      !== discoveredRuntimeServiceKey(
        normalizedOrigin,
      )
    ) {
      fail(
        'Runtime descoberto possui identidade divergente do origin observado.',
        'context.runtime.apiServiceKey',
        'TEST_DESIGN_DISCOVERED_RUNTIME_INVALID',
      );
    }

    if (
      runtime.resolutionConfidence
      !== 'HIGH'
    ) {
      fail(
        'Runtime descoberto v1 exige confidence HIGH.',
        'context.runtime.resolutionConfidence',
        'TEST_DESIGN_DISCOVERED_RUNTIME_INVALID',
      );
    }

    if (
      runtime.requiresExecutionConfirmation
      !== true
    ) {
      fail(
        'Runtime descoberto precisa exigir confirmação de execução.',
        'context.runtime.requiresExecutionConfirmation',
        'TEST_DESIGN_DISCOVERED_RUNTIME_INVALID',
      );
    }
  }

  assertNullableString(
    runtime.defaultAuthProfileRef,
    'context.runtime.defaultAuthProfileRef',
    { max: 160 },
  );

  const authRefs = assertStringArray(
    runtime.availableAuthProfileRefs ?? [],
    'context.runtime.availableAuthProfileRefs',
    {
      maxItems: 30,
      maxLength: 160,
    },
  );

  assertUniqueStrings(
    authRefs,
    'context.runtime.availableAuthProfileRefs',
  );

  if (
    runtime.defaultAuthProfileRef
    && !authRefs.includes(
      runtime.defaultAuthProfileRef,
    )
  ) {
    fail(
      'defaultAuthProfileRef precisa existir em availableAuthProfileRefs.',
      'context.runtime.defaultAuthProfileRef',
      'TEST_DESIGN_AUTH_PROFILE_UNKNOWN',
    );
  }

  if (runtime.authObservation != null) {
    assertPlainObject(
      runtime.authObservation,
      'context.runtime.authObservation',
    );

    assertKnownKeys(
      runtime.authObservation,
      new Set([
        'status',
        'scheme',
        'evidenceRefs',
      ]),
      'context.runtime.authObservation',
    );

    assertEnum(
      runtime.authObservation.status,
      [
        'REQUIRED',
        'NONE',
        'OPTIONAL',
        'MIXED',
        'UNKNOWN',
      ],
      'context.runtime.authObservation.status',
    );

    if (
      runtime.authObservation.scheme
      != null
    ) {
      assertEnum(
        runtime.authObservation.scheme,
        [
          'BEARER',
          'BASIC',
          'API_KEY',
          'COOKIE',
          'UNKNOWN',
        ],
        'context.runtime.authObservation.scheme',
      );
    }

    const observedEvidenceRefs =
      assertStringArray(
        runtime.authObservation.evidenceRefs
        ?? [],
        'context.runtime.authObservation.evidenceRefs',
        {
          maxItems: 20,
          maxLength: 160,
        },
      );

    assertUniqueStrings(
      observedEvidenceRefs,
      'context.runtime.authObservation.evidenceRefs',
    );

    const allowedEvidenceRefs =
      new Set(
        (context.evidence || [])
          .map(
            (item) =>
              item?.evidenceId,
          )
          .filter(Boolean),
      );

    for (
      const ref
      of observedEvidenceRefs
    ) {
      if (!allowedEvidenceRefs.has(ref)) {
        fail(
          'authObservation.evidenceRefs precisa apontar para Evidence presente no contexto.',
          'context.runtime.authObservation.evidenceRefs',
          'TEST_DESIGN_EVIDENCE_REF_UNKNOWN',
        );
      }
    }

    if (
      ![
        'REQUIRED',
        'OPTIONAL',
      ].includes(
        runtime.authObservation.status,
      )
      && runtime.authObservation.scheme
      != null
    ) {
      fail(
        'authObservation.scheme só pode ser materializado quando status=REQUIRED ou OPTIONAL.',
        'context.runtime.authObservation.scheme',
        'TEST_DESIGN_AUTH_SIGNAL_INCONSISTENT',
      );
    }
  }

  const refs =
    collectContextReferences(context);

  assertUniqueStrings(
    [...refs.evidenceRefs],
    'context.evidence',
  );

  assertUniqueStrings(
    [...refs.schemaRefs],
    'context.schemas',
  );

  return context;
}

function validateGrounding(grounding, path, refs) {
  assertPlainObject(grounding, path);
  assertKnownKeys(grounding, new Set(['level', 'rationale', 'evidenceRefs', 'schemaRefs']), path);
  const level = assertEnum(grounding.level, TEST_GROUNDING_LEVELS, `${path}.level`);
  const rationale = assertStringArray(grounding.rationale ?? [], `${path}.rationale`, { maxItems: 12, maxLength: 500 });
  if (!rationale.length) fail('Grounding precisa de rationale.', `${path}.rationale`, 'TEST_DESIGN_GROUNDING_REQUIRED');
  const evidenceRefs = assertStringArray(grounding.evidenceRefs ?? [], `${path}.evidenceRefs`, { maxItems: 20, maxLength: 160 });
  const schemaRefs = assertStringArray(grounding.schemaRefs ?? [], `${path}.schemaRefs`, { maxItems: 20, maxLength: 256 });
  assertUniqueStrings(evidenceRefs, `${path}.evidenceRefs`);
  assertUniqueStrings(schemaRefs, `${path}.schemaRefs`);

  for (const ref of evidenceRefs) {
    if (!refs.evidenceRefs.has(ref)) fail(`Evidence ref desconhecida: ${ref}.`, `${path}.evidenceRefs`, 'TEST_DESIGN_GROUNDING_REFERENCE_UNKNOWN');
  }
  for (const ref of schemaRefs) {
    if (!refs.schemaRefs.has(ref)) fail(`Schema ref desconhecida: ${ref}.`, `${path}.schemaRefs`, 'TEST_DESIGN_GROUNDING_REFERENCE_UNKNOWN');
  }

  if (level === 'OBSERVED' && evidenceRefs.length + schemaRefs.length === 0) {
    fail('Grounding OBSERVED exige evidenceRefs ou schemaRefs reais.', path, 'TEST_DESIGN_GROUNDING_REQUIRED');
  }
}

function normalizeToken(value) {
  if (typeof value !== 'string') return value;
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

function normalizeConfidence(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const score = value >= 0 && value <= 1 ? value * 100 : value;
    if (score >= 80 && score <= 100) return 'HIGH';
    if (score >= 50 && score < 80) return 'MEDIUM';
    if (score >= 0 && score < 50) return 'LOW';
    return value;
  }

  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  const percentMatch = trimmed.match(/^(\d+(?:\.\d+)?)%$/);
  if (percentMatch) return normalizeConfidence(Number(percentMatch[1]));
  const numericMatch = trimmed.match(/^\d+(?:\.\d+)?$/);
  if (numericMatch) return normalizeConfidence(Number(trimmed));

  const token = normalizeToken(trimmed);
  const aliases = {
    VERY_HIGH: 'HIGH',
    HIGH_CONFIDENCE: 'HIGH',
    ALTA: 'HIGH',
    ALTO: 'HIGH',
    MODERATE: 'MEDIUM',
    MODERATE_CONFIDENCE: 'MEDIUM',
    MEDIA: 'MEDIUM',
    MEDIO: 'MEDIUM',
    VERY_LOW: 'LOW',
    LOW_CONFIDENCE: 'LOW',
    BAIXA: 'LOW',
    BAIXO: 'LOW',
  };
  return aliases[token] || token;
}

function setNormalized(target, key, nextValue, path, changes) {
  if (!target || !Object.prototype.hasOwnProperty.call(target, key)) return;
  const prev = target[key];
  if (Object.is(prev, nextValue)) return;
  target[key] = nextValue;
  changes.push(path);
}

export function normalizeTestDesignModelOutputV1(output) {
  if (!isPlainObject(output)) return { output, changes: [] };
  const clone = JSON.parse(JSON.stringify(output));
  const changes = [];

  for (let index = 0; index < (Array.isArray(clone.scenarios) ? clone.scenarios.length : 0); index += 1) {
    const scenario = clone.scenarios[index];
    if (!isPlainObject(scenario)) continue;
    const base = `modelOutput.scenarios[${index}]`;

    if ('category' in scenario) setNormalized(scenario, 'category', normalizeToken(scenario.category), `${base}.category`, changes);
    if ('priority' in scenario) setNormalized(scenario, 'priority', normalizeToken(scenario.priority), `${base}.priority`, changes);
    if ('confidence' in scenario) setNormalized(scenario, 'confidence', normalizeConfidence(scenario.confidence), `${base}.confidence`, changes);
    if ('authRequirement' in scenario) setNormalized(scenario, 'authRequirement', normalizeToken(scenario.authRequirement), `${base}.authRequirement`, changes);

    if (isPlainObject(scenario.grounding) && 'level' in scenario.grounding) {
      setNormalized(scenario.grounding, 'level', normalizeToken(scenario.grounding.level), `${base}.grounding.level`, changes);
    }

    if (Array.isArray(scenario.assertions)) {
      scenario.assertions.forEach((assertion, assertionIndex) => {
        if (isPlainObject(assertion) && 'type' in assertion) {
          setNormalized(assertion, 'type', normalizeToken(assertion.type), `${base}.assertions[${assertionIndex}].type`, changes);
        }
      });
    }

    if (Array.isArray(scenario.extract)) {
      scenario.extract.forEach((item, extractIndex) => {
        if (isPlainObject(item) && 'source' in item) {
          setNormalized(item, 'source', normalizeToken(item.source), `${base}.extract[${extractIndex}].source`, changes);
        }
      });
    }
  }

  return { output: clone, changes };
}

export function validateTestDesignModelOutputV1(output, context) {
  validateCatalogTestDesignContextV1(context);
  assertPlainObject(output, 'modelOutput');
  assertKnownKeys(output, MODEL_OUTPUT_KEYS, 'modelOutput');

  assertString(output.title, 'modelOutput.title', { max: 260 });
  assertString(output.objective, 'modelOutput.objective', { max: 1200 });
  assertStringArray(output.assumptions ?? [], 'modelOutput.assumptions', { maxItems: 20, maxLength: 500 });

  const scenarios = assertArray(output.scenarios, 'modelOutput.scenarios', { max: 20 });
  if (!scenarios.length) fail('Ao menos um cenário é obrigatório.', 'modelOutput.scenarios');

  const refs = collectContextReferences(context);
  const scenarioIds = new Set();

  scenarios.forEach((scenario, index) => {
    const path = `modelOutput.scenarios[${index}]`;
    assertPlainObject(scenario, path);
    assertKnownKeys(scenario, MODEL_SCENARIO_KEYS, path);

    const scenarioId = assertString(scenario.scenarioId, `${path}.scenarioId`, { max: 80 });
    if (!/^[A-Za-z0-9_-]+$/.test(scenarioId)) fail('scenarioId contém caracteres inválidos.', `${path}.scenarioId`);
    if (scenarioIds.has(scenarioId)) fail('scenarioId duplicado.', `${path}.scenarioId`, 'TEST_DESIGN_DUPLICATE_SCENARIO');
    scenarioIds.add(scenarioId);

    assertString(scenario.title, `${path}.title`, { max: 260 });
    assertString(scenario.objective, `${path}.objective`, { max: 1000 });
    assertEnum(scenario.category, TEST_SCENARIO_CATEGORIES, `${path}.category`);
    assertEnum(scenario.priority, TEST_PRIORITIES, `${path}.priority`);
    const confidence = assertEnum(scenario.confidence, TEST_CONFIDENCE_LEVELS, `${path}.confidence`);
    validateGrounding(scenario.grounding, `${path}.grounding`, refs);
    if (scenario.grounding.level === 'ASSUMED' && confidence === 'HIGH') {
      fail('Cenário ASSUMED não pode declarar confidence HIGH.', `${path}.confidence`, 'TEST_DESIGN_CONFIDENCE_INCONSISTENT');
    }

    assertStringArray(scenario.preconditions ?? [], `${path}.preconditions`, { maxItems: 20, maxLength: 500 });
    assertEnum(scenario.authRequirement, AUTH_REQUIREMENTS, `${path}.authRequirement`);
    validateRequestObject(scenario.request ?? {}, `${path}.request`);

    const assertions = assertArray(scenario.assertions ?? [], `${path}.assertions`, { max: 30 });
    if (!assertions.length) fail('Cenário precisa de ao menos uma assertion.', `${path}.assertions`);
    assertions.forEach((assertion, assertionIndex) => validateAssertion(assertion, `${path}.assertions[${assertionIndex}]`, refs.schemaRefs));

    const extract = assertArray(scenario.extract ?? [], `${path}.extract`, { max: 20 });
    extract.forEach((item, extractIndex) => validateExtract(item, `${path}.extract[${extractIndex}]`));

    const hints = scenario.automationHints ?? {};
    assertPlainObject(hints, `${path}.automationHints`);
    assertKnownKeys(hints, new Set(['needsData', 'reviewRequired', 'reasons']), `${path}.automationHints`);
    if ('needsData' in hints && typeof hints.needsData !== 'boolean') fail('needsData deve ser boolean.', `${path}.automationHints.needsData`);
    if ('reviewRequired' in hints && typeof hints.reviewRequired !== 'boolean') fail('reviewRequired deve ser boolean.', `${path}.automationHints.reviewRequired`);
    assertStringArray(hints.reasons ?? [], `${path}.automationHints.reasons`, { maxItems: 10, maxLength: 500 });
  });

  return output;
}

function computeAutomationReadiness(scenario, context) {
  const runtime = context.runtime || {};
  const blockers = [];
  const hintReasons = scenario.automationHints?.reasons || [];
  const reviewRequired = scenario.automationHints?.reviewRequired === true;
  const needsData = scenario.automationHints?.needsData === true;
  const needsAuth = scenario.authRequirement === 'REQUIRED' && !runtime.defaultAuthProfileRef;
  const needsEnvironment = !runtime.apiServiceKey;
  const assumed = scenario.grounding?.level === 'ASSUMED';

  if (reviewRequired) blockers.push(...(hintReasons.length ? hintReasons : ['O cenário precisa de revisão semântica antes da automação.']));
  if (needsData) blockers.push(...(hintReasons.length ? hintReasons : ['O cenário requer dados de teste adicionais.']));
  if (assumed && !reviewRequired && !needsData) blockers.push('O cenário contém hipótese que precisa de revisão humana.');
  if (needsAuth) blockers.push('O cenário requer autenticação, mas não há Auth Profile selecionado.');
  if (needsEnvironment) blockers.push('Nenhum API Service de runtime configurado ou runtime target seguro descoberto foi resolvido para o endpoint.');

  const uniqueBlockers = [...new Set(blockers)].slice(0, 10);
  if (reviewRequired) return { readiness: 'REVIEW_REQUIRED', blockers: uniqueBlockers };
  if (needsData) return { readiness: 'NEEDS_DATA', blockers: uniqueBlockers };
  if (assumed) return { readiness: 'REVIEW_REQUIRED', blockers: uniqueBlockers };
  if (needsAuth) return { readiness: 'NEEDS_AUTH', blockers: uniqueBlockers };
  if (needsEnvironment) return { readiness: 'NEEDS_ENVIRONMENT', blockers: uniqueBlockers };
  return { readiness: 'READY', blockers: [] };
}

function buildSummary(scenarios) {
  const byCategory = {};
  const byReadiness = {};
  const byGrounding = {};
  for (const scenario of scenarios) {
    byCategory[scenario.category] = (byCategory[scenario.category] || 0) + 1;
    byReadiness[scenario.automation.readiness] = (byReadiness[scenario.automation.readiness] || 0) + 1;
    byGrounding[scenario.grounding.level] = (byGrounding[scenario.grounding.level] || 0) + 1;
  }
  return {
    scenarioCount: scenarios.length,
    readyCount: byReadiness.READY || 0,
    byCategory,
    byReadiness,
    byGrounding,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateTestDataBindingsV1(testData, path) {
  assertPlainObject(testData, path);
  assertKnownKeys(testData, new Set(['contractVersion', 'bindings']), path);
  if (testData.contractVersion !== 'qagent.test-data-bindings.v1') fail('Test Data contract inválido.', `${path}.contractVersion`, 'TEST_DATA_CONTRACT_INVALID');
  const bindings = assertArray(testData.bindings ?? [], `${path}.bindings`, { max: 100 });
  bindings.forEach((binding, index) => {
    const bPath = `${path}.bindings[${index}]`;
    assertPlainObject(binding, bPath);
    assertKnownKeys(binding, new Set(['target', 'selector', 'source', 'valueType', 'bindingKey', 'generator']), bPath);
    assertEnum(binding.target, ['BODY', 'PATH_PARAM', 'QUERY'], `${bPath}.target`);
    assertString(binding.selector, `${bPath}.selector`, { max: 320 });
    assertEnum(binding.source, ['GENERATED', 'FIXED', 'SECRET', 'OBSERVED'], `${bPath}.source`);
    if (isSensitiveTestDataSelector(binding.target, binding.selector) && binding.source !== 'SECRET') fail('Campo sensível de Test Data deve usar SECRET.', `${bPath}.source`, 'TEST_DATA_SECRET_SOURCE_REQUIRED');
    assertEnum(binding.valueType, ['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'JSON'], `${bPath}.valueType`);
    if (binding.source === 'SECRET' && binding.valueType !== 'STRING') fail('SECRET Test Data v1 suporta somente STRING.', `${bPath}.valueType`, 'TEST_DATA_SECRET_VALUE_TYPE_INVALID');
    if (binding.source === 'GENERATED') {
      assertPlainObject(binding.generator, `${bPath}.generator`);
      assertKnownKeys(binding.generator, new Set(['kind', 'config']), `${bPath}.generator`);
      assertString(binding.generator.kind, `${bPath}.generator.kind`, { max: 64 });
      if (binding.generator.config != null) assertJsonValue(binding.generator.config, `${bPath}.generator.config`);
      if (binding.bindingKey != null) fail('GENERATED não usa bindingKey.', `${bPath}.bindingKey`, 'TEST_DATA_CONTRACT_INVALID');
    } else {
      assertString(binding.bindingKey, `${bPath}.bindingKey`, { max: 400 });
      if (binding.generator != null) fail('FIXED/SECRET/OBSERVED não usam generator.', `${bPath}.generator`, 'TEST_DATA_CONTRACT_INVALID');
    }
  });
}

export function buildTestSpecificationV1({ context, modelOutput, generation, testDataPlans = {} }) {
  validateTestDesignModelOutputV1(modelOutput, context);
  assertPlainObject(generation, 'generation');
  assertKnownKeys(generation, new Set(['provider', 'model', 'generatedAt', 'contextFingerprint']), 'generation');

  const provider = assertString(generation.provider, 'generation.provider', { max: 80 });
  const model = assertString(generation.model, 'generation.model', { max: 160 });
  const generatedAt = assertString(generation.generatedAt, 'generation.generatedAt', { max: 64 });
  const contextFingerprint = assertString(generation.contextFingerprint, 'generation.contextFingerprint', { max: 256 });

  const method = normalizeMethod(context.endpoint.method);
  const path = assertRelativePath(context.endpoint.normalizedPath);
  const apiServiceKey = context.runtime?.apiServiceKey || null;
  const defaultAuthProfileRef = context.runtime?.defaultAuthProfileRef || null;

  const scenarios = modelOutput.scenarios.map((scenario) => {
    const automation = computeAutomationReadiness(scenario, context);
    return {
      scenarioId: scenario.scenarioId,
      title: scenario.title.trim(),
      objective: scenario.objective.trim(),
      category: scenario.category,
      priority: scenario.priority,
      confidence: scenario.confidence,
      grounding: cloneJson(scenario.grounding),
      automation,
      preconditions: cloneJson(scenario.preconditions || []),
      spec: {
        dslVersion: API_TEST_DSL_VERSION,
        type: 'api',
        target: {
          catalogEndpointId: context.endpoint.endpointId,
          apiServiceKey,
          method,
          path,
        },
        auth: {
          requirement: scenario.authRequirement,
          authProfileRef: scenario.authRequirement === 'REQUIRED' ? defaultAuthProfileRef : null,
        },
        request: cloneJson(scenario.request || { pathParams: {}, query: {}, headers: {}, body: null }),
        assertions: cloneJson(scenario.assertions || []),
        extract: cloneJson(scenario.extract || []),
        ...(testDataPlans?.[scenario.scenarioId]?.bindings?.length ? { testData: cloneJson(testDataPlans[scenario.scenarioId]) } : {}),
      },
    };
  });

  return {
    contractVersion: TEST_DESIGN_CONTRACT_VERSION,
    specificationVersion: TEST_SPECIFICATION_VERSION,
    source: {
      type: 'CATALOG_ENDPOINT',
      organizationId: context.organizationId,
      projectId: context.projectId,
      endpointId: context.endpoint.endpointId,
    },
    title: modelOutput.title.trim(),
    objective: modelOutput.objective.trim(),
    assumptions: cloneJson(modelOutput.assumptions || []),
    summary: buildSummary(scenarios),
    scenarios,
    generation: {
      mode: 'AI',
      provider,
      model,
      generatedAt,
      contextFingerprint,
    },
  };
}

export function validateTestSpecificationV1(specification, context) {
  validateCatalogTestDesignContextV1(context);
  assertPlainObject(specification, 'specification');
  assertKnownKeys(specification, new Set([
    'contractVersion', 'specificationVersion', 'source', 'title', 'objective', 'assumptions',
    'summary', 'scenarios', 'generation',
  ]), 'specification');
  if (specification.contractVersion !== TEST_DESIGN_CONTRACT_VERSION) fail('Contract version inválida.', 'specification.contractVersion');
  if (specification.specificationVersion !== TEST_SPECIFICATION_VERSION) fail('Specification version inválida.', 'specification.specificationVersion');

  assertPlainObject(specification.source, 'specification.source');
  if (specification.source.type !== 'CATALOG_ENDPOINT') fail('Source type inválido.', 'specification.source.type');
  if (specification.source.organizationId !== context.organizationId) fail('organizationId divergente do contexto.', 'specification.source.organizationId', 'TEST_DESIGN_SCOPE_MISMATCH');
  if (specification.source.projectId !== context.projectId) fail('projectId divergente do contexto.', 'specification.source.projectId', 'TEST_DESIGN_SCOPE_MISMATCH');
  if (specification.source.endpointId !== context.endpoint.endpointId) fail('endpointId divergente do contexto.', 'specification.source.endpointId', 'TEST_DESIGN_SCOPE_MISMATCH');

  assertString(specification.title, 'specification.title', { max: 260 });
  assertString(specification.objective, 'specification.objective', { max: 1200 });
  assertStringArray(specification.assumptions ?? [], 'specification.assumptions', { maxItems: 20, maxLength: 500 });

  assertPlainObject(specification.generation, 'specification.generation');
  assertKnownKeys(specification.generation, new Set(['mode', 'provider', 'model', 'generatedAt', 'contextFingerprint']), 'specification.generation');
  if (specification.generation.mode !== 'AI') fail('Generation mode inválido.', 'specification.generation.mode');
  assertString(specification.generation.provider, 'specification.generation.provider', { max: 80 });
  assertString(specification.generation.model, 'specification.generation.model', { max: 160 });
  assertString(specification.generation.generatedAt, 'specification.generation.generatedAt', { max: 64 });
  assertString(specification.generation.contextFingerprint, 'specification.generation.contextFingerprint', { max: 256 });

  const refs = collectContextReferences(context);
  const scenarios = assertArray(specification.scenarios, 'specification.scenarios', { max: 20 });
  if (!scenarios.length) fail('Specification sem cenários.', 'specification.scenarios');

  for (let index = 0; index < scenarios.length; index++) {
    const scenario = scenarios[index];
    const path = `specification.scenarios[${index}]`;
    assertPlainObject(scenario, path);
    assertKnownKeys(scenario, new Set([
      'scenarioId', 'title', 'objective', 'category', 'priority', 'confidence', 'grounding',
      'automation', 'preconditions', 'spec',
    ]), path);
    assertString(scenario.scenarioId, `${path}.scenarioId`, { max: 80 });
    assertString(scenario.title, `${path}.title`, { max: 260 });
    assertString(scenario.objective, `${path}.objective`, { max: 1000 });
    assertStringArray(scenario.preconditions ?? [], `${path}.preconditions`, { maxItems: 20, maxLength: 500 });
    assertEnum(scenario.category, TEST_SCENARIO_CATEGORIES, `${path}.category`);
    assertEnum(scenario.priority, TEST_PRIORITIES, `${path}.priority`);
    assertEnum(scenario.confidence, TEST_CONFIDENCE_LEVELS, `${path}.confidence`);
    validateGrounding(scenario.grounding, `${path}.grounding`, refs);
    assertPlainObject(scenario.automation, `${path}.automation`);
    assertEnum(scenario.automation.readiness, AUTOMATION_READINESS_LEVELS, `${path}.automation.readiness`);
    assertStringArray(scenario.automation.blockers ?? [], `${path}.automation.blockers`, { maxItems: 10, maxLength: 500 });

    assertPlainObject(scenario.spec, `${path}.spec`);
    if (scenario.spec.dslVersion !== API_TEST_DSL_VERSION) fail('DSL version inválida.', `${path}.spec.dslVersion`);
    if (scenario.spec.type !== 'api') fail('Somente API Test DSL é suportada nesta versão.', `${path}.spec.type`);
    assertKnownKeys(scenario.spec, new Set(['dslVersion', 'type', 'target', 'auth', 'request', 'assertions', 'extract', 'testData']), `${path}.spec`);
    assertPlainObject(scenario.spec.target, `${path}.spec.target`);
    assertKnownKeys(scenario.spec.target, new Set(['catalogEndpointId', 'apiServiceKey', 'method', 'path']), `${path}.spec.target`);
    if (scenario.spec.target.catalogEndpointId !== context.endpoint.endpointId) fail('Target endpoint foi alterado.', `${path}.spec.target.catalogEndpointId`, 'TEST_DESIGN_SCOPE_MISMATCH');
    if (normalizeMethod(scenario.spec.target.method, `${path}.spec.target.method`) !== normalizeMethod(context.endpoint.method)) fail('Método divergente do Catalog.', `${path}.spec.target.method`, 'TEST_DESIGN_TARGET_MISMATCH');
    if (assertRelativePath(scenario.spec.target.path, `${path}.spec.target.path`) !== context.endpoint.normalizedPath) fail('Path divergente do Catalog.', `${path}.spec.target.path`, 'TEST_DESIGN_TARGET_MISMATCH');
    if ((scenario.spec.target.apiServiceKey || null) !== (context.runtime?.apiServiceKey || null)) fail('Runtime API Service não pode ser inventado pelo Test Design.', `${path}.spec.target.apiServiceKey`, 'TEST_DESIGN_RUNTIME_SERVICE_MISMATCH');

    assertPlainObject(scenario.spec.auth, `${path}.spec.auth`);
    assertKnownKeys(scenario.spec.auth, new Set(['requirement', 'authProfileRef']), `${path}.spec.auth`);
    assertEnum(scenario.spec.auth.requirement, AUTH_REQUIREMENTS, `${path}.spec.auth.requirement`);
    const authProfileRef = scenario.spec.auth.authProfileRef || null;
    if (authProfileRef && !(context.runtime?.availableAuthProfileRefs || []).includes(authProfileRef)) {
      fail('Auth Profile não pertence ao contexto permitido.', `${path}.spec.auth.authProfileRef`, 'TEST_DESIGN_AUTH_PROFILE_UNKNOWN');
    }
    if (!context.runtime?.apiServiceKey && scenario.automation.readiness === 'READY') {
      fail('Cenário não pode ser READY sem runtime target resolvido.', `${path}.automation.readiness`, 'TEST_DESIGN_READINESS_INCONSISTENT');
    }
    if (context.runtime?.apiServiceKey && scenario.spec.auth.requirement === 'REQUIRED' && !authProfileRef && scenario.automation.readiness === 'READY') {
      fail('Cenário não pode ser READY quando autenticação é obrigatória sem Auth Profile.', `${path}.automation.readiness`, 'TEST_DESIGN_READINESS_INCONSISTENT');
    }
    if (scenario.grounding.level === 'ASSUMED' && !['REVIEW_REQUIRED', 'NEEDS_ENVIRONMENT', 'NEEDS_AUTH', 'NEEDS_DATA'].includes(scenario.automation.readiness)) {
      fail('Cenário ASSUMED não pode ser READY.', `${path}.automation.readiness`, 'TEST_DESIGN_READINESS_INCONSISTENT');
    }

    validateRequestObject(scenario.spec.request, `${path}.spec.request`);
    if (scenario.spec.testData != null) validateTestDataBindingsV1(scenario.spec.testData, `${path}.spec.testData`);
    const assertions = assertArray(scenario.spec.assertions, `${path}.spec.assertions`, { max: 30 });
    if (!assertions.length) fail('Specification scenario precisa de ao menos uma assertion.', `${path}.spec.assertions`);
    assertions.forEach((assertion, assertionIndex) => validateAssertion(assertion, `${path}.spec.assertions[${assertionIndex}]`, refs.schemaRefs));
    const extract = assertArray(scenario.spec.extract ?? [], `${path}.spec.extract`, { max: 20 });
    extract.forEach((item, extractIndex) => validateExtract(item, `${path}.spec.extract[${extractIndex}]`));
  }

  const expectedSummary = buildSummary(scenarios);
  if (JSON.stringify(specification.summary) !== JSON.stringify(expectedSummary)) {
    fail('Summary divergente dos cenários; summary é system-owned.', 'specification.summary', 'TEST_DESIGN_SUMMARY_MISMATCH');
  }

  return specification;
}

export const TEST_DESIGN_MODEL_OUTPUT_JSON_SCHEMA_V1 = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['title', 'objective', 'scenarios'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 260 },
    objective: { type: 'string', minLength: 1, maxLength: 1200 },
    assumptions: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 500 } },
    scenarios: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'scenarioId', 'title', 'objective', 'category', 'priority', 'confidence',
          'grounding', 'authRequirement', 'request', 'assertions',
        ],
        properties: {
          scenarioId: { type: 'string', pattern: '^[A-Za-z0-9_-]+$', maxLength: 80 },
          title: { type: 'string', minLength: 1, maxLength: 260 },
          objective: { type: 'string', minLength: 1, maxLength: 1000 },
          category: { type: 'string', enum: TEST_SCENARIO_CATEGORIES },
          priority: { type: 'string', enum: TEST_PRIORITIES },
          confidence: { type: 'string', enum: TEST_CONFIDENCE_LEVELS },
          grounding: {
            type: 'object',
            additionalProperties: false,
            required: ['level', 'rationale', 'evidenceRefs', 'schemaRefs'],
            properties: {
              level: { type: 'string', enum: TEST_GROUNDING_LEVELS },
              rationale: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', maxLength: 500 } },
              evidenceRefs: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 160 } },
              schemaRefs: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 256 } },
            },
          },
          preconditions: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 500 } },
          authRequirement: { type: 'string', enum: AUTH_REQUIREMENTS },
          request: {
            type: 'object',
            additionalProperties: false,
            properties: {
              pathParams: { type: 'object' },
              query: { type: 'object' },
              headers: { type: 'object' },
              body: {},
            },
          },
          assertions: {
            type: 'array',
            minItems: 1,
            maxItems: 30,
            items: {
              oneOf: [
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'expectedStatusCodes'],
                  properties: {
                    type: { const: 'STATUS' },
                    expectedStatusCodes: {
                      type: 'array', minItems: 1, maxItems: 12,
                      items: { type: 'integer', minimum: 100, maximum: 599 },
                    },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'schemaRef'],
                  properties: {
                    type: { const: 'SCHEMA' },
                    schemaRef: { type: 'string', minLength: 1, maxLength: 160 },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'path'],
                  properties: {
                    type: { const: 'JSON_PATH_EXISTS' },
                    path: { type: 'string', minLength: 1, maxLength: 500 },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'path', 'expected'],
                  properties: {
                    type: { const: 'JSON_PATH_EQUALS' },
                    path: { type: 'string', minLength: 1, maxLength: 500 },
                    expected: {},
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'name'],
                  properties: {
                    type: { const: 'HEADER_EXISTS' },
                    name: { type: 'string', minLength: 1, maxLength: 160 },
                  },
                },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['type', 'expected'],
                  properties: {
                    type: { const: 'CONTENT_TYPE' },
                    expected: {
                      type: 'array', minItems: 1, maxItems: 10,
                      items: { type: 'string', minLength: 1, maxLength: 160 },
                    },
                  },
                },
              ],
            },
          },
          extract: {
            type: 'array',
            maxItems: 20,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'source', 'selector'],
              properties: {
                name: { type: 'string', minLength: 1, maxLength: 120 },
                source: { type: 'string', enum: EXTRACT_SOURCES },
                selector: { type: 'string', minLength: 1, maxLength: 500 },
              },
            },
          },
          automationHints: {
            type: 'object',
            additionalProperties: false,
            properties: {
              needsData: { type: 'boolean' },
              reviewRequired: { type: 'boolean' },
              reasons: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 500 } },
            },
          },
        },
      },
    },
  },
});

export const SECRET_SAFE_TEST_DESIGN_SANITIZER_VERSION = 'qagent.secret-safe-test-design-sanitizer.v1';

const SENSITIVE_REQUEST_KEY_RE = /(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|client[_-]?secret)/i;
const SENSITIVE_SELECTOR_KEYS = new Set([
  'password', 'passwd', 'newpassword', 'currentpassword', 'passwordconfirmation', 'newpasswordconfirmation',
  'secret', 'clientsecret', 'apikey', 'authorization', 'cookie', 'credential', 'privatekey',
  'accesstoken', 'refreshtoken', 'idtoken', 'bearertoken', 'sessiontoken',
]);

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniquePush(array, value, max = 20) {
  if (!value || array.includes(value) || array.length >= max) return;
  array.push(value);
}

function isSensitiveKey(key) {
  return SENSITIVE_REQUEST_KEY_RE.test(String(key || ''));
}

function isSensitiveHeader(name) {
  const normalized = String(name || '').trim().toLowerCase();
  return SENSITIVE_HEADER_NAMES.has(normalized) || isSensitiveKey(normalized);
}

function isSensitiveSelector(selector) {
  const value = String(selector || '').trim();
  if (!value) return false;
  const tokens = value.match(/[A-Za-z_][A-Za-z0-9_-]*/g) || [];
  return tokens.some((token) => SENSITIVE_SELECTOR_KEYS.has(token.replace(/[_-]/g, '').toLowerCase()));
}

function ensureScenarioContainers(scenario) {
  if (!isPlainObject(scenario.automationHints)) scenario.automationHints = {};
  if (!Array.isArray(scenario.automationHints.reasons)) scenario.automationHints.reasons = [];
  if (!isPlainObject(scenario.grounding)) {
    scenario.grounding = { level: 'ASSUMED', rationale: [], evidenceRefs: [], schemaRefs: [] };
  }
  if (!Array.isArray(scenario.grounding.rationale)) scenario.grounding.rationale = [];
}

function recordRemoval(diagnostics, { scenarioId, path, kind, needsData = false, reviewRequired = false }) {
  diagnostics.removedMaterialCount += 1;
  diagnostics.byKind[kind] = (diagnostics.byKind[kind] || 0) + 1;
  uniquePush(diagnostics.sanitizedPaths, path, 40);
  uniquePush(diagnostics.sanitizedScenarioIds, scenarioId, 20);
  if (needsData) uniquePush(diagnostics.needsDataScenarioIds, scenarioId, 20);
  if (reviewRequired) uniquePush(diagnostics.reviewRequiredScenarioIds, scenarioId, 20);
}

function sanitizeNestedObject(value, path, onSensitive, depth = 0) {
  if (depth > 12 || value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => sanitizeNestedObject(item, `${path}[${index}]`, onSensitive, depth + 1));
    return;
  }
  if (!isPlainObject(value)) return;

  for (const key of Object.keys(value)) {
    const childPath = `${path}.${key}`;
    if (isSensitiveKey(key)) {
      delete value[key];
      onSensitive(childPath);
      continue;
    }
    sanitizeNestedObject(value[key], childPath, onSensitive, depth + 1);
  }
}

function markNeedsSecureRuntimeData(scenario, diagnostics, scenarioId) {
  scenario.automationHints.needsData = true;
  const reason = 'QAgent Secret Guard: dados sensíveis do request foram removidos do Test Design; forneça-os por um mecanismo seguro de runtime/test data.';
  uniquePush(scenario.automationHints.reasons, reason, 10);
  uniquePush(scenario.grounding.rationale, reason, 12);
  uniquePush(diagnostics.needsDataScenarioIds, scenarioId, 20);
}

function markSensitiveIntentReview(scenario, diagnostics, scenarioId) {
  scenario.automationHints.reviewRequired = true;
  const reason = 'QAgent Secret Guard: assertion/extract sobre material sensível foi removido; a intenção do cenário precisa de revisão antes da automação.';
  uniquePush(scenario.automationHints.reasons, reason, 10);
  uniquePush(scenario.grounding.rationale, reason, 12);
  uniquePush(diagnostics.reviewRequiredScenarioIds, scenarioId, 20);
}

/**
 * Deterministic secret-safe pass applied before contract validation/persistence.
 * It never attempts to create placeholders or replacement secret values.
 */
export function applySecretSafeTestDesignSanitizerV1(modelOutput) {
  const output = cloneJson(modelOutput);
  const diagnostics = {
    sanitizerVersion: SECRET_SAFE_TEST_DESIGN_SANITIZER_VERSION,
    sanitizedScenarioCount: 0,
    removedMaterialCount: 0,
    requestSecretRemovalCount: 0,
    authHeaderRemovalCount: 0,
    assertionRemovalCount: 0,
    extractRemovalCount: 0,
    needsDataScenarioCount: 0,
    reviewRequiredScenarioCount: 0,
    byKind: {},
    sanitizedPaths: [],
    sanitizedScenarioIds: [],
    needsDataScenarioIds: [],
    reviewRequiredScenarioIds: [],
  };

  if (!isPlainObject(output) || !Array.isArray(output.scenarios)) return { output, diagnostics };

  output.scenarios.forEach((scenario, scenarioIndex) => {
    if (!isPlainObject(scenario)) return;
    ensureScenarioContainers(scenario);
    const scenarioId = String(scenario.scenarioId || `scenario_${scenarioIndex + 1}`);
    let removedRequestSecret = false;
    let removedSensitiveIntent = false;
    const request = isPlainObject(scenario.request) ? scenario.request : null;

    if (request) {
      for (const field of ['body', 'query', 'pathParams']) {
        if (!(field in request)) continue;
        sanitizeNestedObject(request[field], `modelOutput.scenarios[${scenarioIndex}].request.${field}`, (path) => {
          removedRequestSecret = true;
          diagnostics.requestSecretRemovalCount += 1;
          recordRemoval(diagnostics, { scenarioId, path, kind: `REQUEST_${field.toUpperCase()}`, needsData: true });
        });
      }

      if (isPlainObject(request.headers)) {
        for (const key of Object.keys(request.headers)) {
          if (!isSensitiveHeader(key)) continue;
          delete request.headers[key];
          diagnostics.authHeaderRemovalCount += 1;
          recordRemoval(diagnostics, {
            scenarioId,
            path: `modelOutput.scenarios[${scenarioIndex}].request.headers.${key}`,
            kind: 'REQUEST_AUTH_HEADER',
          });
        }
      }
    }

    if (Array.isArray(scenario.assertions)) {
      scenario.assertions = scenario.assertions.filter((assertion, assertionIndex) => {
        if (!isPlainObject(assertion)) return true;
        const sensitiveHeader = assertion.type === 'HEADER_EXISTS' && isSensitiveHeader(assertion.name);
        const sensitiveJsonPath = ['JSON_PATH_EXISTS', 'JSON_PATH_EQUALS'].includes(assertion.type) && isSensitiveSelector(assertion.path);
        if (!sensitiveHeader && !sensitiveJsonPath) return true;
        removedSensitiveIntent = true;
        diagnostics.assertionRemovalCount += 1;
        recordRemoval(diagnostics, {
          scenarioId,
          path: `modelOutput.scenarios[${scenarioIndex}].assertions[${assertionIndex}]`,
          kind: 'SENSITIVE_ASSERTION',
          reviewRequired: true,
        });
        return false;
      });
    }

    if (Array.isArray(scenario.extract)) {
      scenario.extract = scenario.extract.filter((extract, extractIndex) => {
        if (!isPlainObject(extract)) return true;
        const sensitive = extract.source === 'HEADER'
          ? isSensitiveHeader(extract.selector)
          : extract.source === 'JSON_PATH' && isSensitiveSelector(extract.selector);
        if (!sensitive) return true;
        removedSensitiveIntent = true;
        diagnostics.extractRemovalCount += 1;
        recordRemoval(diagnostics, {
          scenarioId,
          path: `modelOutput.scenarios[${scenarioIndex}].extract[${extractIndex}]`,
          kind: 'SENSITIVE_EXTRACT',
          reviewRequired: true,
        });
        return false;
      });
    }

    if (removedRequestSecret) markNeedsSecureRuntimeData(scenario, diagnostics, scenarioId);
    if (removedSensitiveIntent) markSensitiveIntentReview(scenario, diagnostics, scenarioId);
  });

  diagnostics.sanitizedScenarioCount = diagnostics.sanitizedScenarioIds.length;
  diagnostics.needsDataScenarioCount = diagnostics.needsDataScenarioIds.length;
  diagnostics.reviewRequiredScenarioCount = diagnostics.reviewRequiredScenarioIds.length;
  return { output, diagnostics };
}

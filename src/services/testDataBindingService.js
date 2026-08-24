import {
  createEndpointTestDataBinding as insertBinding,
  getEndpointTestDataBinding,
  listEndpointTestDataBindings,
  updateEndpointTestDataBinding as persistBinding,
} from '../repositories/testDataBindingRepository.js';
import { getProjectEnvironment } from './environmentService.js';
import { getOrganizationProject } from './projectService.js';
import { createProjectSecret, rotateProjectSecret } from './secretVaultService.js';
import { getSecretMetadata } from '../repositories/secretRepository.js';
import { cleanConfigText } from '../lib/environmentConfig.js';
import { assertTestDataSourceSecurity, sanitizeTestDataGeneratorConfig, scopeRank, TEST_DATA_SCOPES } from '../lib/testDataPolicy.js';

const TARGETS = new Set(['BODY', 'PATH_PARAM', 'QUERY']);
const SOURCES = new Set(['GENERATED', 'FIXED', 'SECRET']);
const VALUE_TYPES = new Set(['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'JSON']);
const GENERATOR_KINDS = new Set([
  'AUTO', 'TEXT', 'TEXT_SENTENCE', 'FIRST_NAME', 'LAST_NAME', 'FULL_NAME', 'EMAIL', 'UUID',
  'BR_CPF', 'BR_CNPJ', 'BR_CEP', 'PHONE', 'INTEGER', 'NUMBER', 'BOOLEAN', 'DATE', 'DATE_TIME',
  'STRING_LIST', 'INTEGER_LIST', 'NUMBER_LIST', 'BOOLEAN_LIST', 'JSON_SCHEMA',
]);
const STRING_GENERATORS = new Set([
  'TEXT', 'TEXT_SENTENCE', 'FIRST_NAME', 'LAST_NAME', 'FULL_NAME', 'EMAIL', 'UUID',
  'BR_CPF', 'BR_CNPJ', 'BR_CEP', 'PHONE', 'DATE', 'DATE_TIME',
]);

function bad(message, code = 'INVALID_TEST_DATA_BINDING', status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function normalizeScope(value = 'ENDPOINT') {
  const scopeType = cleanConfigText(value, 32).toUpperCase();
  if (!TEST_DATA_SCOPES.includes(scopeType)) bad('Test Data scopeType inválido.', 'INVALID_TEST_DATA_SCOPE');
  return scopeType;
}

function normalizeTarget(value) {
  const target = cleanConfigText(value, 32).toUpperCase();
  if (!TARGETS.has(target)) bad('Test Data target inválido.');
  return target;
}

function normalizeSelector(target, value) {
  const selector = cleanConfigText(value, 320);
  if (!selector) bad('Test Data selector é obrigatório.');
  if (target === 'BODY') {
    if (!/^\$\.[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)*$/.test(selector)) {
      bad('BODY selector deve usar JSON path simples, por exemplo $.comment ou $.customer.id.', 'INVALID_TEST_DATA_SELECTOR');
    }
  } else if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/.test(selector)) {
    bad('Selector de PATH_PARAM/QUERY inválido.', 'INVALID_TEST_DATA_SELECTOR');
  }
  return selector;
}

function normalizeSource(value) {
  const source = cleanConfigText(value, 32).toUpperCase();
  if (!SOURCES.has(source)) bad('Test Data sourceType inválido.');
  return source;
}

function normalizeValueType(value = 'STRING') {
  const type = cleanConfigText(value, 32).toUpperCase();
  if (!VALUE_TYPES.has(type)) bad('Test Data valueType inválido.');
  return type;
}

function normalizeFixedValue(value, valueType) {
  if (value === undefined) bad('FIXED requer value.', 'TEST_DATA_FIXED_VALUE_REQUIRED');
  let normalized;
  if (valueType === 'STRING') normalized = String(value);
  else if (valueType === 'INTEGER') {
    const number = Number(value);
    if (!Number.isInteger(number)) bad('FIXED INTEGER inválido.');
    normalized = number;
  } else if (valueType === 'NUMBER') {
    const number = Number(value);
    if (!Number.isFinite(number)) bad('FIXED NUMBER inválido.');
    normalized = number;
  } else if (valueType === 'BOOLEAN') {
    if (typeof value === 'boolean') normalized = value;
    else if (String(value).toLowerCase() === 'true') normalized = true;
    else if (String(value).toLowerCase() === 'false') normalized = false;
    else bad('FIXED BOOLEAN inválido.');
  } else normalized = value;

  let serialized;
  try { serialized = JSON.stringify(normalized); } catch { bad('FIXED JSON inválido.', 'TEST_DATA_FIXED_VALUE_INVALID'); }
  if (serialized === undefined) bad('FIXED value inválido.', 'TEST_DATA_FIXED_VALUE_INVALID');
  if (new TextEncoder().encode(serialized).byteLength > 16_384) bad('FIXED value excede 16 KB.', 'TEST_DATA_FIXED_VALUE_TOO_LARGE', 413);
  return serialized;
}

function assertGeneratorCompatibility(kind, valueType) {
  if (kind === 'AUTO') return;
  if (STRING_GENERATORS.has(kind) && valueType === 'STRING') return;
  if (kind === 'INTEGER' && valueType === 'INTEGER') return;
  if ((kind === 'INTEGER' || kind === 'NUMBER') && valueType === 'NUMBER') return;
  if (kind === 'BOOLEAN' && valueType === 'BOOLEAN') return;
  if ((kind.endsWith('_LIST') || kind === 'JSON_SCHEMA') && valueType === 'JSON') return;
  bad('generatorKind é incompatível com valueType.', 'TEST_DATA_GENERATOR_TYPE_MISMATCH');
}

function normalizeGenerator(sourceType, generatorKind, generatorConfig, valueType, selector = '$') {
  if (sourceType !== 'GENERATED') return { generatorKind: null, generatorConfigJson: null };
  const kind = cleanConfigText(generatorKind || 'AUTO', 64).toUpperCase();
  if (!GENERATOR_KINDS.has(kind)) bad('generatorKind inválido.', 'INVALID_TEST_DATA_GENERATOR');
  assertGeneratorCompatibility(kind, valueType);
  const rawConfig = generatorConfig && typeof generatorConfig === 'object' && !Array.isArray(generatorConfig) ? generatorConfig : {};
  const config = sanitizeTestDataGeneratorConfig(kind, rawConfig, { valueType, selectorPath: selector });
  let serialized;
  try { serialized = JSON.stringify(config); } catch { bad('generatorConfig inválido.', 'INVALID_TEST_DATA_GENERATOR_CONFIG'); }
  if (new TextEncoder().encode(serialized).byteLength > 8_192) bad('generatorConfig excede 8 KB.', 'TEST_DATA_GENERATOR_CONFIG_TOO_LARGE', 413);
  return { generatorKind: kind, generatorConfigJson: serialized };
}

function publicBinding(row) {
  if (!row) return null;
  let generatorConfig = {};
  try { generatorConfig = row.generatorConfigJson ? JSON.parse(row.generatorConfigJson) : {}; } catch {}
  let fixedValue = null;
  try { fixedValue = row.fixedValueJson == null ? null : JSON.parse(row.fixedValueJson); } catch {}
  return {
    bindingId: row.bindingId,
    organizationId: row.organizationId,
    projectId: row.projectId,
    scopeType: row.scopeType,
    environmentId: row.environmentId || null,
    endpointId: row.endpointId || null,
    target: row.target,
    selector: row.selector,
    sourceType: row.sourceType,
    valueType: row.valueType,
    generatorKind: row.generatorKind || null,
    generatorConfig,
    ...(row.sourceType === 'FIXED' ? { value: fixedValue } : {}),
    secretConfigured: row.sourceType === 'SECRET' ? Boolean(row.secretId) : false,
    description: row.description || null,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function scopeFields(scopeType, environmentId, endpointId) {
  if (scopeType === 'PROJECT') return { environmentId: null, endpointId: null };
  if (!environmentId) bad(`${scopeType} requer environmentId.`, 'TEST_DATA_ENVIRONMENT_REQUIRED');
  if (scopeType === 'ENVIRONMENT') return { environmentId, endpointId: null };
  if (!endpointId) bad('ENDPOINT requer endpointId.', 'TEST_DATA_ENDPOINT_REQUIRED');
  return { environmentId, endpointId };
}

async function validateScopeEnvironment(env, organizationId, projectId, scopeType, environmentId) {
  if (scopeType === 'PROJECT') return null;
  return getProjectEnvironment(env, organizationId, projectId, environmentId);
}

export async function listProjectEndpointTestDataBindings(env, organizationId, projectId, endpointId, options = {}) {
  await getOrganizationProject(env, organizationId, projectId);
  if (options.environmentId) await getProjectEnvironment(env, organizationId, projectId, options.environmentId);
  return (await listEndpointTestDataBindings(env, organizationId, projectId, endpointId, options)).map(publicBinding);
}

export async function getProjectEndpointTestDataBinding(env, organizationId, projectId, endpointId, bindingId, options = {}) {
  await getOrganizationProject(env, organizationId, projectId, { includeArchived: options.includeArchived === true });
  const row = await getEndpointTestDataBinding(env, organizationId, projectId, endpointId, bindingId, options);
  if (!row) bad('Test Data binding não encontrado.', 'TEST_DATA_BINDING_NOT_FOUND', 404);
  return publicBinding(row);
}

async function prepareSecret(env, { organizationId, projectId, userId, scopeLabel, endpointId, selector, existingSecretId = null, secretValue }) {
  if (secretValue === undefined || secretValue === null || String(secretValue).length === 0) {
    if (existingSecretId) return existingSecretId;
    bad('SECRET requer secretValue para a primeira configuração.', 'TEST_DATA_SECRET_VALUE_REQUIRED');
  }
  const payload = { value: String(secretValue) };
  if (existingSecretId) {
    const current = await getSecretMetadata(env, organizationId, projectId, existingSecretId);
    if (!current || current.kind !== 'generic') bad('Secret atual do Test Data binding é incompatível.', 'TEST_DATA_SECRET_KIND_MISMATCH', 409);
    await rotateProjectSecret(env, { organizationId, projectId, secretId: existingSecretId, input: { value: payload } });
    return existingSecretId;
  }
  const created = await createProjectSecret(env, {
    organizationId,
    projectId,
    userId,
    forcedKind: 'generic',
    forcedName: `Test Data · ${scopeLabel} · ${(endpointId || 'global').slice(0, 16)} · ${selector}`.slice(0, 160),
    input: { value: payload },
  });
  return created.secretId;
}

export async function createProjectEndpointTestDataBinding(env, { organizationId, projectId, endpointId, userId, input }) {
  await getOrganizationProject(env, organizationId, projectId);
  const scopeType = normalizeScope(input?.scopeType || 'ENDPOINT');
  const requestedEnvironmentId = cleanConfigText(input?.environmentId, 160) || null;
  const scope = scopeFields(scopeType, requestedEnvironmentId, endpointId);
  const environment = await validateScopeEnvironment(env, organizationId, projectId, scopeType, scope.environmentId);
  const target = normalizeTarget(input?.target);
  const selector = normalizeSelector(target, input?.selector);
  const sourceType = normalizeSource(input?.sourceType);
  assertTestDataSourceSecurity(target, selector, sourceType, bad);
  const valueType = normalizeValueType(input?.valueType || 'STRING');
  if (sourceType === 'SECRET' && valueType !== 'STRING') bad('SECRET v1 suporta somente valueType STRING.', 'TEST_DATA_SECRET_VALUE_TYPE_INVALID');
  const generator = normalizeGenerator(sourceType, input?.generatorKind, input?.generatorConfig, valueType, selector);
  const fixedValueJson = sourceType === 'FIXED' ? normalizeFixedValue(input?.value, valueType) : null;
  const scopeLabel = scopeType === 'PROJECT' ? 'Project' : `${scopeType} ${environment?.name || scope.environmentId}`;
  const secretId = sourceType === 'SECRET'
    ? await prepareSecret(env, { organizationId, projectId, userId, scopeLabel, endpointId: scope.endpointId, selector, secretValue: input?.secretValue })
    : null;
  const description = cleanConfigText(input?.description, 1000) || null;
  try {
    return publicBinding(await insertBinding(env, {
      organizationId,
      projectId,
      endpointContextId: endpointId,
      scopeType,
      environmentId: scope.environmentId,
      endpointId: scope.endpointId,
      target,
      selector,
      sourceType,
      valueType,
      generatorKind: generator.generatorKind,
      generatorConfigJson: generator.generatorConfigJson,
      fixedValueJson,
      secretId,
      description,
      createdByUserId: userId,
    }));
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE constraint failed')) bad('Já existe binding ativo para este scope/target/selector.', 'DUPLICATE_TEST_DATA_BINDING', 409);
    throw error;
  }
}

export async function patchProjectEndpointTestDataBinding(env, { organizationId, projectId, endpointId, bindingId, userId, input }) {
  const row = await getEndpointTestDataBinding(env, organizationId, projectId, endpointId, bindingId, { includeArchived: true });
  if (!row) bad('Test Data binding não encontrado.', 'TEST_DATA_BINDING_NOT_FOUND', 404);
  if (row.status === 'archived') bad('Test Data binding arquivado não pode ser alterado.', 'TEST_DATA_BINDING_ARCHIVED', 409);
  if (input?.scopeType && normalizeScope(input.scopeType) !== row.scopeType) bad('scopeType é imutável; crie outro binding.', 'TEST_DATA_BINDING_SCOPE_IMMUTABLE', 409);
  if (input?.target && normalizeTarget(input.target) !== row.target) bad('target é imutável; crie outro binding.', 'TEST_DATA_BINDING_TARGET_IMMUTABLE', 409);
  if (input?.selector && normalizeSelector(row.target, input.selector) !== row.selector) bad('selector é imutável; crie outro binding.', 'TEST_DATA_BINDING_SELECTOR_IMMUTABLE', 409);
  if (input?.environmentId !== undefined && (cleanConfigText(input.environmentId, 160) || null) !== (row.environmentId || null)) bad('environmentId é imutável; crie outro binding.', 'TEST_DATA_BINDING_ENVIRONMENT_IMMUTABLE', 409);

  const sourceType = input?.sourceType ? normalizeSource(input.sourceType) : row.sourceType;
  assertTestDataSourceSecurity(row.target, row.selector, sourceType, bad);
  const valueType = input?.valueType ? normalizeValueType(input.valueType) : row.valueType;
  if (sourceType === 'SECRET' && valueType !== 'STRING') bad('SECRET v1 suporta somente valueType STRING.', 'TEST_DATA_SECRET_VALUE_TYPE_INVALID');
  let previousGeneratorConfig = {};
  try { previousGeneratorConfig = JSON.parse(row.generatorConfigJson || '{}'); } catch {}
  const generator = normalizeGenerator(sourceType, input?.generatorKind ?? row.generatorKind, input?.generatorConfig ?? previousGeneratorConfig, valueType, row.selector);
  let fixedValueJson = null;
  let secretId = null;
  if (sourceType === 'FIXED') {
    fixedValueJson = input?.value === undefined && row.sourceType === 'FIXED' ? row.fixedValueJson : normalizeFixedValue(input?.value, valueType);
  } else if (sourceType === 'SECRET') {
    const environment = row.environmentId ? await getProjectEnvironment(env, organizationId, projectId, row.environmentId) : null;
    const scopeLabel = row.scopeType === 'PROJECT' ? 'Project' : `${row.scopeType} ${environment?.name || row.environmentId}`;
    secretId = await prepareSecret(env, {
      organizationId,
      projectId,
      userId,
      scopeLabel,
      endpointId: row.endpointId,
      selector: row.selector,
      existingSecretId: row.sourceType === 'SECRET' ? row.secretId : null,
      secretValue: input?.secretValue,
    });
  }
  const description = input?.description === undefined ? row.description : (cleanConfigText(input.description, 1000) || null);
  return publicBinding(await persistBinding(env, {
    ...row,
    endpointContextId: endpointId,
    organizationId,
    projectId,
    bindingId,
    sourceType,
    valueType,
    generatorKind: generator.generatorKind,
    generatorConfigJson: generator.generatorConfigJson,
    fixedValueJson,
    secretId,
    description,
    status: 'active',
  }));
}

export async function archiveProjectEndpointTestDataBinding(env, { organizationId, projectId, endpointId, bindingId }) {
  const row = await getEndpointTestDataBinding(env, organizationId, projectId, endpointId, bindingId, { includeArchived: true });
  if (!row) bad('Test Data binding não encontrado.', 'TEST_DATA_BINDING_NOT_FOUND', 404);
  if (row.status === 'archived') return publicBinding(row);
  return publicBinding(await persistBinding(env, { ...row, endpointContextId: endpointId, status: 'archived' }));
}

function effectiveBindings(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.target}:${row.selector}`;
    const previous = byKey.get(key);
    if (!previous || scopeRank(row.scopeType) > scopeRank(previous.scopeType)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

export async function resolveEndpointTestDataBindingsForRun(env, organizationId, projectId, endpointId, environmentId) {
  const rows = await listEndpointTestDataBindings(env, organizationId, projectId, endpointId, { environmentId });
  return effectiveBindings(rows).map((row) => {
    let generatorConfig = {};
    let fixedValue = null;
    try { generatorConfig = row.generatorConfigJson ? JSON.parse(row.generatorConfigJson) : {}; } catch {}
    try { fixedValue = row.fixedValueJson == null ? null : JSON.parse(row.fixedValueJson); } catch {}
    return {
      bindingId: row.bindingId,
      scopeType: row.scopeType,
      target: row.target,
      selector: row.selector,
      sourceType: row.sourceType,
      valueType: row.valueType,
      generatorKind: row.generatorKind || null,
      generatorConfig,
      fixedValue,
      secretId: row.secretId || null,
    };
  });
}

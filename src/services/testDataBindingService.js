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

const TARGETS = new Set(['BODY', 'PATH_PARAM', 'QUERY']);
const SOURCES = new Set(['GENERATED', 'FIXED', 'SECRET']);
const VALUE_TYPES = new Set(['STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'JSON']);
const GENERATOR_KINDS = new Set([
  'AUTO', 'TEXT', 'TEXT_SENTENCE', 'FIRST_NAME', 'LAST_NAME', 'FULL_NAME', 'EMAIL', 'UUID',
  'BR_CPF', 'BR_CNPJ', 'BR_CEP', 'PHONE', 'INTEGER', 'NUMBER', 'BOOLEAN', 'DATE', 'DATE_TIME',
  'STRING_LIST', 'INTEGER_LIST', 'NUMBER_LIST', 'BOOLEAN_LIST', 'JSON_SCHEMA',
]);

function bad(message, code = 'INVALID_TEST_DATA_BINDING', status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
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
  } else {
    normalized = value;
  }
  const serialized = JSON.stringify(normalized);
  if (new TextEncoder().encode(serialized).byteLength > 16_384) bad('FIXED value excede 16 KB.', 'TEST_DATA_FIXED_VALUE_TOO_LARGE', 413);
  return serialized;
}

function normalizeGenerator(sourceType, generatorKind, generatorConfig) {
  if (sourceType !== 'GENERATED') return { generatorKind: null, generatorConfigJson: null };
  const kind = cleanConfigText(generatorKind || 'AUTO', 64).toUpperCase();
  if (!GENERATOR_KINDS.has(kind)) bad('generatorKind inválido.', 'INVALID_TEST_DATA_GENERATOR');
  const config = generatorConfig && typeof generatorConfig === 'object' && !Array.isArray(generatorConfig) ? generatorConfig : {};
  const serialized = JSON.stringify(config);
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
    environmentId: row.environmentId,
    endpointId: row.endpointId,
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

async function prepareSecret(env, { organizationId, projectId, userId, environmentName, endpointId, selector, existingSecretId = null, secretValue }) {
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
    forcedName: `Test Data · ${environmentName} · ${endpointId.slice(0, 16)} · ${selector}`.slice(0, 160),
    input: { value: payload },
  });
  return created.secretId;
}

export async function createProjectEndpointTestDataBinding(env, { organizationId, projectId, endpointId, userId, input }) {
  const environmentId = cleanConfigText(input?.environmentId, 160);
  if (!environmentId) bad('environmentId é obrigatório.');
  const environment = await getProjectEnvironment(env, organizationId, projectId, environmentId);
  const target = normalizeTarget(input?.target);
  const selector = normalizeSelector(target, input?.selector);
  const sourceType = normalizeSource(input?.sourceType);
  const valueType = normalizeValueType(input?.valueType || 'STRING');
  const generator = normalizeGenerator(sourceType, input?.generatorKind, input?.generatorConfig);
  const fixedValueJson = sourceType === 'FIXED' ? normalizeFixedValue(input?.value, valueType) : null;
  const secretId = sourceType === 'SECRET'
    ? await prepareSecret(env, { organizationId, projectId, userId, environmentName: environment.name, endpointId, selector, secretValue: input?.secretValue })
    : null;
  const description = cleanConfigText(input?.description, 1000) || null;
  try {
    return publicBinding(await insertBinding(env, {
      organizationId, projectId, environmentId, endpointId, target, selector, sourceType, valueType,
      generatorKind: generator.generatorKind,
      generatorConfigJson: generator.generatorConfigJson,
      fixedValueJson,
      secretId,
      description,
      createdByUserId: userId,
    }));
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE constraint failed')) bad('Já existe binding ativo para este target/selector no Environment.', 'DUPLICATE_TEST_DATA_BINDING', 409);
    throw error;
  }
}

export async function patchProjectEndpointTestDataBinding(env, { organizationId, projectId, endpointId, bindingId, userId, input }) {
  const row = await getEndpointTestDataBinding(env, organizationId, projectId, endpointId, bindingId, { includeArchived: true });
  if (!row) bad('Test Data binding não encontrado.', 'TEST_DATA_BINDING_NOT_FOUND', 404);
  if (row.status === 'archived') bad('Test Data binding arquivado não pode ser alterado.', 'TEST_DATA_BINDING_ARCHIVED', 409);
  // Target/selector/environment are immutable to keep references stable.
  if (input?.target && normalizeTarget(input.target) !== row.target) bad('target é imutável; crie outro binding.', 'TEST_DATA_BINDING_TARGET_IMMUTABLE', 409);
  if (input?.selector && normalizeSelector(row.target, input.selector) !== row.selector) bad('selector é imutável; crie outro binding.', 'TEST_DATA_BINDING_SELECTOR_IMMUTABLE', 409);
  if (input?.environmentId && cleanConfigText(input.environmentId, 160) !== row.environmentId) bad('environmentId é imutável; crie outro binding.', 'TEST_DATA_BINDING_ENVIRONMENT_IMMUTABLE', 409);

  const sourceType = input?.sourceType ? normalizeSource(input.sourceType) : row.sourceType;
  const valueType = input?.valueType ? normalizeValueType(input.valueType) : row.valueType;
  const generator = normalizeGenerator(sourceType, input?.generatorKind ?? row.generatorKind, input?.generatorConfig ?? (() => { try { return JSON.parse(row.generatorConfigJson || '{}'); } catch { return {}; } })());
  let fixedValueJson = null;
  let secretId = null;
  if (sourceType === 'FIXED') {
    fixedValueJson = input?.value === undefined && row.sourceType === 'FIXED' ? row.fixedValueJson : normalizeFixedValue(input?.value, valueType);
  } else if (sourceType === 'SECRET') {
    const environment = await getProjectEnvironment(env, organizationId, projectId, row.environmentId);
    secretId = await prepareSecret(env, {
      organizationId, projectId, userId, environmentName: environment.name, endpointId, selector: row.selector,
      existingSecretId: row.sourceType === 'SECRET' ? row.secretId : null,
      secretValue: input?.secretValue,
    });
  }
  const description = input?.description === undefined ? row.description : (cleanConfigText(input.description, 1000) || null);
  return publicBinding(await persistBinding(env, {
    ...row,
    organizationId,
    projectId,
    endpointId,
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
  return publicBinding(await persistBinding(env, { ...row, status: 'archived' }));
}

export async function resolveEndpointTestDataBindingsForRun(env, organizationId, projectId, endpointId, environmentId) {
  const rows = await listEndpointTestDataBindings(env, organizationId, projectId, endpointId, { environmentId });
  return rows.map((row) => {
    let generatorConfig = {};
    let fixedValue = null;
    try { generatorConfig = row.generatorConfigJson ? JSON.parse(row.generatorConfigJson) : {}; } catch {}
    try { fixedValue = row.fixedValueJson == null ? null : JSON.parse(row.fixedValueJson); } catch {}
    return {
      bindingId: row.bindingId,
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

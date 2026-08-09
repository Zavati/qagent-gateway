import { encryptCredentialPayload } from '../security/credentialCrypto.js';
import {
  getAiProviderConfig,
  listAiProviderConfigs,
  upsertAiProviderConfig,
  deleteAiProviderConfig,
} from '../repositories/aiProviderConfigRepository.js';
import { getProviderDefinition, getSupportedCredentialTypeIds } from '../ai/providerCatalog.js';

function clean(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function normalizeProvider(value) {
  const provider = clean(value, 50).toLowerCase();
  if (!getProviderDefinition(provider)) {
    const err = new Error(`Provider ainda não habilitado para configuração: ${provider || '(vazio)'}.`);
    err.status = 400;
    err.code = 'AI_PROVIDER_CONFIG_UNSUPPORTED';
    throw err;
  }
  return provider;
}

function normalizeCredentialType(provider, value) {
  const credentialType = clean(value || 'api_key', 50).toLowerCase();
  if (!getSupportedCredentialTypeIds(provider).includes(credentialType)) {
    const err = new Error(`Tipo de credencial não suportado para ${provider}.`);
    err.status = 400;
    err.code = 'AI_CREDENTIAL_TYPE_UNSUPPORTED';
    throw err;
  }
  return credentialType;
}

export async function getAccountAiConfigSummary(env, accountId, { repository } = {}) {
  const repo = repository || { getAiProviderConfig, listAiProviderConfigs, upsertAiProviderConfig, deleteAiProviderConfig };
  const configs = await repo.listAiProviderConfigs(env, accountId);
  return configs.map((config) => ({
    configId: config.configId,
    provider: config.provider,
    credentialType: config.credentialType,
    generateTestsModel: config.generateTestsModel,
    autofillModel: config.autofillModel,
    enabled: Number(config.enabled) === 1,
    isDefault: Number(config.isDefault) === 1,
    credentialsConfigured: true,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  }));
}

export async function saveAccountAiConfig(env, accountId, input, { repository } = {}) {
  const repo = repository || { getAiProviderConfig, listAiProviderConfigs, upsertAiProviderConfig, deleteAiProviderConfig };
  const provider = normalizeProvider(input?.provider);
  const credentialType = normalizeCredentialType(provider, input?.credentialType);
  const existing = await repo.getAiProviderConfig(env, accountId, provider);

  let encrypted;
  const apiKey = clean(input?.credentials?.apiKey, 10000);
  if (apiKey) {
    encrypted = await encryptCredentialPayload(env, { apiKey });
  } else if (existing?.credentialsCiphertext) {
    encrypted = {
      ciphertext: existing.credentialsCiphertext,
      iv: existing.credentialsIv,
      keyVersion: existing.credentialsKeyVersion,
    };
  } else {
    const err = new Error('Credencial de IA obrigatória para a primeira configuração.');
    err.status = 400;
    err.code = 'AI_CREDENTIAL_REQUIRED';
    throw err;
  }

  const generateTestsModel = clean(input?.models?.generateTests || existing?.generateTestsModel, 200);
  const autofillModel = clean(input?.models?.autofill || existing?.autofillModel || generateTestsModel, 200);
  if (!generateTestsModel) {
    const err = new Error('Modelo para geração de testes é obrigatório.');
    err.status = 400;
    err.code = 'AI_MODEL_REQUIRED';
    throw err;
  }

  const saved = await repo.upsertAiProviderConfig(env, {
    configId: existing?.configId,
    accountId,
    provider,
    credentialType,
    credentialsCiphertext: encrypted.ciphertext,
    credentialsIv: encrypted.iv,
    credentialsKeyVersion: encrypted.keyVersion,
    generateTestsModel,
    autofillModel,
    enabled: input?.enabled !== false,
  });

  return {
    configId: saved.configId,
    provider: saved.provider,
    credentialType: saved.credentialType,
    generateTestsModel: saved.generateTestsModel,
    autofillModel: saved.autofillModel,
    enabled: Number(saved.enabled) === 1,
    isDefault: Number(saved.isDefault) === 1,
    credentialsConfigured: true,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
  };
}

export async function removeAccountAiConfig(env, accountId, providerValue, { repository } = {}) {
  const repo = repository || { getAiProviderConfig, listAiProviderConfigs, upsertAiProviderConfig, deleteAiProviderConfig };
  const provider = normalizeProvider(providerValue);
  await repo.deleteAiProviderConfig(env, accountId, provider);
  return { provider, removed: true };
}

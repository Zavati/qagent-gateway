import { decryptCredentialPayload } from '../security/credentialCrypto.js';
import { getDefaultAiProviderConfig } from '../repositories/aiProviderConfigRepository.js';

function normalizeMode(value) {
  const mode = String(value || 'account_preferred').trim().toLowerCase();
  if (['env', 'account_preferred', 'account_required'].includes(mode)) return mode;
  return 'account_preferred';
}

function envCredentials(provider, env) {
  if (provider === 'openai') {
    return { apiKey: String(env?.OPENAI_API_KEY || '').trim() || null };
  }
  if (provider === 'gemini') {
    return { apiKey: String(env?.GEMINI_API_KEY || '').trim() || null };
  }
  return {};
}

function selectAccountModel(config, capability, fallbackModel) {
  if (capability === 'autofill') return config?.autofillModel || config?.generateTestsModel || fallbackModel;
  return config?.generateTestsModel || config?.autofillModel || fallbackModel;
}

export async function resolveAiRuntimeConfig(env, {
  accountId = null,
  capability,
  fallbackModel,
  repository = { getDefaultAiProviderConfig },
} = {}) {
  const mode = normalizeMode(env?.AI_CONFIG_MODE);

  if (mode !== 'env' && accountId) {
    try {
      const stored = await repository.getDefaultAiProviderConfig(env, accountId);
      if (stored && Number(stored.enabled) === 1) {
        const credentials = await decryptCredentialPayload(env, {
          ciphertext: stored.credentialsCiphertext,
          iv: stored.credentialsIv,
          keyVersion: stored.credentialsKeyVersion,
        });

        return {
          source: 'account',
          accountId,
          provider: String(stored.provider || '').trim().toLowerCase(),
          credentialType: stored.credentialType,
          credentials,
          model: selectAccountModel(stored, capability, fallbackModel),
          configId: stored.configId,
        };
      }
    } catch (e) {
      if (mode === 'account_required') throw e;
      // account_preferred mantém compatibilidade durante a migração para D1.
    }
  }

  if (mode === 'account_required') {
    const err = new Error('A conta não possui um motor de IA configurado.');
    err.status = 409;
    err.code = 'AI_ACCOUNT_CONFIG_REQUIRED';
    throw err;
  }

  const provider = String(env?.AI_PROVIDER || 'openai').trim().toLowerCase();
  return {
    source: 'env',
    accountId,
    provider,
    credentialType: 'environment',
    credentials: envCredentials(provider, env),
    model: fallbackModel,
    configId: null,
  };
}

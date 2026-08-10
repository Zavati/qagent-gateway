import assert from 'node:assert';
import { decryptCredentialPayload } from '../src/security/credentialCrypto.js';
import {
  getAccountAiConfigSummary,
  saveAccountAiConfig,
  removeAccountAiConfig,
} from '../src/services/aiProviderConfigService.js';

const env = {
  AI_CREDENTIALS_ACTIVE_KEY_VERSION: 'v1',
  AI_CREDENTIALS_KEY_V1: Buffer.alloc(32, 19).toString('base64url'),
};

let stored = null;
const repository = {
  async getAiProviderConfig(_env, accountId, provider) {
    return stored?.accountId === accountId && stored?.provider === provider ? stored : null;
  },
  async listAiProviderConfigs(_env, accountId) {
    return stored?.accountId === accountId ? [stored] : [];
  },
  async upsertAiProviderConfig(_env, config) {
    const now = new Date().toISOString();
    stored = {
      configId: config.configId || 'cfg_1',
      accountId: config.accountId,
      provider: config.provider,
      credentialType: config.credentialType,
      credentialsCiphertext: config.credentialsCiphertext,
      credentialsIv: config.credentialsIv,
      credentialsKeyVersion: config.credentialsKeyVersion,
      generateTestsModel: config.generateTestsModel,
      autofillModel: config.autofillModel,
      enabled: config.enabled === false ? 0 : 1,
      isDefault: 1,
      createdAt: now,
      updatedAt: now,
    };
    return stored;
  },
  async deleteAiProviderConfig(_env, accountId, provider) {
    if (stored?.accountId === accountId && stored?.provider === provider) stored = null;
  },
};

const saved = await saveAccountAiConfig(env, 'cus_123', {
  provider: 'openai',
  credentialType: 'api_key',
  credentials: { apiKey: 'sk-company-secret' },
  models: { generateTests: 'gpt-company-tests', autofill: 'gpt-company-fill' },
}, { repository });

assert.strictEqual(saved.provider, 'openai');
assert.strictEqual(saved.credentialsConfigured, true);
assert.ok(stored.credentialsCiphertext);
assert.ok(!stored.credentialsCiphertext.includes('sk-company-secret'));
const credentials = await decryptCredentialPayload(env, {
  ciphertext: stored.credentialsCiphertext,
  iv: stored.credentialsIv,
  keyVersion: stored.credentialsKeyVersion,
});
assert.strictEqual(credentials.apiKey, 'sk-company-secret');

const originalCiphertext = stored.credentialsCiphertext;
await saveAccountAiConfig(env, 'cus_123', {
  provider: 'openai',
  credentialType: 'api_key',
  models: { generateTests: 'gpt-company-tests-v2', autofill: 'gpt-company-fill' },
}, { repository });
assert.strictEqual(stored.credentialsCiphertext, originalCiphertext);
assert.strictEqual(stored.generateTestsModel, 'gpt-company-tests-v2');

const summaries = await getAccountAiConfigSummary(env, 'cus_123', { repository });
assert.strictEqual(summaries.length, 1);
assert.strictEqual(summaries[0].credentialsConfigured, true);
assert.strictEqual('credentialsCiphertext' in summaries[0], false);

const removed = await removeAccountAiConfig(env, 'cus_123', 'openai', { repository });
assert.deepStrictEqual(removed, { provider: 'openai', removed: true });
assert.strictEqual(stored, null);

const geminiSaved = await saveAccountAiConfig(env, 'cus_123', {
  provider: 'gemini',
  credentialType: 'api_key',
  credentials: { apiKey: 'gemini-company-secret' },
  models: { generateTests: 'gemini-company-tests', autofill: 'gemini-company-fill' },
}, { repository });
assert.strictEqual(geminiSaved.provider, 'gemini');
const geminiCredentials = await decryptCredentialPayload(env, {
  ciphertext: stored.credentialsCiphertext,
  iv: stored.credentialsIv,
  keyVersion: stored.credentialsKeyVersion,
});
assert.strictEqual(geminiCredentials.apiKey, 'gemini-company-secret');

await assert.rejects(
  () => saveAccountAiConfig(env, 'cus_123', {
    provider: 'unsupported-provider',
    credentials: { apiKey: 'x' },
    models: { generateTests: 'x' },
  }, { repository }),
  (err) => err?.code === 'AI_PROVIDER_CONFIG_UNSUPPORTED'
);

console.log('AI provider config service tests passed ✅');

import assert from 'node:assert';
import { encryptCredentialPayload } from '../src/security/credentialCrypto.js';
import { resolveAiRuntimeConfig } from '../src/services/aiRuntimeConfigService.js';

const key = Buffer.alloc(32, 11).toString('base64url');
const env = {
  AI_CONFIG_MODE: 'account_preferred',
  AI_PROVIDER: 'openai',
  OPENAI_API_KEY: 'env-openai-key',
  AI_CREDENTIALS_ACTIVE_KEY_VERSION: 'v1',
  AI_CREDENTIALS_KEY_V1: key,
};

const encrypted = await encryptCredentialPayload(env, { apiKey: 'account-openai-key' });
const stored = {
  configId: 'cfg_1',
  accountId: 'cus_1',
  provider: 'openai',
  credentialType: 'api_key',
  credentialsCiphertext: encrypted.ciphertext,
  credentialsIv: encrypted.iv,
  credentialsKeyVersion: encrypted.keyVersion,
  generateTestsModel: 'company-test-model',
  autofillModel: 'company-autofill-model',
  enabled: 1,
  isDefault: 1,
};

const repository = {
  async getDefaultAiProviderConfig(_env, accountId) {
    return accountId === 'cus_1' ? stored : null;
  },
};

const accountConfig = await resolveAiRuntimeConfig(env, {
  accountId: 'cus_1',
  capability: 'test-generation',
  fallbackModel: 'browser-requested-model',
  repository,
});
assert.strictEqual(accountConfig.source, 'account');
assert.strictEqual(accountConfig.provider, 'openai');
assert.strictEqual(accountConfig.model, 'company-test-model');
assert.strictEqual(accountConfig.credentials.apiKey, 'account-openai-key');

const autofillConfig = await resolveAiRuntimeConfig(env, {
  accountId: 'cus_1',
  capability: 'autofill',
  fallbackModel: 'browser-requested-model',
  repository,
});
assert.strictEqual(autofillConfig.model, 'company-autofill-model');

const fallbackConfig = await resolveAiRuntimeConfig(env, {
  accountId: 'cus_missing',
  capability: 'test-generation',
  fallbackModel: 'fallback-model',
  repository,
});
assert.strictEqual(fallbackConfig.source, 'env');
assert.strictEqual(fallbackConfig.provider, 'openai');
assert.strictEqual(fallbackConfig.credentials.apiKey, 'env-openai-key');
assert.strictEqual(fallbackConfig.model, 'fallback-model');


const geminiFallback = await resolveAiRuntimeConfig({
  ...env,
  AI_PROVIDER: 'gemini',
  GEMINI_API_KEY: 'env-gemini-key',
}, {
  accountId: 'cus_missing',
  capability: 'test-generation',
  fallbackModel: 'gemini-company-model',
  repository,
});
assert.strictEqual(geminiFallback.source, 'env');
assert.strictEqual(geminiFallback.provider, 'gemini');
assert.strictEqual(geminiFallback.credentials.apiKey, 'env-gemini-key');
assert.strictEqual(geminiFallback.model, 'gemini-company-model');

await assert.rejects(
  () => resolveAiRuntimeConfig({ ...env, AI_CONFIG_MODE: 'account_required' }, {
    accountId: 'cus_missing',
    capability: 'test-generation',
    fallbackModel: 'fallback-model',
    repository,
  }),
  (err) => err?.code === 'AI_ACCOUNT_CONFIG_REQUIRED' && err?.status === 409
);

console.log('AI runtime config tests passed ✅');

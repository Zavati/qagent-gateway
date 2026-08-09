import assert from 'node:assert/strict';
import { getAiProviderCatalog } from '../src/services/aiProviderCatalogService.js';

const preferred = getAiProviderCatalog({ AI_CONFIG_MODE: 'account_preferred' });
assert.equal(preferred.mode, 'account_preferred');
assert.equal(preferred.accountConfigurationAllowed, true);
assert.equal(preferred.accountConfigurationRequired, false);
assert.equal(preferred.providers.length, 1);
assert.equal(preferred.providers[0].id, 'openai');
assert.deepEqual(preferred.providers[0].capabilities, ['test_generation', 'autofill']);
assert.equal(preferred.providers[0].credentialTypes[0].fields[0].type, 'secret');

const required = getAiProviderCatalog({ AI_CONFIG_MODE: 'account_required' });
assert.equal(required.accountConfigurationRequired, true);

const envOnly = getAiProviderCatalog({ AI_CONFIG_MODE: 'env' });
assert.equal(envOnly.accountConfigurationAllowed, false);

console.log('AI provider catalog tests passed ✅');

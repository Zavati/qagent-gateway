import { listProviderDefinitions } from '../ai/providerCatalog.js';

function normalizeMode(value) {
  const mode = String(value || 'account_preferred').trim().toLowerCase();
  if (['env', 'account_preferred', 'account_required'].includes(mode)) return mode;
  return 'account_preferred';
}

export function getAiProviderCatalog(env) {
  const mode = normalizeMode(env?.AI_CONFIG_MODE);
  return {
    mode,
    accountConfigurationAllowed: mode !== 'env',
    accountConfigurationRequired: mode === 'account_required',
    providers: listProviderDefinitions(),
  };
}

import { ProviderRegistry } from './providerRegistry.js';
import { openaiProvider } from './providers/openaiProvider.js';

export class AiEngine {
  constructor({ registry, defaultProvider = 'openai' } = {}) {
    this.registry = registry || new ProviderRegistry({ openai: openaiProvider });
    this.defaultProvider = String(defaultProvider || 'openai').trim().toLowerCase();
  }

  resolveProviderName(env, providerOverride) {
    return String(providerOverride || env?.AI_PROVIDER || this.defaultProvider || 'openai')
      .trim()
      .toLowerCase();
  }

  getProvider(env, providerOverride) {
    const providerName = this.resolveProviderName(env, providerOverride);
    const provider = this.registry.get(providerName);
    if (!provider) {
      const err = new Error(`AI provider não suportado: ${providerName}`);
      err.status = 500;
      err.code = 'AI_PROVIDER_UNSUPPORTED';
      err.provider = providerName;
      throw err;
    }
    return { providerName, provider };
  }

  async generateJson(request, env) {
    const { providerName, provider } = this.getProvider(env, request?.provider);
    const out = await provider.generateJson({ ...request, env });
    return {
      ...out,
      provider: out?.provider || providerName,
      model: out?.model || request?.model || null,
    };
  }

  async repairJson(request, env) {
    const { provider } = this.getProvider(env, request?.provider);
    if (typeof provider.repairJson !== 'function') return null;
    return provider.repairJson({ ...request, env });
  }
}

export const aiEngine = new AiEngine();

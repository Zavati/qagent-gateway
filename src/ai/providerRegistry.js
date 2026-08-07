export class ProviderRegistry {
  constructor(providers = {}) {
    this.providers = new Map();
    for (const [name, provider] of Object.entries(providers)) {
      this.register(name, provider);
    }
  }

  register(name, provider) {
    const normalized = String(name || '').trim().toLowerCase();
    if (!normalized) throw new Error('AI provider name is required.');
    if (!provider || typeof provider.generateJson !== 'function') {
      throw new Error(`AI provider "${normalized}" must implement generateJson().`);
    }
    this.providers.set(normalized, provider);
    return this;
  }

  has(name) {
    return this.providers.has(String(name || '').trim().toLowerCase());
  }

  get(name) {
    return this.providers.get(String(name || '').trim().toLowerCase()) || null;
  }

  list() {
    return [...this.providers.keys()];
  }
}

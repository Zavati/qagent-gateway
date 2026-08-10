import assert from 'node:assert';
import { AiEngine } from '../src/ai/aiEngine.js';
import { ProviderRegistry } from '../src/ai/providerRegistry.js';


async function testDefaultRegistryIncludesGemini() {
  const engine = new AiEngine();
  assert.strictEqual(engine.registry.has('openai'), true);
  assert.strictEqual(engine.registry.has('gemini'), true);
}

async function testDefaultProvider() {
  let received = null;
  const mockProvider = {
    async generateJson(input) {
      received = input;
      return { json: { ok: true }, model: input.model };
    },
    async repairJson() {
      return { repaired: true };
    },
  };
  const registry = new ProviderRegistry({ openai: mockProvider });
  const engine = new AiEngine({ registry, defaultProvider: 'openai' });

  const result = await engine.generateJson({ capability: 'test', model: 'model-x', userPrompt: 'hello' }, {});
  assert.deepStrictEqual(result.json, { ok: true });
  assert.strictEqual(result.provider, 'openai');
  assert.strictEqual(received.capability, 'test');
  assert.strictEqual(received.userPrompt, 'hello');
}

async function testEnvProviderSelection() {
  const calls = [];
  const registry = new ProviderRegistry({
    openai: { async generateJson() { calls.push('openai'); return { json: {} }; } },
    fake: { async generateJson() { calls.push('fake'); return { json: {} }; } },
  });
  const engine = new AiEngine({ registry });
  await engine.generateJson({ model: 'x', userPrompt: 'x' }, { AI_PROVIDER: 'fake' });
  assert.deepStrictEqual(calls, ['fake']);
}

async function testUnsupportedProvider() {
  const engine = new AiEngine({ registry: new ProviderRegistry({ openai: { async generateJson() { return {}; } } }) });
  await assert.rejects(
    () => engine.generateJson({ model: 'x', userPrompt: 'x' }, { AI_PROVIDER: 'missing' }),
    (err) => err?.code === 'AI_PROVIDER_UNSUPPORTED' && err?.status === 500
  );
}

async function testRepairDelegation() {
  let received = null;
  const registry = new ProviderRegistry({
    openai: {
      async generateJson() { return { json: {} }; },
      async repairJson(input) { received = input; return { fixed: true }; },
    },
  });
  const engine = new AiEngine({ registry });
  const result = await engine.repairJson({ capability: 'autofill', model: 'x', rawText: 'bad' }, {});
  assert.deepStrictEqual(result, { fixed: true });
  assert.strictEqual(received.rawText, 'bad');
}

await testDefaultRegistryIncludesGemini();
await testDefaultProvider();
await testEnvProviderSelection();
await testUnsupportedProvider();
await testRepairDelegation();
console.log('AI engine tests passed ✅');

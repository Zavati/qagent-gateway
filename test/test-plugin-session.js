import assert from 'node:assert/strict';
import { postPluginSession } from '../src/handlers/pluginSession.js';

class MemoryKv {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
  }

  async get(key) {
    return this.entries.get(key) ?? null;
  }

  async put(key, value) {
    this.entries.set(key, value);
  }
}

async function expectFailure(request, env, expectedStatus, expectedCode) {
  try {
    await postPluginSession(request, env);
    assert.fail('Expected Plugin Session request to fail');
  } catch (error) {
    assert.equal(error.status, expectedStatus);
    assert.equal(error.code, expectedCode);
  }
}

await expectFailure(
  new Request('https://api.apiqagent.com/v1/plugin/session', { method: 'POST' }),
  { QAGENT_KV: new MemoryKv() },
  401,
  'PLUGIN_CLIENT_KEY_REQUIRED',
);

await expectFailure(
  new Request('https://api.apiqagent.com/v1/plugin/session', {
    method: 'POST',
    headers: { Authorization: 'Bearer not-a-client-key' },
  }),
  { QAGENT_KV: new MemoryKv() },
  401,
  'PLUGIN_CLIENT_KEY_REQUIRED',
);

await expectFailure(
  new Request('https://api.apiqagent.com/v1/plugin/session', {
    method: 'POST',
    headers: { Authorization: `Bearer qag_test_${'A'.repeat(40)}` },
  }),
  { QAGENT_KV: new MemoryKv() },
  403,
  'PLUGIN_CLIENT_KEY_INVALID',
);

console.log('plugin session boundary tests passed ✅');

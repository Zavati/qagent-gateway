import fs from 'node:fs';

const text = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

if (!text.includes('"binding": "TEST_REGISTRY_SERVICE"')) {
  throw new Error('TEST_REGISTRY_SERVICE binding is missing from wrangler.jsonc');
}
if (!text.includes('"service": "qagent-test-registry"')) {
  throw new Error('TEST_REGISTRY_SERVICE must target qagent-test-registry');
}
if (!text.includes('"TEST_REGISTRY_TIMEOUT_MS": "10000"')) {
  throw new Error('TEST_REGISTRY_TIMEOUT_MS default is missing');
}
if (!text.includes('"TEST_REGISTRY_PERSIST_RETRIES": "1"')) {
  throw new Error('TEST_REGISTRY_PERSIST_RETRIES default is missing');
}
if (/api\.apiqagent\.com\/v1\/test-registry\/\*/.test(text)) {
  throw new Error('Gateway config must not expose a public Test Registry wildcard route');
}

console.log('Foundation 07.6.5-C Test Registry binding config verified ✅');

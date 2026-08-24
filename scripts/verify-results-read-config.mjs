import fs from 'node:fs';

const text = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

function fail(message) {
  console.error(`qagent-gateway 07.7.9-C config verification FAILED: ${message}`);
  process.exit(1);
}

if (!text.includes('"binding": "RESULTS_SERVICE"')) fail('RESULTS_SERVICE binding ausente.');
if (!text.includes('"service": "qagent-test-results"')) fail('RESULTS_SERVICE deve apontar para qagent-test-results.');
if (!text.includes('"RESULTS_READ_TIMEOUT_MS"')) fail('RESULTS_READ_TIMEOUT_MS ausente.');
if (/"secrets"\s*:/.test(text)) fail('metadata top-level "secrets" é inválido no wrangler atual; use Worker Secrets reais.');

console.log('Foundation 07.7.9-C Gateway Results read config verified ✅');

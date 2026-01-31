import assert from 'node:assert';
import { safeId, normalizeCases, daysLeft, validateGenerateTestsBody, corsHeaders } from '../src/index.js';

console.log('Running quick unit tests...');

// safeId returns an 8-char hex-ish string
const id = safeId('abc123');
assert.strictEqual(typeof id, 'string');
assert.strictEqual(id.length, 8);

// normalizeCases
assert.strictEqual(normalizeCases(null), null);
const p1 = { cases: [{ id: 'x' }] };
assert.strictEqual(normalizeCases(p1), p1);
const p2 = { result: { cases: [{ id: 'y' }], extra: true } };
const n2 = normalizeCases(p2);
assert.strictEqual(Array.isArray(n2.cases), true);

// daysLeft should be >= 1 for 2 days from now
const expires = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
assert.ok(daysLeft(expires) >= 2);

// validateGenerateTestsBody: missing jira/source should throw
let thrown = false;
try {
  validateGenerateTestsBody({});
} catch (e) {
  thrown = true;
  assert.strictEqual(e.status, 400);
}
assert.ok(thrown, 'expected validation to throw for empty payload');

// corsHeaders with allowed origin
const fakeReq = { headers: { get: () => 'https://example.com' } };
const env = { QAGENT_ALLOWED_ORIGINS: 'https://example.com' };
const hdrs = corsHeaders(fakeReq, env);
assert.strictEqual(hdrs['Access-Control-Allow-Origin'], 'https://example.com');

console.log('All quick tests passed ✅');

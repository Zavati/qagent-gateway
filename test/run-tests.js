import assert from 'node:assert';
import { safeId, normalizeCases, daysLeft, validateGenerateTestsBody, corsHeaders, validateAutofillBody, generateAutofillStub, buildAutofillPrompt, normalizeAutofillResponse, prefillHeuristics, normalizeIncomingElement, extractJsonFromText, generateCpf, generateCnpj, detectCpfCnpjField, applyCpfCnpjReplacement, getAutofillModel } from '../src/index.js';

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

// validateAutofillBody
thrown = false;
try {
  validateAutofillBody({});
} catch (e) {
  thrown = true;
  assert.strictEqual(e.status, 400);
}
assert.ok(thrown, 'expected autofill validation to throw for empty payload');

const good = {
  url: 'https://example.com',
  elements: [ { selector: '#email', type: 'email' }, { selector: 'input[name=phone]' } ]
};
validateAutofillBody(good);

// generateAutofillStub
const actions = generateAutofillStub(good.elements);
assert.strictEqual(Array.isArray(actions), true);
assert.ok(actions.length >= 1);
assert.strictEqual(actions[0].selector, '#email');
assert.strictEqual(actions[0].value, 'user@example.com');

// buildAutofillPrompt
const prompt = buildAutofillPrompt(good);
assert.strictEqual(typeof prompt, 'string');
assert.ok(prompt.includes('#email|'));

// prefillHeuristics
const { actions: pref, remaining } = prefillHeuristics(good.elements);
assert.strictEqual(Array.isArray(pref), true);
assert.ok(pref.length >= 1);
assert.strictEqual(pref[0].selector, '#email');
assert.strictEqual(pref[0].value, 'user@example.com');
assert.strictEqual(Array.isArray(remaining), true);

// normalizeIncomingElement
const sampleEl = { selector: '#email', originalSelector: '#email', name: 'email', placeholder: 'your@mail.com', value: 'a@b.c', visible: true };
const normalized = normalizeIncomingElement(sampleEl);
assert.strictEqual(normalized.selector, '#email');
assert.strictEqual(normalized.name, 'email');
assert.strictEqual(normalized.value, 'a@b.c');

// extractJsonFromText
const messy = 'Some text\n\n {"actions":[{"selector":"#a","value":"1"}]} \n trailing';
const ex = extractJsonFromText(messy);
assert.strictEqual(typeof ex, 'object');
assert.strictEqual(Array.isArray(ex.actions), true);
assert.strictEqual(ex.actions[0].selector, '#a');
// normalizeAutofillResponse
const parsedGood = { actions: [ { selector: '#email', value: 'user@example.com' }, { selector: 'javascript:alert(1)', value: 'x' } ] };
const normResp = normalizeAutofillResponse(parsedGood);
assert.strictEqual(Array.isArray(normResp), true);
assert.strictEqual(normResp.length, 1);
assert.strictEqual(normResp[0].selector, '#email');
assert.strictEqual(normResp[0].value, 'user@example.com');

// CPF/CNPJ generators + replacement
const cpf = generateCpf();
assert.ok(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(cpf));
const cnpj = generateCnpj();
assert.ok(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(cnpj));

const elCpf = { selector: '#idcpf', name: 'cpf', label: 'CPF' };
const norm = normalizeIncomingElement(elCpf);
assert.strictEqual(detectCpfCnpjField(norm), 'cpf');
let cpfActions = [{ selector: '#idcpf', value: 'x' }];
cpfActions = applyCpfCnpjReplacement(cpfActions, [norm]);
assert.ok(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(cpfActions[0].value));

const elCnpj = { selector: '#idcnpj', name: 'cnpj' };
const normCnpj = normalizeIncomingElement(elCnpj);
assert.strictEqual(detectCpfCnpjField(normCnpj), 'cnpj');
let cnpjActions = [{ selector: '#idcnpj', value: 'x' }];
cnpjActions = applyCpfCnpjReplacement(cnpjActions, [normCnpj]);
assert.ok(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(cnpjActions[0].value));

// getAutofillModel precedence
assert.strictEqual(getAutofillModel({ meta: { model: 'gpt-3.5-turbo' } }, {}).startsWith('gpt-3.5-turbo'), true);
assert.strictEqual(getAutofillModel({ settings: { model: 'gpt-4' } }, {}).startsWith('gpt-4'), true);
assert.strictEqual(getAutofillModel({}, { AUTOFILL_MODEL: 'gpt-3.5-test' }).startsWith('gpt-3.5-test'), true);

// corsHeaders with allowed origin
const fakeReq = { headers: { get: () => 'https://example.com' } };
const env = { QAGENT_ALLOWED_ORIGINS: 'https://example.com' };
const hdrs = corsHeaders(fakeReq, env);
assert.strictEqual(hdrs['Access-Control-Allow-Origin'], 'https://example.com');

console.log('All quick tests passed ✅');

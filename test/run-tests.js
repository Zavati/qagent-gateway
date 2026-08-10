import assert from 'node:assert';
import { safeId } from '../src/lib/keyService.js';
import { daysLeft } from '../src/lib/licenseService.js';
import { normalizeCases, validateGenerateTestsBody, validateAutofillBody } from '../src/lib/validators.js';
import { corsHeaders } from '../src/lib/http.js';
import { buildAutofillPrompt, normalizeAutofillResponse } from '../src/lib/autofill.js';
import { generateAutofillStub, prefillHeuristics, normalizeIncomingElement, generateCpf, generateCnpj, detectCpfCnpjField, applyCpfCnpjReplacement } from '../src/lib/heuristics.js';
import { extractJsonFromText } from '../src/lib/openai.js';
import { getAutofillModel } from '../src/lib/config.js';
import worker from '../src/index.js';
import { generateClientKey, validateClientKeyFormat, hashClientKey } from '../src/lib/keyService.js';
import { validateSignupTrialBody, validateEmailDispatchedBody, validatePaymentWebhookBody } from '../src/lib/validators.js';
import { API_CONTRACT_VERSION, errorEnvelope, contractsV1 } from '../src/lib/contracts.js';
import { runWebhookContractTests } from './test-webhook-contracts.js';

async function signWebhookPayload(secret, ts, payloadText) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const data = `${ts}.${payloadText}`;
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${ts},v1=${hex}`;
}

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
assert.ok(hdrs['Access-Control-Allow-Methods'].includes('PUT'));
assert.ok(hdrs['Access-Control-Allow-Methods'].includes('DELETE'));
assert.ok(hdrs['Access-Control-Allow-Headers'].includes('Authorization'));
assert.strictEqual(hdrs['Vary'], 'Origin');

// client key utils
const clientKeyLive = generateClientKey('live');
assert.ok(validateClientKeyFormat(clientKeyLive));
assert.ok(clientKeyLive.startsWith('qag_live_'));
const clientKeyTest = generateClientKey('test');
assert.ok(validateClientKeyFormat(clientKeyTest));
assert.ok(clientKeyTest.startsWith('qag_test_'));
const keyHash = await hashClientKey(clientKeyLive);
assert.ok(/^sha256:[a-f0-9]{64}$/.test(keyHash));

// contracts versioning
assert.strictEqual(typeof API_CONTRACT_VERSION, 'string');
assert.ok(API_CONTRACT_VERSION.startsWith('v1-'));
assert.strictEqual(typeof contractsV1.signupTrial.request.email, 'string');
const errEnvelope = errorEnvelope('VALIDATION_ERROR', 'bad request', 'req-1');
assert.strictEqual(errEnvelope.error.code, 'VALIDATION_ERROR');
assert.strictEqual(errEnvelope.error.requestId, 'req-1');

// validateSignupTrialBody
validateSignupTrialBody({
  email: 'cliente@empresa.com',
  name: 'Cliente',
  company: 'Empresa',
  source: 'landing-page',
  acceptTerms: true,
  acceptPrivacy: true,
});
thrown = false;
try {
  validateSignupTrialBody({ email: 'x', acceptTerms: true, acceptPrivacy: true });
} catch (e) {
  thrown = true;
  assert.strictEqual(e.status, 400);
}
assert.ok(thrown, 'expected signup validation to throw for invalid email');

// validateEmailDispatchedBody
validateEmailDispatchedBody({
  eventId: 'mail_123',
  occurredAt: new Date().toISOString(),
  type: 'email.dispatched',
  customerId: 'cus_1',
  email: 'cliente@empresa.com',
  template: 'trial_welcome',
  metadata: { keyHash: 'sha256:abc' },
});
thrown = false;
try {
  validateEmailDispatchedBody({ eventId: 'x', occurredAt: 'bad-date', type: 'email.dispatched', customerId: 'c', email: 'a@b.com', template: 't' });
} catch (e) {
  thrown = true;
  assert.strictEqual(e.status, 400);
}
assert.ok(thrown, 'expected email dispatched validation to throw for invalid date');

// validatePaymentWebhookBody
validatePaymentWebhookBody({
  provider: 'stripe',
  eventId: 'evt_123',
  eventType: 'checkout.session.completed',
  occurredAt: new Date().toISOString(),
  customer: { customerId: 'cus_1', email: 'cliente@empresa.com' },
  reference: { clientKey: clientKeyLive },
  billing: { status: 'active', amount: 5900, periodStart: new Date().toISOString(), periodEnd: new Date(Date.now() + 86400000).toISOString() },
});
thrown = false;
try {
  validatePaymentWebhookBody({ provider: 'stripe', eventId: 'evt', eventType: 'x', occurredAt: new Date().toISOString(), reference: {}, billing: { status: 'active' } });
} catch (e) {
  thrown = true;
  assert.strictEqual(e.status, 400);
}
assert.ok(thrown, 'expected payment webhook validation to throw for missing reference identifiers');

// signup-trial endpoint integration (in-memory KV)
const mem = new Map();
const envApi = {
  ENVIRONMENT: 'development',
  CLIENT_KEY_MODE: 'test',
  WEBHOOK_SIGNING_SECRET: 'unit-test-secret',
  WEBHOOK_MAX_SKEW_SEC: '300',
  WEBHOOK_REPLAY_TTL_SEC: '900',
  MAX_BODY_BYTES: '250000',
  QAGENT_KV: {
    async get(key) { return mem.has(key) ? mem.get(key) : null; },
    async put(key, val) { mem.set(key, val); },
  },
};

const signupReq = new Request('https://api.apiqagent.com/v1/signup-trial', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: 'cliente@empresa.com',
    name: 'Cliente Teste',
    company: 'Empresa Teste',
    source: 'landing-page',
    acceptTerms: true,
    acceptPrivacy: true,
  }),
});

const signupRes = await worker.fetch(signupReq, envApi);
assert.strictEqual(signupRes.status, 201);
const signupJson = await signupRes.json();
assert.strictEqual(signupJson.status, 'ok');
assert.ok(signupJson.credentials.clientKey.startsWith('qag_test_'));

const duplicateReq = new Request('https://api.apiqagent.com/v1/signup-trial', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: 'cliente@empresa.com',
    acceptTerms: true,
    acceptPrivacy: true,
  }),
});
const duplicateRes = await worker.fetch(duplicateReq, envApi);
assert.strictEqual(duplicateRes.status, 409);

const licenseReq = new Request('https://api.apiqagent.com/v1/license', {
  method: 'GET',
  headers: { Authorization: `Bearer ${signupJson.credentials.clientKey}` },
});
const licenseRes = await worker.fetch(licenseReq, envApi);
assert.strictEqual(licenseRes.status, 200);
const licenseJson = await licenseRes.json();
assert.strictEqual(licenseJson.license.status, 'trial');
assert.strictEqual(licenseJson.credential.type, 'client_key');

// legacy token compatibility during migration window
const legacyToken = 'legacy_token_compatibility_1234567890';
const legacyReq = new Request('https://api.apiqagent.com/v1/license', {
  method: 'GET',
  headers: { Authorization: `Bearer ${legacyToken}` },
});
const legacyRes = await worker.fetch(legacyReq, envApi);
assert.strictEqual(legacyRes.status, 200);
const legacyJson = await legacyRes.json();
assert.strictEqual(legacyJson.credential.type, 'legacy_token');
assert.strictEqual(legacyJson.migration.legacyAccepted, true);
assert.strictEqual(legacyJson.migration.policy, 'global_allowed');

// legacy token blocked by tenant rollout flag
const envTenantForced = {
  ...envApi,
  MIGRATION_REQUIRE_CLIENTKEY_TENANTS: 'tenant-alpha,tenant-beta',
};
const legacyTenantReq = new Request('https://api.apiqagent.com/v1/license', {
  method: 'GET',
  headers: {
    Authorization: 'Bearer legacy_token_tenant_rollout_1234567890',
    'X-QAgent-Tenant': 'tenant-alpha',
  },
});
const legacyTenantRes = await worker.fetch(legacyTenantReq, envTenantForced);
assert.strictEqual(legacyTenantRes.status, 403);

// rollout rollback by config: tenant not in forced list continues accepted
const legacyTenantOtherReq = new Request('https://api.apiqagent.com/v1/license', {
  method: 'GET',
  headers: {
    Authorization: 'Bearer legacy_token_tenant_other_1234567890',
    'X-QAgent-Tenant': 'tenant-gamma',
  },
});
const legacyTenantOtherRes = await worker.fetch(legacyTenantOtherReq, envTenantForced);
assert.strictEqual(legacyTenantOtherRes.status, 200);

// legacy token blocked by cohort rollout flag
const envCohortForced = {
  ...envApi,
  MIGRATION_REQUIRE_CLIENTKEY_COHORTS: 'cohort-a,cohort-b',
};
const legacyCohortReq = new Request('https://api.apiqagent.com/v1/license', {
  method: 'GET',
  headers: {
    Authorization: 'Bearer legacy_token_cohort_rollout_1234567890',
    'X-QAgent-Cohort': 'cohort-b',
  },
});
const legacyCohortRes = await worker.fetch(legacyCohortReq, envCohortForced);
assert.strictEqual(legacyCohortRes.status, 403);

// legacy token disabled after migration window closes
const envLegacyClosed = {
  ...envApi,
  LEGACY_TOKEN_MIGRATION_UNTIL: '2020-01-01T00:00:00.000Z',
};
const legacyClosedReq = new Request('https://api.apiqagent.com/v1/license', {
  method: 'GET',
  headers: { Authorization: `Bearer legacy_token_closed_1234567890` },
});
const legacyClosedRes = await worker.fetch(legacyClosedReq, envLegacyClosed);
assert.strictEqual(legacyClosedRes.status, 403);

// BE-3003 migration metrics tracking
const day = new Date().toISOString().slice(0, 10);
const metricKeyGlobal = `metrics:migration:${day}:tenant:all:cohort:all`;
const metricRawGlobal = mem.get(metricKeyGlobal);
assert.ok(metricRawGlobal, 'global metric should exist');
const metricGlobal = JSON.parse(metricRawGlobal);
assert.ok(metricGlobal.requestsTotal >= 3);
assert.ok(metricGlobal.credentialClientKey >= 1);
assert.ok(metricGlobal.credentialLegacyToken >= 1);
assert.ok(metricGlobal.errors403 >= 1);

const metricKeyTenantAlpha = `metrics:migration:${day}:tenant:tenant-alpha:cohort:unknown`;
const metricRawTenantAlpha = mem.get(metricKeyTenantAlpha);
assert.ok(metricRawTenantAlpha, 'tenant-alpha metric should exist');
const metricTenantAlpha = JSON.parse(metricRawTenantAlpha);
assert.strictEqual(metricTenantAlpha.errors403, 1);
assert.strictEqual(metricTenantAlpha.legacyBlocked, 1);

// signup should enqueue async email event in KV outbox
const emailEventKeys = [...mem.keys()].filter((k) => String(k).startsWith('email_event:'));
assert.ok(emailEventKeys.length >= 1);
const createdEmailEvent = JSON.parse(mem.get(emailEventKeys[0]));
assert.strictEqual(createdEmailEvent.type, 'email.dispatch.requested');
assert.strictEqual(createdEmailEvent.email, 'cliente@empresa.com');

// email-dispatched webhook endpoint
const emailAckPayload = {
  eventId: createdEmailEvent.eventId,
  occurredAt: new Date().toISOString(),
  type: 'email.dispatched',
  customerId: signupJson.customer.customerId,
  email: signupJson.customer.email,
  template: 'trial_welcome',
  metadata: { keyHash: createdEmailEvent.metadata.keyHash },
};
const emailAckBody = JSON.stringify(emailAckPayload);
const ts1 = Math.floor(Date.now() / 1000);
const sig1 = await signWebhookPayload(envApi.WEBHOOK_SIGNING_SECRET, ts1, emailAckBody);
const emailAckReq = new Request('https://api.apiqagent.com/v1/webhooks/email-dispatched', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'X-QAgent-Signature': sig1,
  },
  body: emailAckBody,
});
const emailAckRes = await worker.fetch(emailAckReq, envApi);
assert.strictEqual(emailAckRes.status, 200);
const emailAckJson = await emailAckRes.json();
assert.strictEqual(emailAckJson.processed, true);

// idempotent callback handling
const ts2 = ts1 + 1;
const sig2 = await signWebhookPayload(envApi.WEBHOOK_SIGNING_SECRET, ts2, emailAckBody);
const emailAckReq2 = new Request('https://api.apiqagent.com/v1/webhooks/email-dispatched', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'X-QAgent-Signature': sig2,
  },
  body: emailAckBody,
});
const emailAckRes2 = await worker.fetch(emailAckReq2, envApi);
assert.strictEqual(emailAckRes2.status, 200);
const emailAckJson2 = await emailAckRes2.json();
assert.strictEqual(emailAckJson2.processed, false);
assert.strictEqual(emailAckJson2.idempotent, true);

// replay request (same signature) should be blocked
const replayReq = new Request('https://api.apiqagent.com/v1/webhooks/email-dispatched', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'X-QAgent-Signature': sig2,
  },
  body: emailAckBody,
});
const replayRes = await worker.fetch(replayReq, envApi);
assert.strictEqual(replayRes.status, 409);

// missing signature should be unauthorized
const unsignedReq = new Request('https://api.apiqagent.com/v1/webhooks/email-dispatched', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: emailAckBody,
});
const unsignedRes = await worker.fetch(unsignedReq, envApi);
assert.strictEqual(unsignedRes.status, 401);

await runWebhookContractTests();

console.log('All quick tests passed ✅');

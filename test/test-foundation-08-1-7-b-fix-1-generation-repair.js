import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectAssertionRepairDiagnostics, validateAssertionRepairIntegrity } from '../src/intelligence/testDesignRepairSupport.js';
import { buildTestDesignRepairContextV1 } from '../src/intelligence/testDesignRepairContext.js';
import { buildTestDesignPromptV1, buildTestDesignRepairPromptV1 } from '../src/intelligence/testDesignPrompt.js';
import { validateTestDesignModelOutputV1, validateTestSpecificationV1, TEST_DESIGN_MODEL_OUTPUT_JSON_SCHEMA_V1 } from '../src/intelligence/testDesignContract.js';
import { generateCatalogTestDesignV1 } from '../src/intelligence/testDesignService.js';
import { generateAndPersistCatalogTestDesignV1 } from '../src/intelligence/testDesignPersistence.js';
import { assessLearningAdmission } from '../src/readiness/learningAdmissionV2.js';

// Providers and external services are injected. Never call the monitored application.
globalThis.fetch = async () => { throw new Error('EXTERNAL_NETWORK_FORBIDDEN'); };
const clone = structuredClone;
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/test-design-empty-assertions.json', import.meta.url), 'utf8'));
const schemaRef = 'csv_ee3a4ae9f486252ce637009bcd4c428bdc5d45d0';
const evidenceRef = 'cev_08e47fe24073b3d0d78ed9316cd51cfbcb3ab855';
const status = n => ({ type: 'STATUS', expectedStatusCodes: [n] });
function context() {
  return {
    contractVersion: 'qagent.test-design.v1', organizationId: 'org_fixture', projectId: 'prj_fixture',
    endpoint: { endpointId: 'cep_fixture', serviceId: 'svc_fixture', serviceName: 'Fixture API', method: 'GET', normalizedPath: '/candidates' },
    schemas: [{ trackId: 'track_fixture', direction: 'RESPONSE', statusCode: 200, currentVersionId: schemaRef, currentSchemaHash: 'fixture_hash', contentTypes: ['application/json'],
      schema: { type: 'object', properties: { data: { type: 'array', items: { type: 'object' } }, meta: { type: 'object', properties: { total: { type: 'number' } } } } }, versions: [] }],
    evidence: [{ evidenceId: evidenceRef, observedAt: '2026-09-11T14:07:13.809Z', statusCode: 200, authObserved: true, authScheme: 'COOKIE', responseSchemaVersionId: schemaRef }],
    environments: [],
    runtime: { apiServiceKey: 'svc_fixture', defaultAuthProfileRef: 'authp_fixture', availableAuthProfileRefs: ['authp_fixture'], authObservation: { status: 'REQUIRED', scheme: 'COOKIE', evidenceRefs: [evidenceRef] } },
  };
}
function hypothesis() { return { title: fixture.title, objective: fixture.objective, scenarios: [clone(fixture.scenarios[2])] }; }
function fill401(o) { const repaired = clone(o); repaired.scenarios[0].assertions = [status(401)]; return repaired; }
function harness(output = hypothesis(), repair = fill401(output), options = {}) {
  const calls = [], logs = [], ctx = options.context || context();
  const env = { SCENARIO_READINESS_V2_ENABLED: 'true', OBSERVED_BASELINE_GENERATION_ENABLED: 'false', log: (event, details) => logs.push({ event, ...details }), ...options.env };
  const input = {
    env, organizationId: ctx.organizationId, projectId: ctx.projectId, endpointId: ctx.endpoint.endpointId,
    aiEngine: {
      async generateJson(request) {
        calls.push({ stage: 'generate', request });
        if (options.generationError) throw options.generationError;
        return { json: clone(output), provider: options.provider || 'openai', model: 'fixture-model' };
      },
      async repairJson(request) {
        calls.push({ stage: 'repair', request });
        if (options.repairError) throw options.repairError;
        return typeof repair === 'function' ? repair(request) : clone(repair);
      },
    },
    contextBuilder: async () => ({ context: ctx, contextFingerprint: 'a'.repeat(64), diagnostics: {} }),
    resolveAiConfig: async () => ({ source: 'env', provider: options.provider || 'openai', model: 'fixture-model', credentials: { apiKey: 'CREDENTIAL_SENTINEL' } }),
    now: () => new Date('2026-09-27T12:00:00Z'),
    ...options.input,
  };
  return { input, calls, logs, run: () => generateCatalogTestDesignV1(input) };
}
const failure = code => error => error.code === 'AI_TEST_DESIGN_OUTPUT_INVALID' && (code == null || error.publicDetails.validationCode === code);
const hasRepairIssue = (error, code) => error.publicDetails?.repairIssues?.some(issue => issue.code === code);

test('reported output reproduces first contract failure, lists all three arrays, does not mutate source', () => {
  const before = clone(fixture);
  assert.throws(() => validateTestDesignModelOutputV1(fixture, context()), error => error.path === 'modelOutput.scenarios[2].assertions');
  const d = collectAssertionRepairDiagnostics(fixture);
  assert.equal(d.issueCount, 3); assert.deepEqual(d.issues.map(i => i.scenarioIndex), [2, 4, 7]);
  assert.ok(d.issues.every(i => i.code === 'ASSERTIONS_EMPTY')); assert.deepEqual(fixture, before);
});
for (const [name, value, code] of [['missing', undefined, 'ASSERTIONS_REQUIRED'], ['null', null, 'ASSERTIONS_REQUIRED'], ['object', {}, 'ASSERTIONS_NOT_ARRAY'], ['string', 'PRIVATE_VALUE', 'ASSERTIONS_NOT_ARRAY'], ['empty', [], 'ASSERTIONS_EMPTY'], ['too many', Array.from({ length: 31 }, () => status(200)), 'ASSERTIONS_LIMIT_EXCEEDED']]) {
  test(`aggregate diagnostics handles ${name} without copying its value`, () => {
    const o = hypothesis(); o.scenarios[0].assertions = value;
    assert.equal(collectAssertionRepairDiagnostics(o).issues[0].code, code);
    assert.ok(!JSON.stringify(collectAssertionRepairDiagnostics(o)).includes('PRIVATE_VALUE'));
  });
}
test('diagnostic bounds and safe ids for untrusted input', () => {
  const o = { scenarios: Array.from({ length: 35 }, () => ({ scenarioId: 'Bearer DO_NOT_ECHO', assertions: [] })) };
  const d = collectAssertionRepairDiagnostics(o); assert.equal(d.issueCount, 20); assert.equal(d.truncated, true);
  assert.ok(!JSON.stringify(d).includes('DO_NOT_ECHO')); assert.equal(collectAssertionRepairDiagnostics(null).issueCount, 0);
  assert.equal(collectAssertionRepairDiagnostics({ scenarios: [null, 1] }).issueCount, 0);
});
test('the existing schema still requires at least one assertion', () => {
  assert.equal(TEST_DESIGN_MODEL_OUTPUT_JSON_SCHEMA_V1.properties.scenarios.items.properties.assertions.minItems, 1);
});
test('repair context contains auth, status, refs and structure; no host, profile, body, sample or secret', () => {
  const c = context(); c.runtime.credentials = { apiKey: 'PRIVATE_CREDENTIAL' }; c.runtime.discoveredOrigin = 'https://PRIVATE_HOST.invalid';
  c.testData = { configuredBindings: [{ fixedValue: 'PRIVATE_FIXED', secretValue: 'PRIVATE_SECRET' }] };
  c.evidence[0].responseBody = { private: 'PRIVATE_BODY' }; c.evidence[0].requestHeaders = { Cookie: 'PRIVATE_COOKIE' };
  c.schemas[0].schema.description = 'PRIVATE_DESCRIPTION'; c.schemas[0].schema.examples = [{ sample: 'PRIVATE_SAMPLE' }];
  c.schemas[0].schema.properties.password = { type: 'string', enum: ['PRIVATE_ENUM'], const: 'PRIVATE_CONST' };
  const before = clone(c), v = buildTestDesignRepairContextV1(c), raw = JSON.stringify(v);
  assert.equal(v.authObservation.status, 'REQUIRED'); assert.equal(v.evidence[0].statusCode, 200);
  assert.equal(v.schemas[0].schema.properties.meta.properties.total.type, 'number');
  assert.equal(v.schemas[0].projectionPartial, true); assert.deepEqual(c, before);
  assert.ok(!raw.includes('PRIVATE_')); assert.ok(!raw.includes('authp_fixture')); assert.ok(!raw.includes('http'));
  assert.equal(v.capabilities.sequence, false); assert.equal(v.capabilities.requestCountPerScenario, 1);
});
test('context preserves safe const/enum but marks unsupported keywords and old refs as projection only', () => {
  const c = context(); c.schemas[0].schema.properties.meta.properties.total.const = 2;
  c.schemas[0].schema.properties.state = { type: 'string', enum: ['active', 'inactive'], pattern: 'unsafe-pattern', default: 'PRIVATE_DEFAULT' };
  const v = buildTestDesignRepairContextV1(c);
  assert.equal(v.schemas[0].schema.properties.meta.properties.total.const, 2);
  assert.deepEqual(v.schemas[0].schema.properties.state.enum, ['active', 'inactive']);
  assert.equal(v.schemas[0].projectionPartial, true); assert.equal(v.schemaProjectionOnly, true);
  assert.ok(!JSON.stringify(v).includes('unsafe-pattern')); assert.ok(!JSON.stringify(v).includes('PRIVATE_DEFAULT'));
});
test('context has depth/size limits and cannot leak prototype keys or absolute urls', () => {
  const c = context(); c.endpoint.normalizedPath = 'https://example.invalid/?token=PRIVATE_URL';
  let node = {}; c.schemas[0].schema = node;
  for (let i = 0; i < 40; i++) { node.properties = { child: {} }; node = node.properties.child; }
  node.const = 'PRIVATE_DEEP'; c.schemas.push(...Array.from({ length: 40 }, (_, i) => ({ trackId: `track_${i}`, schema: JSON.parse('{"properties":{"__proto__":{"const":"PRIVATE_PROTO"}}}') })));
  const v = buildTestDesignRepairContextV1(c);
  assert.equal(v.schemas.length, 24); assert.equal(v.endpoint.normalizedPath, null); assert.equal(v.truncated, true);
  assert.ok(!JSON.stringify(v).includes('PRIVATE_')); assert.equal({}.polluted, undefined);
});
test('prompts separate hypothesis from empty arrays, protect untrusted context and original scenario set', () => {
  const generation = buildTestDesignPromptV1(context()), repair = buildTestDesignRepairPromptV1(context());
  for (const prompt of [generation, repair]) {
    assert.match(prompt.systemPrompt, /ASSUMED significa expectativa explícita/);
    assert.match(prompt.systemPrompt, /Nunca preencha uma lista vazia com STATUS 200/);
    assert.match(prompt.systemPrompt, /DADOS? NÃO CONFIÁVE/);
  }
  assert.equal(generation.promptVersion, 'qagent.test-design-prompt.v6.4');
  assert.equal(repair.promptVersion, 'qagent.test-design-repair-prompt.v1.2');
  assert.match(repair.userPrompt, /REPAIR_CONTEXT_JSON_BEGIN/); assert.match(repair.userPrompt, /"status":"REQUIRED"/);
  assert.match(repair.systemPrompt, /quantidade real/); assert.match(generation.userPrompt, /Produza até 8/);
});
test('entire reported failure reaches a single repair and final error lists all remaining arrays', async () => {
  const h = harness(fixture, fixture);
  await assert.rejects(h.run(), error => {
    assert.equal(error.publicDetails.repairAttempts, 1);
    assert.deepEqual(error.publicDetails.assertionDiagnostics.issues.map(i => i.scenarioIndex), [2, 4, 7]);
    return failure('TEST_DESIGN_CONTRACT_INVALID')(error);
  });
  assert.deepEqual(h.calls.map(c => c.stage), ['generate', 'repair']);
  const request = h.calls[1].request;
  for (const n of [2, 4, 7]) assert.ok(request.repairInstruction.includes(`modelOutput.scenarios[${n}].assertions`));
  assert.match(request.originalPrompt, /REPAIR_CONTEXT_JSON_BEGIN/); assert.equal(request.retries, 0);
  assert.equal(request.maxOutputTokens, 5500); assert.equal(request.timeoutMs, 60_000);
  assert.ok(h.logs.find(e => e.event === 'testDesign_ai_contract_repair').assertionDiagnostics.issueCount === 3);
});
test('fixing only the first missing assertion reports remaining 5th and 8th instead of hiding them', async () => {
  const repaired = clone(fixture); repaired.scenarios[2].assertions = [status(401)];
  await assert.rejects(harness(fixture, repaired).run(), error => {
    assert.equal(error.publicDetails.validationPath, 'modelOutput.scenarios[4].assertions');
    assert.deepEqual(error.publicDetails.assertionDiagnostics.issues.map(i => i.scenarioIndex), [4, 7]); return true;
  });
});
for (const provider of ['openai', 'gemini']) test(`a defensible 401 repair works with the ${provider} interface and remains HYPOTHESIS`, async () => {
  const o = hypothesis(), before = clone(o), h = harness(o, fill401(o), { provider });
  const result = await h.run(), s = result.specification.scenarios[0], r = s.readinessV2;
  assert.equal(s.spec.auth.requirement, 'UNAUTHENTICATED'); assert.deepEqual(s.spec.assertions, [status(401)]);
  assert.deepEqual([r.execution.status, r.expectation.status, r.regression.status], ['READY', 'HYPOTHESIS', 'BLOCKED']);
  assert.equal(s.grounding.level, 'ASSUMED'); assert.deepEqual(s.grounding.evidenceRefs, []);
  assert.equal(result.diagnostics.assertionRepair.initial.issueCount, 1);
  assert.equal(result.diagnostics.assertionRepair.remaining.issueCount, 0);
  assert.equal(result.diagnostics.assertionRepair.integrityChecked, true);
  assert.equal(result.diagnostics.promptVersion, 'qagent.test-design-prompt.v6.4');
  assert.doesNotThrow(() => validateTestSpecificationV1(result.specification, context()));
  const admission = assessLearningAdmission(s, { enabled: true });
  assert.equal(admission.admissionBasis, 'STRUCTURED_READINESS_V2'); assert.equal(admission.allowed, true);
  assert.deepEqual(o, before); assert.ok(!JSON.stringify({ logs: h.logs, result }).includes('CREDENTIAL_SENTINEL'));
});
test('a repaired hypothesis with missing id remains blocked by data; no id injected to force ready', async () => {
  const c = context(); c.endpoint.normalizedPath = '/candidates/{id}';
  const result = await harness(hypothesis(), fill401(hypothesis()), { context: c }).run();
  const s = result.specification.scenarios[0];
  assert.equal(s.readinessV2.execution.status, 'BLOCKED'); assert.equal(s.readinessV2.expectation.status, 'HYPOTHESIS');
  assert.ok(s.readinessV2.execution.reasonCodes.includes('PATH_PARAM_UNRESOLVED'));
});
test('a clean valid generation makes no repair call and no extra assertion', async () => {
  const o = fill401(hypothesis()), h = harness(o, () => { throw Error('REPAIR_FORBIDDEN'); });
  const result = await h.run(); assert.equal(h.calls.length, 1); assert.equal(result.diagnostics.repairAttempts, 0);
  assert.deepEqual(result.specification.scenarios[0].spec.assertions, [status(401)]);
});
test('flag false still fixes structural generation without enabling readiness v2', async () => {
  const result = await harness(hypothesis(), fill401(hypothesis()), { env: { SCENARIO_READINESS_V2_ENABLED: 'false' } }).run();
  assert.equal(result.specification.scenarios[0].readinessV2, undefined); assert.equal(result.diagnostics.repairAttempts, 1);
});
for (const [name, mutate, code] of [
  ['drop a scenario', o => o.scenarios.pop(), 'REPAIR_SCENARIO_SET_CHANGED'],
  ['change objective', o => { o.scenarios[0].objective = 'Validar qualquer status'; }, 'REPAIR_INTENT_CHANGED'],
  ['change auth', o => { o.scenarios[0].authRequirement = 'NONE'; }, 'REPAIR_INTENT_CHANGED'],
  ['change category', o => { o.scenarios[0].category = 'HAPPY_PATH'; }, 'REPAIR_INTENT_CHANGED'],
  ['change id', o => { o.scenarios[0].scenarioId = 'other'; }, 'REPAIR_SCENARIO_SET_CHANGED'],
  ['change request', o => { o.scenarios[0].request.query = { limit: 100 }; }, 'REPAIR_REQUEST_CHANGED'],
  ['promote hypothesis', o => { o.scenarios[0].grounding = { level: 'OBSERVED', rationale: ['now observed'], evidenceRefs: [evidenceRef], schemaRefs: [] }; }, 'REPAIR_HYPOTHESIS_PROMOTED'],
  ['raise confidence', o => { o.scenarios[0].confidence = 'MEDIUM'; }, 'REPAIR_HYPOTHESIS_PROMOTED'],
  ['allow success for negative auth', o => { o.scenarios[0].assertions = [status(200)]; }, 'REPAIR_NEGATIVE_INTENT_WEAKENED'],
  ['allow all status classes', o => { o.scenarios[0].assertions = [{ type: 'STATUS', expectedStatusCodes: [200, 400, 401, 404] }]; }, 'REPAIR_STATUS_CLASSES_BROADENED'],
]) test(`repair cannot ${name}`, async () => {
  const o = hypothesis(); o.scenarios.push(clone(fixture.scenarios[0])); const repaired = fill401(o); mutate(repaired);
  await assert.rejects(harness(o, repaired).run(), error => failure('TEST_DESIGN_REPAIR_INTEGRITY_INVALID')(error) && hasRepairIssue(error, code));
});
test('unaffected valid assertions cannot be removed or broadened during another repair', async () => {
  const o = hypothesis(); o.scenarios.push(clone(fixture.scenarios[0]));
  for (const next of [[status(200)], [{ type: 'STATUS', expectedStatusCodes: [200, 404] }, o.scenarios[1].assertions[1]]]) {
    const repaired = fill401(o); repaired.scenarios[1].assertions = next;
    await assert.rejects(harness(o, repaired).run(), error => hasRepairIssue(error, 'REPAIR_ASSERTION_CHANGED'));
  }
});
test('a dummy repair of all reported arrays is rejected for count and sequence instead of passing', async () => {
  const repaired = clone(fixture); repaired.scenarios[2].assertions = [status(401)];
  repaired.scenarios[4].assertions = [status(200), { type: 'JSON_PATH_EXISTS', path: '$.meta.total' }];
  repaired.scenarios[7].assertions = [status(200)];
  assert.doesNotThrow(() => validateTestDesignModelOutputV1(repaired, context()));
  await assert.rejects(harness(fixture, repaired).run(), error => {
    assert.equal(error.publicDetails.assertionDiagnostics.issueCount, 0);
    return hasRepairIssue(error, 'REPAIR_COUNT_RULE_UNAVAILABLE') && hasRepairIssue(error, 'REPAIR_SEQUENCE_NOT_REPRESENTABLE');
  });
});
test('count correctness cannot be renamed to presence and ordinary SCHEMA type is not a count rule', async () => {
  const o = { title: fixture.title, objective: fixture.objective, scenarios: [clone(fixture.scenarios[4])] };
  const repaired = clone(o); repaired.scenarios[0].objective = 'Verificar presença de total';
  repaired.scenarios[0].assertions = [status(200), { type: 'SCHEMA', schemaRef }];
  await assert.rejects(harness(o, repaired).run(), error => hasRepairIssue(error, 'REPAIR_INTENT_CHANGED') && hasRepairIssue(error, 'REPAIR_COUNT_RULE_UNAVAILABLE'));
});
test('a provided const can substantiate a fixed count, but does not prove count equals array length', async () => {
  const o = { title: fixture.title, objective: fixture.objective, scenarios: [clone(fixture.scenarios[4])] }, repaired = clone(o), c = context();
  c.schemas[0].schema.properties.meta.properties.total.const = 2;
  repaired.scenarios[0].assertions = [status(200), { type: 'JSON_PATH_EQUALS', path: '$.meta.total', expected: 2 }];
  assert.doesNotThrow(() => validateAssertionRepairIntegrity(o, repaired, c));
  o.scenarios[0].objective = 'Verificar que total corresponde ao tamanho da lista'; repaired.scenarios[0].objective = o.scenarios[0].objective;
  assert.throws(() => validateAssertionRepairIntegrity(o, repaired, c), error => error.details.repairIssues.some(i => i.code === 'REPAIR_COUNT_RULE_UNAVAILABLE'));
});
test('presence-only repair for explicit number objective stays coverage PARTIAL through existing guards', async () => {
  const o = hypothesis(); Object.assign(o.scenarios[0], { title: 'Campo total', objective: 'Validar $.meta.total como number', category: 'SCHEMA_CONTRACT', authRequirement: 'REQUIRED' });
  const repaired = clone(o); repaired.scenarios[0].assertions = [status(200), { type: 'JSON_PATH_EXISTS', path: '$.meta.total' }];
  const s = (await harness(o, repaired).run()).specification.scenarios[0];
  assert.equal(s.readinessV2.coverage.status, 'PARTIAL'); assert.equal(s.readinessV2.regression.status, 'BLOCKED');
  assert.equal(assessLearningAdmission(s, { enabled: true }).confirmationRequiresCoverage, true);
});
test('secret-only assertions removed before repair stay removed and cannot be reintroduced', async () => {
  const o = hypothesis(); o.scenarios[0].assertions = [{ type: 'JSON_PATH_EQUALS', path: '$.password', expected: 'PASSWORD_SENTINEL' }];
  o.scenarios[0].request.headers.Cookie = 'COOKIE_SENTINEL';
  const h = harness(o, request => {
    assert.ok(!request.rawText.includes('PASSWORD_SENTINEL')); assert.ok(!request.rawText.includes('COOKIE_SENTINEL'));
    assert.match(request.repairInstruction, /ASSERTIONS_EMPTY/);
    const repaired = JSON.parse(request.rawText); repaired.scenarios[0].assertions = clone(o.scenarios[0].assertions); return repaired;
  });
  await assert.rejects(h.run(), error => {
    assert.equal(error.publicDetails.assertionDiagnostics.issues[0].code, 'ASSERTIONS_EMPTY');
    assert.ok(!JSON.stringify(error.publicDetails).includes('SENTINEL')); return true;
  });
  assert.ok(!JSON.stringify(h.logs).includes('SENTINEL'));
});
test('secret sanitizer review is retained even when replacement assertion is structurally valid', async () => {
  const o = hypothesis(); o.scenarios[0].assertions = [{ type: 'JSON_PATH_EXISTS', path: '$.password' }];
  const h = harness(o, request => { const repaired = JSON.parse(request.rawText); repaired.scenarios[0].assertions = [status(401)]; return repaired; });
  const result = await h.run(); assert.equal(result.diagnostics.secretSafeSanitizer.assertionRemovalCount, 1);
  assert.equal(result.specification.scenarios[0].readinessV2.regression.status, 'BLOCKED');
  assert.equal(result.specification.scenarios[0].readinessV2.review.status, 'HUMAN_REQUIRED');
  assert.ok(result.specification.scenarios[0].readinessV2.issues.some(i => i.code === 'SENSITIVE_INTENT_REQUIRES_REVIEW'));
});
test('after format repair the one-repair budget is still enforced and all array defects are returned', async () => {
  const error = Object.assign(new Error('malformed json'), { code: 'AI_INVALID_JSON', rawText: '{ broken JSON' });
  const h = harness(fixture, fixture, { generationError: error });
  await assert.rejects(h.run(), e => e.publicDetails.repairAttempts === 1 && e.publicDetails.assertionDiagnostics.issueCount === 3);
  assert.equal(h.calls.filter(c => c.stage === 'repair').length, 1);
  assert.ok(h.logs.some(e => e.event === 'testDesign_ai_contract_failed'));
});
test('provider transport failure is not disguised as empty assertions or retried as contract repair', async () => {
  const error = Object.assign(new Error('unavailable'), { code: 'AI_UPSTREAM_FAILED', upstreamFailed: true, upstreamStatus: 503 });
  const h = harness(hypothesis(), null, { generationError: error });
  await assert.rejects(h.run(), e => e === error); assert.equal(h.calls.length, 1);
});
test('repair timeout remains a 504, not a successful fallback', async () => {
  const error = Object.assign(new Error('aborted'), { upstreamFailed: true, upstreamStatus: 0, transportError: { name: 'AbortError' } });
  const h = harness(hypothesis(), null, { repairError: error });
  await assert.rejects(h.run(), e => e.code === 'AI_UPSTREAM_TIMEOUT' && e.status === 504);
});
test('invalid output never reaches Registry append in the generation/persistence flow', async () => {
  let appends = 0; const h = harness(fixture, fixture), c = context();
  await assert.rejects(generateAndPersistCatalogTestDesignV1({ env: { log() {} }, organizationId: c.organizationId, projectId: c.projectId, endpointId: c.endpoint.endpointId,
    generateDesign: h.run, registryAppend: async () => { appends++; throw new Error('APPEND_FORBIDDEN'); } }), failure());
  assert.equal(appends, 0);
});
test('successful repair appends only a validated specification, never raw output or prompt', async () => {
  let appends = 0; const h = harness(), c = context();
  const result = await generateAndPersistCatalogTestDesignV1({ env: { log() {} }, organizationId: c.organizationId, projectId: c.projectId, endpointId: c.endpoint.endpointId,
    generateDesign: h.run, registryAppend: async ({ generationResult }) => {
      appends++; validateTestSpecificationV1(generationResult.specification, c);
      assert.equal(Object.hasOwn(generationResult, 'rawText'), false); assert.equal(Object.hasOwn(generationResult, 'prompt'), false);
      return { testDesign: { id: 'td_fixture', versionId: 'tdv_fixture', version: 1 }, idempotentReplay: false };
    } });
  assert.equal(appends, 1); assert.equal(result.testDesign.persisted, true);
});
test('protected observed baseline stays outside repair and survives exploratory AI failure', async () => {
  const b = JSON.parse(fs.readFileSync(new URL('./fixtures/baseline-fixture.json', import.meta.url), 'utf8'));
  const before = clone(b), h = harness(fixture, fixture, {
    context: b.context, env: { OBSERVED_BASELINE_GENERATION_ENABLED: 'true' },
    input: { loadBaselines: async () => ({ items: [b.source] }), loadPrevious: async () => ({ exists: false }), now: () => new Date(Date.parse(b.source.source.observedAt) + 60_000) },
  });
  const result = await h.run(); assert.ok(result.specification.scenarios.some(s => s.generationClass === 'OBSERVED_BASELINE'));
  assert.ok(result.specification.scenarios.every(s => s.generationClass === 'OBSERVED_BASELINE'));
  assert.deepEqual(b, before);
  const serialized = JSON.stringify(h.calls.filter(c => c.stage === 'repair').map(c => c.request));
  assert.ok(!serialized.includes(b.source.baselineId));
});

// Synthetic variation: unlike the reported count/sequence goals, these three
// missing assertions have explicitly representable goals. This is NOT a repair
// that rewrites the user's objectives; it is a separate controlled test input.
test('three repairable missing arrays are repaired together without touching five valid scenarios', async () => {
  const source = clone(fixture);
  source.scenarios[4].title = 'Presença do total'; source.scenarios[4].objective = 'Verificar presença de $.meta.total';
  source.scenarios[7].title = 'Presença dos dados'; source.scenarios[7].objective = 'Verificar presença de $.data';
  const repaired = clone(source);
  repaired.scenarios[2].assertions = [status(401)];
  repaired.scenarios[4].assertions = [status(200), { type: 'JSON_PATH_EXISTS', path: '$.meta.total' }];
  repaired.scenarios[7].assertions = [status(200), { type: 'JSON_PATH_EXISTS', path: '$.data' }];
  const h = harness(source, repaired), result = await h.run();
  assert.equal(result.specification.scenarios.length, 8);
  assert.equal(result.diagnostics.assertionRepair.initial.issueCount, 3);
  assert.equal(result.diagnostics.assertionRepair.remaining.issueCount, 0);
  assert.equal(result.diagnostics.assertionRepair.integrityChecked, true);
  assert.equal(h.calls.filter(c => c.stage === 'repair').length, 1);
  for (let i = 0; i < 8; i++) {
    assert.equal(result.specification.scenarios[i].scenarioId, source.scenarios[i].scenarioId);
    assert.equal(result.specification.scenarios[i].objective, source.scenarios[i].objective);
  }
});
test('failed integrity repair never appends even though all arrays now satisfy the contract', async () => {
  const repaired = clone(fixture);
  repaired.scenarios[2].assertions = [status(401)];
  repaired.scenarios[4].assertions = [status(200)];
  repaired.scenarios[7].assertions = [status(200)];
  let appends = 0; const h = harness(fixture, repaired), c = context();
  await assert.rejects(generateAndPersistCatalogTestDesignV1({ env: { log() {} }, organizationId: c.organizationId, projectId: c.projectId, endpointId: c.endpoint.endpointId,
    generateDesign: h.run, registryAppend: async () => { appends++; throw Error('APPEND_FORBIDDEN'); } }), failure('TEST_DESIGN_REPAIR_INTEGRITY_INVALID'));
  assert.equal(appends, 0);
});

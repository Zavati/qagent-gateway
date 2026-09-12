import { aiEngine as defaultAiEngine } from '../ai/aiEngine.js';
import { resolveAiRuntimeConfig } from './aiRuntimeConfigService.js';

const CLASSIFICATIONS=new Set([
  'EXPECTED_BEHAVIOR_LEARNED',
  'EXPECTATION_DRIFT',
  'TEST_DATA_DRIFT',
  'APPLICATION_BUG_SUSPECTED',
  'RUNTIME_FAILURE',
  'INCONCLUSIVE',
]);
const DECISIONS=new Set(['EVOLVE_TEST','KEEP_TEST','REVIEW_REQUIRED']);

function fail(message,code='TEST_EVOLUTION_AI_OUTPUT_INVALID',status=502){
  const error=new Error(message);error.code=code;error.status=status;return error;
}
function normalize(out){
  const value=out?.json??out;
  if(!value||typeof value!=='object'||Array.isArray(value))throw fail('AI Test Evolution returned an invalid object.');
  const classification=String(value.classification||'').trim().toUpperCase();
  const decision=String(value.decision||'').trim().toUpperCase();
  if(!CLASSIFICATIONS.has(classification))throw fail('AI Test Evolution returned an unsupported classification.');
  if(!DECISIONS.has(decision))throw fail('AI Test Evolution returned an unsupported decision.');
  const raw=Number(value.confidence);
  const confidence=raw<=1?Math.round(raw*100):Math.round(raw);
  if(!Number.isFinite(confidence)||confidence<0||confidence>100)throw fail('AI Test Evolution returned invalid confidence.');
  const reasonCodes=Array.isArray(value.reasonCodes)
    ? [...new Set(value.reasonCodes.map((x)=>String(x||'').trim().toUpperCase()).filter((x)=>/^[A-Z0-9_:-]{1,100}$/.test(x)))].slice(0,20)
    : [];
  const rationale=String(value.rationale||'').trim().slice(0,1600);
  return {classification,decision,confidence,reasonCodes,rationale};
}

function prompts(context){
  const systemPrompt=`You are QAgent Test Evolution Reasoner.
Your job is quality decision support, NOT blind self-healing.

You receive:
- the current immutable Test Design scenario;
- deterministic candidate changes already derived from execution evidence;
- the current sanitized execution result;
- up to 5 recent executions of the SAME scenario;
- up to 5 bounded observed endpoint samples/evidence;
- up to 5 successful request execution evidence items from this endpoint;
- up to 3 Test Design versions.

Rules:
1. You MUST NOT invent a new test change. The only possible mutation is one of currentTest.candidateChanges.
2. Distinguish a wrong/outdated expectation from an application bug.
3. A test failure is NOT evidence that the test should be changed.
4. If a negative/validation scenario historically returns 4xx and now returns 2xx, prefer APPLICATION_BUG_SUSPECTED.
5. HTTP 5xx, auth failures inconsistent with scenario intent, runtime/network failures, or weak/conflicting evidence must NOT be auto-healed.
6. TEST_DATA_DRIFT means the response expectation normally stays unchanged. Candidate request repairs may be TEST_DATA_BINDING, REQUEST_BODY_FIELD_ADD, or REQUEST_BODY_FIELD_REMOVE. Choose TEST_DATA_DRIFT + EVOLVE_TEST only when machine-readable request rejection evidence and successful request evidence support the deterministic candidate. Structural BODY add/remove changes are human-review gated by policy even when your recommendation is EVOLVE_TEST.
7. EXPECTED_BEHAVIOR_LEARNED is for behavior that matches scenario intent and is supported by execution/observed evidence, where the test expectation simply lacked the real product behavior. A candidate ADD_JSON_PATH_EQUALS_ASSERTION on a LEARNING scenario strengthens the test; approve it only when the observed literal is semantically stable and appropriate to assert.
8. Changing an existing JSON_PATH_EQUALS literal is more dangerous than adding a learned assertion and normally requires review. EXPECTATION_DRIFT is a plausible product contract change that still deserves human review unless risk is clearly low; do not call it learned behavior just to make a test pass.
9. If evidence is insufficient or ambiguous, choose INCONCLUSIVE + REVIEW_REQUIRED.
10. When the response explicitly identifies invalid, missing-required, or unexpected request fields and the candidate change repairs GENERATED Test Data/payload structure using successful request evidence, prefer TEST_DATA_DRIFT over changing STATUS expectations.
11. FIXED request data is origin-aware. USER_DEFINED and LEGACY_UNKNOWN values must never be treated as QAgent-owned merely because their literal looks generic. If deterministic evidence proposes FIXED -> OBSERVED, classify it as TEST_DATA_DRIFT only when the candidate already contains strong successful evidence; the policy will require human review.
12. Never recommend changing a successful-intent 2xx expectation to a 4xx merely because the request constructed for the test was rejected. If request evidence is machine-readable but no safe repair exists, prefer INCONCLUSIVE + REVIEW_REQUIRED rather than expectation drift.
13. REQUEST_BODY_FIELD_ADD/REMOVE and FIXED -> OBSERVED changes must remain explainable as request construction repairs; never reinterpret them as product behavior learning.
14. Never include secrets, raw credentials, raw configured FIXED values, or new request data in the output.
15. A SCHEMA_EXPECTATION candidate with learningMode=ENRICHMENT completes previously unknown structure; it is NOT permission to change known rules. Require knownRulesPreserved, compatible typed complete structural evidence and no known assertion violation. Prefer EXPECTED_BEHAVIOR_LEARNED only when these conditions hold. It remains human reviewed.
16. A NOT_EVALUATED assertion due to incomplete schema is uncertainty, not proof of an application defect. Completing that gap requires a new version and a later verification, not relabeling the same source execution as PASSED.
18. SCENARIO_READINESS_CONFIRMATION confirms existing assertions after a passed LEARNING run. It is not an assertion repair. Keep all assertions and auth intent unchanged. Recommend EXPECTED_BEHAVIOR_LEARNED + EVOLVE_TEST only for adopting the persisted readiness and reusable binding declarations shown in the candidate. It always requires human approval; do not claim the new version already passed or infer business correctness beyond the actual assertions. Expected 401 on an intentionally UNAUTHENTICATED request is evidence for that hypothesis, not an auth outage.
20. NEGATIVE_REQUEST_REPAIR repairs a malformed negative experiment, not its expected status. All old assertions and auth are preserved. OMIT_PATH_SEGMENT is an explicitly reviewed route variant (not proof the original endpoint was tested). QUERY_VALUE_PROBE is a bounded hypothesis based on a value different from the source request, NOT proof of invalidity or a documented enum. Recommend TEST_DATA_DRIFT/EVOLVE_TEST only for compatible construction repair and explain uncertainty. Never change a rejection into 2xx to hide an unrealized negative, never call the old 2xx an application bug without an established condition. Repairs always need human approval and a subsequent execution.
19. ASSERTION_COVERAGE_EXTENSION is a reviewed additive repair of the test's missing checks. The previous assertions passed, but do not fully represent its declared numeric/pagination intent. It adds only the candidate STATUS/JSON_PATH_TYPE/JSON_ARRAY_LENGTH_LTE_REQUEST assertions; it does not alter input, auth, existing assertions or shared schemas. JSON_ARRAY_LENGTH_LTE_REQUEST tests only the upper bound using the actual query sent; small/empty samples do not establish complete pagination correctness. It is never auto-applied. Do not claim these new assertions have been independently verified before the next run. Respect inconclusive/conflicting evidence; do not replace declared numeric rules with strings or accept 5xx as a learned success.
17. Original observed-baseline status, known field types/presence, request data and original provenance must not be weakened. AI_EXPLORATORY remains its original class after learning; never recommend fabricating an observed origin.

Return ONLY JSON with this exact shape:
{
  "classification": "EXPECTED_BEHAVIOR_LEARNED|EXPECTATION_DRIFT|TEST_DATA_DRIFT|APPLICATION_BUG_SUSPECTED|RUNTIME_FAILURE|INCONCLUSIVE",
  "decision": "EVOLVE_TEST|KEEP_TEST|REVIEW_REQUIRED",
  "confidence": 0-100,
  "reasonCodes": ["UPPER_SNAKE_CASE"],
  "rationale": "short explanation"
}

Decision guidance:
- EXPECTED_BEHAVIOR_LEARNED -> EVOLVE_TEST only when evidence supports the scenario intent.
- APPLICATION_BUG_SUSPECTED -> KEEP_TEST.
- TEST_DATA_DRIFT -> EVOLVE_TEST only for deterministic request repairs already present in candidateChanges and supported by successful evidence. GENERATED -> GENERATED TEST_DATA_BINDING may be AUTO_SAFE only when policy allows it. FIXED -> OBSERVED and structural REQUEST_BODY_FIELD_ADD/REMOVE are always human-review gated. Generator constraints are evidence-derived and must never be widened or invented by the model; otherwise KEEP_TEST or REVIEW_REQUIRED.
- RUNTIME_FAILURE -> KEEP_TEST.
- INCONCLUSIVE -> REVIEW_REQUIRED.
- EXPECTATION_DRIFT -> usually REVIEW_REQUIRED.`;

  const userPrompt=`Analyze this bounded QAgent Test Evolution evidence context.

${JSON.stringify(context)}

Return only the required JSON decision.`;
  return {systemPrompt,userPrompt};
}

export async function assessTestEvolutionWithAi({
  env,
  accountId=null,
  context,
  aiEngine=defaultAiEngine,
  resolveAiConfig=resolveAiRuntimeConfig,
}={}){
  const fallbackModel=String(env?.TEST_EVOLUTION_MODEL||env?.GENERATE_TESTS_MODEL||'gpt-4o-mini').trim();
  const aiConfig=await resolveAiConfig(env,{
    accountId,
    capability:'test-evolution',
    fallbackModel,
  });
  const prompt=prompts(context);
  const request={
    capability:'test-evolution',
    provider:aiConfig.provider,
    credentials:aiConfig.credentials,
    model:aiConfig.model,
    systemPrompt:prompt.systemPrompt,
    userPrompt:prompt.userPrompt,
    temperature:0,
    maxOutputTokens:900,
    timeoutMs:Math.max(15000,Math.min(90000,Number(env?.TEST_EVOLUTION_AI_TIMEOUT_MS||60000))),
    retries:1,
  };
  let out;
  try{
    out=await aiEngine.generateJson(request,env);
    return {
      assessment:normalize(out),
      ai:{provider:out?.provider||aiConfig.provider,model:out?.model||aiConfig.model,configSource:aiConfig.source},
    };
  }catch(error){
    const rawText=String(error?.contentText||error?.rawText||'');
    if(error?.upstreamFailed||!rawText)throw error;
    const repaired=await aiEngine.repairJson({
      ...request,
      originalPrompt:prompt.userPrompt,
      rawText,
      repairInstruction:'Return only the exact Test Evolution decision JSON. Do not add markdown or commentary.',
      retries:0,
      timeoutMs:Math.min(30000,request.timeoutMs),
    },env);
    if(!repaired)throw fail('AI Test Evolution response could not be repaired.');
    return {
      assessment:normalize(repaired),
      ai:{provider:aiConfig.provider,model:aiConfig.model,configSource:aiConfig.source},
    };
  }
}

export { normalize as normalizeTestEvolutionAiOutput };

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
- up to 3 Test Design versions.

Rules:
1. You MUST NOT invent a new test change. The only possible mutation is one of currentTest.candidateChanges.
2. Distinguish a wrong/outdated expectation from an application bug.
3. A test failure is NOT evidence that the test should be changed.
4. If a negative/validation scenario historically returns 4xx and now returns 2xx, prefer APPLICATION_BUG_SUSPECTED.
5. HTTP 5xx, auth failures inconsistent with scenario intent, runtime/network failures, or weak/conflicting evidence must NOT be auto-healed.
6. TEST_DATA_DRIFT means the expectation should normally stay unchanged.
7. EXPECTED_BEHAVIOR_LEARNED is for behavior that matches scenario intent and is supported by execution/observed evidence, where the test expectation simply lacked the real product behavior. A candidate ADD_JSON_PATH_EQUALS_ASSERTION on a LEARNING scenario strengthens the test; approve it only when the observed literal is semantically stable and appropriate to assert.
8. Changing an existing JSON_PATH_EQUALS literal is more dangerous than adding a learned assertion and normally requires review. EXPECTATION_DRIFT is a plausible product contract change that still deserves human review unless risk is clearly low; do not call it learned behavior just to make a test pass.
9. If evidence is insufficient or ambiguous, choose INCONCLUSIVE + REVIEW_REQUIRED.
10. Never include secrets, raw credentials, or new request data in the output.

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
- TEST_DATA_DRIFT -> KEEP_TEST.
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

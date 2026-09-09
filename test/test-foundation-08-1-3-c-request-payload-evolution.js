import assert from 'node:assert/strict';
import { assessTestEvolutionWithAi } from '../src/services/testEvolutionAiService.js';

let capturedRequest=null;
const result=await assessTestEvolutionWithAi({
  env:{TEST_EVOLUTION_MODEL:'gpt-request-payload-test'},
  accountId:'cus_payload_1',
  context:{
    contractVersion:'qagent.test-evolution-evidence-context.v1',
    currentTest:{candidateChanges:[{
      changeType:'REQUEST_BODY_FIELD_ADD',
      current:{target:'BODY',selector:'$.lastName',presence:'ABSENT'},
      observed:{successfulSupportCount:5,conflictingSupportCount:0,constraintProvenance:'SUCCESSFUL_REQUEST_PAYLOAD_EVIDENCE'},
      proposed:{target:'BODY',selector:'$.lastName',source:'GENERATED',valueType:'STRING',generatorKind:'TEXT'},
    }]},
    currentExecution:{http:{outcome:'RESPONSE',statusCode:422}},
  },
  resolveAiConfig:async()=>({source:'env',provider:'openai',credentials:{apiKey:'test-only'},model:'gpt-request-payload-test'}),
  aiEngine:{
    async generateJson(request){
      capturedRequest=request;
      return {json:{classification:'TEST_DATA_DRIFT',decision:'EVOLVE_TEST',confidence:96,reasonCodes:['REQUEST_PAYLOAD_REPAIR'],rationale:'Machine-readable request rejection and successful request evidence support the candidate.'},provider:'openai',model:'gpt-request-payload-test'};
    },
  },
});

assert.match(capturedRequest.systemPrompt,/REQUEST_BODY_FIELD_ADD/);
assert.match(capturedRequest.systemPrompt,/REQUEST_BODY_FIELD_REMOVE/);
assert.match(capturedRequest.systemPrompt,/human-review gated/i);
assert.match(capturedRequest.systemPrompt,/never reinterpret them as product behavior learning/i);
assert.equal(result.assessment.classification,'TEST_DATA_DRIFT');
assert.equal(result.assessment.decision,'EVOLVE_TEST');
assert.equal(result.ai.configSource,'env');
console.log('08.1.3-C Gateway Request Payload Evolution AI boundary: PASS');

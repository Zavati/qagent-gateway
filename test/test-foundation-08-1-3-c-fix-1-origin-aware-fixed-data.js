import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyTestDataPlannerV1 } from '../src/intelligence/testDataPlanner.js';
import { buildTestSpecificationV1, validateTestSpecificationV1 } from '../src/intelligence/testDesignContract.js';

function context(origin='USER_DEFINED'){
  return {
    contractVersion:'qagent.test-design.v1',organizationId:'org',projectId:'prj',
    endpoint:{endpointId:'cep',method:'POST',normalizedPath:'/leave',observationCount:5,environmentCount:1,successRatePct:100},
    schemas:[{trackId:'req',direction:'REQUEST',schema:{type:'object',properties:{leaveTypeId:{type:'string'}}},versions:[]}],
    evidence:[],environments:[{environmentId:'env',name:'STG'}],
    testData:{configuredBindings:[{bindingId:'tdb_1',scopeType:'ENDPOINT',environmentId:'env',target:'BODY',selector:'$.leaveTypeId',sourceType:'FIXED',valueType:'STRING',generatorKind:null,generatorConfig:{},secretConfigured:false,...(origin?{origin}:{})}]},
    runtime:{apiServiceKey:'svc',resolutionSource:'EXPLICIT_CONFIG',resolutionConfidence:'CONFIRMED',requiresExecutionConfirmation:false,defaultAuthProfileRef:null,availableAuthProfileRefs:[],authObservation:{status:'NONE',scheme:null,evidenceRefs:[]}},
  };
}
function scenario(){return {scenarioId:'test_001',title:'Happy path',objective:'Create leave',category:'HAPPY_PATH',priority:'HIGH',confidence:'HIGH',grounding:{level:'INFERRED',rationale:['observed'],evidenceRefs:[],schemaRefs:['req']},preconditions:[],authRequirement:'NONE',request:{pathParams:{},query:{},headers:{},body:{leaveTypeId:'placeholder'}},assertions:[{type:'STATUS',expectedStatusCodes:[200]}],extract:[],automationHints:{needsData:true,reviewRequired:false,reasons:['O formato do body é modelado, mas seus valores precisam ser fornecidos por massa de teste controlada.']}};}

const planned=applyTestDataPlannerV1({title:'Leave',objective:'Create leave',assumptions:[],scenarios:[scenario()]},context());
assert.equal(planned.plansByScenarioId.test_001.bindings.length,1);
assert.equal(planned.plansByScenarioId.test_001.bindings[0].source,'FIXED');
assert.deepEqual(planned.plansByScenarioId.test_001.bindings[0].provenance,{origin:'USER_DEFINED'});

const legacy=applyTestDataPlannerV1({title:'Leave',objective:'Create leave',assumptions:[],scenarios:[scenario()]},context(null));
assert.deepEqual(legacy.plansByScenarioId.test_001.bindings[0].provenance,{origin:'LEGACY_UNKNOWN'});

// Contract accepts bounded provenance and rejects ownership strings outside the enum.
const spec=buildTestSpecificationV1({context:context(),modelOutput:planned.output,generation:{provider:'openai',model:'x',generatedAt:new Date().toISOString(),contextFingerprint:'a'.repeat(64)},testDataPlans:planned.plansByScenarioId});
validateTestSpecificationV1(spec,context());
const invalid=structuredClone(spec);invalid.scenarios[0].spec.testData.bindings[0].provenance.origin='GUESSED_FROM_LITERAL';
assert.throws(()=>validateTestSpecificationV1(invalid,context()),/enum|inválid|não suportado|GUESSED|Unsupported/i);

const migration=fs.readFileSync(new URL('../migrations/0018_foundation_08_1_3_c_fix_1_test_data_origin.sql',import.meta.url),'utf8');
for(const needle of ['ADD COLUMN origin','USER_DEFINED','AI_GENERATED','SYSTEM_DERIVED','LEGACY_UNKNOWN','created_by_user_id IS NOT NULL'])assert.ok(migration.includes(needle),needle);
const service=fs.readFileSync(new URL('../src/services/testDataBindingService.js',import.meta.url),'utf8');
assert.ok(service.includes("origin: 'USER_DEFINED'"));
assert.ok(service.includes("origin: row.origin || 'LEGACY_UNKNOWN'"));
const prompt=fs.readFileSync(new URL('../src/services/testEvolutionAiService.js',import.meta.url),'utf8');
assert.ok(prompt.includes('FIXED request data is origin-aware'));
assert.ok(prompt.includes('must never be treated as QAgent-owned merely because their literal looks generic'));
assert.ok(prompt.includes('FIXED -> OBSERVED'));

console.log('08.1.3-C FIX-1 Gateway Origin-Aware Fixed Request Data: PASS');

import assert from 'node:assert/strict';
import { createHumanRequestRepairV1 } from '../src/services/humanRequestRepairService.js';

const resultData={
  resultSet:{resultSetId:'rset_date',runId:'run_date',testDesignVersionId:'tdv_4',endpointId:'cep_leaves',environmentId:'env_1'},
  scenarios:[{scenarioResultId:'sres_1',scenarioId:'test_001',evidence:{request:{bodyFields:[]}}}],
};
const inspection={
  sourceTestDesignVersionId:'tdv_4',
  scenarios:[{
    scenarioId:'test_001',requestIssueDetected:true,blocksExpectationEvolution:true,
    requestIssue:{fields:[{
      issueType:'INVALID_PARAMETER',key:'date',target:null,selector:null,bindingSource:null,
      suggestion:{contractVersion:'qagent.unbound-request-parameter-suggestion.v1',actionType:'ADD_REQUEST_BINDING',candidateTarget:'QUERY',candidateSelector:'date',confidence:'MEDIUM',requiresHumanConfirmation:true,reasonCode:'READ_REQUEST_UNBOUND_PARAMETER_LIKELY_QUERY',valueTypeHint:'STRING',formatHint:'DATE_ISO_8601',inputPlaceholder:'YYYY-MM-DD'},
    }]},
  }],
};
const artifact={endpointId:'cep_leaves',specification:{scenarios:[{scenarioId:'test_001',spec:{target:{method:'GET',path:'/web/index.php/api/v2/dashboard/employees/leaves'},testData:{contractVersion:'qagent.test-data-bindings.v1',bindings:[]}}}]}};
let createdBindingInput=null,registryPayload=null,rerunInput=null;
const deps={
  getResult:async()=>resultData,inspect:async()=>inspection,getArtifact:async()=>artifact,listBindings:async()=>[],
  createBinding:async(_env,args)=>{createdBindingInput=args;return{bindingId:'tdb_date',status:'active',scopeType:'ENDPOINT',environmentId:'env_1',target:'QUERY',selector:'date',sourceType:'FIXED',valueType:'STRING',origin:'USER_DEFINED'};},
  createRegistryVersion:async(args)=>{registryPayload=args.payload;return{testDesign:{id:'td_leaves',versionId:'tdv_5',version:5}};},
  createRerun:async(args)=>{rerunInput=args;return{run:{runId:'run_date_rerun',status:'CREATED'}};},
  recordLearning:async()=>{},
};
const out=await createHumanRequestRepairV1({env:{},organizationId:'org_1',projectId:'prj_1',userId:'usr_1',input:{contractVersion:'qagent.human-request-repair-create.v1',resultSetId:'rset_date',scenarioId:'test_001',sourceTestDesignVersionId:'tdv_4',changes:[{target:'QUERY',selector:'date',operation:'ADD_REQUEST_BINDING',valueType:'STRING',value:'2026-09-09'}],reason:'Human confirmed query date',rerun:true},deps});
assert.equal(out.testDesign.testDesignVersion,5);
assert.equal(createdBindingInput.input.target,'QUERY');
assert.equal(createdBindingInput.input.selector,'date');
assert.equal(createdBindingInput.input.value,'2026-09-09');
assert.equal(createdBindingInput.input.sourceType,'FIXED');
assert.deepEqual(registryPayload.changes,[{type:'ADD_FIXED_TEST_DATA',scenarioId:'test_001',bindingIndex:0,target:'QUERY',selector:'date',valueType:'STRING'}]);
assert.equal(rerunInput.testDesignVersionId,'tdv_5');
assert.equal(rerunInput.scenarioId,'test_001');
assert.equal(out.bindings[0].origin,'USER_DEFINED');

await assert.rejects(
  ()=>createHumanRequestRepairV1({env:{},organizationId:'org_1',projectId:'prj_1',userId:'usr_1',input:{contractVersion:'qagent.human-request-repair-create.v1',resultSetId:'rset_date',scenarioId:'test_001',sourceTestDesignVersionId:'tdv_4',changes:[{target:'QUERY',selector:'other',operation:'ADD_REQUEST_BINDING',valueType:'STRING',value:'x'}]},deps}),
  error=>error?.code==='HUMAN_REQUEST_REPAIR_SUGGESTION_REQUIRED'&&error?.status===409,
);
await assert.rejects(
  ()=>createHumanRequestRepairV1({env:{},organizationId:'org_1',projectId:'prj_1',userId:'usr_1',input:{contractVersion:'qagent.human-request-repair-create.v1',resultSetId:'rset_date',scenarioId:'test_001',sourceTestDesignVersionId:'tdv_4',changes:[{target:'PATH_PARAM',selector:'date',operation:'ADD_REQUEST_BINDING',valueType:'STRING',value:'2026-09-09'}]},deps}),
  error=>error?.code==='HUMAN_REQUEST_REPAIR_TARGET_UNSUPPORTED',
);
console.log('08.1.3-C FIX-4 unbound request parameter human repair: PASS');

import fs from 'node:fs';
export const scope={organizationId:'org_semantic',projectId:'prj_semantic',endpointId:'cep_semantic',environmentId:'env_semantic'};
export function fixture(){
 const specification=JSON.parse(fs.readFileSync(new URL('./fixtures/semantic-08.1.6-fix2-3.json',import.meta.url)));
 const sourceVersion={...scope,id:'tdv_semantic_v2',testDesignId:'td_semantic',version:2,specification};
 const resultSet={...scope,resultSetId:'rset_semantic',runId:'run_semantic',testDesignId:sourceVersion.testDesignId,testDesignVersionId:sourceVersion.id,testDesignVersion:2,outcome:'PASSED',createdAt:'2026-09-11T19:08:08.000Z',completedAt:'2026-09-11T19:08:07.000Z'};
 const body={data:[{id:1,name:'example'}],meta:{total:1},rels:[]};
 const scenarios=specification.scenarios.map(s=>{
  const status=s.spec.auth.requirement==='UNAUTHENTICATED'?401:200;
  return {scenarioId:s.scenarioId,scenarioResultId:'sres_'+s.scenarioId,outcome:'PASSED',assertionCount:s.spec.assertions.length,assertionPassedCount:s.spec.assertions.length,assertionFailedCount:0,assertionNotEvaluatedCount:0,
    http:{method:'GET',path:s.spec.target.path,statusCode:status,contentType:'application/json',outcome:'RESPONSE',redirectCount:0,truncated:false,errorCode:null,headerNames:[]},
    assertions:s.spec.assertions.map((a,i)=>({assertionResultId:'ares_'+s.scenarioId+'_'+i,assertionIndex:i,type:a.type,outcome:'PASSED',errorCode:null,...(a.type==='STATUS'?{actualStatusCode:status,expectedStatusCodes:a.expectedStatusCodes}:a.type==='SCHEMA'?{schemaRef:a.schemaRef}:{path:a.path,matchCount:1})})),
    evidence:{contractVersion:'qagent.sanitized-execution-evidence.v1',executionPurpose:'LEARNING',expected:{testDataBindings:(s.spec.testData?.bindings||[]).map(b=>({target:b.target,selector:b.selector,valueType:b.valueType,source:b.source==='OBSERVED'?'FIXED':b.source,generatorKind:null}))},
      request:{method:'GET',path:s.spec.target.path,pathParams:[],query:[{name:'limit',source:'FIXED',values:['50'],redacted:false}],headers:status===401?[]:[{name:'cookie',source:'AUTH_RUNTIME',value:'[REDACTED]',redacted:true}],bodyBytes:0,bodyFields:[]},
      response:{previewFormat:'JSON',typesPreserved:true,previewTruncated:false,redacted:false,suppressionReason:null,bodyPreview:JSON.stringify(status===401?{error:{message:'Unauthorized'}}:body)}}};
 });
 return {sourceVersion,resultSet,scenarios,scenario:scenarios.find(s=>s.scenarioId==='test_006')};
}

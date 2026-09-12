import fs from 'node:fs';
export const scope={organizationId:'org_negative',projectId:'prj_negative',endpointId:'cep_negative',environmentId:'env_negative'};
export function fixture(){
 const specification=JSON.parse(fs.readFileSync(new URL('./fixtures/negative-08.1.6-fix2-4.json',import.meta.url)));
 const sourceVersion={...scope,id:'tdv_negative_v2',testDesignId:'td_negative',version:2,specification};
 const resultSet={...scope,resultSetId:'rset_negative',runId:'run_negative',testDesignId:sourceVersion.testDesignId,testDesignVersionId:sourceVersion.id,testDesignVersion:2,outcome:'FAILED',createdAt:'2026-09-11T22:23:07.000Z',completedAt:'2026-09-11T22:23:05.000Z'};
 const scenarios=specification.scenarios.map(s=>{
  const status=s.spec.auth.requirement==='UNAUTHENTICATED'?401:200;
  const body=status===401?{error:{message:'Unauthorized'}}:{data:{custom1:'example'},meta:{fields:[]},rels:[]};
  const assertions=s.spec.assertions.map((a,i)=>({assertionResultId:'ares_'+s.scenarioId+'_'+i,assertionIndex:i,type:a.type,outcome:a.type==='STATUS'&&!a.expectedStatusCodes.includes(status)?'FAILED':'PASSED',errorCode:a.type==='STATUS'&&!a.expectedStatusCodes.includes(status)?'ASSERTION_STATUS_MISMATCH':null,...(a.type==='STATUS'?{actualStatusCode:status,expectedStatusCodes:a.expectedStatusCodes}:a.type==='SCHEMA'?{schemaRef:a.schemaRef}:a.type==='HEADER_EXISTS'?{headerName:a.name}:a.type==='CONTENT_TYPE'?{expectedContentTypes:a.expected,actualContentType:'application/json'}:{path:a.path,matchCount:1})}));
  const failed=assertions.filter(a=>a.outcome==='FAILED').length;
  return {scenarioId:s.scenarioId,scenarioResultId:'sres_'+s.scenarioId,outcome:failed?'FAILED':'PASSED',assertionCount:assertions.length,assertionPassedCount:assertions.length-failed,assertionFailedCount:failed,assertionNotEvaluatedCount:0,
   http:{method:'GET',path:s.spec.target.path,statusCode:status,contentType:'application/json',outcome:'RESPONSE',redirectCount:0,truncated:false,errorCode:null,headerNames:[]},assertions,
   evidence:{contractVersion:'qagent.sanitized-execution-evidence.v1',executionPurpose:'LEARNING',expected:{testDataBindings:[{target:'QUERY',selector:'screen',source:'FIXED',valueType:'STRING',generatorKind:null},{target:'PATH_PARAM',selector:'id',source:'FIXED',valueType:'STRING',generatorKind:null}]},
    request:{method:'GET',path:s.spec.target.path,pathParams:[{name:'id',value:'7',redacted:false,source:'FIXED'}],query:[{name:'screen',source:'FIXED',values:['personal'],redacted:false}],headers:status===401?[]:[{name:'cookie',source:'AUTH_RUNTIME',value:'[REDACTED]',redacted:true}],contentType:null,bodyEncoding:'NONE',serialization:'NONE',bodyBytes:0,bodyFields:[],bodyFieldCount:0,signals:[]},
    response:{previewFormat:'JSON',typesPreserved:true,previewTruncated:false,redacted:false,suppressionReason:null,bodyPreview:JSON.stringify(body)}}};
 });
 return {sourceVersion,resultSet,scenarios,source:id=>specification.scenarios.find(s=>s.scenarioId===id),result:id=>scenarios.find(s=>s.scenarioId===id)};
}

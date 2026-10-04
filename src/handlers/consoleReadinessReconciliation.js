import { requireConsoleTenant } from '../services/tenantContextService.js';
import { getOrganizationProject } from '../services/projectService.js';
import { getProjectTestReadiness } from '../services/testRegistryClient.js';
import { parseTestReadinessQuery, isReadinessId } from '../contracts/testReadiness.js';
import { readinessReconciliationEnabled } from '../readiness/readinessReconciliation.js';
import { getReadinessReconciliation } from '../services/readinessReconciliationClient.js';
const fail=(code,status=400)=>{const e=new Error('Consulta de reconciliação inválida ou indisponível.');e.code=code;e.status=status;throw e;};
async function authorize(req,env,projectId,deps){
  const tenant=await(deps.requireTenant||requireConsoleTenant)(req,env);
  await(deps.getProject||getOrganizationProject)(env,tenant.organizationId,projectId);
  if(!readinessReconciliationEnabled(env))fail('READINESS_RECONCILIATION_DISABLED',409);
  return {env,organizationId:tenant.organizationId,projectId};
}
export async function postConsoleReadinessReconciliation(req,env,{projectId},deps={}){
  const scope=await authorize(req,env,projectId,deps);let input;
  const text=await req.text();if(new TextEncoder().encode(text).byteLength>16384)fail('READINESS_RECONCILIATION_INPUT_TOO_LARGE',413);
  try{input=JSON.parse(text);}catch{fail('READINESS_RECONCILIATION_INPUT_INVALID');}
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['endpointId','testDesignVersionId','environmentId','scenarioIds'].includes(k)))fail('READINESS_RECONCILIATION_INPUT_INVALID');
  for(const k of ['endpointId','testDesignVersionId','environmentId'])if(!isReadinessId(input[k]))fail('READINESS_RECONCILIATION_INPUT_INVALID');
  if(input.scenarioIds!=null&&(!Array.isArray(input.scenarioIds)||!input.scenarioIds.length||input.scenarioIds.length>50||new Set(input.scenarioIds).size!==input.scenarioIds.length||input.scenarioIds.some(x=>!isReadinessId(x))))fail('READINESS_RECONCILIATION_INPUT_INVALID');
  return {status:'ok',data:await(deps.reconcile||getReadinessReconciliation)({...scope,...input})};
}
/** Paged preview. Totals deliberately describe THIS PAGE, never the entire project. */
export async function getConsoleReadinessReconciliationPreview(req,env,{projectId},deps={}){
  const scope=await authorize(req,env,projectId,deps),params=new URL(req.url).searchParams;
  const environmentId=params.get('environmentId');
  if(params.getAll('environmentId').length!==1||!isReadinessId(environmentId))fail('READINESS_RECONCILIATION_INPUT_INVALID');
  params.delete('environmentId');
  if(params.get('view')&&params.get('view')!=='endpoints')fail('READINESS_RECONCILIATION_INPUT_INVALID');
  params.set('view','endpoints');if(!params.has('limit'))params.set('limit','3');
  const query=parseTestReadinessQuery(params);if(query.limit>10)fail('READINESS_PREVIEW_LIMIT');
  const inventory=await(deps.getReadiness||getProjectTestReadiness)({...scope,query});
  const items=[];const counts={scenarioCount:0,regressionReady:0,learningAvailable:0,needsData:0,coveragePartial:0,humanRequired:0,blocked:0,verified:0,contradicted:0};
  for(const endpoint of inventory.items){
    try{
      const projection=await(deps.reconcile||getReadinessReconciliation)({...scope,environmentId,endpointId:endpoint.endpointId,testDesignVersionId:endpoint.testDesignVersionId});
      items.push(projection);
      for(const s of projection.items){const v=s.readinessV2;counts.scenarioCount++;
        if(v.regression.status==='READY')counts.regressionReady++;
        if(v.review.status==='LEARNING_AVAILABLE')counts.learningAvailable++;
        if(v.issues.some(i=>i.kind==='DATA_DEPENDENCY'&&i.blocksExecution))counts.needsData++;
        if(v.coverage.status==='PARTIAL')counts.coveragePartial++;
        if(v.review.status==='HUMAN_REQUIRED')counts.humanRequired++;
        if(v.execution.status==='BLOCKED')counts.blocked++;
        if(v.expectation.status==='VERIFIED')counts.verified++;
        if(v.expectation.status==='CONTRADICTED')counts.contradicted++;
      }
    }catch(error){items.push({endpointId:endpoint.endpointId,testDesignVersionId:endpoint.testDesignVersionId,complete:false,errorCode:/^[A-Z][A-Z0-9_]{1,99}$/.test(error.code||'')?error.code:'READINESS_PREVIEW_UNAVAILABLE',items:[]});}
  }
  return {status:'ok',data:{contractVersion:'qagent.readiness-reconciliation-preview.v1',organizationId:scope.organizationId,projectId,environmentId,
    summaryBasis:'PAGE_ONLY_OVERLAPPING_DIMENSIONS',readinessRevision:inventory.readinessRevision,computedAt:new Date().toISOString(),
    projection:counts,page:inventory.page,items,complete:items.every(i=>i.complete===true),executionStarted:false,appliedByThisOperation:false,versionsModified:false,aiCalled:false}};
}

import { getOrganizationById } from '../repositories/organizationRepository.js';
import {
  inspectResultEvolution,
  createEvolutionProposal,
  getEvolutionPolicy,
  getEvolutionProposalContext,
  assessEvolutionProposal,
} from '../services/testEvolutionClient.js';
import { assessTestEvolutionWithAi } from '../services/testEvolutionAiService.js';
import { createRunV1 } from '../services/runService.js';
import { getRunByRunId } from '../repositories/runRepository.js';

const CONTRACT='qagent.test-evolution-result-trigger.v1';
function log(type,data={}){console.log(JSON.stringify({type,time:new Date().toISOString(),...data}));}
function validId(value,prefix){return typeof value==='string'&&value.startsWith(prefix)&&value.length<=240;}
function normalize(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||body.contractVersion!==CONTRACT)return null;
  if(!validId(body.organizationId,'org_')||!validId(body.projectId,'prj_')||!validId(body.resultSetId,'rset_'))return null;
  const scenarioIds=Array.isArray(body.scenarioIds)?[...new Set(body.scenarioIds.map((v)=>String(v||'').trim()).filter((v)=>v&&v.length<=200))].slice(0,500):[];
  return scenarioIds.length?{organizationId:body.organizationId,projectId:body.projectId,resultSetId:body.resultSetId,runId:validId(body.runId,'run_')?body.runId:null,scenarioIds}:null;
}
function retryable(error){if(error?.retryable===true)return true;const status=Number(error?.status||0);return status>=500||status===429;}
async function createRerun(env,trigger,proposalId,result){
  const rec=result?.rerun;if(!rec?.requested)return null;
  try{
    const created=await createRunV1({env,organizationId:trigger.organizationId,projectId:trigger.projectId,userId:null,input:{contractVersion:'qagent.run-create.v1',testDesignVersionId:rec.testDesignVersionId,environmentId:rec.environmentId,scenarioIds:[rec.scenarioId],confirmDiscoveredRuntime:false},idempotencyKey:`test-evolution-rerun:${proposalId}:${rec.testDesignVersionId}`});
    return {status:'CREATED',runId:created?.run?.runId||null};
  }catch(error){log('test_evolution_auto_rerun_create_failed',{proposalId,resultSetId:trigger.resultSetId,scenarioId:rec.scenarioId,code:error?.code||null});return {status:'CREATE_FAILED',errorCode:error?.code||'EVOLUTION_RERUN_CREATE_FAILED'};}
}
async function processEligibleScenario(env,trigger,scope,policy,organization,scenario){
  let proposal=await createEvolutionProposal({...scope,input:{resultSetId:trigger.resultSetId,scenarioResultId:scenario.scenarioResultId}});
  if(proposal?.assessment){
    let rerun=null;
    const wasAutoApplied=proposal.assessment.autoAction==='AUTO_APPLIED';
    if(wasAutoApplied&&proposal.status==='APPLIED'&&proposal.result?.testDesignVersionId&&policy?.autoRerun&&Number(policy?.maxEvolutionDepth||0)>=1){
      const context=await getEvolutionProposalContext({...scope,proposalId:proposal.proposalId});
      const method=String(context?.currentExecution?.http?.method||'').toUpperCase();
      if(['GET','HEAD','OPTIONS'].includes(method))rerun=await createRerun(env,trigger,proposal.proposalId,{rerun:{requested:true,testDesignVersionId:proposal.result.testDesignVersionId,environmentId:context?.source?.environmentId,scenarioId:proposal.source?.scenarioId}});
    }
    log('test_evolution_trigger_idempotent',{resultSetId:trigger.resultSetId,scenarioId:scenario.scenarioId,proposalId:proposal.proposalId,status:proposal.status,assessmentId:proposal.assessment.assessmentId,autoAction:proposal.assessment.autoAction||null,rerunStatus:rerun?.status||null});return;
  }
  const context=await getEvolutionProposalContext({...scope,proposalId:proposal.proposalId});
  const reasoned=await assessTestEvolutionWithAi({env,accountId:organization?.legacyCustomerId||null,context});
  const result=await assessEvolutionProposal({...scope,proposalId:proposal.proposalId,input:{contextFingerprint:context.contextFingerprint,assessment:reasoned.assessment,ai:reasoned.ai}});
  const rerun=await createRerun(env,trigger,proposal.proposalId,result);
  log('test_evolution_trigger_processed',{resultSetId:trigger.resultSetId,scenarioId:scenario.scenarioId,proposalId:proposal.proposalId,classification:result?.assessment?.classification||null,decision:result?.assessment?.decision||null,confidence:result?.assessment?.confidence??null,riskScore:result?.assessment?.risk?.score??null,riskLevel:result?.assessment?.risk?.level||null,autoAction:result?.assessment?.autoAction||null,autoApplied:Boolean(result?.autoApplied),rerunStatus:rerun?.status||null});
}
async function processTrigger(env,trigger){
  const sourceRun=await getRunByRunId(env,trigger.runId).catch(()=>null);
  if(String(sourceRun?.idempotencyKey||'').startsWith('test-evolution-rerun:')){
    log('test_evolution_trigger_skipped',{resultSetId:trigger.resultSetId,runId:trigger.runId,reason:'BOUNDED_RERUN_DEPTH_REACHED'});
    return;
  }
  const scope={env,organizationId:trigger.organizationId,projectId:trigger.projectId,userId:null};
  const policy=await getEvolutionPolicy(scope);if(policy?.mode==='OFF'){log('test_evolution_trigger_skipped',{resultSetId:trigger.resultSetId,reason:'PROJECT_MODE_OFF'});return;}
  const inspection=await inspectResultEvolution({...scope,resultSetId:trigger.resultSetId});
  const wanted=new Set(trigger.scenarioIds);const eligible=(inspection?.scenarios||[]).filter((scenario)=>wanted.has(scenario.scenarioId)&&scenario.eligible);
  if(!eligible.length){log('test_evolution_result_not_eligible',{resultSetId:trigger.resultSetId,responseScenarioCount:trigger.scenarioIds.length});return;}
  const organization=await getOrganizationById(env,trigger.organizationId);
  for(const scenario of eligible)await processEligibleScenario(env,trigger,scope,policy,organization,scenario);
}
export async function handleTestEvolutionQueue(batch,env){
  for(const message of batch.messages){const trigger=normalize(message.body);if(!trigger){log('test_evolution_trigger_invalid',{messageId:message.id||null});message.ack();continue;}try{await processTrigger(env,trigger);message.ack();}catch(error){log('test_evolution_trigger_failed',{resultSetId:trigger.resultSetId,code:error?.code||null,status:error?.status||null,retryable:retryable(error)});if(retryable(error))message.retry({delaySeconds:10});else message.ack();}}
}

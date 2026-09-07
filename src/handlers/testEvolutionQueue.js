import { getOrganizationById } from '../repositories/organizationRepository.js';
import {
  inspectResultEvolution,
  createEvolutionProposal,
  getEvolutionPolicy,
  getEvolutionProposalContext,
  assessEvolutionProposal,
  verifyEvolutionOutcome,
} from '../services/testEvolutionClient.js';
import { assessTestEvolutionWithAi } from '../services/testEvolutionAiService.js';
import { createEvolutionRerunV1 } from '../services/evolutionRerunService.js';
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
function parseEvolutionRerunKey(value){
  const text=String(value||'');
  const parts=text.split(':');
  if(parts.length!==3||parts[0]!=='test-evolution-rerun')return null;
  const proposalId=parts[1];const testDesignVersionId=parts[2];
  if(!proposalId.startsWith('tep_')||!testDesignVersionId.startsWith('tdv_'))return null;
  return {proposalId,testDesignVersionId};
}
async function createRerun(env,trigger,proposalId,result){
  const rec=result?.rerun;if(!rec?.requested)return null;
  try{
    const created=await createEvolutionRerunV1({
      env,
      organizationId:trigger.organizationId,
      projectId:trigger.projectId,
      userId:null,
      sourceRunId:rec.sourceRunId||result?.proposal?.source?.runId||trigger.runId||null,
      testDesignVersionId:rec.testDesignVersionId,
      environmentId:rec.environmentId,
      scenarioId:rec.scenarioId,
      idempotencyKey:`test-evolution-rerun:${proposalId}:${rec.testDesignVersionId}`,
    });
    return {
      status:'CREATED',
      runId:created?.run?.runId||null,
      runtimeReuse:created?.evolutionRuntimeReuse||null,
    };
  }catch(error){log('test_evolution_auto_rerun_create_failed',{proposalId,resultSetId:trigger.resultSetId,scenarioId:rec.scenarioId,sourceRunId:rec.sourceRunId||trigger.runId||null,code:error?.code||null});return {status:'CREATE_FAILED',errorCode:error?.code||'EVOLUTION_RERUN_CREATE_FAILED'};}
}
async function processEligibleScenario(env,trigger,scope,policy,organization,scenario){
  let proposal=await createEvolutionProposal({...scope,input:{resultSetId:trigger.resultSetId,scenarioResultId:scenario.scenarioResultId}});
  if(proposal?.assessment){
    let rerun=null;
    const wasAutoApplied=proposal.assessment.autoAction==='AUTO_APPLIED';
    if(wasAutoApplied&&proposal.status==='APPLIED'&&proposal.result?.testDesignVersionId&&policy?.autoRerun&&Number(policy?.maxEvolutionDepth||0)>=1){
      const context=await getEvolutionProposalContext({...scope,proposalId:proposal.proposalId});
      const method=String(context?.currentExecution?.http?.method||'').toUpperCase();
      if(['GET','HEAD','OPTIONS'].includes(method))rerun=await createRerun(env,trigger,proposal.proposalId,{proposal,rerun:{requested:true,testDesignVersionId:proposal.result.testDesignVersionId,environmentId:context?.source?.environmentId,scenarioId:proposal.source?.scenarioId,sourceRunId:proposal.source?.runId||trigger.runId||null}});
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
  let sourceRun;
  try{sourceRun=await getRunByRunId(env,trigger.runId);}catch(error){error.retryable=true;error.status=Number(error?.status||503);throw error;}
  if(!sourceRun){log('test_evolution_trigger_skipped',{resultSetId:trigger.resultSetId,runId:trigger.runId,reason:'RUN_METADATA_NOT_FOUND'});return;}
  if(sourceRun.organizationId!==trigger.organizationId||sourceRun.projectId!==trigger.projectId){log('test_evolution_trigger_skipped',{resultSetId:trigger.resultSetId,runId:trigger.runId,reason:'RUN_SCOPE_MISMATCH'});return;}
  const rerunLink=parseEvolutionRerunKey(sourceRun?.idempotencyKey);
  const scope={env,organizationId:trigger.organizationId,projectId:trigger.projectId,userId:null};
  if(rerunLink){
    const verification=await verifyEvolutionOutcome({...scope,proposalId:rerunLink.proposalId,input:{rerunRunId:trigger.runId,rerunResultSetId:trigger.resultSetId}});
    log('test_evolution_outcome_verified',{
      proposalId:rerunLink.proposalId,resultSetId:trigger.resultSetId,runId:trigger.runId,
      outcome:verification?.outcome||null,recoveryConfirmed:Boolean(verification?.recoveryConfirmed),reasonCode:verification?.reasonCode||null,
    });
    return;
  }
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

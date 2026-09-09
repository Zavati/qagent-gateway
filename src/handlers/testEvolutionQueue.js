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
import { recordLearningResultTrigger, recordLearningInspection, recordLearningProposal, recordLearningEvolutionVerification, recordHumanRepairRerunOutcome } from '../services/learningCycleService.js';

const CONTRACT='qagent.test-evolution-result-trigger.v1';
function log(type,data={}){console.log(JSON.stringify({type,time:new Date().toISOString(),...data}));}
function validId(value,prefix){return typeof value==='string'&&value.startsWith(prefix)&&value.length<=240;}
function normalizeMethod(value){const v=String(value??'').trim().toUpperCase();return /^[A-Z][A-Z0-9_-]{0,15}$/.test(v)?v:null;}
function normalizePath(value){const v=String(value??'').trim();return v&&v.length<=2048?v:null;}
export function normalizeTestEvolutionTrigger(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||body.contractVersion!==CONTRACT)return null;
  if(!validId(body.organizationId,'org_')||!validId(body.projectId,'prj_')||!validId(body.resultSetId,'rset_'))return null;
  const scenarioIds=Array.isArray(body.scenarioIds)?[...new Set(body.scenarioIds.map((v)=>String(v||'').trim()).filter((v)=>v&&v.length<=200))].slice(0,500):[];
  const wanted=new Set(scenarioIds);
  const scenarioSummaries=Array.isArray(body.scenarioSummaries)?body.scenarioSummaries.filter((x)=>x&&wanted.has(String(x.scenarioId||''))).slice(0,500).map((x)=>({scenarioId:String(x.scenarioId),scenarioResultId:validId(x.scenarioResultId,'sres_')?x.scenarioResultId:null,outcome:String(x.outcome||'').toUpperCase()||null,httpOutcome:String(x.httpOutcome||'').toUpperCase()||null,statusCode:Number.isFinite(Number(x.statusCode))?Number(x.statusCode):null,assertionFailedCount:Number.isFinite(Number(x.assertionFailedCount))?Math.max(0,Number(x.assertionFailedCount)):0,method:normalizeMethod(x.method),path:normalizePath(x.path)})):[];
  return scenarioIds.length?{organizationId:body.organizationId,projectId:body.projectId,resultSetId:body.resultSetId,runId:validId(body.runId,'run_')?body.runId:null,endpointId:validId(body.endpointId,'cep_')?body.endpointId:null,method:normalizeMethod(body.method),path:normalizePath(body.path),environmentId:validId(body.environmentId,'env_')?body.environmentId:null,testDesignVersionId:validId(body.testDesignVersionId,'tdv_')?body.testDesignVersionId:null,testDesignVersion:Number.isFinite(Number(body.testDesignVersion))?Number(body.testDesignVersion):null,scenarioIds,scenarioSummaries}:null;
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
function parseHumanRepairRerunKey(value){
  const text=String(value||'');
  const parts=text.split(':');
  if(parts.length!==3||parts[0]!=='human-request-repair-rerun')return null;
  const repairId=parts[1];const testDesignVersionId=parts[2];
  if(!repairId.startsWith('hrr_')||!testDesignVersionId.startsWith('tdv_'))return null;
  return {repairId,testDesignVersionId};
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
async function processEligibleScenario(env,trigger,scope,policy,organization,scenario,cycle){
  let proposal=await createEvolutionProposal({...scope,input:{resultSetId:trigger.resultSetId,scenarioResultId:scenario.scenarioResultId}});
  if(proposal?.assessment){
    let rerun=null;
    const wasAutoApplied=proposal.assessment.autoAction==='AUTO_APPLIED';
    if(wasAutoApplied&&proposal.status==='APPLIED'&&proposal.result?.testDesignVersionId&&policy?.autoRerun&&Number(policy?.maxEvolutionDepth||0)>=1){
      const context=await getEvolutionProposalContext({...scope,proposalId:proposal.proposalId});
      const method=String(context?.currentExecution?.http?.method||'').toUpperCase();
      if(['GET','HEAD','OPTIONS'].includes(method))rerun=await createRerun(env,trigger,proposal.proposalId,{proposal,rerun:{requested:true,testDesignVersionId:proposal.result.testDesignVersionId,environmentId:context?.source?.environmentId,scenarioId:proposal.source?.scenarioId,sourceRunId:proposal.source?.runId||trigger.runId||null}});
    }
    await recordLearningProposal(env,{cycle,trigger,scenario,result:{proposal,assessment:proposal.assessment},rerun}).catch(()=>{});
    log('test_evolution_trigger_idempotent',{resultSetId:trigger.resultSetId,scenarioId:scenario.scenarioId,proposalId:proposal.proposalId,status:proposal.status,assessmentId:proposal.assessment.assessmentId,autoAction:proposal.assessment.autoAction||null,rerunStatus:rerun?.status||null});return;
  }
  const context=await getEvolutionProposalContext({...scope,proposalId:proposal.proposalId});
  const reasoned=await assessTestEvolutionWithAi({env,accountId:organization?.legacyCustomerId||null,context});
  const result=await assessEvolutionProposal({...scope,proposalId:proposal.proposalId,input:{contextFingerprint:context.contextFingerprint,assessment:reasoned.assessment,ai:reasoned.ai}});
  const rerun=await createRerun(env,trigger,proposal.proposalId,result);
  await recordLearningProposal(env,{cycle,trigger,scenario,result,rerun}).catch(()=>{});
  log('test_evolution_trigger_processed',{resultSetId:trigger.resultSetId,scenarioId:scenario.scenarioId,proposalId:proposal.proposalId,classification:result?.assessment?.classification||null,decision:result?.assessment?.decision||null,confidence:result?.assessment?.confidence??null,riskScore:result?.assessment?.risk?.score??null,riskLevel:result?.assessment?.risk?.level||null,autoAction:result?.assessment?.autoAction||null,autoApplied:Boolean(result?.autoApplied),rerunStatus:rerun?.status||null});
}

async function processTrigger(env,trigger){
  let sourceRun;
  try{sourceRun=await getRunByRunId(env,trigger.runId);}catch(error){error.retryable=true;error.status=Number(error?.status||503);throw error;}
  if(!sourceRun){log('test_evolution_trigger_skipped',{resultSetId:trigger.resultSetId,runId:trigger.runId,reason:'RUN_METADATA_NOT_FOUND'});return;}
  if(sourceRun.organizationId!==trigger.organizationId||sourceRun.projectId!==trigger.projectId){log('test_evolution_trigger_skipped',{resultSetId:trigger.resultSetId,runId:trigger.runId,reason:'RUN_SCOPE_MISMATCH'});return;}
  const scope={env,organizationId:trigger.organizationId,projectId:trigger.projectId,userId:null};
  const humanRerunLink=parseHumanRepairRerunKey(sourceRun?.idempotencyKey);
  if(humanRerunLink){
    const summary=(trigger.scenarioSummaries||[])[0]||{scenarioId:trigger.scenarioIds[0]};
    await recordHumanRepairRerunOutcome(env,{runId:trigger.runId,summary}).catch(()=>{});
    log('human_request_repair_outcome_recorded',{repairId:humanRerunLink.repairId,resultSetId:trigger.resultSetId,runId:trigger.runId,outcome:summary?.outcome||null,statusCode:summary?.statusCode??null});
    return;
  }
  const rerunLink=parseEvolutionRerunKey(sourceRun?.idempotencyKey);
  if(rerunLink){
    const verification=await verifyEvolutionOutcome({...scope,proposalId:rerunLink.proposalId,input:{rerunRunId:trigger.runId,rerunResultSetId:trigger.resultSetId}});
    await recordLearningEvolutionVerification(env,{proposalId:rerunLink.proposalId,verification}).catch(()=>{});
    log('test_evolution_outcome_verified',{proposalId:rerunLink.proposalId,resultSetId:trigger.resultSetId,runId:trigger.runId,outcome:verification?.outcome||null,recoveryConfirmed:Boolean(verification?.recoveryConfirmed),reasonCode:verification?.reasonCode||null});
    return;
  }
  const cycle=await recordLearningResultTrigger(env,{trigger,sourceRun}).catch(()=>null);
  const policy=await getEvolutionPolicy(scope);
  if(policy?.mode==='OFF'){
    if(cycle){const synthetic={scenarios:trigger.scenarioIds.map((scenarioId)=>({scenarioId,eligible:false,reason:'PROJECT_MODE_OFF',requestIssueDetected:false}))};await recordLearningInspection(env,{cycle,trigger,inspection:synthetic}).catch(()=>{});}
    log('test_evolution_trigger_skipped',{resultSetId:trigger.resultSetId,reason:'PROJECT_MODE_OFF'});return;
  }
  const inspection=await inspectResultEvolution({...scope,resultSetId:trigger.resultSetId});
  await recordLearningInspection(env,{cycle,trigger,inspection}).catch(()=>{});
  const wanted=new Set(trigger.scenarioIds);const eligible=(inspection?.scenarios||[]).filter((scenario)=>wanted.has(scenario.scenarioId)&&scenario.eligible);
  if(!eligible.length){log('test_evolution_result_not_eligible',{resultSetId:trigger.resultSetId,scenarioCount:trigger.scenarioIds.length});return;}
  const organization=await getOrganizationById(env,trigger.organizationId);
  for(const scenario of eligible)await processEligibleScenario(env,trigger,scope,policy,organization,scenario,cycle);
}

export async function handleTestEvolutionQueue(batch,env){
  for(const message of batch.messages){const trigger=normalizeTestEvolutionTrigger(message.body);if(!trigger){log('test_evolution_trigger_invalid',{messageId:message.id||null});message.ack();continue;}try{await processTrigger(env,trigger);message.ack();}catch(error){log('test_evolution_trigger_failed',{resultSetId:trigger.resultSetId,code:error?.code||null,status:error?.status||null,retryable:retryable(error)});if(retryable(error))message.retry({delaySeconds:10});else message.ack();}}
}

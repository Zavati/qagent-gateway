import { sha256Hex } from '../lib/runContracts.js';
import { isTerminalSuiteRunStatus } from '../lib/suiteRunContracts.js';
import { getSuiteRunProgress, getSuiteRunContextByChildRunId, listSuiteRunChildRuns } from '../repositories/suiteRunRepository.js';
import {
  aggregateLearningCycle,
  appendLearningCycleEvent,
  ensureLearningCycle,
  getLearningCycleBySuiteRunId,
  getLearningScenarioByProposalId,
  getLearningScenarioBySource,
  hasLearningCycleEvent,
  listLearningCycleEvents,
  listLearningCycleSourceRunIds,
  listLearningScenarios,
  setLearningCycleStatus,
  updateLearningScenarioHumanOutcomeByRerun,
  updateLearningScenarioHumanRepair,
  updateLearningScenarioInspection,
  updateLearningScenarioProposal,
  updateLearningScenarioVerificationByProposal,
  upsertLearningScenario,
} from '../repositories/learningCycleRepository.js';
import { getResultsLatestRunResultSet } from './resultsReadClient.js';

const CONTRACT='qagent.continuous-learning-cycle.v1';
const TERMINAL_CYCLE=new Set(['WAITING_REVIEW','COMPLETED']);
function terminalSuite(status){return isTerminalSuiteRunStatus(status);}
function cycleIdForSuite(suiteRunId){return sha256Hex(`continuous-learning-cycle|${suiteRunId}`).then((h)=>`lcycle_${h.slice(0,48)}`);}
async function eventId(cycleId,eventKey){const h=await sha256Hex(`${cycleId}|${eventKey}`);return `lce_${h.slice(0,48)}`;}
async function scenarioId(cycleId,resultSetId,scenarioIdValue){const h=await sha256Hex(`${cycleId}|${resultSetId}|${scenarioIdValue}`);return `lcs_${h.slice(0,48)}`;}
function stateForInspection(summary,inspection){
  const sourceOutcome=String(summary?.outcome||'').toUpperCase();
  if(sourceOutcome==='PASSED')return 'HEALTHY';
  if(inspection?.eligible===true)return 'ANALYZED_ELIGIBLE';
  if(sourceOutcome==='FAILED'||sourceOutcome==='NOT_EVALUATED')return 'REVIEW_REQUIRED';
  return 'NO_EVOLUTION';
}
function stateForProposal(result,rerun){
  const proposal=result?.proposal||result;
  const assessment=result?.assessment||proposal?.assessment||null;
  if(assessment?.autoAction==='AUTO_APPLIED'){
    return rerun?.status==='CREATED'?'VERIFYING':'REVIEW_REQUIRED';
  }
  return 'REVIEW_REQUIRED';
}
function stateForVerification(outcome){
  if(outcome==='RECOVERED_BY_EVOLUTION')return 'RECOVERED_BY_EVOLUTION';
  if(outcome==='NOT_RECOVERED')return 'NOT_RECOVERED';
  return 'VERIFICATION_BLOCKED';
}
function stateForHumanOutcome(summary){
  const outcome=String(summary?.outcome||'').toUpperCase();
  const httpOutcome=String(summary?.httpOutcome||'').toUpperCase();
  const failed=Number(summary?.assertionFailedCount||0);
  if(outcome==='PASSED'&&httpOutcome==='RESPONSE'&&failed===0)return {state:'RECOVERED_BY_HUMAN_REPAIR',outcome:'RECOVERED_BY_HUMAN_REPAIR',reasonCode:'HUMAN_REPAIR_RERUN_PASSED'};
  if(outcome==='FAILED'&&httpOutcome==='RESPONSE')return {state:'HUMAN_REPAIR_NOT_RECOVERED',outcome:'NOT_RECOVERED',reasonCode:'HUMAN_REPAIR_RERUN_FAILED_ASSERTIONS'};
  return {state:'HUMAN_VERIFICATION_BLOCKED',outcome:'VERIFICATION_BLOCKED',reasonCode:httpOutcome==='TIMEOUT'?'HUMAN_REPAIR_RERUN_TIMEOUT':httpOutcome==='NETWORK_ERROR'?'HUMAN_REPAIR_RERUN_NETWORK_ERROR':'HUMAN_REPAIR_RERUN_NOT_VERIFIABLE'};
}

export function isTerminalLearningCycleStatus(status){return TERMINAL_CYCLE.has(String(status||''));}

export function determineLearningCycleStatus({suiteStatus,expectedResultSetCount=0,resultSetCount=0,pendingAnalysisCount=0,pendingVerificationCount=0,attentionCount=0,errorUnits=0}={}){
  if(!terminalSuite(suiteStatus))return 'COLLECTING';
  const missingResults=Math.max(0,Number(expectedResultSetCount||0)-Number(resultSetCount||0));
  if(Number(pendingAnalysisCount||0)+missingResults>0)return 'ANALYZING';
  if(Number(pendingVerificationCount||0)>0)return 'VERIFYING';
  if(Number(attentionCount||0)>0||Number(errorUnits||0)>0)return 'WAITING_REVIEW';
  return 'COMPLETED';
}

export async function ensureLearningCycleForSuiteRun(env,suiteRun){
  if(!suiteRun?.suiteRunId)return null;
  const learningCycleId=await cycleIdForSuite(suiteRun.suiteRunId);
  const cycle=await ensureLearningCycle(env,{learningCycleId,organizationId:suiteRun.organizationId,projectId:suiteRun.projectId,suiteRunId:suiteRun.suiteRunId,suiteVersionId:suiteRun.suiteVersionId,suiteVersion:suiteRun.suiteVersion,environmentId:suiteRun.environmentId,now:suiteRun.createdAt||new Date().toISOString()});
  await appendLearningCycleEvent(env,{eventId:await eventId(cycle.learningCycleId,'CYCLE_CREATED'),learningCycleId:cycle.learningCycleId,organizationId:cycle.organizationId,projectId:cycle.projectId,eventType:'CYCLE_CREATED',eventKey:'CYCLE_CREATED',metadata:{suiteRunId:cycle.suiteRunId,suiteVersionId:cycle.suiteVersionId}}).catch(()=>{});
  return cycle;
}

export async function recordLearningResultTrigger(env,{trigger,sourceRun}){
  const link=await getSuiteRunContextByChildRunId(env,sourceRun.runId);
  if(!link?.suiteRun)return null;
  const cycle=await ensureLearningCycleForSuiteRun(env,link.suiteRun);
  const summaries=Array.isArray(trigger.scenarioSummaries)&&trigger.scenarioSummaries.length?trigger.scenarioSummaries:trigger.scenarioIds.map((scenarioIdValue)=>({scenarioId:scenarioIdValue}));
  for(const summary of summaries){
    if(!summary?.scenarioId)continue;
    const learningScenarioId=await scenarioId(cycle.learningCycleId,trigger.resultSetId,summary.scenarioId);
    const item=await upsertLearningScenario(env,{learningScenarioId,learningCycleId:cycle.learningCycleId,organizationId:cycle.organizationId,projectId:cycle.projectId,resultSetId:trigger.resultSetId,runId:sourceRun.runId,scenarioResultId:summary.scenarioResultId||null,scenarioId:summary.scenarioId,endpointId:trigger.endpointId||sourceRun.endpointId||null,testDesignVersionId:trigger.testDesignVersionId||sourceRun.testDesignVersionId||null,testDesignVersion:trigger.testDesignVersion??sourceRun.testDesignVersion??null,outcome:summary.outcome||null,httpOutcome:summary.httpOutcome||null,statusCode:summary.statusCode??null,assertionFailedCount:summary.assertionFailedCount||0});
    await appendLearningCycleEvent(env,{eventId:await eventId(cycle.learningCycleId,`RESULT:${trigger.resultSetId}:${summary.scenarioId}`),learningCycleId:cycle.learningCycleId,learningScenarioId:item.learningScenarioId,organizationId:cycle.organizationId,projectId:cycle.projectId,eventType:'RESULT_RECEIVED',eventKey:`RESULT:${trigger.resultSetId}:${summary.scenarioId}`,metadata:{runId:sourceRun.runId,resultSetId:trigger.resultSetId,scenarioId:summary.scenarioId,outcome:summary.outcome||null,statusCode:summary.statusCode??null}}).catch(()=>{});
  }
  await refreshLearningCycleState(env,{organizationId:cycle.organizationId,projectId:cycle.projectId,suiteRunId:cycle.suiteRunId});
  return cycle;
}

export async function recordLearningInspection(env,{cycle,trigger,inspection}){
  if(!cycle)return;
  const summaryById=new Map((trigger.scenarioSummaries||[]).map((x)=>[x.scenarioId,x]));
  const wanted=new Set(trigger.scenarioIds||[]);
  for(const item of inspection?.scenarios||[]){
    if(!wanted.has(item.scenarioId))continue;
    const state=stateForInspection(summaryById.get(item.scenarioId),item);
    await updateLearningScenarioInspection(env,{learningCycleId:cycle.learningCycleId,resultSetId:trigger.resultSetId,scenarioId:item.scenarioId,eligible:item.eligible===true,reason:item.reason||null,requestIssueDetected:item.requestIssueDetected===true,effectiveState:state});
    await appendLearningCycleEvent(env,{eventId:await eventId(cycle.learningCycleId,`INSPECTION:${trigger.resultSetId}:${item.scenarioId}`),learningCycleId:cycle.learningCycleId,organizationId:cycle.organizationId,projectId:cycle.projectId,eventType:'SCENARIO_ANALYZED',eventKey:`INSPECTION:${trigger.resultSetId}:${item.scenarioId}`,metadata:{eligible:item.eligible===true,reason:item.reason||null,requestIssueDetected:item.requestIssueDetected===true}}).catch(()=>{});
  }
  await refreshLearningCycleState(env,{organizationId:cycle.organizationId,projectId:cycle.projectId,suiteRunId:cycle.suiteRunId});
}

export async function recordLearningProposal(env,{cycle,trigger,scenario,result,rerun}){
  if(!cycle)return;
  const proposal=result?.proposal||result;
  const assessment=result?.assessment||proposal?.assessment||null;
  const effectiveState=stateForProposal(result,rerun);
  await updateLearningScenarioProposal(env,{learningCycleId:cycle.learningCycleId,resultSetId:trigger.resultSetId,scenarioId:scenario.scenarioId,proposalId:proposal?.proposalId||null,classification:assessment?.classification||null,decision:assessment?.decision||null,confidence:assessment?.confidence??null,riskScore:assessment?.risk?.score??null,riskLevel:assessment?.risk?.level||null,autoAction:assessment?.autoAction||null,evolvedTestDesignVersionId:proposal?.result?.testDesignVersionId||null,evolvedTestDesignVersion:proposal?.result?.testDesignVersion??null,evolutionRerunRunId:rerun?.runId||null,effectiveState});
  await appendLearningCycleEvent(env,{eventId:await eventId(cycle.learningCycleId,`PROPOSAL:${proposal?.proposalId||trigger.resultSetId+':'+scenario.scenarioId}`),learningCycleId:cycle.learningCycleId,organizationId:cycle.organizationId,projectId:cycle.projectId,eventType:'EVOLUTION_DECIDED',eventKey:`PROPOSAL:${proposal?.proposalId||trigger.resultSetId+':'+scenario.scenarioId}`,metadata:{proposalId:proposal?.proposalId||null,classification:assessment?.classification||null,decision:assessment?.decision||null,autoAction:assessment?.autoAction||null,rerunStatus:rerun?.status||null}}).catch(()=>{});
  await refreshLearningCycleState(env,{organizationId:cycle.organizationId,projectId:cycle.projectId,suiteRunId:cycle.suiteRunId});
}

export async function recordLearningEvolutionVerification(env,{proposalId,verification}){
  const row=await getLearningScenarioByProposalId(env,proposalId);
  if(!row)return null;
  const updated=await updateLearningScenarioVerificationByProposal(env,{proposalId,outcome:verification?.outcome||null,reasonCode:verification?.reasonCode||null,rerunRunId:verification?.rerun?.runId||null,effectiveState:stateForVerification(verification?.outcome)});
  await appendLearningCycleEvent(env,{eventId:await eventId(row.learningCycleId,`VERIFY:${proposalId}`),learningCycleId:row.learningCycleId,learningScenarioId:row.learningScenarioId,organizationId:row.organizationId,projectId:row.projectId,eventType:'EVOLUTION_VERIFIED',eventKey:`VERIFY:${proposalId}`,metadata:{proposalId,outcome:verification?.outcome||null,reasonCode:verification?.reasonCode||null,rerunRunId:verification?.rerun?.runId||null}}).catch(()=>{});
  const cycle=await getCycleByIdUnsafe(env,row);
  if(cycle)await refreshLearningCycleState(env,{organizationId:row.organizationId,projectId:row.projectId,suiteRunId:cycle.suiteRunId});
  return updated;
}
async function getCycleByIdUnsafe(env,row){
  // Avoid another exported repository dependency in callers; all rows are suite scoped.
  const db=env?.QAGENT_DB;if(!db?.prepare)return null;
  const cycle=await db.prepare(`SELECT suite_run_id AS suiteRunId FROM continuous_learning_cycles WHERE learning_cycle_id=? LIMIT 1`).bind(row.learningCycleId).first();return cycle||null;
}

export async function recordHumanRepairInLearningCycle(env,{organizationId,projectId,resultSetId,scenarioId,repairId,testDesignVersionId,testDesignVersion,rerunRunId=null}){
  const db=env?.QAGENT_DB;if(!db?.prepare)return null;
  const row=await db.prepare(`SELECT learning_cycle_id AS learningCycleId FROM continuous_learning_scenarios WHERE organization_id=? AND project_id=? AND source_result_set_id=? AND scenario_id=? LIMIT 1`).bind(organizationId,projectId,resultSetId,scenarioId).first();
  if(!row)return null;
  const effectiveState=rerunRunId?'HUMAN_VERIFYING':'REVIEW_REQUIRED';
  const updated=await updateLearningScenarioHumanRepair(env,{learningCycleId:row.learningCycleId,resultSetId,scenarioId,repairId,testDesignVersionId,testDesignVersion,humanRerunRunId:rerunRunId,effectiveState});
  await appendLearningCycleEvent(env,{eventId:await eventId(row.learningCycleId,`HUMAN_REPAIR:${repairId}`),learningCycleId:row.learningCycleId,learningScenarioId:updated?.learningScenarioId||null,organizationId,projectId,eventType:'HUMAN_REPAIR_APPLIED',eventKey:`HUMAN_REPAIR:${repairId}`,metadata:{repairId,testDesignVersionId,testDesignVersion,rerunRunId}}).catch(()=>{});
  const cycle=await getCycleByIdUnsafe(env,{learningCycleId:row.learningCycleId});
  if(cycle)await refreshLearningCycleState(env,{organizationId,projectId,suiteRunId:cycle.suiteRunId});
  return updated;
}

export async function recordHumanRepairRerunOutcome(env,{runId,summary}){
  const verdict=stateForHumanOutcome(summary);
  const updated=await updateLearningScenarioHumanOutcomeByRerun(env,{humanRerunRunId:runId,effectiveState:verdict.state,verificationOutcome:verdict.outcome,reasonCode:verdict.reasonCode});
  if(!updated)return null;
  await appendLearningCycleEvent(env,{eventId:await eventId(updated.learningCycleId,`HUMAN_VERIFY:${runId}`),learningCycleId:updated.learningCycleId,learningScenarioId:updated.learningScenarioId,organizationId:updated.organizationId,projectId:updated.projectId,eventType:'HUMAN_REPAIR_VERIFIED',eventKey:`HUMAN_VERIFY:${runId}`,metadata:{runId,outcome:verdict.outcome,reasonCode:verdict.reasonCode}}).catch(()=>{});
  const cycle=await getCycleByIdUnsafe(env,updated);if(cycle)await refreshLearningCycleState(env,{organizationId:updated.organizationId,projectId:updated.projectId,suiteRunId:cycle.suiteRunId});
  return updated;
}

export function buildLearningReconciliationTrigger({organizationId,projectId,runId,data}){
  const resultSet=data?.resultSet;
  const summaries=(Array.isArray(data?.scenarios)?data.scenarios:[]).map((scenario)=>({
    scenarioId:String(scenario?.scenarioId||'').trim(),
    scenarioResultId:scenario?.scenarioResultId||null,
    outcome:scenario?.outcome||null,
    httpOutcome:scenario?.http?.outcome||null,
    statusCode:scenario?.http?.statusCode??null,
    assertionFailedCount:Number(scenario?.assertionFailedCount||0),
  })).filter((scenario)=>scenario.scenarioId).slice(0,500);
  if(!resultSet?.resultSetId||!summaries.length)return null;
  return {contractVersion:'qagent.test-evolution-result-trigger.v1',organizationId,projectId,resultSetId:resultSet.resultSetId,runId,endpointId:resultSet.endpointId||null,environmentId:resultSet.environmentId||null,testDesignVersionId:resultSet.testDesignVersionId||null,testDesignVersion:resultSet.testDesignVersion??null,scenarioIds:summaries.map((x)=>x.scenarioId),scenarioSummaries:summaries,createdAt:new Date().toISOString()};
}

async function reconcileMissingLearningTriggers(env,{cycle,state,missingResults}){
  if(missingResults<=0||!terminalSuite(state?.suiteRun?.status))return 0;
  const queue=env?.TEST_EVOLUTION_QUEUE;if(!queue?.send)return 0;
  const tracked=await listLearningCycleSourceRunIds(env,cycle.learningCycleId);
  const children=await listSuiteRunChildRuns(env,cycle.organizationId,cycle.projectId,cycle.suiteRunId,{limit:1000});
  const candidates=children.filter((child)=>child.runId&&['PASSED','FAILED'].includes(String(child.runStatus||''))&&!tracked.has(child.runId)).slice(0,Math.min(12,missingResults));
  let queued=0;
  for(const child of candidates){
    let data;
    try{data=await getResultsLatestRunResultSet({env,organizationId:cycle.organizationId,projectId:cycle.projectId,runId:child.runId});}
    catch(error){if(Number(error?.status)===404)continue;console.warn(JSON.stringify({type:'continuous_learning_reconciliation_read_failed',suiteRunId:cycle.suiteRunId,runId:child.runId,code:error?.code||null}));continue;}
    const trigger=buildLearningReconciliationTrigger({organizationId:cycle.organizationId,projectId:cycle.projectId,runId:child.runId,data});
    if(!trigger)continue;
    const eventKey=`RECONCILE_TRIGGER:${trigger.resultSetId}`;
    if(await hasLearningCycleEvent(env,cycle.learningCycleId,eventKey))continue;
    try{
      await queue.send(trigger);
      await appendLearningCycleEvent(env,{eventId:await eventId(cycle.learningCycleId,eventKey),learningCycleId:cycle.learningCycleId,organizationId:cycle.organizationId,projectId:cycle.projectId,eventType:'RESULT_TRIGGER_RECONCILED',eventKey,metadata:{runId:child.runId,resultSetId:trigger.resultSetId,scenarioCount:trigger.scenarioIds.length}});
      queued+=1;
    }catch(error){console.warn(JSON.stringify({type:'continuous_learning_reconciliation_queue_failed',suiteRunId:cycle.suiteRunId,runId:child.runId,resultSetId:trigger.resultSetId,code:error?.code||null}));}
  }
  return queued;
}

function publicSummary(cycle,agg,state){
  const c=state?.counts||{},run=state?.suiteRun||{};
  const expectedResultSets=Number(c.passed||0)+Number(c.failed||0);
  return {
    contractVersion:CONTRACT,
    learningCycleId:cycle.learningCycleId,
    suiteRunId:cycle.suiteRunId,
    suiteVersionId:cycle.suiteVersionId,
    suiteVersion:cycle.suiteVersion,
    environmentId:cycle.environmentId,
    status:cycle.status,
    settled:isTerminalLearningCycleStatus(cycle.status),
    execution:{
      suiteRunStatus:run.status||null,
      totalExecutionUnits:Number(run.executionUnitCount||run.endpointCount||0),
      completedExecutionUnits:Number(c.passed||0)+Number(c.failed||0)+Number(c.error||0)+Number(c.cancelled||0)+Number(c.createError||0),
      passedUnits:Number(c.passed||0),failedUnits:Number(c.failed||0),errorUnits:Number(c.error||0)+Number(c.createError||0),cancelledUnits:Number(c.cancelled||0),
      expectedResultSetCount:expectedResultSets,resultSetCount:agg.result_set_count||0,
    },
    learning:{
      scenarioCount:agg.scenario_count||0,
      responseScenarioCount:agg.response_scenario_count||0,
      initialPassedCount:agg.initial_passed||0,
      initialFailedCount:agg.initial_failed||0,
      initialNotEvaluatedCount:agg.initial_not_evaluated||0,
      analyzedCount:agg.analyzed_count||0,
      pendingAnalysisCount:agg.pending_analysis_count||0,
      eligibleCount:agg.eligible_count||0,
      proposalCount:agg.proposal_count||0,
      autoAppliedCount:agg.auto_applied_count||0,
      attentionRequiredCount:agg.attention_count||0,
      healthyCount:agg.healthy_count||0,
    },
    classifications:{
      expectedBehaviorLearned:agg.expected_behavior_learned_count||0,
      expectationDrift:agg.expectation_drift_count||0,
      testDataDrift:agg.test_data_drift_count||0,
      applicationBugSuspected:agg.application_bug_suspected_count||0,
      runtimeFailure:agg.runtime_failure_count||0,
      inconclusive:agg.inconclusive_count||0,
    },
    verification:{
      pendingCount:agg.pending_verification_count||0,
      recoveredByEvolutionCount:agg.recovered_evolution_count||0,
      notRecoveredCount:agg.not_recovered_count||0,
      blockedCount:agg.verification_blocked_count||0,
    },
    human:{
      repairCount:agg.human_repair_count||0,
      recoveredCount:agg.recovered_human_count||0,
      notRecoveredCount:agg.human_not_recovered_count||0,
      verificationBlockedCount:agg.human_verification_blocked_count||0,
    },
    startedAt:cycle.startedAt,
    settledAt:cycle.settledAt||null,
    completedAt:cycle.completedAt||null,
    updatedAt:cycle.updatedAt,
  };
}

export async function refreshLearningCycleState(env,{organizationId,projectId,suiteRunId}){
  const cycle=await getLearningCycleBySuiteRunId(env,organizationId,projectId,suiteRunId);if(!cycle)return null;
  const state=await getSuiteRunProgress(env,organizationId,projectId,suiteRunId,{limit:1});if(!state)return null;
  const agg=await aggregateLearningCycle(env,cycle.learningCycleId);
  const expectedResultSets=Number(state.counts?.passed||0)+Number(state.counts?.failed||0);
  const missingResults=Math.max(0,expectedResultSets-Number(agg.result_set_count||0));
  if(missingResults>0)await reconcileMissingLearningTriggers(env,{cycle,state,missingResults}).catch(()=>0);
  const pendingAnalysis=Number(agg.pending_analysis_count||0)+missingResults;
  const pendingVerification=Number(agg.pending_verification_count||0);
  const attention=Number(agg.attention_count||0);
  const errorUnits=Number(state.counts?.error||0)+Number(state.counts?.createError||0)+Number(state.counts?.cancelled||0);
  const status=determineLearningCycleStatus({suiteStatus:state.suiteRun.status,expectedResultSetCount:expectedResultSets,resultSetCount:agg.result_set_count,pendingAnalysisCount:agg.pending_analysis_count,pendingVerificationCount:pendingVerification,attentionCount:attention,errorUnits});
  const settled=status==='WAITING_REVIEW'||status==='COMPLETED';
  const completed=status==='COMPLETED';
  const updatedCycle=cycle.status===status&&Boolean(cycle.settledAt)===settled?cycle:await setLearningCycleStatus(env,{organizationId,projectId,learningCycleId:cycle.learningCycleId,status,settled,completed});
  if(updatedCycle.status!==cycle.status){const transitionKey=`STATUS:${cycle.status}:${status}:${updatedCycle.updatedAt}`;await appendLearningCycleEvent(env,{eventId:await eventId(cycle.learningCycleId,transitionKey),learningCycleId:cycle.learningCycleId,organizationId,projectId,eventType:'CYCLE_STATUS_CHANGED',eventKey:transitionKey,metadata:{from:cycle.status,to:status,pendingAnalysis,pendingVerification,attention,missingResults}}).catch(()=>{});}
  return publicSummary(updatedCycle,agg,state);
}

export async function getLearningCycleCompactV1({env,organizationId,projectId,suiteRunId}){
  return refreshLearningCycleState(env,{organizationId,projectId,suiteRunId});
}

export async function getLearningCycleDetailV1({env,organizationId,projectId,suiteRunId,limit=80}){
  const summary=await refreshLearningCycleState(env,{organizationId,projectId,suiteRunId});if(!summary)return null;
  const cycle=await getLearningCycleBySuiteRunId(env,organizationId,projectId,suiteRunId);
  const [items,events]=await Promise.all([listLearningScenarios(env,{organizationId,projectId,learningCycleId:cycle.learningCycleId,limit}),listLearningCycleEvents(env,{organizationId,projectId,learningCycleId:cycle.learningCycleId,limit:30})]);
  return {...summary,items:items.map((x)=>({learningScenarioId:x.learningScenarioId,resultSetId:x.sourceResultSetId,runId:x.sourceRunId,scenarioResultId:x.sourceScenarioResultId,scenarioId:x.scenarioId,endpointId:x.endpointId,sourceTestDesignVersionId:x.sourceTestDesignVersionId,sourceTestDesignVersion:x.sourceTestDesignVersion,sourceOutcome:x.sourceOutcome,httpOutcome:x.httpOutcome,statusCode:x.statusCode,assertionFailedCount:x.assertionFailedCount,inspection:{state:x.inspectionState,eligible:x.inspectionEligible,reason:x.inspectionReason,requestIssueDetected:x.requestIssueDetected},evolution:{proposalId:x.proposalId,classification:x.classification,decision:x.decision,confidence:x.confidence,riskScore:x.riskScore,riskLevel:x.riskLevel,autoAction:x.autoAction,evolvedTestDesignVersionId:x.evolvedTestDesignVersionId,evolvedTestDesignVersion:x.evolvedTestDesignVersion,rerunRunId:x.evolutionRerunRunId},verification:{outcome:x.verificationOutcome,reasonCode:x.verificationReasonCode},humanRepair:x.humanRepairId?{repairId:x.humanRepairId,testDesignVersionId:x.humanRepairTestDesignVersionId,testDesignVersion:x.humanRepairTestDesignVersion,rerunRunId:x.humanRerunRunId}:null,effectiveState:x.effectiveState,updatedAt:x.updatedAt})),itemsTruncated:(summary.learning.scenarioCount||0)>items.length,events};
}

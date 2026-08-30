import { requireDataDb } from '../repositories/dataDb.js';
import { sha256Hex } from '../lib/runContracts.js';
import { getProjectEnvironment } from './environmentService.js';
import { resolveSingleMutationPolicy } from './mutationExecutionPolicyService.js';
import { getMutationPolicyVersion } from '../repositories/mutationExecutionPolicyRepository.js';
import { getMutationJournal,listMutationJournalsByRun,prepareMutationJournal,recordMutationDispatching,transitionMutationJournal } from '../repositories/mutationExecutionJournalRepository.js';

async function suiteContextForRun(env,runId){const db=requireDataDb(env);return await db.prepare(`SELECT sr.suite_run_id AS suiteRunId,sr.confirm_production_mutation AS confirmProductionMutation,u.execution_kind AS executionKind,u.decision,u.policy_version_id AS policyVersionId,u.retry_mode AS retryMode FROM suite_run_children c JOIN suite_runs sr ON sr.suite_run_id=c.suite_run_id LEFT JOIN suite_run_execution_units u ON u.suite_run_id=c.suite_run_id AND u.ordinal=c.ordinal WHERE c.run_id=? LIMIT 1`).bind(runId).first();}
async function deterministicIdempotencyKey(mutationExecutionId){return `qagent-${(await sha256Hex(mutationExecutionId)).slice(0,48)}`;}
async function resolvePinnedOrCurrentPolicy({env,run,input,suiteContext}){
  const environment=await getProjectEnvironment(env,run.organizationId,run.projectId,run.environmentId);
  if(suiteContext?.executionKind==='MUTATION_SINGLE'){
    if(suiteContext.decision!=='EXECUTE'||!suiteContext.policyVersionId)return {environment,policy:{executionDecision:'DENY',reason:'SUITE_MUTATION_POLICY_NOT_PINNED',policyVersionId:null,retryMode:'NO_AUTOMATIC_RETRY',idempotencyHeaderName:null,productionConfirmation:false}};
    const version=await getMutationPolicyVersion(env,suiteContext.policyVersionId);
    if(!version||version.organizationId!==run.organizationId||version.projectId!==run.projectId||version.environmentId!==run.environmentId||version.endpointId!==run.endpointId||version.method!==input.method){return {environment,policy:{executionDecision:'DENY',reason:'SUITE_MUTATION_POLICY_VERSION_INVALID',policyVersionId:suiteContext.policyVersionId,retryMode:'NO_AUTOMATIC_RETRY',idempotencyHeaderName:null,productionConfirmation:false}};}
    return {environment,policy:{...version,executionDecision:version.executionDecision==='ALLOW'?'ALLOW':'DENY',reason:version.executionDecision==='ALLOW'?null:(version.reason||'POLICY_DENIED')}};
  }
  return resolveSingleMutationPolicy({env,organizationId:run.organizationId,projectId:run.projectId,environmentId:run.environmentId,endpointId:run.endpointId,method:input.method});
}
function replayDecision(journal){
  if(journal.state==='PREPARED')return {allow:true,retry:false};
  if(journal.state==='FAILED_BEFORE_DISPATCH')return {allow:true,rearm:true,retry:true};
  if(journal.state==='DISPATCHING'&&journal.retryMode==='IDEMPOTENCY_HEADER')return {allow:true,retry:true,redispatch:true};
  if(journal.state==='DISPATCHING')return {allow:false,reason:'MUTATION_SIDE_EFFECT_UNKNOWN',markUnknown:true};
  if(journal.state==='UNKNOWN_SIDE_EFFECT')return {allow:false,reason:'MUTATION_SIDE_EFFECT_UNKNOWN'};
  if(journal.state==='RESPONSE_RECEIVED'||journal.state==='ASSERTED')return {allow:false,reason:'MUTATION_RESPONSE_NOT_REPLAYABLE'};
  if(journal.state==='COMPLETED')return {allow:false,reason:'MUTATION_ALREADY_COMPLETED'};
  if(journal.state==='POLICY_DENIED')return {allow:false,reason:journal.lastErrorCode||'MUTATION_POLICY_DENIED'};
  return {allow:false,reason:'MUTATION_JOURNAL_STATE_INVALID'};
}
export async function preflightMutationExecution({env,bundle,input}){
  const run=bundle.run;const suiteContext=await suiteContextForRun(env,run.runId);let existing=await getMutationJournal(env,run.runId,input.scenarioId);
  if(existing){
    if(existing.requestFingerprint!==input.requestFingerprint||existing.method!==input.method||existing.canonicalPath!==input.canonicalPath){const e=new Error('Mutation Journal replay divergiu do request fingerprint.');e.code='MUTATION_JOURNAL_CONFLICT';e.status=409;throw e;}
    const resume=replayDecision(existing);
    if(resume.markUnknown){existing=await transitionMutationJournal(env,{runId:run.runId,scenarioId:input.scenarioId,mutationExecutionId:existing.mutationExecutionId,attemptId:input.attemptId,toState:'UNKNOWN_SIDE_EFFECT',eventCode:'REDELIVERY_AFTER_UNCERTAIN_DISPATCH',lastErrorCode:'MUTATION_SIDE_EFFECT_UNKNOWN',networkDispatchMayHaveOccurred:true});}
    if(resume.rearm){existing=await transitionMutationJournal(env,{runId:run.runId,scenarioId:input.scenarioId,mutationExecutionId:existing.mutationExecutionId,attemptId:input.attemptId,toState:'PREPARED',eventCode:'RETRY_PREPARED',lastErrorCode:null,networkDispatchMayHaveOccurred:false});}
    return {contractVersion:'qagent.runner-mutation-preflight-result.v1',decision:resume.allow?'ALLOW':'DENY',reason:resume.allow?null:resume.reason,environmentType:null,mutationExecutionId:existing.mutationExecutionId,policyVersionId:existing.policyVersionId||null,retryMode:existing.retryMode||'NO_AUTOMATIC_RETRY',idempotencyHeaderName:existing.idempotencyHeaderName||null,idempotencyKeyHash:existing.idempotencyKeyHash||null,journalState:existing.state,retry:resume.retry===true,created:false};
  }
  const {environment,policy}=await resolvePinnedOrCurrentPolicy({env,run,input,suiteContext});let allowed=policy.executionDecision==='ALLOW';let reason=policy.reason||null;
  if(environment.environmentType==='PROD' && (policy.productionConfirmation!==true || Number(suiteContext?.confirmProductionMutation)!==1)){allowed=false;reason=policy.productionConfirmation!==true?'PRODUCTION_POLICY_CONFIRMATION_REQUIRED':'PRODUCTION_RUN_CONFIRMATION_REQUIRED';}
  const state=allowed?'PREPARED':'POLICY_DENIED';const mutationExecutionId=`mex_${crypto.randomUUID()}`;let idempotencyKeyHash=null;
  if(allowed&&policy.retryMode==='IDEMPOTENCY_HEADER'){idempotencyKeyHash=await sha256Hex(await deterministicIdempotencyKey(mutationExecutionId));}
  const result=await prepareMutationJournal(env,{mutationExecutionId,organizationId:run.organizationId,projectId:run.projectId,environmentId:run.environmentId,endpointId:run.endpointId,runId:run.runId,scenarioId:input.scenarioId,attemptId:input.attemptId,testDesignVersionId:run.testDesignVersionId,method:input.method,canonicalPath:input.canonicalPath,policyVersionId:policy.policyVersionId||null,retryMode:policy.retryMode||'NO_AUTOMATIC_RETRY',idempotencyHeaderName:policy.idempotencyHeaderName||null,idempotencyKeyHash,requestFingerprint:input.requestFingerprint,state,lastErrorCode:allowed?null:(reason||'MUTATION_POLICY_DENIED')});
  return {contractVersion:'qagent.runner-mutation-preflight-result.v1',decision:allowed?'ALLOW':'DENY',reason:allowed?null:(reason||'MUTATION_POLICY_DENIED'),environmentType:environment.environmentType,mutationExecutionId:result.journal.mutationExecutionId,policyVersionId:policy.policyVersionId||null,retryMode:policy.retryMode||'NO_AUTOMATIC_RETRY',idempotencyHeaderName:policy.idempotencyHeaderName||null,idempotencyKeyHash,journalState:result.journal.state,retry:false,created:result.created};
}
export async function markMutationDispatching({env,runId,scenarioId,mutationExecutionId,attemptId,dispatchFingerprint,idempotencyKeyHash}){return recordMutationDispatching(env,{runId,scenarioId,mutationExecutionId,attemptId,dispatchFingerprint,idempotencyKeyHash});}
export async function markMutationResponseReceived({env,runId,scenarioId,mutationExecutionId,attemptId,httpStatusCode}){return transitionMutationJournal(env,{runId,scenarioId,mutationExecutionId,attemptId,toState:'RESPONSE_RECEIVED',eventCode:'RESPONSE_RECEIVED',httpStatusCode,networkDispatchMayHaveOccurred:true});}
export async function markMutationCompleted({env,runId,scenarioId,mutationExecutionId,attemptId,assertionOutcome}){return transitionMutationJournal(env,{runId,scenarioId,mutationExecutionId,attemptId,toState:'COMPLETED',eventCode:'COMPLETED',assertionOutcome});}
export async function markMutationUnknown({env,runId,scenarioId,mutationExecutionId,attemptId,lastErrorCode}){return transitionMutationJournal(env,{runId,scenarioId,mutationExecutionId,attemptId,toState:'UNKNOWN_SIDE_EFFECT',eventCode:'UNKNOWN_SIDE_EFFECT',lastErrorCode,networkDispatchMayHaveOccurred:true});}
export async function markMutationFailedBeforeDispatch({env,runId,scenarioId,mutationExecutionId,attemptId,lastErrorCode}){return transitionMutationJournal(env,{runId,scenarioId,mutationExecutionId,attemptId,toState:'FAILED_BEFORE_DISPATCH',eventCode:'FAILED_BEFORE_DISPATCH',lastErrorCode,networkDispatchMayHaveOccurred:false});}

export async function reconcileMutationJournalsAfterDlq({env,runId,attemptId=null,errorCode='RUNNER_QUEUE_DLQ_EXHAUSTED'}){
  const journals=await listMutationJournalsByRun(env,runId);const summary={count:journals.length,failedBeforeDispatch:0,unknownSideEffect:0,unchanged:0};
  for(const journal of journals){
    if(journal.state==='PREPARED'){await transitionMutationJournal(env,{runId,scenarioId:journal.scenarioId,mutationExecutionId:journal.mutationExecutionId,attemptId:attemptId||journal.latestAttemptId,toState:'FAILED_BEFORE_DISPATCH',eventCode:'DLQ_TERMINAL_BEFORE_DISPATCH',lastErrorCode:errorCode,networkDispatchMayHaveOccurred:false});summary.failedBeforeDispatch++;continue;}
    if(journal.state==='DISPATCHING'){await transitionMutationJournal(env,{runId,scenarioId:journal.scenarioId,mutationExecutionId:journal.mutationExecutionId,attemptId:attemptId||journal.latestAttemptId,toState:'UNKNOWN_SIDE_EFFECT',eventCode:'DLQ_TERMINAL_AFTER_DISPATCH',lastErrorCode:'MUTATION_SIDE_EFFECT_UNKNOWN',networkDispatchMayHaveOccurred:true});summary.unknownSideEffect++;continue;}
    summary.unchanged++;
  }
  return summary;
}

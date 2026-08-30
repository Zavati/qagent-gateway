import { requireDataDb } from '../repositories/dataDb.js';
import { sha256Hex } from '../lib/runContracts.js';
import { resolveSingleMutationPolicy } from './mutationExecutionPolicyService.js';
import { prepareMutationJournal,transitionMutationJournal } from '../repositories/mutationExecutionJournalRepository.js';
async function suiteContextForRun(env,runId){const db=requireDataDb(env);return await db.prepare(`SELECT sr.suite_run_id AS suiteRunId,sr.confirm_production_mutation AS confirmProductionMutation FROM suite_run_children c JOIN suite_runs sr ON sr.suite_run_id=c.suite_run_id WHERE c.run_id=? LIMIT 1`).bind(runId).first();}
export async function preflightMutationExecution({env,bundle,input}){
  const run=bundle.run;const suiteContext=await suiteContextForRun(env,run.runId);const {environment,policy}=await resolveSingleMutationPolicy({env,organizationId:run.organizationId,projectId:run.projectId,environmentId:run.environmentId,endpointId:run.endpointId,method:input.method});
  let allowed=policy.executionDecision==='ALLOW';let reason=policy.reason||null;
  if(environment.environmentType==='PROD' && Number(suiteContext?.confirmProductionMutation)!==1){allowed=false;reason='PRODUCTION_RUN_CONFIRMATION_REQUIRED';}
  const state=allowed?'PREPARED':'POLICY_DENIED';const idempotencyKeyHash=policy.retryMode==='IDEMPOTENCY_HEADER'?await sha256Hex(`${run.runId}|${input.scenarioId}|${policy.policyVersionId||'policy'}`):null;
  const result=await prepareMutationJournal(env,{organizationId:run.organizationId,projectId:run.projectId,environmentId:run.environmentId,endpointId:run.endpointId,runId:run.runId,scenarioId:input.scenarioId,attemptId:input.attemptId,testDesignVersionId:run.testDesignVersionId,method:input.method,canonicalPath:input.canonicalPath,policyVersionId:policy.policyVersionId||null,retryMode:policy.retryMode||'NO_AUTOMATIC_RETRY',idempotencyHeaderName:policy.idempotencyHeaderName||null,idempotencyKeyHash,requestFingerprint:input.requestFingerprint,state,lastErrorCode:allowed?null:(reason||'MUTATION_POLICY_DENIED')});
  return {contractVersion:'qagent.runner-mutation-preflight-result.v1',decision:allowed?'ALLOW':'DENY',reason:allowed?null:(reason||'MUTATION_POLICY_DENIED'),environmentType:environment.environmentType,mutationExecutionId:result.journal.mutationExecutionId,policyVersionId:policy.policyVersionId||null,retryMode:policy.retryMode||'NO_AUTOMATIC_RETRY',idempotencyHeaderName:policy.idempotencyHeaderName||null,idempotencyKeyHash,created:result.created};
}
export async function markMutationDispatching(args){return transitionMutationJournal(args.env,{...args,toState:'DISPATCHING',eventCode:'DISPATCHING',networkDispatchMayHaveOccurred:true});}
export async function markMutationResponseReceived(args){return transitionMutationJournal(args.env,{...args,toState:'RESPONSE_RECEIVED',eventCode:'RESPONSE_RECEIVED',networkDispatchMayHaveOccurred:true});}
export async function markMutationCompleted(args){return transitionMutationJournal(args.env,{...args,toState:'COMPLETED',eventCode:'COMPLETED'});}
export async function markMutationUnknown(args){return transitionMutationJournal(args.env,{...args,toState:'UNKNOWN_SIDE_EFFECT',eventCode:'UNKNOWN_SIDE_EFFECT',networkDispatchMayHaveOccurred:true});}

import { canonicalizeJson, sha256Hex } from './runContracts.js';

export const MUTATION_POLICY_CONTRACT_VERSION = 'qagent.mutation-policy.v1';
export const MUTATION_PREFLIGHT_CONTRACT_VERSION = 'qagent.runner-mutation-preflight.v1';
export const MUTATION_PREFLIGHT_RESULT_CONTRACT_VERSION = 'qagent.runner-mutation-preflight-result.v1';
export const MUTATION_DISPATCH_CONTRACT_VERSION = 'qagent.runner-mutation-dispatch.v1';
export const MUTATION_RESPONSE_CONTRACT_VERSION = 'qagent.runner-mutation-response.v1';
export const MUTATION_COMPLETE_CONTRACT_VERSION = 'qagent.runner-mutation-complete.v1';
export const MUTATION_UNKNOWN_CONTRACT_VERSION = 'qagent.runner-mutation-unknown.v1';
export const MUTATION_FAILED_BEFORE_DISPATCH_CONTRACT_VERSION = 'qagent.runner-mutation-failed-before-dispatch.v1';
export const MUTATION_ELIGIBILITY_POLICY_VERSION = 'qagent.suite-run-eligibility.v2';
export const MUTATION_METHODS = Object.freeze(['POST','PUT','PATCH','DELETE']);
export const SAFE_METHODS = Object.freeze(['GET','HEAD','OPTIONS']);

function fail(message, code='MUTATION_CONTRACT_INVALID', status=400, details=null){const e=new Error(message);e.code=code;e.status=status;if(details)e.publicDetails=details;throw e;}
function text(v,max=220){return String(v??'').trim().slice(0,max);}
export function normalizeMutationMethod(v){const method=text(v,12).toUpperCase();if(!MUTATION_METHODS.includes(method))fail('Método não é uma mutation suportada.','MUTATION_METHOD_INVALID',400,{method});return method;}
export function normalizeMutationPolicyInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('Mutation Policy inválida.');
  const allowed=new Set(['contractVersion','executionDecision','retryMode','idempotencyHeaderName','productionConfirmation','reason']);
  for(const k of Object.keys(input))if(!allowed.has(k))fail(`Campo não permitido: ${k}.`);
  if(input.contractVersion!==MUTATION_POLICY_CONTRACT_VERSION)fail(`contractVersion deve ser '${MUTATION_POLICY_CONTRACT_VERSION}'.`);
  const executionDecision=text(input.executionDecision,16).toUpperCase();if(!['ALLOW','DENY'].includes(executionDecision))fail('executionDecision inválido.');
  const retryMode=text(input.retryMode||'NO_AUTOMATIC_RETRY',40).toUpperCase();if(!['NO_AUTOMATIC_RETRY','IDEMPOTENCY_HEADER'].includes(retryMode))fail('retryMode inválido.');
  let idempotencyHeaderName=input.idempotencyHeaderName==null?null:text(input.idempotencyHeaderName,120);
  if(retryMode==='IDEMPOTENCY_HEADER' && (!idempotencyHeaderName||!/^[A-Za-z0-9-]{1,120}$/.test(idempotencyHeaderName)))fail('idempotencyHeaderName obrigatório para IDEMPOTENCY_HEADER.');
  if(retryMode!=='IDEMPOTENCY_HEADER')idempotencyHeaderName=null;
  return {contractVersion:MUTATION_POLICY_CONTRACT_VERSION,executionDecision,retryMode,idempotencyHeaderName,productionConfirmation:input.productionConfirmation===true,reason:input.reason==null?null:text(input.reason,500)};
}
export function normalizeMutationPreflightInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('Mutation preflight inválido.','RUNNER_MUTATION_PREFLIGHT_INVALID');
  if(input.contractVersion!==MUTATION_PREFLIGHT_CONTRACT_VERSION)fail(`contractVersion deve ser '${MUTATION_PREFLIGHT_CONTRACT_VERSION}'.`,'RUNNER_MUTATION_PREFLIGHT_INVALID');
  const scenarioId=text(input.scenarioId,220);const attemptId=text(input.attemptId,220);const leaseToken=text(input.leaseToken,1024);const runtimePlanHash=text(input.runtimePlanHash,128);const requestFingerprint=text(input.requestFingerprint,128);
  if(!scenarioId||!attemptId||!leaseToken||!/^[0-9a-f]{64}$/i.test(runtimePlanHash)||!/^[0-9a-f]{64}$/i.test(requestFingerprint))fail('Campos obrigatórios do mutation preflight inválidos.','RUNNER_MUTATION_PREFLIGHT_INVALID');
  return {contractVersion:MUTATION_PREFLIGHT_CONTRACT_VERSION,scenarioId,attemptId,leaseToken,runtimePlanHash,method:normalizeMutationMethod(input.method),canonicalPath:text(input.canonicalPath,2000),requestFingerprint:requestFingerprint.toLowerCase()};
}
export async function mutationPolicyFingerprint(policies){return sha256Hex(canonicalizeJson(policies.map((p)=>({endpointId:p.endpointId,method:p.method,policyVersionId:p.policyVersionId||null,decision:p.executionDecision,retryMode:p.retryMode||null})).sort((a,b)=>`${a.endpointId}|${a.method}`.localeCompare(`${b.endpointId}|${b.method}`))));}

function normalizeMutationControlBase(input, contractVersion, code='RUNNER_MUTATION_CONTROL_INVALID') {
  if(!input||typeof input!=='object'||Array.isArray(input))fail('Mutation control inválido.',code);
  if(input.contractVersion!==contractVersion)fail(`contractVersion deve ser '${contractVersion}'.`,code);
  const attemptId=text(input.attemptId,220);const leaseToken=text(input.leaseToken,1024);const runtimePlanHash=text(input.runtimePlanHash,128);const mutationExecutionId=text(input.mutationExecutionId,220);
  if(!attemptId||!leaseToken||!/^[0-9a-f]{64}$/i.test(runtimePlanHash)||!/^mex_[A-Za-z0-9_-]+$/.test(mutationExecutionId))fail('Campos obrigatórios de Mutation control inválidos.',code);
  return {attemptId,leaseToken,runtimePlanHash:runtimePlanHash.toLowerCase(),mutationExecutionId};
}
export function normalizeMutationDispatchInput(input){
  const base=normalizeMutationControlBase(input,MUTATION_DISPATCH_CONTRACT_VERSION,'RUNNER_MUTATION_DISPATCH_INVALID');
  const dispatchFingerprint=text(input.dispatchFingerprint,128);if(!/^[0-9a-f]{64}$/i.test(dispatchFingerprint))fail('dispatchFingerprint inválido.','RUNNER_MUTATION_DISPATCH_INVALID');
  let idempotencyKeyHash=input.idempotencyKeyHash==null?null:text(input.idempotencyKeyHash,128);if(idempotencyKeyHash!=null&&!/^[0-9a-f]{64}$/i.test(idempotencyKeyHash))fail('idempotencyKeyHash inválido.','RUNNER_MUTATION_DISPATCH_INVALID');
  return {...base,dispatchFingerprint:dispatchFingerprint.toLowerCase(),idempotencyKeyHash:idempotencyKeyHash?.toLowerCase()||null};
}
export function normalizeMutationResponseInput(input){
  const base=normalizeMutationControlBase(input,MUTATION_RESPONSE_CONTRACT_VERSION,'RUNNER_MUTATION_RESPONSE_INVALID');
  const statusCode=Number(input.httpStatusCode);if(!Number.isInteger(statusCode)||statusCode<100||statusCode>599)fail('httpStatusCode inválido.','RUNNER_MUTATION_RESPONSE_INVALID');
  return {...base,httpStatusCode:statusCode};
}
export function normalizeMutationCompleteInput(input){
  const base=normalizeMutationControlBase(input,MUTATION_COMPLETE_CONTRACT_VERSION,'RUNNER_MUTATION_COMPLETE_INVALID');
  const assertionOutcome=text(input.assertionOutcome||'NOT_EVALUATED',40).toUpperCase();if(!['PASSED','FAILED','NOT_EVALUATED'].includes(assertionOutcome))fail('assertionOutcome inválido.','RUNNER_MUTATION_COMPLETE_INVALID');
  return {...base,assertionOutcome};
}
export function normalizeMutationUnknownInput(input){
  const base=normalizeMutationControlBase(input,MUTATION_UNKNOWN_CONTRACT_VERSION,'RUNNER_MUTATION_UNKNOWN_INVALID');
  const errorCode=text(input.errorCode||'MUTATION_SIDE_EFFECT_UNKNOWN',120).toUpperCase();if(!/^[A-Z][A-Z0-9_:-]{1,119}$/.test(errorCode))fail('errorCode inválido.','RUNNER_MUTATION_UNKNOWN_INVALID');
  return {...base,errorCode};
}
export function normalizeMutationFailedBeforeDispatchInput(input){
  const base=normalizeMutationControlBase(input,MUTATION_FAILED_BEFORE_DISPATCH_CONTRACT_VERSION,'RUNNER_MUTATION_FAILED_BEFORE_DISPATCH_INVALID');
  const errorCode=text(input.errorCode||'MUTATION_FAILED_BEFORE_DISPATCH',120).toUpperCase();if(!/^[A-Z][A-Z0-9_:-]{1,119}$/.test(errorCode))fail('errorCode inválido.','RUNNER_MUTATION_FAILED_BEFORE_DISPATCH_INVALID');
  return {...base,errorCode};
}

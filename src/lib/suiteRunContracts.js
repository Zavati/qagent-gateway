import { canonicalizeJson, sha256Hex } from './runContracts.js';

export const SUITE_RUN_CREATE_CONTRACT_VERSION = 'qagent.suite-run-create.v1';
export const SUITE_RUN_CONTRACT_VERSION = 'qagent.suite-run.v1';
export const SUITE_RUN_REQUESTED_CONTRACT_VERSION = 'qagent.suite-run-requested.v1';
export const SUITE_EXECUTION_SLICE_CONTRACT_VERSION = 'qagent.suite-execution-slice.v1';
export const SUITE_RUN_TERMINAL_STATUSES = Object.freeze(['PASSED','FAILED','ERROR','CANCELLED']);

function fail(message, code='SUITE_RUN_CREATE_CONTRACT_INVALID', status=400, details=null) {
  const error = new Error(message); error.code=code; error.status=status; if (details) error.publicDetails=details; throw error;
}
function cleanId(value, field, prefix) {
  const v=String(value??'').trim();
  if (!v || v.length>220 || !new RegExp(`^${prefix}[A-Za-z0-9_-]+$`).test(v)) fail(`${field} inválido.`, 'SUITE_RUN_CREATE_CONTRACT_INVALID', 400, {field});
  return v;
}
export function normalizeSuiteRunCreateInput(input) {
  if (!input || typeof input!=='object' || Array.isArray(input)) fail('Payload de Suite Run inválido.');
  const allowed=new Set(['contractVersion','suiteVersionId','environmentId','confirmDiscoveredRuntime','confirmProductionMutation']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail(`Campo não permitido no Suite Run: ${key}.`, 'SUITE_RUN_CREATE_CONTRACT_INVALID', 400, {field:key});
  if (input.contractVersion!==SUITE_RUN_CREATE_CONTRACT_VERSION) fail(`contractVersion deve ser '${SUITE_RUN_CREATE_CONTRACT_VERSION}'.`);
  return {
    contractVersion:SUITE_RUN_CREATE_CONTRACT_VERSION,
    suiteVersionId:cleanId(input.suiteVersionId,'suiteVersionId','suitev_'),
    environmentId:cleanId(input.environmentId,'environmentId','env_'),
    confirmDiscoveredRuntime:input.confirmDiscoveredRuntime===true,
    confirmProductionMutation:input.confirmProductionMutation===true,
  };
}
export function normalizeSuiteRunIdempotencyKey(value) {
  const key=String(value??'').trim();
  if (key.length<8 || key.length>160 || !/^[A-Za-z0-9._:-]+$/.test(key)) fail('Idempotency-Key é obrigatório para Suite Run.', 'SUITE_RUN_IDEMPOTENCY_KEY_INVALID');
  return key;
}
export async function fingerprintSuiteRunCreateInput(input) {
  return sha256Hex(canonicalizeJson({
    contractVersion:SUITE_RUN_CREATE_CONTRACT_VERSION,
    suiteVersionId:input.suiteVersionId,
    environmentId:input.environmentId,
    confirmDiscoveredRuntime:input.confirmDiscoveredRuntime===true,
    confirmProductionMutation:input.confirmProductionMutation===true,
  }));
}
export function buildSuiteRunRequestedMessage({suiteRunId, organizationId, projectId, expectedCursor=0}) {
  return {contractVersion:SUITE_RUN_REQUESTED_CONTRACT_VERSION,suiteRunId,organizationId,projectId,expectedCursor:Number(expectedCursor)||0};
}
export function isTerminalSuiteRunStatus(status) { return SUITE_RUN_TERMINAL_STATUSES.includes(String(status||'')); }

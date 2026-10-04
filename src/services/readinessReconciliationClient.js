import { validateScenarioReadinessV2, projectLegacyReadiness } from '../readiness/scenarioReadinessV2.js';
import { READINESS_RECONCILIATION_CONTRACT, readinessScenarioHash } from '../readiness/readinessReconciliation.js';
const ID=/^[A-Za-z0-9_-]{1,180}$/;
const STATES=new Set(['UNCHANGED','PENDING_VERIFICATION','VERIFIED','CONTRADICTED','EVIDENCED','PROPOSAL_AVAILABLE','BASELINE_PROTECTED','MUTATION_POLICY_PRESERVED']);
const CODE=/^[A-Z][A-Z0-9_]{1,99}$/;
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
function fail(code,status=502){const e=new Error('Reconciliação de prontidão indisponível ou inconsistente.');e.code=code;e.status=status;throw e;}
function keys(o,allowed){if(!plain(o)||Object.keys(o).some(k=>!allowed.includes(k)))fail('READINESS_RECONCILIATION_RESPONSE_INVALID');}
function refs(o,fields){if(o===null)return null;keys(o,fields);for(const k of fields){const v=o[k];if(k==='completedAt'){if(!Number.isFinite(Date.parse(v||'')))fail('READINESS_RECONCILIATION_RESPONSE_INVALID');}else if(v!==null&&(typeof v!=='string'||!ID.test(v)))fail('READINESS_RECONCILIATION_RESPONSE_INVALID');}return o;}
export function validateReconciliationResponse(body,scope,input) {
  keys(body,['status','data']);
  const d=body?.data;
  keys(d,['contractVersion','organizationId','projectId','endpointId','testDesignId','testDesignVersionId','testDesignVersion','environmentId','computedAt','items','complete','executionStarted','appliedByThisOperation','versionsModified','aiCalled']);
  if(body?.status!=='ok'||d?.contractVersion!=='qagent.test-readiness-reconciliation.v1'
    ||['organizationId','projectId'].some(k=>d[k]!==scope[k])
    ||['endpointId','testDesignVersionId','environmentId'].some(k=>d[k]!==input[k])
    ||!ID.test(d.testDesignId||'')||!Number.isInteger(d.testDesignVersion)||d.testDesignVersion<1
    ||d.executionStarted!==false||d.appliedByThisOperation!==false||d.versionsModified!==false||d.aiCalled!==false
    ||!Number.isFinite(Date.parse(d.computedAt||''))||typeof d.complete!=='boolean'||!Array.isArray(d.items)||d.items.length>50)fail('READINESS_RECONCILIATION_RESPONSE_INVALID');
  const seen=new Set();
  for(const item of d.items){
    keys(item,['scenarioId','readiness','readinessV2','effectiveReadiness','readinessReconciliation']);
    if(!ID.test(item.scenarioId||'')||seen.has(item.scenarioId))fail('READINESS_RECONCILIATION_RESPONSE_INVALID');seen.add(item.scenarioId);
    validateScenarioReadinessV2(item.readinessV2);
    if(item.readinessV2.evaluationScope!=='EVIDENCE_RECONCILED'||item.effectiveReadiness!==projectLegacyReadiness(item.readinessV2))fail('READINESS_RECONCILIATION_RESPONSE_INVALID');
    const m=item.readinessReconciliation;
    keys(m,['contractVersion','scenarioId','testDesignVersionId','environmentId','sourceScenarioHash','state','complete','reasonCodes','resolvedIssueCodes','evidence','proposal','verification','examinedResultCount','historyLimit','snapshotPersisted']);
    if(m.contractVersion!==READINESS_RECONCILIATION_CONTRACT||m.scenarioId!==item.scenarioId||m.testDesignVersionId!==d.testDesignVersionId||m.environmentId!==d.environmentId
      ||!STATES.has(m.state)||typeof m.complete!=='boolean'||!(/^[a-f0-9]{64}$/).test(m.sourceScenarioHash||'')||m.snapshotPersisted!==false
      ||!Number.isInteger(m.examinedResultCount)||m.examinedResultCount<0||m.examinedResultCount>12||m.historyLimit!==5)fail('READINESS_RECONCILIATION_RESPONSE_INVALID');
    for(const k of ['reasonCodes','resolvedIssueCodes'])if(!Array.isArray(m[k])||m[k].length>128||m[k].some(x=>typeof x!=='string'||!CODE.test(x)))fail('READINESS_RECONCILIATION_RESPONSE_INVALID');
    refs(m.evidence,['resultSetId','scenarioResultId','runId','completedAt']);
    refs(m.proposal,['proposalId','status','sourceTestDesignVersionId','resultTestDesignVersionId']);
    refs(m.verification,['verificationId','proposalId','resultSetId']);
    if((m.state==='VERIFIED')!==(item.readinessV2.expectation.status==='VERIFIED')||(m.state==='VERIFIED'&&(!m.verification||!m.complete)))fail('READINESS_RECONCILIATION_RESPONSE_INVALID');
  }
  if(d.complete!==d.items.every(i=>i.readinessReconciliation.complete))fail('READINESS_RECONCILIATION_RESPONSE_INVALID');
  if(input.scenarioIds&&(input.scenarioIds.length!==seen.size||input.scenarioIds.some(id=>!seen.has(id))))fail('READINESS_RECONCILIATION_RESPONSE_INVALID');
  return d;
}
async function readBounded(response,signal){
  if(!response.body)fail('READINESS_RECONCILIATION_RESPONSE_INVALID');
  const reader=response.body.getReader(),parts=[];let bytes=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{while(true){if(signal.aborted)fail('READINESS_RECONCILIATION_TIMEOUT',504);const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>1_048_576){void reader.cancel();fail('READINESS_RECONCILIATION_RESPONSE_TOO_LARGE');}parts.push(r.value);}
    const all=new Uint8Array(bytes);let at=0;for(const p of parts){all.set(p,at);at+=p.length;}return JSON.parse(new TextDecoder().decode(all));
  }finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
}
export async function getReadinessReconciliation({env,organizationId,projectId,endpointId,testDesignVersionId,environmentId,scenarioIds=null,fetchImpl=null}){
  const input={endpointId,testDesignVersionId,environmentId,...(scenarioIds?{scenarioIds}:{})};
  if([organizationId,projectId,endpointId,testDesignVersionId,environmentId].some(x=>typeof x!=='string'||!ID.test(x)))fail('READINESS_RECONCILIATION_INPUT_INVALID',400);
  if(!fetchImpl&&typeof env?.TEST_EVOLUTION_SERVICE?.fetch!=='function')fail('TEST_EVOLUTION_NOT_CONFIGURED',503);
  const controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();const e=new Error('Readiness timeout');e.code='READINESS_RECONCILIATION_TIMEOUT';e.status=504;reject(e);},Math.max(1000,Math.min(30000,Number(env?.TEST_EVOLUTION_TIMEOUT_MS)||15000)));});
  try{
    return await Promise.race([timeout,(async()=>{
      const request=new Request(`https://qagent-test-evolution.internal/internal/v1/projects/${encodeURIComponent(projectId)}/test-readiness/reconcile`,{
        method:'POST',headers:{'content-type':'application/json','X-QAgent-Organization-Id':organizationId,'X-QAgent-Project-Id':projectId},body:JSON.stringify(input),signal:controller.signal});
      const response=await(fetchImpl?fetchImpl(request):env.TEST_EVOLUTION_SERVICE.fetch(request));
      const body=await readBounded(response,controller.signal);
      if(!response.ok)fail(CODE.test(body?.code||'')?body.code:'READINESS_RECONCILIATION_UPSTREAM_FAILED',response.status>=500?503:response.status);
      return validateReconciliationResponse(body,{organizationId,projectId},input);
    })()]);
  }catch(e){if(e.code)throw e;fail('READINESS_RECONCILIATION_UPSTREAM_FAILED',503);}finally{clearTimeout(timer);}
}
/** Only a private clone changes; spec/request/assertions and version identity are untouched. */
export async function applyReconciliationToArtifact(artifact, projection) {
  if(Number(artifact.testDesignVersion ?? artifact.version)!==Number(projection.testDesignVersion)||artifact.testDesignVersionId!==projection.testDesignVersionId||artifact.testDesignId!==projection.testDesignId
    ||artifact.endpointId!==projection.endpointId||artifact.organizationId!==projection.organizationId||artifact.projectId!==projection.projectId)fail('READINESS_SOURCE_SCOPE_MISMATCH');
  const byId=new Map(projection.items.map(i=>[i.scenarioId,i]));
  const out=structuredClone(artifact);
  for(let i=0;i<artifact.specification.scenarios.length;i++){
    const source=artifact.specification.scenarios[i],item=byId.get(source.scenarioId);if(!item)continue;
    if(item.readinessReconciliation.sourceScenarioHash!==await readinessScenarioHash(source))fail('READINESS_SOURCE_HASH_MISMATCH',409);
    if(!item.readinessReconciliation.complete)fail('READINESS_EVIDENCE_UNAVAILABLE',503);
    if(!['GET','HEAD','OPTIONS'].includes(source.spec?.target?.method)||source.generationClass==='OBSERVED_BASELINE'||source.baseline)continue;
    out.specification.scenarios[i].readinessV2=structuredClone(item.readinessV2);
    out.specification.scenarios[i].automation={...out.specification.scenarios[i].automation,readiness:item.effectiveReadiness};
  }
  return out;
}

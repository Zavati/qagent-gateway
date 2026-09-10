import { buildTestReadinessQuery, validateTestReadinessEnvelope, readinessError } from '../contracts/testReadiness.js';
const BASE = 'https://qagent-test-registry.internal';
const SAFE_ERRORS = {
  TEST_READINESS_QUERY_INVALID:[400,'Filtros de prontidão inválidos.'],
  TEST_READINESS_CURSOR_INVALID:[400,'Cursor inválido para este conjunto de filtros.'],
  TEST_READINESS_CURSOR_STALE:[409,'As versões dos testes mudaram. Atualize os resultados.'],
  TEST_READINESS_VERSION_NOT_FOUND:[404,'Versão não encontrada neste endpoint.'],
  TEST_READINESS_CORRUPT_PROJECTION:[502,'O Test Registry encontrou metadados inconsistentes.'],
  TEST_READINESS_READ_UNAVAILABLE:[503,'A leitura de prontidão está indisponível no Test Registry.'],
};
async function boundedJson(response, signal) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    // Service Binding body streams may outlive fetch() resolving its headers.
    // Bound the entire exchange, including a stalled or oversized response body.
    rejectAbort(new DOMException('Upstream timeout', 'AbortError'));
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) onAbort();
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      length += value.byteLength;
      if (length > 1_048_576) {
        void reader.cancel().catch(() => {});
        throw readinessError('TEST_READINESS_RESPONSE_INVALID', 'Resposta de prontidão acima do limite seguro.', 502);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let position = 0;
    for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error?.name === 'TestReadinessError' || error?.name === 'AbortError') throw error;
    throw readinessError('TEST_READINESS_RESPONSE_INVALID', 'Resposta de prontidão inválida.', 502);
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}
async function requestReadiness({env,organizationId,projectId,endpointId=null,query,fetchImpl=null}){
  const binding=env?.TEST_REGISTRY_SERVICE;
  if(!fetchImpl&&typeof binding?.fetch!=='function')throw readinessError('TEST_REGISTRY_NOT_CONFIGURED','Test Registry service binding não configurado.',503);
  const detail=Boolean(endpointId),params=buildTestReadinessQuery(query,{detail});
  const suffix=detail?`/endpoints/${encodeURIComponent(endpointId)}/scenarios`:'';
  const path=`/v1/test-registry/projects/${encodeURIComponent(projectId)}/test-readiness${suffix}?${params}`;
  const controller=new AbortController();const configured=Number(env?.TEST_REGISTRY_TIMEOUT_MS)||10000;
  const timer=setTimeout(()=>controller.abort(),Math.max(1000,Math.min(30000,configured)));
  try {
    const req=new Request(BASE+path,{headers:{Accept:'application/json','X-QAgent-Organization-Id':organizationId,'X-QAgent-Project-Id':projectId},signal:controller.signal});
    // Private Service Binding + trusted tenant headers, matching the existing Registry boundary.
    // No public URL fallback, caller-supplied tenant header, or new secret/configuration.
    const response=fetchImpl?await fetchImpl(req):await binding.fetch(req);
    const body=await boundedJson(response,controller.signal);
    if(!response.ok){
      const known=SAFE_ERRORS[body?.code];
      if(known)throw readinessError(body.code,known[1],known[0]);
      throw readinessError(response.status===404?'TEST_READINESS_UPSTREAM_INCOMPATIBLE':'TEST_READINESS_UPSTREAM_UNAVAILABLE',response.status===404?'Publique o Test Registry compatível com a consulta de prontidão.':'O Test Registry não concluiu a consulta de prontidão.',503);
    }
    return validateTestReadinessEnvelope(body,{organizationId,projectId,endpointId,testDesignVersionId:query.testDesignVersionId},{detail,query});
  } catch(error){
    if(error?.name==='TestReadinessError')throw error;
    throw readinessError(error?.name==='AbortError'?'TEST_READINESS_UPSTREAM_TIMEOUT':'TEST_READINESS_UPSTREAM_UNAVAILABLE',error?.name==='AbortError'?'A consulta de prontidão excedeu o tempo limite.':'Test Registry indisponível para consulta de prontidão.',error?.name==='AbortError'?504:503);
  } finally {clearTimeout(timer);}
}
export const getProjectTestReadiness = options => requestReadiness(options);
export const getEndpointTestReadinessScenarios = options => requestReadiness(options);

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { canonicalizeCatalogQuery, buildCatalogQuerySigningPayload, createCatalogQuerySignature } from '../src/security/catalogQuerySigner.js';
import { buildCatalogUpstreamUrl, proxyCatalogQuery } from '../src/services/catalogQueryProxyService.js';

const secret = '0123456789abcdef0123456789abcdef';
const organizationId = 'org_test';
const projectId = 'prj_test';
const timestamp = '1786839791';
const params = new URLSearchParams('z=last&q=hello world&a=2&a=1');
assert.equal(canonicalizeCatalogQuery(params), 'a=1&a=2&q=hello%20world&z=last');

const signedUrl = new URL('https://api.apiqagent.com/v1/catalog/projects/prj_test/endpoints?z=last&q=hello%20world&a=2&a=1');
const payload = buildCatalogQuerySigningPayload({ method: 'GET', url: signedUrl, organizationId, projectId, timestamp });
const expectedPayload = ['qagent.catalog-query.v1','GET','/v1/catalog/projects/prj_test/endpoints','a=1&a=2&q=hello%20world&z=last',organizationId,projectId,timestamp].join('\n');
assert.equal(payload, expectedPayload);
const expectedSig = createHmac('sha256', secret).update(expectedPayload).digest('hex');
assert.equal(await createCatalogQuerySignature({ secret, method: 'GET', url: signedUrl, organizationId, projectId, timestamp }), expectedSig);

const env = { ENVIRONMENT:'development', CATALOG_QUERY_BASE_URL:'https://api.apiqagent.com', CATALOG_QUERY_TIMEOUT_MS:'10000', CATALOG_QUERY_HMAC_SECRET:secret };
const incoming = new URL('https://gateway.example/v1/console/projects/prj_test/catalog/endpoints?classification=FIRST_PARTY_API&limit=20');
const upstream = buildCatalogUpstreamUrl(env, '/v1/catalog/projects/prj_test/endpoints', incoming);
assert.equal(upstream.toString(), 'https://api.apiqagent.com/v1/catalog/projects/prj_test/endpoints?classification=FIRST_PARTY_API&limit=20');

let captured;
const result = await proxyCatalogQuery({ env, organizationId, projectId, upstreamPath:'/v1/catalog/projects/prj_test/endpoints', incomingUrl:incoming, fetchImpl:async (url, init) => {
  captured={url,init};
  return new Response(JSON.stringify({status:'ok',data:[{endpointId:'cep_1'}]}), {status:200,headers:{'content-type':'application/json','x-qagent-query-api-version':'catalog-query-v1'}});
}});
assert.equal(result.status,200); assert.equal(result.queryApiVersion,'catalog-query-v1');
assert.equal(captured.init.headers['X-QAgent-Organization-Id'], organizationId);
assert.equal(captured.init.headers['X-QAgent-Project-Id'], projectId);
const livePayload=buildCatalogQuerySigningPayload({method:'GET',url:new URL(captured.url),organizationId,projectId,timestamp:captured.init.headers['X-QAgent-Query-Timestamp']});
assert.equal(captured.init.headers['X-QAgent-Query-Signature'], createHmac('sha256',secret).update(livePayload).digest('hex'));

await assert.rejects(() => proxyCatalogQuery({ env,organizationId,projectId,upstreamPath:'/v1/catalog/projects/prj_test/summary',incomingUrl:new URL('https://gateway.example/v1/console/projects/prj_test/catalog/summary'),fetchImpl:async()=>new Response(JSON.stringify({status:'error',code:'INVALID_QUERY_SIGNATURE'}),{status:401,headers:{'content-type':'application/json'}})}), e=>e?.status===502&&e?.code==='CATALOG_UPSTREAM_AUTH_FAILED');
await assert.rejects(() => proxyCatalogQuery({ env,organizationId,projectId,upstreamPath:'/v1/catalog/projects/prj_test/summary',incomingUrl:new URL('https://gateway.example/v1/console/projects/prj_test/catalog/summary'),fetchImpl:async()=>{throw new Error('network down')}}), e=>e?.status===502&&e?.code==='CATALOG_UPSTREAM_UNAVAILABLE');
console.log('catalog query proxy tests passed ✅');

/** 08.1.6 FIX-2.3: small, deterministic assertion capabilities.
 * No code evaluation, remote fetches, raw secrets or arbitrary request selectors.
 * Shared byte-for-byte at producer, consumer and persistence boundaries.
 */
export const COVERAGE_ASSERTION_TYPES = new Set(['JSON_PATH_TYPE', 'JSON_ARRAY_LENGTH_LTE_REQUEST']);
export const JSON_TYPES = new Set(['number','integer','string','boolean','array','object','null']);
export const PAGE_SELECTORS = /^(?:limit|pageSize|page_size|pagesize|perPage|per_page|perpage)$/;
const forbidden = new Set(['__proto__','prototype','constructor']);
const sensitive = /^(?:password|passwd|secret|authorization|cookie|access_token|refresh_token|api_key|client_secret|private_key)$/i;
export function simplePathParts(path) {
  if(typeof path!=='string'||path.length>240||!/^\$(?:\.[A-Za-z_][A-Za-z0-9_-]*){0,12}$/.test(path)) return null;
  const parts=path==='$'?[]:path.slice(2).split('.');
  return parts.some(p=>forbidden.has(p)||sensitive.test(p))?null:parts;
}
export function valueAtSimplePath(value,path) {
  const parts=simplePathParts(path);if(!parts)return {exists:false};
  let current=value;
  for(const part of parts){if(!current||typeof current!=='object'||Array.isArray(current)||!Object.prototype.hasOwnProperty.call(current,part))return {exists:false};current=current[part];}
  return {exists:true,value:current};
}
export function jsonValueType(value){if(value===null)return 'null';if(Array.isArray(value))return 'array';if(typeof value==='number')return Number.isInteger(value)?'integer':'number';return typeof value;}
export function jsonTypeMatches(value,type){const actual=jsonValueType(value);return type==='number'?(typeof value==='number'&&Number.isFinite(value)):actual===type;}
export function positiveQueryBound(values){
  if(!Array.isArray(values)||values.length!==1)return null;
  const raw=values[0];if(typeof raw!=='string'&&typeof raw!=='number')return null;
  if(!/^[1-9][0-9]{0,8}$/.test(String(raw)))return null;
  const n=Number(raw);return Number.isSafeInteger(n)&&n>0?n:null;
}
export function validateCoverageAssertion(assertion){
  const a=assertion;
  if(!a||typeof a!=='object'||Array.isArray(a)||!COVERAGE_ASSERTION_TYPES.has(a.type)||!simplePathParts(a.path))throw Object.assign(new Error('Invalid coverage assertion.'),{code:'ASSERTION_COVERAGE_CONTRACT_INVALID'});
  const keys=a.type==='JSON_PATH_TYPE'?['type','path','expectedType']:['type','path','target','selector'];
  if(Object.keys(a).length!==keys.length||Object.keys(a).some(k=>!keys.includes(k)))throw Object.assign(new Error('Unexpected coverage assertion fields.'),{code:'ASSERTION_COVERAGE_CONTRACT_INVALID'});
  if(a.type==='JSON_PATH_TYPE'&&!JSON_TYPES.has(a.expectedType))throw Object.assign(new Error('Invalid expected JSON type.'),{code:'ASSERTION_COVERAGE_CONTRACT_INVALID'});
  if(a.type==='JSON_ARRAY_LENGTH_LTE_REQUEST'&&(a.target!=='QUERY'||typeof a.selector!=='string'||!PAGE_SELECTORS.test(a.selector)))throw Object.assign(new Error('Only declared pagination query selectors are supported.'),{code:'ASSERTION_COVERAGE_CONTRACT_INVALID'});
  return {...a};
}
export function schemaTypeProves(node,expectedType){
  if(!node||node['x-qagent-partial']===true||node['x-qagent-coverage-reasons']?.length)return false;
  const types=Array.isArray(node.type)?node.type:[node.type];
  return types.length>0&&types.every(t=>expectedType==='number'?(t==='number'||t==='integer'):t===expectedType);
}
export function schemaNodeAtPath(schema,path){
  const parts=simplePathParts(path);if(!parts)return null;
  let node=schema;
  for(const p of parts){if(!node||node['x-qagent-partial']===true||node['x-qagent-coverage-reasons']?.length||node.type!=='object')return null;node=node.properties?.[p];}
  return node||null;
}
const normalized = x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
/** Bounded recognition of declared intent. Produces diagnostics/proposals, never authorization. */
export function assertionCoverageRequirements(scenario){
  const spec=scenario?.spec||{},assertions=spec.assertions||[],intent=normalized(`${scenario?.title||''} ${scenario?.objective||''}`);
  const types=[];
  const integer=/\b(?:integer|inteiro|inteira)\b/.test(intent);
  const number=/\b(?:number|numeric|numerico|numerica)\b|\b(?:e|is|be|um|a) (?:um |a )?numero\b/.test(intent);
  if(integer||number){
    const paths=[...new Set(assertions.filter(a=>['JSON_PATH_EXISTS','JSON_PATH_EQUALS','JSON_PATH_TYPE'].includes(a?.type)&&simplePathParts(a.path)).map(a=>a.path))];
    // One path is unambiguous; otherwise require its leaf to be named by the objective.
    const chosen=paths.length===1?paths:paths.filter(p=>new RegExp(`\\b${simplePathParts(p).at(-1)}\\b`,'i').test(intent));
    for(const path of chosen)types.push({kind:'JSON_TYPE',path,expectedType:integer?'integer':'number'});
  }
  const statuses=assertions.filter(a=>a?.type==='STATUS').flatMap(a=>a.expectedStatusCodes||[]);
  const positive=!statuses.length||statuses.every(s=>s>=200&&s<300);
  const pagination=positive&&scenario?.category!=='NEGATIVE'&&scenario?.category!=='AUTHORIZATION'&&/\b(?:limit(?:e)?(?: de)? (?:result[a-z]*|retorn[a-z]*)|result(?:ado)?s?.{0,30}limit|paginacao|pagination|page size|limite de registros)\b/.test(intent);
  const names=[...new Set([...(spec.testData?.bindings||[]).filter(b=>b.target==='QUERY').map(b=>b.selector),...Object.keys(spec.request?.query||{})].filter(n=>typeof n==='string'&&PAGE_SELECTORS.test(n)))];
  const needs=[...types];
  if(pagination)needs.push({kind:'PAGINATION_BOUND',selector:names.length===1?names[0]:null});
  return needs;
}
export function assertionCoverageGaps(scenario){
 const assertions=scenario?.spec?.assertions||[];
 return assertionCoverageRequirements(scenario).filter(r=>r.kind==='JSON_TYPE'
   ?!assertions.some(a=>a.type==='JSON_PATH_TYPE'&&a.path===r.path&&(a.expectedType===r.expectedType||(r.expectedType==='number'&&a.expectedType==='integer')))
   :!assertions.some(a=>a.type==='JSON_ARRAY_LENGTH_LTE_REQUEST'&&a.target==='QUERY'&&a.selector===r.selector));
}
/** Safe, bounded result metadata. Counts and a declared pagination bound only. */
export function validateCoverageEvaluation(value, assertionType=null) {
 if(!value||typeof value!=='object'||Array.isArray(value)||value.contractVersion!=='qagent.assertion-coverage-evaluation.v1')throw Object.assign(new Error('Invalid coverage evaluation.'),{code:'ASSERTION_COVERAGE_EVIDENCE_INVALID'});
 const a=validateCoverageAssertion(value.assertion);
 if(assertionType&&a.type!==assertionType)throw Object.assign(new Error('Coverage type mismatch.'),{code:'ASSERTION_COVERAGE_EVIDENCE_INVALID'});
 const keys=['contractVersion','assertion','actualType','actualLength','requestBound'];
 if(Object.keys(value).some(k=>!keys.includes(k))||(value.actualType!=null&&!JSON_TYPES.has(value.actualType)))throw Object.assign(new Error('Invalid coverage evaluation fields.'),{code:'ASSERTION_COVERAGE_EVIDENCE_INVALID'});
 if(value.actualLength!=null&&(!Number.isSafeInteger(value.actualLength)||value.actualLength<0||value.actualLength>10000000))throw Object.assign(new Error('Invalid length.'),{code:'ASSERTION_COVERAGE_EVIDENCE_INVALID'});
 if(value.requestBound!=null&&positiveQueryBound([value.requestBound])==null)throw Object.assign(new Error('Invalid pagination bound.'),{code:'ASSERTION_COVERAGE_EVIDENCE_INVALID'});
 if(a.type==='JSON_PATH_TYPE'&&(value.actualLength!=null||value.requestBound!=null))throw Object.assign(new Error('Unexpected type assertion evidence.'),{code:'ASSERTION_COVERAGE_EVIDENCE_INVALID'});
 return {contractVersion:value.contractVersion,assertion:a,actualType:value.actualType??null,actualLength:value.actualLength??null,requestBound:value.requestBound??null};
}

/** Reuse the existing Test Data resolver for learning. Never append a Test Design here. */
import { pathPlaceholderDescriptors } from '../intelligence/testDataPlanner.js';
import { assessExploratoryLearning } from '../learningScenarioEligibility.js';
import { isSensitiveTestDataSelector } from '../lib/testDataPolicy.js';

function fail(code, scenarioId, selector = null) {
  const error = new Error(code); error.code = code; error.status = 409;
  error.publicDetails = {scenarioId, ...(selector ? {target:'PATH_PARAM', selector} : {})}; throw error;
}
const key = b => `${b.target}:${b.selector}`;
function fixedUsable(b) {
  const v=b.fixedValue;
  if(v == null || (typeof v==='string' && /\[REDACTED\]|\[TRUNCATED\]|__qagent_redacted__|__qagent_truncated__/.test(v))) return false;
  return b.valueType==='STRING' ? typeof v==='string' && (b.target!=='PATH_PARAM' || v.length>0)
    : b.valueType==='INTEGER' ? Number.isSafeInteger(v)
    : b.valueType==='NUMBER' ? typeof v==='number' && Number.isFinite(v)
    : b.valueType==='BOOLEAN' ? typeof v==='boolean'
    : b.valueType==='JSON' ? typeof v==='object' : false;
}
const has = (o,k) => Object.prototype.hasOwnProperty.call(o || {}, k);

/** Work only on a clone, respecting explicit settings and already declared values.
 * Missing, ordinary path dependencies may use the exact positional OBSERVED policy
 * already supported by the planner/materializer. Special negative conditions are
 * NOT fulfilled by selecting the successful request's identifier.
 */
export function prepareExploratoryLearningData(scenario, configuredBindings = []) {
  const assessment = assessExploratoryLearning(scenario);
  if (!assessment.allowed) fail(assessment.reason, scenario.scenarioId);
  const out = structuredClone(scenario), spec = out.spec;
  const configured = new Map(configuredBindings.map(b => [key(b), b]));
  const bindings = spec.testData?.bindings || [];
  const fromConfig = (b) => {
    if (b.sourceType !== 'FIXED' && b.sourceType !== 'SECRET') fail('LEARNING_PATH_CONFIGURATION_UNSUPPORTED',out.scenarioId,b.selector);
    if (b.sourceType === 'FIXED' && !fixedUsable(b)) fail('RUN_TEST_DATA_FIXED_INVALID',out.scenarioId,b.selector);
    if (b.sourceType === 'SECRET' && !b.secretId) fail('RUN_TEST_DATA_SECRET_NOT_CONFIGURED',out.scenarioId,b.selector);
    if (isSensitiveTestDataSelector(b.target,b.selector) && b.sourceType !== 'SECRET') fail('RUN_TEST_DATA_SECRET_SOURCE_REQUIRED',out.scenarioId,b.selector);
    return {target:b.target,selector:b.selector,source:b.sourceType,valueType:b.valueType,bindingKey:key(b),provenance:{origin:b.origin || 'LEGACY_UNKNOWN'}};
  };
  // Explicit configuration takes priority over an OBSERVED fallback. It is not rewritten.
  for (let i=0; i<bindings.length; i++) {
    const binding=bindings[i], c=configured.get(key(binding));
    if (binding.source === 'OBSERVED' && c) bindings[i]=fromConfig(c);
    else if (binding.source === 'FIXED' || binding.source === 'SECRET') {
      if (!c) fail('RUN_TEST_DATA_BINDING_MISSING',out.scenarioId,binding.selector);
      if (c.sourceType !== binding.source) fail('RUN_TEST_DATA_BINDING_SOURCE_MISMATCH',out.scenarioId,binding.selector);
      if (binding.source === 'FIXED' && !fixedUsable(c)) fail('RUN_TEST_DATA_FIXED_INVALID',out.scenarioId,binding.selector);
      if (binding.source === 'SECRET' && !c.secretId) fail('RUN_TEST_DATA_SECRET_NOT_CONFIGURED',out.scenarioId,binding.selector);
    }
  }
  for (const descriptor of pathPlaceholderDescriptors(spec.target.path)) {
    if (has(spec.request?.pathParams,descriptor.selector)) continue;
    if (bindings.some(b => b.target==='PATH_PARAM' && b.selector===descriptor.selector &&
        (b.source!=='OBSERVED' || b.bindingKey===descriptor.bindingKey))) continue;
    const c=configured.get(`PATH_PARAM:${descriptor.selector}`);
    if (c) { if (!bindings.some(b=>key(b)===key(c))) bindings.push(fromConfig(c)); continue; }
    if (!['id','uuid','objectId','ulid'].includes(descriptor.selector) || isSensitiveTestDataSelector('PATH_PARAM',descriptor.selector)) fail('LEARNING_PATH_SOURCE_UNAVAILABLE',out.scenarioId,descriptor.selector);
    bindings.push({target:'PATH_PARAM',selector:descriptor.selector,source:'OBSERVED',valueType:'STRING',bindingKey:descriptor.bindingKey,provenance:{origin:'OBSERVED'}});
  }
  if (bindings.length) spec.testData={contractVersion:'qagent.test-data-bindings.v1',bindings};
  return out;
}

/** Metadata-only projection, called after the resolver has confirmed OBSERVED values. */
export function learningDataSummary(scenario) {
  return { status: 'RESOLVED', bindings:(scenario.spec?.testData?.bindings || []).slice(0,64).map(b=>({target:b.target,selector:b.selector,source:b.source})),
    noValuesExposed:true };
}

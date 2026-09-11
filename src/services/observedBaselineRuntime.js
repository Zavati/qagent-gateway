import { assertSchemaRefinement } from '../activeLearningSchema.js';
import { baselineFromSource, validateObservedBaselineScenario, observedBaselineReady, canonicalBaselineJson, baselineLearningEligibility, baselineEffectiveResponse } from '../baselineContract.js';
import { captureHash, captureRequestSafe } from '../baselineCapture.js';
import { getCatalogObservedBaseline } from '../intelligence/catalogKnowledgeClient.js';
function stop(code) { throw Object.assign(new Error('A baseline observada não pode ser reproduzida com a fonte/configuração atual. Revise a origem e os dados; o request não será substituído.'), { code, status: 409 }); }
function bodyAt(body, selector) {
    const parts = String(selector || '').replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let v = body;
    for (const p of parts) {
        if (!v || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(v, p))
            return { exists: false };
        v = v[p];
    }
    return { exists: true, value: v };
}
function valueFor(req, binding) {
    if (binding.target === 'BODY')
        return bodyAt(req.body, binding.selector);
    const map = binding.target === 'QUERY' ? req.query : binding.target === 'PATH_PARAM' ? req.pathParams : null;
    return map && Object.prototype.hasOwnProperty.call(map, binding.selector) ? { exists: true, value: map[binding.selector] } : { exists: false };
}
export async function materializeObservedBaselineRequests({ env, organizationId, projectId, endpointId, environmentId, scenarios, configuredBindings = [], loadSource = getCatalogObservedBaseline, now = Date.now(), purpose = 'REGRESSION' }) {
    const requests = new Map(), cache = new Map();
    for (const scenario of scenarios) {
        if (scenario.generationClass !== 'OBSERVED_BASELINE')
            continue;
        validateObservedBaselineScenario(scenario, { organizationId, projectId, endpointId, environmentId });
        const b = scenario.baseline;
        if (!observedBaselineReady(b, now) && !(purpose === 'LEARNING' && baselineLearningEligibility(scenario,now).allowed))
            stop('RUN_OBSERVED_BASELINE_SOURCE_UNAVAILABLE');
        if (!cache.has(b.baselineId))
            cache.set(b.baselineId, await loadSource({ env, organizationId, projectId, endpointId, baselineId: b.baselineId }));
        const source = cache.get(b.baselineId);
        if (!source || source.availability !== 'AVAILABLE' || !captureRequestSafe(source.request))
            stop('RUN_OBSERVED_BASELINE_SOURCE_UNAVAILABLE');
        const current = { ...baselineFromSource(source), comparisonPolicy: b.comparisonPolicy, ...(b.revision ? { revision: b.revision } : {}) };
        const {enrichment, ...original} = b;
        if (canonicalBaselineJson(current) !== canonicalBaselineJson(original))
            stop('RUN_OBSERVED_BASELINE_PROVENANCE_MISMATCH');
        if ('brq_' + await captureHash({ request: source.request, encoding: b.requestBodyEncoding }) !== b.requestFingerprint)
            stop('RUN_OBSERVED_BASELINE_REQUEST_HASH_MISMATCH');
        for (const configured of configuredBindings) {
            // Do not mutate shared settings, and do not silently override explicitly configured data.
            if (!['USER_DEFINED', 'LEGACY_UNKNOWN'].includes(configured.origin || 'LEGACY_UNKNOWN'))
                continue;
            const match = valueFor(source.request, configured);
            if (!match.exists)
                continue;
            const same = configured.sourceType === 'FIXED' && (configured.target === 'BODY'
                ? canonicalBaselineJson(configured.fixedValue) === canonicalBaselineJson(match.value)
                : !Array.isArray(match.value) && String(configured.fixedValue) === String(match.value));
            if (!same)
                stop('RUN_OBSERVED_BASELINE_USER_DATA_CONFLICT');
        }
        requests.set(scenario.scenarioId, structuredClone(source.request));
    }
    return requests;
}
export async function verifyObservedBaselineSchemas(scenarios, snapshots) {
    for (const s of scenarios) {
        if (s.generationClass !== 'OBSERVED_BASELINE' || !s.baseline.responseSchemaVersionId || s.baseline.responseCoverage.status === 'NO_BODY')
            continue;
        const b = s.baseline, snapshot = snapshots.find(x => x.schemaRef === b.responseSchemaVersionId);
        if (!snapshot || snapshot.schemaVersionId !== b.responseSchemaVersionId || snapshot.schemaHash !== b.responseSchemaHash || snapshot.direction !== 'RESPONSE' || snapshot.statusCode !== b.source.statusCode)
            stop('RUN_OBSERVED_BASELINE_SCHEMA_MISMATCH');
        if ('sch_' + (await captureHash(snapshot.schema)).slice(0, 40) !== b.responseSchemaHash)
            stop('RUN_OBSERVED_BASELINE_SCHEMA_HASH_MISMATCH');
        if(b.enrichment){
            const expected=baselineEffectiveResponse(b), effective=snapshots.find(x=>x.schemaRef===expected.schemaVersionId);
            if(!effective||effective.schemaVersionId!==expected.schemaVersionId||effective.schemaHash!==expected.schemaHash||effective.direction!=='RESPONSE'||effective.statusCode!==b.source.statusCode||'sch_'+(await captureHash(effective.schema)).slice(0,40)!==expected.schemaHash)stop('RUN_OBSERVED_BASELINE_ENRICHMENT_SCHEMA_MISMATCH');
            assertSchemaRefinement(snapshot.schema,effective.schema);
        }
    }
}

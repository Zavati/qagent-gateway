import { validateObservedBaselineScenario } from '../baselineContract.js';
import { buildObservedBaselineScenario } from './observedBaselineGeneration.js';
import { buildSummary } from './testDesignContract.js';
function stop(code, message) { throw Object.assign(new Error(message), { code, status: 409 }); }
/** Explicit human operation: replace one source/policy in a new Test Design version; never execute. */
export function reviseObservedBaseline({ previous, sources, context, contextFingerprint, options, actor, now }) {
    const r = options.replace;
    if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some(k => !['scenarioId', 'newBaselineId', 'sourceTestDesignVersionId', 'confirm', 'reasonCode'].includes(k))
        || r.confirm !== true || !actor || typeof r.scenarioId !== 'string' || typeof r.newBaselineId !== 'string'
        || !['APPROVED_PRODUCT_CHANGE', 'RECAPTURE_SOURCE', 'CORRECT_GENERATION', 'COMPARISON_POLICY_REVIEW'].includes(r.reasonCode))
        stop('OBSERVED_BASELINE_APPROVAL_REQUIRED', 'Confirme a revisão da origem e informe o motivo.');
    if (!previous?.testDesign?.specification || previous.testDesign.versionId !== r.sourceTestDesignVersionId)
        stop('OBSERVED_BASELINE_REVISION_STALE', 'O Test Design mudou. Atualize a tela e revise a versão atual antes de salvar.');
    const specification = structuredClone(previous.testDesign.specification);
    const index = specification.scenarios.findIndex(s => s.scenarioId === r.scenarioId && s.generationClass === 'OBSERVED_BASELINE');
    if (index < 0)
        stop('OBSERVED_BASELINE_NOT_FOUND', 'O cenário observado não existe na versão atual.');
    const old = specification.scenarios[index], source = (sources?.items || []).find(b => b.baselineId === r.newBaselineId);
    if (!source || source.availability === 'EXPIRED')
        stop('OBSERVED_BASELINE_SOURCE_UNAVAILABLE', 'A nova fonte não está disponível para revisão.');
    if (['organizationId', 'projectId', 'endpointId', 'environmentId', 'method', 'path', 'origin'].some(k => source.source[k] !== old.baseline.source[k]))
        stop('OBSERVED_BASELINE_SCOPE_MISMATCH', 'A revisão deve preservar endpoint, origem e ambiente do cenário.');
    const replacement = buildObservedBaselineScenario(source, context, { mode: options.mode || old.baseline.comparisonPolicy.mode, actor, now });
    if (replacement.automation.readiness !== 'READY')
        stop('OBSERVED_BASELINE_REVISION_NOT_READY', 'A nova fonte/contexto não está pronta; a baseline atual não foi alterada.');
    if (replacement.baseline.comparisonPolicy.mode === 'CONTROLLED_STATE' && options.confirmControlledContext !== true)
        stop('OBSERVED_BASELINE_CONTEXT_CONFIRMATION_REQUIRED', 'Confirme as precondições do contexto controlado.');
    if (old.baseline.baselineId === replacement.baseline.baselineId && old.baseline.comparisonPolicy.mode === replacement.baseline.comparisonPolicy.mode)
        stop('OBSERVED_BASELINE_REVISION_NO_CHANGE', 'Selecione outra fonte ou política; não há mudança a aprovar.');
    replacement.scenarioId = old.scenarioId; // Stable operational identity; source identity/version changes explicitly.
    replacement.baseline.revision = { previousBaselineId: old.baseline.baselineId, sourceTestDesignVersionId: r.sourceTestDesignVersionId,
        approvedByUserId: actor, approvedAt: now.toISOString(), reasonCode: r.reasonCode };
    validateObservedBaselineScenario(replacement, { organizationId: context.organizationId, projectId: context.projectId, endpointId: context.endpoint.endpointId });
    specification.scenarios[index] = replacement;
    specification.summary = buildSummary(specification.scenarios);
    specification.generation = { ...specification.generation, mode: 'OBSERVED_REBASELINE', provider: 'SYSTEM', model: 'observed-baseline-v1', generatedAt: now.toISOString(), contextFingerprint };
    return { specification, contextFingerprint, diagnostics: { observedBaselineRevision: { scenarioId: old.scenarioId,
                previousBaselineId: old.baseline.baselineId, baselineId: replacement.baseline.baselineId, approvedAt: now.toISOString(), executionRequested: false } } };
}

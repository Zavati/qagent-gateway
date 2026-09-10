import { baselineFromSource, validateObservedBaseline, observedBaselineReady, observedBaselineAssertions } from '../baselineContract.js';
export function buildObservedBaselineScenario(source, context, { mode = 'STRUCTURE', actor = null, now = new Date() } = {}) {
    const b = source.comparisonPolicy ? structuredClone(source) : baselineFromSource(source, { mode }, actor, now.toISOString());
    validateObservedBaseline(b, { organizationId: context.organizationId, projectId: context.projectId, endpointId: context.endpoint.endpointId });
    const runtime = context.runtime || {};
    const blockers = [];
    let readiness = 'READY';
    const requiresAuth = b.source.authObserved;
    if (!runtime.apiServiceKey) {
        readiness = 'NEEDS_ENVIRONMENT';
        blockers.push('OBSERVED_BASELINE_RUNTIME_REQUIRED');
    }
    if (requiresAuth && !runtime.defaultAuthProfileRef) {
        readiness = 'NEEDS_AUTH';
        blockers.push('OBSERVED_BASELINE_AUTH_REQUIRED');
    }
    if (!observedBaselineReady(b, now.getTime()) || source.availability === 'EXPIRED') {
        readiness = 'NEEDS_DATA';
        if (source.availability === 'EXPIRED')
            blockers.push('OBSERVED_BASELINE_SOURCE_UNAVAILABLE');
        if (Date.parse(b.expiresAt) <= now.getTime())
            blockers.push('OBSERVED_BASELINE_SOURCE_EXPIRED');
        if (b.requestCoverage.status !== 'COMPLETE')
            blockers.push('OBSERVED_BASELINE_REQUEST_INCOMPLETE');
        if (!['COMPLETE', 'NO_BODY'].includes(b.responseCoverage.status))
            blockers.push('OBSERVED_BASELINE_RESPONSE_INCOMPLETE');
        if (!['PASSED', 'NO_BODY'].includes(b.selfCheck))
            blockers.push('OBSERVED_BASELINE_SELF_CHECK_INCOMPLETE');
    }
    const variant = b.arrayStates.some(x => x.state === 'NON_EMPTY') ? 'objetos observados' : b.arrayStates.some(x => x.state === 'EMPTY') ? 'lista vazia observada' : 'estrutura observada';
    return {
        scenarioId: 'baseline_' + b.baselineId.slice(4), title: `Regressão observada · ${b.source.statusCode} · ${variant}`,
        objective: 'Proteger as regras selecionadas da observação de origem, sem mover a expectativa com o Catalog corrente.',
        category: 'HAPPY_PATH', priority: 'HIGH', confidence: 'HIGH', generationClass: 'OBSERVED_BASELINE', baseline: b,
        grounding: { level: 'OBSERVED', rationale: ['Baseline construída deterministicamente a partir de uma transação monitorada; sua origem não é escolhida pela IA.'], evidenceRefs: [b.source.evidenceId], schemaRefs: b.responseSchemaVersionId ? [b.responseSchemaVersionId] : [] },
        automation: { readiness, blockers, evolutionState: readiness === 'READY' ? 'STABLE' : 'BLOCKED' },
        preconditions: [`Ambiente de origem: ${b.source.environmentId}.`, `Dados da fonte disponíveis até ${b.expiresAt}.`,
            b.comparisonPolicy.mode === 'CONTROLLED_STATE' ? 'Contexto controlado confirmado: o estado vazio/preenchido dos arrays observados também é protegido.' : 'Somente estrutura: diferenças vazio/preenchido são informadas, não são declaradas defeito sem contexto controlado.',
            'Headers de negócio não capturados devem ser mantidos na configuração do serviço; autenticação pertence ao Auth Runtime.'],
        spec: { dslVersion: 'qagent.api-test-dsl.v1', type: 'api', target: { catalogEndpointId: b.source.endpointId, apiServiceKey: runtime.apiServiceKey || null, method: b.source.method, path: b.source.path },
            auth: { requirement: requiresAuth ? 'REQUIRED' : 'NONE', authProfileRef: requiresAuth ? runtime.defaultAuthProfileRef || null : null },
            request: { pathParams: {}, query: {}, headers: {} }, assertions: observedBaselineAssertions(b), extract: [] },
    };
}

import { getProjectTestReadiness, getRunnerTestArtifact } from './testRegistryClient.js';
import { getReadinessReconciliation } from './readinessReconciliationClient.js';
import { readScenarioReadinessV2 } from '../readiness/legacyReadinessAdapter.js';
import { readinessScenarioHash } from '../readiness/readinessReconciliation.js';
import { readinessHash, parseTestReadinessQuery, safeReadinessText, safeReadinessPath } from '../contracts/testReadiness.js';
import { WORKSPACE_CONTRACT, emptyWorkspaceFilters, countWorkspaceItems, matchesWorkspaceFilters, validateWorkspaceEnvelope, workspaceError } from '../contracts/adaptiveReadinessWorkspace.mjs';
import { readinessNextAction } from '../readiness/readinessNextAction.js';
const assert = (ok, code = 'READINESS_WORKSPACE_SOURCE_MISMATCH') => { if (!ok)
    throw workspaceError(code, 502); };
const b64 = x => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(x)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unb64 = x => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(x.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0))));
const errorCode = e => /^[A-Z][A-Z0-9_]{0,119}$/.test(e?.code || '') ? e.code : 'READINESS_WORKSPACE_UNAVAILABLE';
export async function readAdaptiveReadinessWorkspace(scope, query, deps = {}) {
    const { env, organizationId, projectId, canWrite } = scope;
    const context = await readinessHash(JSON.stringify({ organizationId, projectId, ...query, cursor: null }));
    let upstreamCursor = null;
    if (query.cursor) {
        try {
            const c = unb64(query.cursor);
            assert(Object.keys(c).sort().join(',') === 'context,upstream,v' && c.v === 1 && c.context === context && typeof c.upstream === 'string' && c.upstream.length <= 3000, 'READINESS_WORKSPACE_CURSOR_INVALID');
            upstreamCursor = c.upstream;
        }
        catch {
            throw workspaceError('READINESS_WORKSPACE_CURSOR_INVALID');
        }
    }
    let endpoints, inventoryCount = null, revision, nextCursor = null;
    if (query.endpointId) {
        endpoints = [{ endpointId: query.endpointId, testDesignVersionId: query.testDesignVersionId }];
        revision = 'rrev_' + await readinessHash(JSON.stringify([organizationId, projectId, query.endpointId, query.testDesignVersionId]));
    }
    else {
        const params = new URLSearchParams({ view: 'endpoints', limit: String(query.limit) });
        if (query.filters.method)
            params.set('method', query.filters.method);
        // Filter on effective dimensions only AFTER reconciliation. Inventory pagination
        // must not eliminate VERIFIED versions whose immutable legacy label differs.
        if (upstreamCursor)
            params.set('cursor', upstreamCursor);
        const inventory = await (deps.getInventory || getProjectTestReadiness)({ env, organizationId, projectId, query: parseTestReadinessQuery(params) });
        assert(inventory.organizationId === organizationId && inventory.projectId === projectId);
        endpoints = inventory.items;
        revision = inventory.readinessRevision;
        inventoryCount = inventory.filteredSummary.matchingEndpointCount;
        if (inventory.page.hasMore)
            nextCursor = b64({ v: 1, context, upstream: inventory.page.nextCursor });
    }
    const all = [], errors = [];
    for (const endpoint of endpoints) {
        try {
            const artifact = await (deps.getArtifact || getRunnerTestArtifact)({ env, organizationId, projectId, testDesignVersionId: endpoint.testDesignVersionId });
            assert(artifact.organizationId === organizationId && artifact.projectId === projectId && artifact.endpointId === endpoint.endpointId && artifact.testDesignVersionId === endpoint.testDesignVersionId);
            const artifactVersion = artifact.testDesignVersion ?? artifact.version;
            assert(Number.isInteger(artifactVersion) && artifactVersion > 0);
            const scenarios = artifact.specification?.scenarios;
            assert(Array.isArray(scenarios) && scenarios.length > 0 && scenarios.length <= 50, 'READINESS_WORKSPACE_SCENARIO_LIMIT');
            const projection = await (deps.reconcile || getReadinessReconciliation)({ env, organizationId, projectId, endpointId: endpoint.endpointId, testDesignVersionId: endpoint.testDesignVersionId, environmentId: query.environmentId });
            assert(projection.organizationId === organizationId && projection.projectId === projectId && projection.endpointId === endpoint.endpointId && projection.environmentId === query.environmentId && projection.testDesignVersionId === artifact.testDesignVersionId && projection.testDesignId === artifact.testDesignId && projection.testDesignVersion === artifactVersion);
            const byId = new Map(projection.items.map(i => [i.scenarioId, i]));
            assert(byId.size === scenarios.length && projection.items.length === scenarios.length);
            const staged = [];
            for (const source of scenarios) {
                const r = byId.get(source.scenarioId);
                assert(r && r.readinessReconciliation.sourceScenarioHash === await readinessScenarioHash(source), 'READINESS_WORKSPACE_HASH_MISMATCH');
                const path = safeReadinessPath(source.spec?.target?.path);
                assert(path, 'READINESS_WORKSPACE_PATH_UNAVAILABLE');
                const snapshot = readScenarioReadinessV2(source, { derivedVersion: Boolean(source.learning?.phase === 'PENDING_VERIFICATION' || artifact.origin === 'RESULT_EVOLUTION') });
                const item = { endpointId: artifact.endpointId, testDesignId: artifact.testDesignId, testDesignVersionId: artifact.testDesignVersionId, testDesignVersion: artifactVersion,
                    scenarioId: source.scenarioId, environmentId: query.environmentId, title: safeReadinessText(source.title) || source.scenarioId,
                    method: source.spec.target.method, path, generationClass: ['OBSERVED_BASELINE', 'AI_EXPLORATORY', 'LEGACY'].includes(source.generationClass) ? source.generationClass : 'LEGACY',
                    readiness: r.readiness, snapshotReadinessV2: snapshot, readinessV2: r.readinessV2, effectiveReadiness: r.effectiveReadiness, readinessReconciliation: r.readinessReconciliation, complete: r.readinessReconciliation.complete };
                Object.assign(item, readinessNextAction(source, item, { canWrite }));
                staged.push(item);
            }
            all.push(...staged);
        }
        catch (e) {
            errors.push({ endpointId: endpoint.endpointId, testDesignVersionId: endpoint.testDesignVersionId, code: errorCode(e) });
        }
    }
    const items = all.filter(i => matchesWorkspaceFilters(i, query.filters));
    const baseFilters = { ...emptyWorkspaceFilters(), q: query.filters.q, method: query.filters.method, generationClass: query.filters.generationClass };
    const classified = all.filter(i => matchesWorkspaceFilters(i, baseFilters));
    const data = { contractVersion: WORKSPACE_CONTRACT, organizationId, projectId, environmentId: query.environmentId, computedAt: new Date().toISOString(), readinessRevision: revision,
        summaryBasis: 'PAGE_ONLY_OVERLAPPING_DIMENSIONS', filters: query.filters, permissions: { canWrite: Boolean(canWrite) },
        summary: { scannedEndpointCount: endpoints.length, inventoryEndpointCount: inventoryCount, scannedScenarioCount: all.length, matchedScenarioCount: items.length, classifiedScenarioCount: classified.filter(i => i.complete).length, kpis: countWorkspaceItems(classified) },
        page: { limit: query.limit, hasMore: Boolean(nextCursor), nextCursor }, items, errors, complete: errors.length === 0 && all.every(i => i.complete), executionStarted: false, appliedByThisOperation: false, versionsModified: false, aiCalled: false };
    return validateWorkspaceEnvelope({ status: 'ok', data }, { organizationId, projectId }, query);
}

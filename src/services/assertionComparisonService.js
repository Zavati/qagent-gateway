import { getExecutionPlanForRun } from '../repositories/runRepository.js';
import { parseJsonPath } from '../lib/assertionJsonPath.js';
import { makeAssertionDiagnostics, pointerSegment, JSON_TYPES } from '../lib/assertionDiagnostics.js';

function locate(schema, path, code) {
  let tokens;
  try { tokens = parseJsonPath(path); } catch { return null; }
  let node = schema, instancePointer = '', schemaPointer = '';
  for (const token of tokens) {
    if (token.type === 'property') {
      if (!node?.properties || !Object.prototype.hasOwnProperty.call(node.properties, token.key)) return null;
      node = node.properties[token.key];
      instancePointer += `/${pointerSegment(token.key)}`;
      schemaPointer += `/properties/${pointerSegment(token.key)}`;
    } else if (token.type === 'index') {
      if (!node?.items) return null;
      node = node.items;
      instancePointer += `/${token.index}`;
      schemaPointer += '/items';
    } else return null; // A wildcard is not a concrete location; never pick an arbitrary match.
  }
  return { node, instancePointer, schemaPointer: `${schemaPointer}/${code === 'SCHEMA_FORMAT_MISMATCH' ? 'format' : 'type'}` };
}

/** Enrich only the read projection. No writes, no Catalog lookup, no re-evaluation of the preview. */
export async function enrichLegacyAssertionComparison({ env, organizationId, projectId, data }, { getPlan = getExecutionPlanForRun } = {}) {
  const root = data?.resultSet;
  if (!root || root.organizationId !== organizationId || root.projectId !== projectId || !root.runId) return data;
  if (!(data.scenarios || []).some(s => (s.assertions || []).some(a => a.type === 'SCHEMA' && a.outcome === 'FAILED' && !a.diagnostics))) return data;
  let row;
  try { row = await getPlan(env, organizationId, projectId, root.runId); } catch { return data; }
  if (!row || row.organizationId !== organizationId || row.projectId !== projectId || row.runId !== root.runId
    || row.executionPlanId !== root.executionPlanId || row.testDesignVersionId !== root.testDesignVersionId
    || row.runtimeSnapshotId !== root.runtimeSnapshotId || row.environmentId !== root.environmentId) return data;
  const plan = row.plan;
  if (!plan || plan.executionPlanId !== root.executionPlanId || plan.runId !== root.runId
    || plan.testDesign?.testDesignVersionId !== root.testDesignVersionId) return data;
  let remaining = 128 * 1024;
  return { ...data, scenarios: data.scenarios.map(scenario => {
    const planned = (plan.scenarios || []).filter(s => s.scenarioId === scenario.scenarioId);
    if (planned.length !== 1) return scenario;
    return { ...scenario, assertions: scenario.assertions.map(assertion => {
      if (assertion.type !== 'SCHEMA' || assertion.outcome !== 'FAILED' || assertion.diagnostics || !assertion.schemaRef) return assertion;
      const spec = planned[0].spec?.assertions?.[assertion.assertionIndex];
      if (spec?.type !== 'SCHEMA' || spec.schemaRef !== assertion.schemaRef) return assertion;
      const snapshots = (plan.schemaSnapshots || []).filter(s => s.schemaRef === assertion.schemaRef);
      if (snapshots.length !== 1) return assertion;
      const snapshot = snapshots[0];
      const location = locate(snapshot.schema, assertion.path, assertion.primaryIssueCode);
      const issues = assertion.primaryIssueCode ? [{ code: assertion.primaryIssueCode, path: assertion.path,
        instancePointer: location?.instancePointer ?? null, schemaPointer: location?.schemaPointer ?? null,
        expectedTypes: (Array.isArray(location?.node?.type) ? location.node.type : [location?.node?.type]).filter(t => JSON_TYPES.has(t)),
        // Historical previews converted primitives to strings. Never derive actualType from them.
        actualType: assertion.actualTypes?.length === 1 ? assertion.actualTypes[0] : null,
        format: location?.node?.format || null }] : [];
      const diagnostics = makeAssertionDiagnostics({ snapshot, issues, issueCount: issues.length, issuesTruncated: true, source: 'LEGACY_EXECUTION_PLAN' });
      const size = new TextEncoder().encode(JSON.stringify(diagnostics)).byteLength;
      if (size > remaining) return assertion;
      remaining -= size;
      return { ...assertion, diagnostics };
    }) };
  }) };
}

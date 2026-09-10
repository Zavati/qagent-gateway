/** 08.1.5: bounded, value-free diagnostics. Never use this projection to evaluate a test. */
export const DIAGNOSTICS_CONTRACT = 'qagent.assertion-diagnostics.v1';
export const JSON_TYPES = new Set(['null', 'boolean', 'object', 'array', 'number', 'integer', 'string']);
export const SCHEMA_FORMATS = new Set(['uuid', 'date', 'date-time', 'time', 'email']);
export const ISSUE_CODES = new Set(['SCHEMA_TYPE_MISMATCH', 'SCHEMA_FORMAT_MISMATCH', 'SCHEMA_DEFINITION_INVALID', 'SCHEMA_VALIDATION_DEPTH_LIMIT', 'SCHEMA_TYPE_INVALID', 'ASSERTION_JSON_PATH_MISSING', 'ASSERTION_JSON_PATH_VALUE_MISMATCH']);
const SECRET_NAMES = new Set(['password','passwd','secret','clientsecret','apikey','authorization','cookie','credential','privatekey','token','accesstoken','refreshtoken','idtoken','bearertoken','sessiontoken','idempotencykey']);
export function diagnosticSensitive(value, knownValues = []) {
  const text = String(value ?? '');
  if (/[\u0000-\u001f]/.test(text) || /\bBearer\s+|\beyJ[A-Za-z0-9_-]{8,}\.|\b(?:qag_(?:test|live)_|sk-)[A-Za-z0-9_-]{8,}/i.test(text)) return true;
  const tokens = text.match(/[A-Za-z_][A-Za-z0-9_-]*/g) || [];
  if (tokens.some(token => SECRET_NAMES.has(token.replace(/[_-]/g, '').toLowerCase()))) return true;
  return knownValues.some(v => String(v).length >= 4 && text.includes(String(v)));
}
export function pointerSegment(value) { return String(value).replace(/~/g, '~0').replace(/\//g, '~1'); }
export function safeDiagnosticPath(value, knownValues = []) {
  return typeof value === 'string' && value.length <= 512 && !diagnosticSensitive(value, knownValues) ? value : null;
}
export function projectStructuralSchema(schema, knownValues = []) {
  let nodes = 0, truncated = false, redacted = false;
  function visit(node, depth) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
    if (depth > 16 || nodes >= 200) { truncated = true; return null; }
    nodes += 1;
    const out = Object.create(null);
    const types = (Array.isArray(node.type) ? node.type : [node.type]).filter(t => JSON_TYPES.has(t));
    if (types.length) out.type = Array.isArray(node.type) ? [...new Set(types)] : types[0];
    if (SCHEMA_FORMATS.has(node.format)) out.format = node.format;
    if (node['x-qagent-partial'] === true) out['x-qagent-partial'] = true;
    if (node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)) {
      out.properties = Object.create(null);
      for (const key of Object.keys(node.properties).sort()) {
        if (diagnosticSensitive(key, knownValues)) { redacted = true; continue; }
        if (key.length > 120 || nodes >= 200) { truncated = true; continue; }
        const child = visit(node.properties[key], depth + 1);
        if (child) out.properties[key] = child;
      }
    }
    if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
      const items = visit(node.items, depth + 1);
      if (items) out.items = items;
    }
    return out;
  }
  let projected = visit(schema, 0);
  if (JSON.stringify(projected).length > 12000) { projected = null; truncated = true; }
  return { schema: projected, truncated, redacted };
}
function safeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_:-]{1,240}$/.test(value) && !diagnosticSensitive(value) ? value : null;
}
export function makeAssertionDiagnostics({ snapshot = null, issues = [], issueCount = issues.length, issuesTruncated = false, source = 'RUNNER_EVALUATION', knownValues = [] } = {}) {
  const projected = projectStructuralSchema(snapshot?.schema, knownValues);
  const selected = issues.slice(0, 32).map(i => {
    const path = safeDiagnosticPath(i.path, knownValues);
    const instancePointer = safeDiagnosticPath(i.instancePointer, knownValues);
    const schemaPointer = safeDiagnosticPath(i.schemaPointer, knownValues);
    const redacted = !!i.redacted || (i.path != null && path == null) || (i.instancePointer != null && instancePointer == null) || (i.schemaPointer != null && schemaPointer == null);
    return {
      code: ISSUE_CODES.has(i.code) ? i.code : 'SCHEMA_DEFINITION_INVALID',
      path: redacted ? null : path,
      instancePointer: redacted ? null : instancePointer,
      schemaPointer: redacted ? null : schemaPointer,
      expectedTypes: redacted ? [] : [...new Set((i.expectedTypes || []).filter(t => JSON_TYPES.has(t)))].slice(0, 7),
      actualType: !redacted && JSON_TYPES.has(i.actualType) ? i.actualType : null,
      format: !redacted && SCHEMA_FORMATS.has(i.format) ? i.format : null,
      redacted,
    };
  });
  const result = {
    contractVersion: DIAGNOSTICS_CONTRACT, source,
    schemaRef: safeId(snapshot?.schemaRef), schemaHash: safeId(snapshot?.schemaHash), schemaVersionId: safeId(snapshot?.schemaVersionId),
    expectedSchema: projected.schema, schemaTruncated: projected.truncated, schemaRedacted: projected.redacted,
    issueCount: Math.max(selected.length, Number.isInteger(issueCount) ? issueCount : selected.length),
    issuesTruncated: issuesTruncated || issues.length > selected.length,
    issues: selected,
  };
  // Bound the entire object too; diagnostics must not prevent a run from being persisted.
  if (JSON.stringify(result).length > 30000) { result.expectedSchema = null; result.schemaTruncated = true; }
  while (JSON.stringify(result).length > 30000 && result.issues.length > 1) { result.issues.pop(); result.issuesTruncated = true; }
  return result;
}

import { isSensitiveTestDataSelector } from '../lib/testDataPolicy.js';

export const TEST_DESIGN_REPAIR_CONTEXT_VERSION = 'qagent.test-design-repair-context.v1';
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const FORMATS = new Set(['uuid', 'email', 'date', 'date-time', 'time', 'uri', 'hostname', 'ipv4', 'ipv6']);
const NUMBERS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties'];
const NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,119}$/;
const REF = /^[A-Za-z0-9_.:-]{1,160}$/;
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const ref = value => typeof value === 'string' && REF.test(value) ? value : null;
const list = value => Array.isArray(value) ? value : [];
const safeName = value => typeof value === 'string' && NAME.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const sensitive = path => isSensitiveTestDataSelector('BODY', path) || /(?:password|passwd|secret|token|credential|authorization|cookie|api[_-]?key|private[_-]?key)/i.test(path);
const scalar = value => value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 256);

/** A bounded structural *view*, never a schema substitute or source of test values.
 * Descriptions/examples/defaults/extensions, private samples, bindings and credentials
 * are excluded. Sensitive selectors retain no const/enum or child material.
 */
function schemaView(node, path, state, depth = 0) {
  if (depth > 12 || ++state.nodes > 1024) { state.partial = true; return {}; }
  if (typeof node === 'boolean') return node;
  if (!plain(node)) { state.partial = true; return {}; }
  if (sensitive(path)) { state.partial = true; return {}; }
  const out = {};
  if (TYPES.has(node.type)) out.type = node.type;
  else if (Array.isArray(node.type) && node.type.every(type => TYPES.has(type))) out.type = [...node.type];
  if (FORMATS.has(node.format)) out.format = node.format;
  for (const key of NUMBERS) if (typeof node[key] === 'number' && Number.isFinite(node[key])) out[key] = node[key];
  for (const key of ['uniqueItems', 'additionalProperties', 'nullable']) if (typeof node[key] === 'boolean') out[key] = node[key];
  if (Object.hasOwn(node, 'const') && scalar(node.const)) out.const = node.const;
  if (Array.isArray(node.enum) && node.enum.length <= 20 && node.enum.every(scalar)) out.enum = [...node.enum];
  if (Array.isArray(node.required)) out.required = node.required.filter(safeName).slice(0, 50);
  if (plain(node.properties)) {
    out.properties = Object.create(null);
    for (const [key, child] of Object.entries(node.properties).slice(0, 50)) {
      if (!safeName(key)) { state.partial = true; continue; }
      out.properties[key] = schemaView(child, `${path}.${key}`, state, depth + 1);
    }
    if (Object.keys(node.properties).length > 50) state.partial = true;
  }
  if (plain(node.items) || typeof node.items === 'boolean') out.items = schemaView(node.items, `${path}[]`, state, depth + 1);
  for (const key of ['oneOf', 'anyOf', 'allOf']) if (Array.isArray(node[key])) {
    out[key] = node[key].slice(0, 8).map(child => schemaView(child, path, state, depth + 1));
    if (node[key].length > 8) state.partial = true;
  }
  // Omissions are explicit. A compact view must not appear to prove a full contract.
  if (Object.keys(node).some(key => !Object.hasOwn(out, key))) state.partial = true;
  return out;
}

export function buildTestDesignRepairContextV1(context) {
  let remainingChars = 24_000;
  const schemas = list(context?.schemas).slice(0, 24).map(track => {
    const state = { nodes: 0, partial: false };
    let view = schemaView(track?.schema, '$', state);
    const size = JSON.stringify(view).length;
    if (size > remainingChars) { view = {}; state.partial = true; }
    else remainingChars -= size;
    return {
      trackId: ref(track?.trackId), direction: ['REQUEST', 'RESPONSE'].includes(track?.direction) ? track.direction : null,
      statusCode: Number.isInteger(track?.statusCode) ? track.statusCode : null,
      currentVersionId: ref(track?.currentVersionId), currentSchemaHash: ref(track?.currentSchemaHash),
      contentTypes: list(track?.contentTypes).filter(value => typeof value === 'string' && /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/.test(value)).slice(0, 8),
      schema: view, projectionPartial: state.partial,
    };
  });
  const path = context?.endpoint?.normalizedPath;
  const auth = context?.runtime?.authObservation;
  return {
    contractVersion: TEST_DESIGN_REPAIR_CONTEXT_VERSION,
    endpoint: {
      method: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(context?.endpoint?.method) ? context.endpoint.method : null,
      // Only the normalized template, no absolute URL, host, query values or origin.
      normalizedPath: typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !/[?#\r\n]/.test(path) && path.length <= 1600 ? path : null,
      queryParameters: list(context?.endpoint?.queryParameters).map(item => item?.name).filter(name => safeName(name) && !sensitive(name)).slice(0, 64),
    },
    authObservation: {
      status: ['REQUIRED', 'OPTIONAL', 'MIXED', 'UNKNOWN'].includes(auth?.status) ? auth.status : 'UNKNOWN',
      scheme: ['BEARER', 'BASIC', 'COOKIE', 'API_KEY', 'UNKNOWN'].includes(auth?.scheme) ? auth.scheme : 'UNKNOWN',
      evidenceRefs: list(auth?.evidenceRefs).map(ref).filter(Boolean).slice(0, 24),
    },
    evidence: list(context?.evidence).slice(0, 24).map(item => ({
      evidenceId: ref(item?.evidenceId), statusCode: Number.isInteger(item?.statusCode) ? item.statusCode : null,
      authObserved: typeof item?.authObserved === 'boolean' ? item.authObserved : null,
      requestSchemaVersionId: ref(item?.requestSchemaVersionId), responseSchemaVersionId: ref(item?.responseSchemaVersionId),
    })),
    schemas,
    capabilities: {
      requestCountPerScenario: 1, targetMutation: false, sequence: false, faultInjection: false,
      relationalAssertion: false, latencyAssertion: false,
      assertionTypes: ['STATUS', 'SCHEMA', 'JSON_PATH_EXISTS', 'JSON_PATH_EQUALS', 'HEADER_EXISTS', 'CONTENT_TYPE'],
    },
    metadataOnly: true, schemaProjectionOnly: true,
    truncated: list(context?.schemas).length > 24 || list(context?.evidence).length > 24 || schemas.some(track => track.projectionPartial),
  };
}

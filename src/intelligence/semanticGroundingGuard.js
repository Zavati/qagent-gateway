export const SEMANTIC_GROUNDING_GUARD_VERSION = 'qagent.semantic-grounding-guard.v1.1';

const GROUNDING_RANK = Object.freeze({ ASSUMED: 0, INFERRED: 1, OBSERVED: 2 });
const CONFIDENCE_RANK = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2 });
const HTTP_AUTH_STATUSES = new Set([401, 403]);
const LATENCY_RE = /(?:lat[eê]ncia|latency|tempo\s+de\s+resposta|response\s+time|performance|desempenho)/i;
const TARGET_PATH_MUTATION_RE = /(?:(?:caminho|path|rota|endpoint|url)\s+(?:inv[aá]lid[oa]?|inexistent[ea]?|desconhecid[oa]?)|(?:inv[aá]lid[oa]?|inexistent[ea]?|desconhecid[oa]?)\s+(?:caminho|path|rota|endpoint|url)|invalid\s+(?:path|route|endpoint|url)|unknown\s+(?:path|route|endpoint)|non[-\s]?existent\s+(?:path|route|endpoint))/i;
const TARGET_METHOD_MUTATION_RE = /(?:(?:m[eé]todo(?:\s+http)?|http\s+method)\s+(?:inv[aá]lid[oa]?|n[aã]o\s+permitid[oa]?|n[aã]o\s+suportad[oa]?)|(?:inv[aá]lid[oa]?|n[aã]o\s+permitid[oa]?|n[aã]o\s+suportad[oa]?)\s+(?:m[eé]todo(?:\s+http)?)|invalid\s+(?:http\s+)?method|method\s+not\s+allowed|unsupported\s+(?:http\s+)?method)/i;
const FAULT_INJECTION_RE = /(?:erro\s+interno(?:\s+do\s+servidor)?|falha\s+interna(?:\s+do\s+servidor)?|internal\s+server\s+(?:error|failure)|server\s+(?:error|failure)|fault\s+injection|simul(?:ar|ando|ação).*?(?:erro|falha|500)|for[cç](?:ar|ando).*?(?:erro|falha|500)|induz(?:ir|indo).*?(?:erro|falha|500))/i;
const NON_EMPTY_INTENT_RE = /(?:n[aã]o\s+(?:est[aá]\s+|esteja\s+)?vazi[oa]|lista\s+n[aã]o\s+vazia|array\s+n[aã]o\s+vazi[oa]|non[-\s]?empty|not\s+empty|at\s+least\s+one|ao\s+menos\s+um|pelo\s+menos\s+um)/i;
const UUID_INTENT_RE = /(?:\buuid\b|formato\s+uuid|uuid\s+v[aá]lid[oa]?|valid\s+uuid)/i;
const BOOLEAN_INTENT_RE = /(?:\bboolean(?:o|a)?\b|tipo\s+boolean|boolean\s+type|true\s*\/\s*false)/i;
const DATE_TIME_INTENT_RE = /(?:data(?:\s+e\s+hora)?\s+v[aá]lid[oa]?|date[-\s]?time|datetime|timestamp\s+v[aá]lid[oa]?|valid\s+(?:date|datetime|timestamp))/i;
const COUNT_RELATION_INTENT_RE = /(?:(?:contagem|quantidade|count).{0,100}(?:corret[oa]|correspon|equival|n[uú]mero\s+de\s+(?:itens|elementos)|tamanho\s+da\s+lista)|(?:matches|equals|corresponds).{0,60}(?:number|length|count).{0,60}(?:items|elements|array|list))/i;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyObject(value) {
  return isPlainObject(value) && Object.keys(value).length > 0;
}

function unique(values) {
  return [...new Set((values || []).filter((value) => value != null && value !== ''))];
}

function boundedPush(array, value, max = 10) {
  if (!value || array.includes(value) || array.length >= max) return;
  array.push(value);
}

function ensureScenarioContainers(scenario) {
  if (!isPlainObject(scenario.grounding)) scenario.grounding = { level: 'ASSUMED', rationale: [], evidenceRefs: [], schemaRefs: [] };
  if (!Array.isArray(scenario.grounding.rationale)) scenario.grounding.rationale = [];
  if (!Array.isArray(scenario.grounding.evidenceRefs)) scenario.grounding.evidenceRefs = [];
  if (!Array.isArray(scenario.grounding.schemaRefs)) scenario.grounding.schemaRefs = [];
  if (!isPlainObject(scenario.automationHints)) scenario.automationHints = {};
  if (!Array.isArray(scenario.automationHints.reasons)) scenario.automationHints.reasons = [];
}

function downgradeGrounding(scenario, target) {
  const current = GROUNDING_RANK[scenario.grounding?.level] ?? 0;
  const desired = GROUNDING_RANK[target] ?? 0;
  if (current > desired) scenario.grounding.level = target;
}

function capConfidence(scenario, target) {
  const current = CONFIDENCE_RANK[scenario.confidence] ?? 0;
  const desired = CONFIDENCE_RANK[target] ?? 0;
  if (current > desired) scenario.confidence = target;
}

function addGuardRationale(scenario, reason) {
  boundedPush(scenario.grounding.rationale, `QAgent Guard: ${reason}`, 12);
}

function addHintReason(scenario, reason) {
  boundedPush(scenario.automationHints.reasons, reason, 10);
}

function issueCollector(scenarioId, issues, scenarioIssues) {
  return function addIssue({ code, path, severity, reason, action = null }) {
    const issue = { scenarioId, code, path, severity, action };
    issues.push(issue);
    scenarioIssues.push(issue);
    if (reason) addHintReason(this, reason);
  };
}

function buildKnowledge(context) {
  const evidence = Array.isArray(context?.evidence) ? context.evidence : [];
  const schemas = Array.isArray(context?.schemas) ? context.schemas : [];
  const evidenceById = new Map();
  const evidenceByStatus = new Map();
  const observedStatuses = new Set();

  for (const item of evidence) {
    if (item?.evidenceId) evidenceById.set(item.evidenceId, item);
    if (Number.isInteger(item?.statusCode)) {
      observedStatuses.add(item.statusCode);
      const current = evidenceByStatus.get(item.statusCode) || [];
      current.push(item);
      evidenceByStatus.set(item.statusCode, current);
    }
  }

  const schemaByRef = new Map();
  const responseTracks = [];
  const requestTracks = [];
  for (const track of schemas) {
    const refs = unique([
      track?.trackId,
      track?.currentVersionId,
      track?.currentSchemaHash,
      ...(track?.versions || []).flatMap((version) => [version?.versionId, version?.schemaHash]),
    ]);
    for (const ref of refs) schemaByRef.set(ref, track);
    if (track?.direction === 'RESPONSE') responseTracks.push(track);
    if (track?.direction === 'REQUEST') requestTracks.push(track);
  }

  return {
    evidenceById,
    evidenceByStatus,
    observedStatuses,
    schemaByRef,
    responseTracks,
    requestTracks,
    availableAuthRefs: new Set(context?.runtime?.availableAuthProfileRefs || []),
  };
}

function expectedStatuses(scenario) {
  return unique((scenario?.assertions || [])
    .filter((assertion) => assertion?.type === 'STATUS')
    .flatMap((assertion) => Array.isArray(assertion.expectedStatusCodes) ? assertion.expectedStatusCodes : []));
}

function relevantResponseTracks(knowledge, statuses) {
  const structural = knowledge.responseTracks.filter((track) => isPlainObject(track?.schema));
  if (!statuses.length) return structural;
  const byStatus = structural.filter((track) => track?.statusCode == null || statuses.includes(track.statusCode));
  return byStatus.length ? byStatus : structural;
}

function parseJsonPath(raw) {
  const path = String(raw || '').trim();
  if (!path.startsWith('$')) return { simple: false, valueDependent: false, tokens: [] };
  if (/\?\(|@\.|==|!=|<=|>=|<|>|['"`]/.test(path)) {
    return { simple: false, valueDependent: true, tokens: [] };
  }
  if (path === '$') return { simple: true, valueDependent: false, tokens: [] };

  const tokens = [];
  let rest = path.slice(1);
  const tokenRe = /^(?:\.([A-Za-z0-9_-]+)|\[(\d+|\*)\])/;
  while (rest.length) {
    const match = rest.match(tokenRe);
    if (!match) return { simple: false, valueDependent: false, tokens: [] };
    if (match[1]) tokens.push({ type: 'property', value: match[1] });
    else tokens.push({ type: 'array', value: match[2] });
    rest = rest.slice(match[0].length);
  }
  return { simple: true, valueDependent: false, tokens };
}

function resolveSchemaNode(schema, tokens, index = 0) {
  if (!isPlainObject(schema)) return null;
  if (index >= tokens.length) return schema;

  if (Array.isArray(schema.oneOf)) {
    for (const child of schema.oneOf) {
      const resolved = resolveSchemaNode(child, tokens, index);
      if (resolved) return resolved;
    }
  }
  if (Array.isArray(schema.anyOf)) {
    for (const child of schema.anyOf) {
      const resolved = resolveSchemaNode(child, tokens, index);
      if (resolved) return resolved;
    }
  }

  const token = tokens[index];
  if (token.type === 'property') {
    const child = schema?.properties?.[token.value];
    return child ? resolveSchemaNode(child, tokens, index + 1) : null;
  }
  if (token.type === 'array') {
    return schema?.items ? resolveSchemaNode(schema.items, tokens, index + 1) : null;
  }
  return null;
}

function findSchemaSupport(tracks, rawPath) {
  const parsed = parseJsonPath(rawPath);
  if (!parsed.simple) return { parsed, track: null, node: null };
  for (const track of tracks) {
    const node = resolveSchemaNode(track?.schema, parsed.tokens);
    if (node) return { parsed, track, node };
  }
  return { parsed, track: null, node: null };
}

function schemaAllowsExactValue(node, expected) {
  if (!isPlainObject(node)) return false;
  if (Object.prototype.hasOwnProperty.call(node, 'const')) {
    return JSON.stringify(node.const) === JSON.stringify(expected);
  }
  if (Array.isArray(node.enum)) {
    return node.enum.some((value) => JSON.stringify(value) === JSON.stringify(expected));
  }
  return false;
}

function addSchemaGrounding(scenario, track) {
  const ref = track?.trackId || track?.currentVersionId || track?.currentSchemaHash;
  if (ref) boundedPush(scenario.grounding.schemaRefs, ref, 20);
}

function scenarioHasSchemaAssertionForTrack(scenario, knowledge, track) {
  return (scenario?.assertions || []).some((assertion) => {
    if (assertion?.type !== 'SCHEMA') return false;
    return knowledge.schemaByRef.get(assertion.schemaRef) === track;
  });
}

function schemaAssertionProvesJsonPathCapability(scenario, knowledge, responseTracks, predicate) {
  for (const assertion of scenario?.assertions || []) {
    if (!['JSON_PATH_EXISTS', 'JSON_PATH_EQUALS'].includes(assertion?.type)) continue;
    const support = findSchemaSupport(responseTracks, assertion.path);
    if (!support.node || !support.track || !predicate(support.node)) continue;
    if (scenarioHasSchemaAssertionForTrack(scenario, knowledge, support.track)) return true;
  }
  return false;
}

function jsonPathEqualsProvesNonEmpty(scenario) {
  return (scenario?.assertions || []).some((assertion) => (
    assertion?.type === 'JSON_PATH_EQUALS'
    && Array.isArray(assertion.expected)
    && assertion.expected.length > 0
  ));
}

function schemaAssertionProvesNonEmpty(scenario, knowledge, responseTracks) {
  return schemaAssertionProvesJsonPathCapability(
    scenario,
    knowledge,
    responseTracks,
    (node) => node?.type === 'array' && Number.isInteger(node?.minItems) && node.minItems >= 1,
  );
}

function addAssertionCapabilityGap({ scenario, index, addIssue, reason }) {
  markReview(scenario, reason);
  addIssue({
    code: 'SEMANTIC_ASSERTION_CAPABILITY_GAP',
    path: `modelOutput.scenarios[${index}].assertions`,
    severity: 'REVIEW',
    reason,
    action: 'REVIEW_REQUIRED',
  });
}

function addEvidenceGroundingForStatus(scenario, knowledge, statusCode) {
  const current = new Set(scenario.grounding.evidenceRefs || []);
  const alreadySupports = [...current].some((ref) => knowledge.evidenceById.get(ref)?.statusCode === statusCode);
  if (alreadySupports) return false;
  const candidate = (knowledge.evidenceByStatus.get(statusCode) || [])[0];
  if (!candidate?.evidenceId) return false;
  boundedPush(scenario.grounding.evidenceRefs, candidate.evidenceId, 20);
  return true;
}

function markInference(scenario, reason) {
  downgradeGrounding(scenario, 'INFERRED');
  capConfidence(scenario, 'MEDIUM');
  addGuardRationale(scenario, reason);
}

function markAssumption(scenario, reason) {
  downgradeGrounding(scenario, 'ASSUMED');
  capConfidence(scenario, 'LOW');
  addGuardRationale(scenario, reason);
}

function markNeedsData(scenario, reason) {
  scenario.automationHints.needsData = true;
  addHintReason(scenario, reason);
}

function markReview(scenario, reason) {
  scenario.automationHints.reviewRequired = true;
  addHintReason(scenario, reason);
}

function requestPlaceholderNames(path) {
  const names = new Set();
  const text = String(path || '');
  for (const match of text.matchAll(/\{([A-Za-z0-9_-]+)\}/g)) names.add(match[1]);
  for (const match of text.matchAll(/(?:^|\/)\:([A-Za-z0-9_-]+)/g)) names.add(match[1]);
  return names;
}

function requestSchemaSupportsBodyKeys(requestTracks, body) {
  if (!nonEmptyObject(body)) return { modeled: Boolean(requestTracks.length), unknownKeys: [] };
  const structural = requestTracks.filter((track) => isPlainObject(track?.schema));
  if (!structural.length) return { modeled: false, unknownKeys: Object.keys(body) };
  const known = new Set(structural.flatMap((track) => Object.keys(track.schema?.properties || {})));
  return { modeled: true, unknownKeys: Object.keys(body).filter((key) => !known.has(key)) };
}

function hasObservedContentType(knowledge, expected, statuses) {
  const tracks = relevantResponseTracks(knowledge, statuses);
  const available = new Set(tracks.flatMap((track) => track?.contentTypes || []).map((value) => String(value).toLowerCase()));
  return (expected || []).every((value) => available.has(String(value).toLowerCase()));
}

function semanticGuardScenario(scenario, index, context, knowledge, issues, mutations) {
  ensureScenarioContainers(scenario);
  const scenarioId = scenario.scenarioId || `scenario_${index + 1}`;
  const scenarioIssues = [];
  const before = {
    grounding: scenario.grounding.level,
    confidence: scenario.confidence,
    needsData: scenario.automationHints.needsData === true,
    reviewRequired: scenario.automationHints.reviewRequired === true,
  };
  const statuses = expectedStatuses(scenario);
  const responseTracks = relevantResponseTracks(knowledge, statuses);

  const addIssue = issueCollector(scenarioId, issues, scenarioIssues).bind(scenario);

  for (const statusCode of statuses) {
    if (knowledge.observedStatuses.has(statusCode)) {
      if (scenario.grounding.level === 'OBSERVED' && addEvidenceGroundingForStatus(scenario, knowledge, statusCode)) {
        addIssue({
          code: 'SEMANTIC_EVIDENCE_AUTO_GROUNDED',
          path: `modelOutput.scenarios[${index}].grounding.evidenceRefs`,
          severity: 'INFO',
          action: 'ADD_EVIDENCE_REF',
        });
      }
      continue;
    }

    const reason = `O status HTTP ${statusCode} não foi observado nas evidências selecionadas para este endpoint.`;
    if (scenario.grounding.level === 'OBSERVED') markInference(scenario, reason);
    markReview(scenario, reason);
    addIssue({
      code: 'SEMANTIC_STATUS_UNOBSERVED',
      path: `modelOutput.scenarios[${index}].assertions`,
      severity: 'REVIEW',
      reason,
      action: 'REVIEW_REQUIRED',
    });
  }

  for (let assertionIndex = 0; assertionIndex < (scenario.assertions || []).length; assertionIndex += 1) {
    const assertion = scenario.assertions[assertionIndex];
    const path = `modelOutput.scenarios[${index}].assertions[${assertionIndex}]`;

    if (assertion?.type === 'SCHEMA') {
      const track = knowledge.schemaByRef.get(assertion.schemaRef);
      if (track) {
        addSchemaGrounding(scenario, track);
        if (track.direction === 'RESPONSE' && statuses.length && track.statusCode != null && !statuses.includes(track.statusCode)) {
          const reason = `O schema referenciado pertence ao response ${track.statusCode}, mas o cenário espera ${statuses.join('/')}.`;
          markReview(scenario, reason);
          markInference(scenario, reason);
          addIssue({ code: 'SEMANTIC_SCHEMA_STATUS_MISMATCH', path, severity: 'REVIEW', reason, action: 'REVIEW_REQUIRED' });
        }
      }
      continue;
    }

    if (assertion?.type === 'CONTENT_TYPE') {
      if (!hasObservedContentType(knowledge, assertion.expected, statuses)) {
        const reason = 'O Content-Type esperado não está presente nos schemas de resposta observados aplicáveis ao cenário.';
        if (scenario.grounding.level === 'OBSERVED') markInference(scenario, reason);
        markReview(scenario, reason);
        addIssue({ code: 'SEMANTIC_CONTENT_TYPE_UNOBSERVED', path, severity: 'REVIEW', reason, action: 'REVIEW_REQUIRED' });
      }
      continue;
    }

    if (assertion?.type === 'JSON_PATH_EXISTS' || assertion?.type === 'JSON_PATH_EQUALS') {
      const support = findSchemaSupport(responseTracks, assertion.path);
      if (support.parsed.valueDependent) {
        const reason = 'O JSONPath depende de um valor/literal que não existe no contexto sanitizado; é necessária massa de teste controlada.';
        markInference(scenario, reason);
        markNeedsData(scenario, reason);
        addIssue({ code: 'SEMANTIC_JSON_PATH_VALUE_DEPENDENT', path: `${path}.path`, severity: 'DATA', reason, action: 'NEEDS_DATA' });
        continue;
      }
      if (!support.parsed.simple || !support.node) {
        const reason = 'O JSONPath não pôde ser comprovado pelo schema estrutural de resposta disponível.';
        markAssumption(scenario, reason);
        markReview(scenario, reason);
        addIssue({ code: 'SEMANTIC_JSON_PATH_UNMODELED', path: `${path}.path`, severity: 'REVIEW', reason, action: 'REVIEW_REQUIRED' });
        continue;
      }

      addSchemaGrounding(scenario, support.track);
      if (assertion.type === 'JSON_PATH_EQUALS' && !schemaAllowsExactValue(support.node, assertion.expected)) {
        const reason = 'O valor literal esperado não é provado por const/enum do schema nem por Evidence (payloads não fazem parte do contexto).';
        markAssumption(scenario, reason);
        markNeedsData(scenario, reason);
        addIssue({ code: 'SEMANTIC_EXACT_VALUE_UNGROUNDED', path: `${path}.expected`, severity: 'DATA', reason, action: 'NEEDS_DATA' });
      }
      continue;
    }

    if (assertion?.type === 'HEADER_EXISTS') {
      const header = String(assertion.name || '').trim().toLowerCase();
      if (header !== 'content-type' || !hasObservedContentType(knowledge, ['application/json'], statuses)) {
        const reason = `O header de resposta '${assertion.name}' não é comprovado pelo contexto disponível.`;
        if (scenario.grounding.level === 'OBSERVED') markInference(scenario, reason);
        markReview(scenario, reason);
        addIssue({ code: 'SEMANTIC_RESPONSE_HEADER_UNOBSERVED', path: `${path}.name`, severity: 'REVIEW', reason, action: 'REVIEW_REQUIRED' });
      }
    }
  }

  const request = scenario.request || {};
  const queryKeys = Object.keys(request.query || {});
  if (queryKeys.length) {
    const reason = `Query params (${queryKeys.join(', ')}) não são modelados pelo Catalog Context v1; sua existência precisa ser revisada.`;
    markAssumption(scenario, reason);
    markNeedsData(scenario, reason);
    markReview(scenario, reason);
    addIssue({ code: 'SEMANTIC_QUERY_PARAM_UNMODELED', path: `modelOutput.scenarios[${index}].request.query`, severity: 'REVIEW', reason, action: 'REVIEW_REQUIRED' });
  }

  const pathParams = request.pathParams || {};
  const pathParamKeys = Object.keys(pathParams);
  if (pathParamKeys.length) {
    const placeholders = requestPlaceholderNames(context?.endpoint?.normalizedPath);
    const unknown = pathParamKeys.filter((key) => !placeholders.has(key));
    if (unknown.length) {
      const reason = `Path params (${unknown.join(', ')}) não existem no normalizedPath observado.`;
      markAssumption(scenario, reason);
      markReview(scenario, reason);
      addIssue({ code: 'SEMANTIC_PATH_PARAM_UNMODELED', path: `modelOutput.scenarios[${index}].request.pathParams`, severity: 'REVIEW', reason, action: 'REVIEW_REQUIRED' });
    } else {
      const reason = 'Valores de path params precisam ser fornecidos por massa de teste/runtime.';
      markInference(scenario, reason);
      markNeedsData(scenario, reason);
      addIssue({ code: 'SEMANTIC_PATH_PARAM_NEEDS_DATA', path: `modelOutput.scenarios[${index}].request.pathParams`, severity: 'DATA', reason, action: 'NEEDS_DATA' });
    }
  }

  const body = request.body;
  const hasBody = body != null && (!(isPlainObject(body)) || Object.keys(body).length > 0);
  if (hasBody) {
    const method = String(context?.endpoint?.method || '').toUpperCase();
    if (method === 'GET' || method === 'HEAD') {
      const reason = `${method} não possui request schema observado que sustente o body gerado; o cenário precisa de revisão.`;
      markAssumption(scenario, reason);
      markNeedsData(scenario, reason);
      markReview(scenario, reason);
      addIssue({ code: 'SEMANTIC_BODY_UNSUPPORTED_FOR_METHOD', path: `modelOutput.scenarios[${index}].request.body`, severity: 'REVIEW', reason, action: 'REVIEW_REQUIRED' });
    } else {
      const support = requestSchemaSupportsBodyKeys(knowledge.requestTracks, body);
      if (!support.modeled) {
        const reason = 'Não existe request schema estrutural observado que sustente o body gerado.';
        markAssumption(scenario, reason);
        markNeedsData(scenario, reason);
        markReview(scenario, reason);
        addIssue({ code: 'SEMANTIC_REQUEST_BODY_UNMODELED', path: `modelOutput.scenarios[${index}].request.body`, severity: 'REVIEW', reason, action: 'REVIEW_REQUIRED' });
      } else if (support.unknownKeys.length) {
        const reason = `Campos do body não aparecem no request schema observado: ${support.unknownKeys.join(', ')}.`;
        markAssumption(scenario, reason);
        markNeedsData(scenario, reason);
        markReview(scenario, reason);
        addIssue({ code: 'SEMANTIC_REQUEST_BODY_FIELDS_UNMODELED', path: `modelOutput.scenarios[${index}].request.body`, severity: 'REVIEW', reason, action: 'REVIEW_REQUIRED' });
      } else {
        const reason = 'O formato do body é modelado, mas seus valores precisam ser fornecidos por massa de teste controlada.';
        markInference(scenario, reason);
        markNeedsData(scenario, reason);
        addIssue({ code: 'SEMANTIC_REQUEST_BODY_NEEDS_DATA', path: `modelOutput.scenarios[${index}].request.body`, severity: 'DATA', reason, action: 'NEEDS_DATA' });
      }
    }
  }

  const headerKeys = Object.keys(request.headers || {});
  if (headerKeys.length) {
    const requestContentTypes = new Set(knowledge.requestTracks.flatMap((track) => track?.contentTypes || []).map((value) => String(value).toLowerCase()));
    const unsupported = headerKeys.filter((key) => {
      if (key.toLowerCase() !== 'content-type') return true;
      const value = request.headers[key];
      return typeof value !== 'string' || !requestContentTypes.has(value.toLowerCase());
    });
    if (unsupported.length) {
      const reason = `Headers de request não são comprovados pelo contexto: ${unsupported.join(', ')}.`;
      markAssumption(scenario, reason);
      markReview(scenario, reason);
      addIssue({ code: 'SEMANTIC_REQUEST_HEADER_UNMODELED', path: `modelOutput.scenarios[${index}].request.headers`, severity: 'REVIEW', reason, action: 'REVIEW_REQUIRED' });
    }
  }

  const authStatusesExpected = statuses.some((status) => HTTP_AUTH_STATUSES.has(status));
  if (authStatusesExpected && scenario.authRequirement === 'NONE') {
    const reason = 'O cenário espera 401/403, mas declara authRequirement NONE; a intenção de autenticação está contraditória.';
    markAssumption(scenario, reason);
    markReview(scenario, reason);
    addIssue({ code: 'SEMANTIC_AUTH_CONTRADICTION', path: `modelOutput.scenarios[${index}].authRequirement`, severity: 'REVIEW', reason, action: 'REVIEW_REQUIRED' });
  } else if (scenario.authRequirement === 'REQUIRED' || scenario.authRequirement === 'UNAUTHENTICATED') {
    const hasObservedAuthSignal = [...knowledge.observedStatuses].some((status) => HTTP_AUTH_STATUSES.has(status));
    if (!hasObservedAuthSignal && knowledge.availableAuthRefs.size === 0) {
      const reason = 'A necessidade de autenticação não é comprovada por 401/403 observado nem por Auth Profile configurado.';
      markAssumption(scenario, reason);
      markReview(scenario, reason);
      addIssue({ code: 'SEMANTIC_AUTH_UNSUPPORTED', path: `modelOutput.scenarios[${index}].authRequirement`, severity: 'REVIEW', reason, action: 'REVIEW_REQUIRED' });
    } else if (scenario.grounding.level === 'OBSERVED' && !hasObservedAuthSignal) {
      markInference(scenario, 'A configuração de Auth Profile permite inferir autenticação, mas ela não foi observada nas evidências selecionadas.');
    }
  }

  const semanticText = `${scenario.title || ''} ${scenario.objective || ''}`;

  if (TARGET_PATH_MUTATION_RE.test(semanticText)) {
    const reason = `O cenário exige alterar o path/rota alvo, mas qagent.api-test-dsl.v1 fixa o path em '${context?.endpoint?.normalizedPath || 'endpoint observado'}'; target mutation ainda não é suportada.`;
    markAssumption(scenario, reason);
    markReview(scenario, reason);
    addIssue({ code: 'SEMANTIC_TARGET_MUTATION_UNSUPPORTED', path: `modelOutput.scenarios[${index}].objective`, severity: 'REVIEW', reason, action: 'REVIEW_REQUIRED' });
  }

  if (TARGET_METHOD_MUTATION_RE.test(semanticText)) {
    const reason = `O cenário exige alterar o HTTP Method, mas qagent.api-test-dsl.v1 fixa o method em '${String(context?.endpoint?.method || '').toUpperCase() || 'método observado'}'; target mutation ainda não é suportada.`;
    markAssumption(scenario, reason);
    markReview(scenario, reason);
    addIssue({ code: 'SEMANTIC_TARGET_MUTATION_UNSUPPORTED', path: `modelOutput.scenarios[${index}].objective`, severity: 'REVIEW', reason, action: 'REVIEW_REQUIRED' });
  }

  if (FAULT_INJECTION_RE.test(semanticText) && statuses.some((status) => Number(status) >= 500)) {
    const reason = 'O cenário depende de provocar ou reproduzir uma falha interna do servidor, mas qagent.api-test-dsl.v1 ainda não possui fault injection, mock ou setup capaz de criar essa condição de forma determinística.';
    markAssumption(scenario, reason);
    markReview(scenario, reason);
    addIssue({ code: 'SEMANTIC_FAULT_INJECTION_UNSUPPORTED', path: `modelOutput.scenarios[${index}].objective`, severity: 'REVIEW', reason, action: 'REVIEW_REQUIRED' });
  }

  if (LATENCY_RE.test(semanticText)) {
    const reason = 'O objetivo menciona latência/performance, mas qagent.api-test-dsl.v1 ainda não possui assertion de latência; o cenário não é executável como está.';
    markReview(scenario, reason);
    addIssue({ code: 'SEMANTIC_ASSERTION_COVERAGE_GAP', path: `modelOutput.scenarios[${index}].assertions`, severity: 'REVIEW', reason, action: 'REVIEW_REQUIRED' });
  }

  if (COUNT_RELATION_INTENT_RE.test(semanticText)) {
    addAssertionCapabilityGap({
      scenario,
      index,
      addIssue,
      reason: 'O objetivo exige validar correção/relação de contagem (por exemplo count versus tamanho da lista), mas qagent.api-test-dsl.v1 não possui assertion relacional entre dois valores JSON.',
    });
  }

  if (NON_EMPTY_INTENT_RE.test(semanticText)
    && !jsonPathEqualsProvesNonEmpty(scenario)
    && !schemaAssertionProvesNonEmpty(scenario, knowledge, responseTracks)) {
    addAssertionCapabilityGap({
      scenario,
      index,
      addIssue,
      reason: 'O objetivo exige provar que uma lista/array não está vazio, mas as assertions atuais só provam existência/estrutura; a DSL v1 não expressa cardinalidade sem uma constraint minItems coberta por SCHEMA.',
    });
  }

  if (UUID_INTENT_RE.test(semanticText)
    && !schemaAssertionProvesJsonPathCapability(scenario, knowledge, responseTracks, (node) => String(node?.format || '').toLowerCase() === 'uuid')) {
    addAssertionCapabilityGap({
      scenario,
      index,
      addIssue,
      reason: 'O objetivo afirma formato UUID, mas JSON_PATH_EXISTS só prova presença. Para provar o formato com a DSL v1 é necessário um SCHEMA assertion cujo schema estrutural modele esse campo como format=uuid.',
    });
  }

  if (BOOLEAN_INTENT_RE.test(semanticText)
    && !schemaAssertionProvesJsonPathCapability(scenario, knowledge, responseTracks, (node) => node?.type === 'boolean')) {
    addAssertionCapabilityGap({
      scenario,
      index,
      addIssue,
      reason: 'O objetivo afirma tipo boolean, mas JSON_PATH_EXISTS só prova presença. Para provar o tipo com a DSL v1 é necessário um SCHEMA assertion cujo schema estrutural modele esse campo como boolean.',
    });
  }

  if (DATE_TIME_INTENT_RE.test(semanticText)
    && !schemaAssertionProvesJsonPathCapability(scenario, knowledge, responseTracks, (node) => ['date-time', 'date', 'time'].includes(String(node?.format || '').toLowerCase()))) {
    addAssertionCapabilityGap({
      scenario,
      index,
      addIssue,
      reason: 'O objetivo afirma formato de data/hora válido, mas JSON_PATH_EXISTS só prova presença. Para provar o formato com a DSL v1 é necessário um SCHEMA assertion cujo schema estrutural modele o campo com format date/date-time/time.',
    });
  }

  for (const extract of scenario.extract || []) {
    if (extract?.source === 'JSON_PATH') {
      const support = findSchemaSupport(responseTracks, extract.selector);
      if (!support.parsed.simple || !support.node) {
        const reason = `O extract '${extract.name}' usa JSONPath não comprovado pelo schema de resposta.`;
        markReview(scenario, reason);
        addIssue({ code: 'SEMANTIC_EXTRACT_UNMODELED', path: `modelOutput.scenarios[${index}].extract`, severity: 'REVIEW', reason, action: 'REVIEW_REQUIRED' });
      }
    }
  }

  const after = {
    grounding: scenario.grounding.level,
    confidence: scenario.confidence,
    needsData: scenario.automationHints.needsData === true,
    reviewRequired: scenario.automationHints.reviewRequired === true,
  };
  if (JSON.stringify(before) !== JSON.stringify(after) || scenarioIssues.some((item) => item.action === 'ADD_EVIDENCE_REF')) {
    mutations.push({ scenarioId, before, after, issueCodes: unique(scenarioIssues.map((item) => item.code)) });
  }
}

export function applySemanticGroundingGuardV1(modelOutput, context) {
  const output = cloneJson(modelOutput);
  const knowledge = buildKnowledge(context || {});
  const issues = [];
  const mutations = [];

  for (let index = 0; index < (Array.isArray(output?.scenarios) ? output.scenarios.length : 0); index += 1) {
    semanticGuardScenario(output.scenarios[index], index, context || {}, knowledge, issues, mutations);
  }

  const issuesByCode = {};
  for (const issue of issues) issuesByCode[issue.code] = (issuesByCode[issue.code] || 0) + 1;
  const changedScenarioIds = new Set(mutations.map((item) => item.scenarioId));

  return {
    output,
    diagnostics: {
      guardVersion: SEMANTIC_GROUNDING_GUARD_VERSION,
      scenarioCount: Array.isArray(output?.scenarios) ? output.scenarios.length : 0,
      changedScenarioCount: changedScenarioIds.size,
      issueCount: issues.length,
      issuesByCode,
      mutations: mutations.slice(0, 20),
      issues: issues.slice(0, 40),
    },
  };
}

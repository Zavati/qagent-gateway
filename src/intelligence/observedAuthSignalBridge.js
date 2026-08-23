export const OBSERVED_AUTH_SIGNAL_BRIDGE_VERSION = 'qagent.observed-auth-signal-bridge.v1.1';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function uniqueStrings(values, limit = 20) {
  const out = [];
  for (const value of values || []) {
    const text = String(value ?? '').trim();
    if (!text || out.includes(text)) continue;
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function ensureAutomationHints(scenario) {
  if (!scenario.automationHints || typeof scenario.automationHints !== 'object' || Array.isArray(scenario.automationHints)) {
    scenario.automationHints = {};
  }
  if (!Array.isArray(scenario.automationHints.reasons)) scenario.automationHints.reasons = [];
  return scenario.automationHints;
}

function authRationale(scheme) {
  const normalized = String(scheme || 'UNKNOWN').trim().toUpperCase();
  return `QAgent Auth Bridge: autenticação ${normalized} foi observada de forma sanitizada para este endpoint.`;
}

function mixedRationale() {
  return 'QAgent Auth Bridge: foram observadas chamadas com e sem autenticação para este endpoint; a política de autenticação precisa de revisão antes da execução automática.';
}

function optionalPublicRationale() {
  return 'QAgent Auth Bridge: sucesso 2xx sem autenticação foi observado para este endpoint; este cenário pode executar no caminho público sem credencial.';
}

function optionalAuthenticatedRationale(scheme) {
  const normalized = String(scheme || 'UNKNOWN').trim().toUpperCase();
  return `QAgent Auth Bridge: o endpoint também possui caminho autenticado ${normalized} observado; este cenário usa o Auth Profile compatível resolvido.`;
}

function isHttp2xx(statusCode) {
  return Number.isInteger(statusCode) && statusCode >= 200 && statusCode < 300;
}

function scenarioAuthEvidence(scenario, context) {
  const refs = new Set(scenario?.grounding?.evidenceRefs || []);
  const relevant = (context?.evidence || []).filter((item) => refs.has(item?.evidenceId));
  return {
    hasAuthenticatedSuccess: relevant.some((item) => item?.authObserved === true && isHttp2xx(item?.statusCode)),
    hasUnauthenticatedSuccess: relevant.some((item) => item?.authObserved === false && isHttp2xx(item?.statusCode)),
  };
}

function isExplicitAuthScenario(scenario) {
  if (String(scenario?.category || '').toUpperCase() === 'AUTHORIZATION') return true;
  const statuses = (scenario?.assertions || [])
    .filter((assertion) => assertion?.type === 'STATUS')
    .flatMap((assertion) => Array.isArray(assertion?.expectedStatusCodes) ? assertion.expectedStatusCodes : []);
  if (statuses.some((status) => status === 401 || status === 403)) return true;
  const text = `${scenario?.title || ''} ${scenario?.objective || ''}`.toLowerCase();
  return /(autentica|authorization|bearer|token|credencial|sem autentica|não autentic)/i.test(text);
}

/**
 * Makes observed authentication a system-owned decision after AI + Semantic Guard.
 * No credential/header value is ever accepted or produced here.
 */
export function applyObservedAuthSignalBridgeV1(modelOutput, context) {
  const output = cloneJson(modelOutput);
  const authObservation = context?.runtime?.authObservation || { status: 'UNKNOWN', scheme: null, evidenceRefs: [] };
  const status = String(authObservation.status || 'UNKNOWN').toUpperCase();
  const scheme = authObservation.scheme ? String(authObservation.scheme).toUpperCase() : null;
  const evidenceRefs = uniqueStrings(authObservation.evidenceRefs || []);
  let changedScenarioCount = 0;
  let forcedRequiredCount = 0;
  let preservedUnauthenticatedCount = 0;
  let mixedReviewCount = 0;
  let optionalPublicScenarioCount = 0;
  let optionalAuthenticatedScenarioCount = 0;
  const mutations = [];

  for (const scenario of output.scenarios || []) {
    const beforeRequirement = scenario.authRequirement;
    const beforeReview = scenario.automationHints?.reviewRequired === true;
    let changed = false;

    if (status === 'REQUIRED') {
      if (scenario.authRequirement === 'UNAUTHENTICATED') {
        preservedUnauthenticatedCount += 1;
      } else {
        if (scenario.authRequirement !== 'REQUIRED') {
          scenario.authRequirement = 'REQUIRED';
          forcedRequiredCount += 1;
          changed = true;
        }

        if (scenario.grounding && typeof scenario.grounding === 'object') {
          scenario.grounding.rationale = uniqueStrings([
            ...(scenario.grounding.rationale || []),
            authRationale(scheme),
          ], 12);
          scenario.grounding.evidenceRefs = uniqueStrings([
            ...(scenario.grounding.evidenceRefs || []),
            ...evidenceRefs,
          ], 20);
        }
      }
    } else if (status === 'OPTIONAL') {
      const evidence = scenarioAuthEvidence(scenario, context);
      const explicitAuthScenario = isExplicitAuthScenario(scenario);
      const hasResolvedProfile = Boolean(context?.runtime?.defaultAuthProfileRef);

      if (scenario.authRequirement === 'UNAUTHENTICATED' || explicitAuthScenario) {
        // Preserve explicit auth/unauthenticated test intent. Semantic Guard is
        // responsible for keeping unobserved 401/403 expectations in review.
      } else if (evidence.hasAuthenticatedSuccess && !evidence.hasUnauthenticatedSuccess && hasResolvedProfile) {
        if (scenario.authRequirement !== 'REQUIRED') {
          scenario.authRequirement = 'REQUIRED';
          changed = true;
        }
        optionalAuthenticatedScenarioCount += 1;
        if (scenario.grounding && typeof scenario.grounding === 'object') {
          scenario.grounding.rationale = uniqueStrings([
            ...(scenario.grounding.rationale || []),
            optionalAuthenticatedRationale(scheme),
          ], 12);
        }
      } else {
        // A 2xx without auth proves public capability. Prefer the least-privilege
        // executable path for ordinary functional/schema scenarios. This also
        // removes false REQUIRED decisions caused only by a configured profile.
        if (scenario.authRequirement !== 'NONE') {
          scenario.authRequirement = 'NONE';
          changed = true;
        }
        optionalPublicScenarioCount += 1;
        if (scenario.grounding && typeof scenario.grounding === 'object') {
          scenario.grounding.rationale = uniqueStrings([
            ...(scenario.grounding.rationale || []),
            optionalPublicRationale(),
          ], 12);
        }
      }
    } else if (status === 'MIXED') {
      const hints = ensureAutomationHints(scenario);
      if (hints.reviewRequired !== true) {
        hints.reviewRequired = true;
        mixedReviewCount += 1;
        changed = true;
      }
      hints.reasons = uniqueStrings([...(hints.reasons || []), mixedRationale()], 10);
    }

    if (changed) {
      changedScenarioCount += 1;
      mutations.push({
        scenarioId: scenario.scenarioId || null,
        before: { authRequirement: beforeRequirement, reviewRequired: beforeReview },
        after: {
          authRequirement: scenario.authRequirement,
          reviewRequired: scenario.automationHints?.reviewRequired === true,
        },
      });
    }
  }

  return {
    output,
    diagnostics: {
      bridgeVersion: OBSERVED_AUTH_SIGNAL_BRIDGE_VERSION,
      observationStatus: status,
      observedScheme: scheme,
      evidenceCount: evidenceRefs.length,
      compatibleProfileCount: (context?.runtime?.availableAuthProfileRefs || []).length,
      defaultProfileSelected: Boolean(context?.runtime?.defaultAuthProfileRef),
      changedScenarioCount,
      forcedRequiredCount,
      preservedUnauthenticatedCount,
      mixedReviewCount,
      optionalPublicScenarioCount,
      optionalAuthenticatedScenarioCount,
      mutations: mutations.slice(0, 20),
    },
  };
}

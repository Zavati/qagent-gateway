const EXACT_ROUTES = new Map([
  ['GET /health', 'health'],
  ['POST /health', 'health'],
  ['GET /debug/openai-models', 'debugOpenAIModels'],
  ['POST /v1/auth/login', 'authLogin'],
  ['POST /v1/auth/forgot-password', 'forgotPassword'],
  ['POST /v1/auth/reset-password', 'resetPassword'],
  ['GET /v1/auth/me', 'authMe'],
  ['POST /v1/plugin/session', 'pluginSessionCreate'],
  ['POST /v1/plugin/observation-grants', 'pluginObservationGrantCreate'],
  ['GET /v1/console/license', 'consoleLicense'],
  ['GET /v1/console/payments', 'consolePayments'],
  ['GET /v1/console/ai-providers', 'consoleAiProvidersGet'],
  ['GET /v1/console/ai-config', 'consoleAiConfigGet'],
  ['PUT /v1/console/ai-config', 'consoleAiConfigPut'],
  ['DELETE /v1/console/ai-config', 'consoleAiConfigDelete'],
  ['GET /v1/console/organization', 'consoleOrganizationGet'],
  ['PATCH /v1/console/organization', 'consoleOrganizationPatch'],
  ['GET /v1/console/projects', 'consoleProjectsList'],
  ['POST /v1/console/projects', 'consoleProjectsCreate'],
  ['POST /v1/console/rotate-clientkey', 'rotateClientKey'],
  ['GET /v1/license', 'getLicense'],
  ['POST /v1/signup-trial', 'signupTrial'],
  ['GET /v1/billing/plans', 'billingPlans'],
  ['POST /v1/billing/checkout', 'billingCheckout'],
  ['POST /v1/webhooks/email-dispatched', 'emailDispatchedWebhook'],
  ['POST /v1/webhooks/payment', 'paymentWebhook'],
  ['POST /v1/generate-tests', 'generateTests'],
  ['POST /v1/autofill', 'autofill'],
]);

export function resolveGatewayRoute(method, pathname) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const normalizedPath = String(pathname || '/');
  const exact = EXACT_ROUTES.get(`${normalizedMethod} ${normalizedPath}`);
  if (exact) {
    return { name: exact, params: {} };
  }

  // Foundation 07.7.3 - internal Runner Control API (HMAC protected)
  if (normalizedPath.startsWith('/internal/v1/runner/runs/')) {
    const segs = normalizedPath.split('/').filter(Boolean);
    if (segs.length === 6 && segs[0] === 'internal' && segs[1] === 'v1' && segs[2] === 'runner' && segs[3] === 'runs') {
      const runId = decodeURIComponent(segs[4]);
      if (segs[5] === 'bundle' && normalizedMethod === 'GET') {
        return { name: 'internalRunnerRunBundleGet', params: { runId } };
      }
      if (segs[5] === 'received' && normalizedMethod === 'POST') {
        return { name: 'internalRunnerRunReceivedPost', params: { runId } };
      }
      if (segs[5] === 'claim' && normalizedMethod === 'POST') {
        return { name: 'internalRunnerRunClaimPost', params: { runId } };
      }
      if (segs[5] === 'heartbeat' && normalizedMethod === 'POST') {
        return { name: 'internalRunnerRunHeartbeatPost', params: { runId } };
      }
      if (segs[5] === 'retry' && normalizedMethod === 'POST') {
        return { name: 'internalRunnerRunRetryPost', params: { runId } };
      }
      if (segs[5] === 'runtime-ready' && normalizedMethod === 'POST') {
        return { name: 'internalRunnerRunRuntimeReadyPost', params: { runId } };
      }
      if (segs[5] === 'http-executed' && normalizedMethod === 'POST') {
        return { name: 'internalRunnerRunHttpExecutedPost', params: { runId } };
      }
      if (segs[5] === 'rejected' && normalizedMethod === 'POST') {
        return { name: 'internalRunnerRunRejectedPost', params: { runId } };
      }
    }
  }

  if (normalizedPath.startsWith('/v1/console/projects/')) {
    const segs = normalizedPath.split('/').filter(Boolean);
    const isProjectBase = segs[0] === 'v1' && segs[1] === 'console' && segs[2] === 'projects';
    if (!isProjectBase) return null;

    // /v1/console/projects/:projectId
    if (segs.length === 4) {
      const projectId = decodeURIComponent(segs[3]);
      const byMethod = {
        GET: 'consoleProjectGet',
        PATCH: 'consoleProjectPatch',
        DELETE: 'consoleProjectDelete',
      };
      const name = byMethod[normalizedMethod];
      if (name) return { name, params: { projectId } };
    }


    // Foundation 07.5.12-A - API Catalog read-only BFF
    if (segs.length === 6 && segs[4] === 'catalog' && segs[5] === 'summary' && normalizedMethod === 'GET') {
      return { name: 'consoleCatalogSummary', params: { projectId: decodeURIComponent(segs[3]) } };
    }
    if (segs.length === 6 && segs[4] === 'catalog' && segs[5] === 'services' && normalizedMethod === 'GET') {
      return { name: 'consoleCatalogServicesList', params: { projectId: decodeURIComponent(segs[3]) } };
    }
    if (segs.length === 6 && segs[4] === 'catalog' && segs[5] === 'endpoints' && normalizedMethod === 'GET') {
      return { name: 'consoleCatalogEndpointsList', params: { projectId: decodeURIComponent(segs[3]) } };
    }
    if (segs.length === 7 && segs[4] === 'catalog' && segs[5] === 'endpoints' && normalizedMethod === 'GET') {
      return { name: 'consoleCatalogEndpointGet', params: { projectId: decodeURIComponent(segs[3]), endpointId: decodeURIComponent(segs[6]) } };
    }
    if (segs.length === 8 && segs[4] === 'catalog' && segs[5] === 'endpoints' && normalizedMethod === 'GET') {
      const params = { projectId: decodeURIComponent(segs[3]), endpointId: decodeURIComponent(segs[6]) };
      if (segs[7] === 'evidence') return { name: 'consoleCatalogEndpointEvidenceList', params };
      if (segs[7] === 'schemas') return { name: 'consoleCatalogEndpointSchemasGet', params };
      if (segs[7] === 'lifecycle-history') return { name: 'consoleCatalogEndpointLifecycleHistoryList', params };
    }

    // Foundation 07.6.2 - deterministic Catalog -> Test Design context preview
    if (segs.length === 8 && segs[4] === 'intelligence' && segs[5] === 'endpoints' && segs[7] === 'test-design-context' && normalizedMethod === 'GET') {
      return {
        name: 'consoleIntelligenceTestDesignContextGet',
        params: { projectId: decodeURIComponent(segs[3]), endpointId: decodeURIComponent(segs[6]) },
      };
    }

    // Foundation 07.6.5-D - persisted Test Design retrieval + generation
    if (segs.length === 8 && segs[4] === 'intelligence' && segs[5] === 'endpoints' && segs[7] === 'test-design') {
      const nameByMethod = {
        GET: 'consoleIntelligenceTestDesignGet',
        POST: 'consoleIntelligenceTestDesignPost',
      };
      const name = nameByMethod[normalizedMethod];
      if (name) {
        return {
          name,
          params: { projectId: decodeURIComponent(segs[3]), endpointId: decodeURIComponent(segs[6]) },
        };
      }
    }

    // Foundation 07.7.2 - Run Contract + immutable Execution Plan foundation
    // /v1/console/projects/:projectId/runs
    if (segs.length === 5 && segs[4] === 'runs') {
      const projectId = decodeURIComponent(segs[3]);
      if (normalizedMethod === 'POST') {
        return { name: 'consoleRunsCreate', params: { projectId } };
      }
    }

    // /v1/console/projects/:projectId/runs/:runId
    if (segs.length === 6 && segs[4] === 'runs' && normalizedMethod === 'GET') {
      return {
        name: 'consoleRunGet',
        params: { projectId: decodeURIComponent(segs[3]), runId: decodeURIComponent(segs[5]) },
      };
    }

    // /v1/console/projects/:projectId/api-services
    if (segs.length === 5 && segs[4] === 'api-services') {
      const projectId = decodeURIComponent(segs[3]);
      const byMethod = {
        GET: 'consoleApiServicesList',
        POST: 'consoleApiServicesCreate',
      };
      const name = byMethod[normalizedMethod];
      if (name) return { name, params: { projectId } };
    }

    // /v1/console/projects/:projectId/api-services/:apiServiceId
    if (segs.length === 6 && segs[4] === 'api-services') {
      const projectId = decodeURIComponent(segs[3]);
      const apiServiceId = decodeURIComponent(segs[5]);
      const byMethod = {
        GET: 'consoleApiServiceGet',
        PATCH: 'consoleApiServicePatch',
        DELETE: 'consoleApiServiceDelete',
      };
      const name = byMethod[normalizedMethod];
      if (name) return { name, params: { projectId, apiServiceId } };
    }

    // /v1/console/projects/:projectId/secrets
    if (segs.length === 5 && segs[4] === 'secrets') {
      const projectId = decodeURIComponent(segs[3]);
      const byMethod = {
        GET: 'consoleSecretsList',
        POST: 'consoleSecretsCreate',
      };
      const name = byMethod[normalizedMethod];
      if (name) return { name, params: { projectId } };
    }

    // /v1/console/projects/:projectId/secrets/:secretId
    if (segs.length === 6 && segs[4] === 'secrets') {
      const projectId = decodeURIComponent(segs[3]);
      const secretId = decodeURIComponent(segs[5]);
      const byMethod = {
        GET: 'consoleSecretGet',
        PATCH: 'consoleSecretPatch',
        DELETE: 'consoleSecretDelete',
      };
      const name = byMethod[normalizedMethod];
      if (name) return { name, params: { projectId, secretId } };
    }

    // /v1/console/projects/:projectId/secrets/:secretId/value
    if (segs.length === 7 && segs[4] === 'secrets' && segs[6] === 'value') {
      const projectId = decodeURIComponent(segs[3]);
      const secretId = decodeURIComponent(segs[5]);
      if (normalizedMethod === 'PUT') {
        return { name: 'consoleSecretValuePut', params: { projectId, secretId } };
      }
    }

    // /v1/console/projects/:projectId/auth-profiles
    if (segs.length === 5 && segs[4] === 'auth-profiles') {
      const projectId = decodeURIComponent(segs[3]);
      const byMethod = {
        GET: 'consoleAuthProfilesList',
        POST: 'consoleAuthProfilesCreate',
      };
      const name = byMethod[normalizedMethod];
      if (name) return { name, params: { projectId } };
    }

    // /v1/console/projects/:projectId/auth-profiles/:authProfileId
    if (segs.length === 6 && segs[4] === 'auth-profiles') {
      const projectId = decodeURIComponent(segs[3]);
      const authProfileId = decodeURIComponent(segs[5]);
      const byMethod = {
        GET: 'consoleAuthProfileGet',
        PATCH: 'consoleAuthProfilePatch',
        DELETE: 'consoleAuthProfileDelete',
      };
      const name = byMethod[normalizedMethod];
      if (name) return { name, params: { projectId, authProfileId } };
    }

    // /v1/console/projects/:projectId/auth-profiles/:authProfileId/environments
    if (segs.length === 7 && segs[4] === 'auth-profiles' && segs[6] === 'environments') {
      const projectId = decodeURIComponent(segs[3]);
      const authProfileId = decodeURIComponent(segs[5]);
      if (normalizedMethod === 'GET') {
        return { name: 'consoleAuthProfileEnvironmentBindingsList', params: { projectId, authProfileId } };
      }
    }

    // /v1/console/projects/:projectId/auth-profiles/:authProfileId/environments/:environmentId
    if (segs.length === 8 && segs[4] === 'auth-profiles' && segs[6] === 'environments') {
      const projectId = decodeURIComponent(segs[3]);
      const authProfileId = decodeURIComponent(segs[5]);
      const environmentId = decodeURIComponent(segs[7]);
      const byMethod = {
        GET: 'consoleAuthProfileEnvironmentBindingGet',
        PUT: 'consoleAuthProfileEnvironmentBindingPut',
        DELETE: 'consoleAuthProfileEnvironmentBindingDelete',
      };
      const name = byMethod[normalizedMethod];
      if (name) return { name, params: { projectId, authProfileId, environmentId } };
    }

    // /v1/console/projects/:projectId/environments
    if (segs.length === 5 && segs[4] === 'environments') {
      const projectId = decodeURIComponent(segs[3]);
      const byMethod = {
        GET: 'consoleEnvironmentsList',
        POST: 'consoleEnvironmentsCreate',
      };
      const name = byMethod[normalizedMethod];
      if (name) return { name, params: { projectId } };
    }

    // /v1/console/projects/:projectId/environments/:environmentId
    if (segs.length === 6 && segs[4] === 'environments') {
      const projectId = decodeURIComponent(segs[3]);
      const environmentId = decodeURIComponent(segs[5]);
      const byMethod = {
        GET: 'consoleEnvironmentGet',
        PATCH: 'consoleEnvironmentPatch',
        DELETE: 'consoleEnvironmentDelete',
      };
      const name = byMethod[normalizedMethod];
      if (name) return { name, params: { projectId, environmentId } };
    }

    // /v1/console/projects/:projectId/environments/:environmentId/api-services
    if (segs.length === 7 && segs[4] === 'environments' && segs[6] === 'api-services') {
      const projectId = decodeURIComponent(segs[3]);
      const environmentId = decodeURIComponent(segs[5]);
      if (normalizedMethod === 'GET') {
        return { name: 'consoleEnvironmentApiBindingsList', params: { projectId, environmentId } };
      }
    }

    // /v1/console/projects/:projectId/environments/:environmentId/api-services/:apiServiceId
    if (segs.length === 8 && segs[4] === 'environments' && segs[6] === 'api-services') {
      const projectId = decodeURIComponent(segs[3]);
      const environmentId = decodeURIComponent(segs[5]);
      const apiServiceId = decodeURIComponent(segs[7]);
      const byMethod = {
        GET: 'consoleEnvironmentApiBindingGet',
        PUT: 'consoleEnvironmentApiBindingPut',
        DELETE: 'consoleEnvironmentApiBindingDelete',
      };
      const name = byMethod[normalizedMethod];
      if (name) return { name, params: { projectId, environmentId, apiServiceId } };
    }

    // /v1/console/projects/:projectId/environments/:environmentId/variables
    if (segs.length === 7 && segs[4] === 'environments' && segs[6] === 'variables') {
      const projectId = decodeURIComponent(segs[3]);
      const environmentId = decodeURIComponent(segs[5]);
      const byMethod = {
        GET: 'consoleEnvironmentVariablesList',
        POST: 'consoleEnvironmentVariablesCreate',
      };
      const name = byMethod[normalizedMethod];
      if (name) return { name, params: { projectId, environmentId } };
    }

    // /v1/console/projects/:projectId/environments/:environmentId/variables/:variableId
    if (segs.length === 8 && segs[4] === 'environments' && segs[6] === 'variables') {
      const projectId = decodeURIComponent(segs[3]);
      const environmentId = decodeURIComponent(segs[5]);
      const variableId = decodeURIComponent(segs[7]);
      const byMethod = {
        GET: 'consoleEnvironmentVariableGet',
        PATCH: 'consoleEnvironmentVariablePatch',
        DELETE: 'consoleEnvironmentVariableDelete',
      };
      const name = byMethod[normalizedMethod];
      if (name) return { name, params: { projectId, environmentId, variableId } };
    }

    // /v1/console/projects/:projectId/environments/:environmentId/runtime-config
    if (segs.length === 7 && segs[4] === 'environments' && segs[6] === 'runtime-config') {
      const projectId = decodeURIComponent(segs[3]);
      const environmentId = decodeURIComponent(segs[5]);
      if (normalizedMethod === 'GET') {
        return { name: 'consoleEnvironmentRuntimeConfigGet', params: { projectId, environmentId } };
      }
    }
  }

  if (normalizedMethod === 'GET' && normalizedPath.startsWith('/debug/payment-event/')) {
    const segs = normalizedPath.split('/').filter(Boolean);
    if (segs.length === 4 && segs[0] === 'debug' && segs[1] === 'payment-event') {
      return {
        name: 'debugPaymentEvent',
        params: {
          provider: segs[2],
          eventId: segs[3],
        },
      };
    }
    return { name: 'invalidDebugPaymentEvent', params: {} };
  }

  return null;
}

export async function dispatchGatewayRoute(req, env, ctx, handlers) {
  const url = new URL(req.url);
  const route = resolveGatewayRoute(req.method, url.pathname);
  if (!route) return null;

  const handler = handlers?.[route.name];
  if (typeof handler !== 'function') {
    throw new Error(`Handler ausente para rota ${route.name}`);
  }

  return await handler(req, env, ctx, route.params);
}

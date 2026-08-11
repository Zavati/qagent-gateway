const EXACT_ROUTES = new Map([
  ['GET /health', 'health'],
  ['POST /health', 'health'],
  ['GET /debug/openai-models', 'debugOpenAIModels'],
  ['POST /v1/auth/login', 'authLogin'],
  ['POST /v1/auth/forgot-password', 'forgotPassword'],
  ['POST /v1/auth/reset-password', 'resetPassword'],
  ['GET /v1/auth/me', 'authMe'],
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

  if (normalizedPath.startsWith('/v1/console/projects/')) {
    const segs = normalizedPath.split('/').filter(Boolean);

    // /v1/console/projects/:projectId
    if (segs.length === 4 && segs[0] === 'v1' && segs[1] === 'console' && segs[2] === 'projects') {
      const projectId = decodeURIComponent(segs[3]);
      const byMethod = {
        GET: 'consoleProjectGet',
        PATCH: 'consoleProjectPatch',
        DELETE: 'consoleProjectDelete',
      };
      const name = byMethod[normalizedMethod];
      if (name) return { name, params: { projectId } };
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

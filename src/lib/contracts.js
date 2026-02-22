export const API_CONTRACT_VERSION = 'v1-2026-02-19';

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

export function errorEnvelope(code, message, requestId = null, details = null) {
  return {
    version: API_CONTRACT_VERSION,
    error: {
      code,
      message,
      requestId,
      details,
    },
  };
}

export const contractsV1 = {
  signupTrial: {
    request: {
      email: 'string',
      name: 'string?',
      company: 'string?',
      source: 'string?',
      acceptTerms: 'boolean(true)',
      acceptPrivacy: 'boolean(true)',
    },
    response201: {
      status: 'ok',
      customer: { customerId: 'string', email: 'string' },
      license: { status: 'trial|active|expired', plan: 'string', trialEndsAt: 'iso-date?', daysLeft: 'number' },
      credentials: { clientKey: 'string', delivery: 'string' },
    },
  },
  paymentWebhook: {
    request: {
      provider: 'string',
      eventId: 'string',
      eventType: 'string',
      occurredAt: 'iso-date',
      customer: { customerId: 'string?', email: 'string?' },
      reference: { clientKey: 'string?', providerCustomerId: 'string?', providerSubscriptionId: 'string?' },
      billing: { status: 'string', plan: 'string?', amount: 'number?', interval: 'string?', periodStart: 'iso-date?', periodEnd: 'iso-date?' },
    },
    response200: {
      status: 'ok',
      processed: 'boolean',
      idempotent: 'boolean',
    },
  },
  emailDispatchedWebhook: {
    request: {
      eventId: 'string',
      occurredAt: 'iso-date',
      type: 'email.dispatched',
      customerId: 'string',
      email: 'string',
      template: 'string',
      metadata: { keyHash: 'string?' },
    },
    response200: {
      status: 'ok',
      processed: 'boolean',
    },
  },
};

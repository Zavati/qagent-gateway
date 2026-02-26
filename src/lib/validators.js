import { sanitizeString } from './sanitize.js';

function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function isIsoDate(v) {
  if (typeof v !== 'string' || !v.trim()) return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

function isEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export function normalizeCases(payload) {
  if (!payload) return null;
  if (Array.isArray(payload.cases)) return payload;
  if (payload.result && Array.isArray(payload.result.cases)) {
    return { ...payload.result, cases: payload.result.cases };
  }
  return null;
}

export function validateGenerateTestsBody(body) {
  if (!body || typeof body !== 'object') {
    fail('Body inválido.');
  }
  const hasJira = body.jira && (body.jira.key || body.jira.title || body.jira.description);
  const hasSource = body.source && body.source.issueKey;
  if (!hasJira && !hasSource) {
    fail("Payload inválido: faltando 'jira' ou 'source.issueKey'.");
  }
  if (body.format && !["step", "bdd"].includes(String(body.format).toLowerCase())) {
    fail('Formato inválido.');
  }
}

export function validateAutofillBody(body) {
  if (!body || typeof body !== 'object') {
    fail('Body inválido.');
  }
  if (!body.url || typeof body.url !== 'string') {
    fail("'url' obrigatório e deve ser string.");
  }
  if (!body.elements || !Array.isArray(body.elements) || body.elements.length === 0) {
    fail("'elements' obrigatório e deve ser array não vazia.");
  }
  for (const el of body.elements) {
    if (!el || typeof el !== 'object') {
      fail('Elemento inválido.');
    }
    if (!el.selector) {
      fail("Elemento inválido: 'selector' obrigatório e válido.");
    }
  }
}

export function validateSignupTrialBody(body) {
  if (!body || typeof body !== 'object') fail('Body inválido.');

  if (!isEmail(body.email)) fail("'email' obrigatório e deve ser válido.");
  if (body.name != null && typeof body.name !== 'string') fail("'name' deve ser string.");
  if (body.company != null && typeof body.company !== 'string') fail("'company' deve ser string.");
  if (body.source != null && typeof body.source !== 'string') fail("'source' deve ser string.");

   // Campos opcionais de senha para criação de conta
   if (body.password != null && typeof body.password !== 'string') fail("'password' deve ser string.");
   if (body.passwordConfirmation != null && typeof body.passwordConfirmation !== 'string') fail("'passwordConfirmation' deve ser string.");
   if (body.password || body.passwordConfirmation) {
     if (!body.password || !body.passwordConfirmation) fail("'password' e 'passwordConfirmation' devem ser informados juntos.");
     if (body.password !== body.passwordConfirmation) fail('As senhas não conferem.');
     const pwd = String(body.password);
     if (pwd.length < 8) fail('Senha muito curta (mínimo 8 caracteres).');
     if (!/[A-Z]/.test(pwd) || !/[a-z]/.test(pwd) || !/[0-9]/.test(pwd)) {
       fail('Senha fraca. Use letras maiúsculas, minúsculas e números.');
     }
   }

  if (body.acceptTerms !== true) fail("'acceptTerms' deve ser true.");
  if (body.acceptPrivacy !== true) fail("'acceptPrivacy' deve ser true.");

  sanitizeString(body.email, 320);
  if (body.name != null) sanitizeString(body.name, 120);
  if (body.company != null) sanitizeString(body.company, 160);
  if (body.source != null) sanitizeString(body.source, 80);
}

export function validateEmailDispatchedBody(body) {
  if (!body || typeof body !== 'object') fail('Body inválido.');

  if (typeof body.eventId !== 'string' || !body.eventId.trim()) fail("'eventId' obrigatório.");
  if (!isIsoDate(body.occurredAt)) fail("'occurredAt' deve ser uma data ISO válida.");
  if (body.type !== 'email.dispatched') fail("'type' deve ser 'email.dispatched'.");
  if (typeof body.customerId !== 'string' || !body.customerId.trim()) fail("'customerId' obrigatório.");
  if (!isEmail(body.email)) fail("'email' obrigatório e deve ser válido.");
  if (typeof body.template !== 'string' || !body.template.trim()) fail("'template' obrigatório.");

  if (body.metadata != null && typeof body.metadata !== 'object') fail("'metadata' deve ser objeto.");
  if (body.metadata?.keyHash != null && typeof body.metadata.keyHash !== 'string') fail("'metadata.keyHash' deve ser string.");

  sanitizeString(body.eventId, 120);
  sanitizeString(body.customerId, 120);
  sanitizeString(body.email, 320);
  sanitizeString(body.template, 120);
}

export function validatePaymentWebhookBody(body) {
  if (!body || typeof body !== 'object') fail('Body inválido.');

  if (typeof body.provider !== 'string' || !body.provider.trim()) fail("'provider' obrigatório.");
  if (typeof body.eventId !== 'string' || !body.eventId.trim()) fail("'eventId' obrigatório.");
  if (typeof body.eventType !== 'string' || !body.eventType.trim()) fail("'eventType' obrigatório.");
  if (!isIsoDate(body.occurredAt)) fail("'occurredAt' deve ser uma data ISO válida.");

  if (!body.reference || typeof body.reference !== 'object') fail("'reference' obrigatório e deve ser objeto.");
  const hasReference = Boolean(
    body.reference.clientKey || body.reference.providerCustomerId || body.reference.providerSubscriptionId
  );
  if (!hasReference) fail("'reference' deve conter ao menos clientKey, providerCustomerId ou providerSubscriptionId.");

  if (!body.billing || typeof body.billing !== 'object') fail("'billing' obrigatório e deve ser objeto.");
  if (typeof body.billing.status !== 'string' || !body.billing.status.trim()) fail("'billing.status' obrigatório.");
  if (body.billing.amount != null && !Number.isFinite(Number(body.billing.amount))) fail("'billing.amount' deve ser número.");
  if (body.billing.periodStart != null && !isIsoDate(body.billing.periodStart)) fail("'billing.periodStart' deve ser ISO válido.");
  if (body.billing.periodEnd != null && !isIsoDate(body.billing.periodEnd)) fail("'billing.periodEnd' deve ser ISO válido.");

  if (body.customer != null && typeof body.customer !== 'object') fail("'customer' deve ser objeto.");
  if (body.customer?.email != null && !isEmail(body.customer.email)) fail("'customer.email' inválido.");

  sanitizeString(body.provider, 60);
  sanitizeString(body.eventId, 160);
  sanitizeString(body.eventType, 120);
  sanitizeString(body.billing.status, 40);
}

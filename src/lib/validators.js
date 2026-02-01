import { sanitizeString } from './sanitize.js';

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
    const err = new Error('Body inválido.');
    err.status = 400;
    throw err;
  }
  const hasJira = body.jira && (body.jira.key || body.jira.title || body.jira.description);
  const hasSource = body.source && body.source.issueKey;
  if (!hasJira && !hasSource) {
    const err = new Error("Payload inválido: faltando 'jira' ou 'source.issueKey'.");
    err.status = 400;
    throw err;
  }
  if (body.format && !["step", "bdd"].includes(String(body.format).toLowerCase())) {
    const err = new Error("Formato inválido.");
    err.status = 400;
    throw err;
  }
}

export function validateAutofillBody(body) {
  if (!body || typeof body !== 'object') {
    const err = new Error('Body inválido.'); err.status = 400; throw err;
  }
  if (!body.url || typeof body.url !== 'string') {
    const err = new Error("'url' obrigatório e deve ser string."); err.status = 400; throw err;
  }
  if (!body.elements || !Array.isArray(body.elements) || body.elements.length === 0) {
    const err = new Error("'elements' obrigatório e deve ser array não vazia."); err.status = 400; throw err;
  }
  for (const el of body.elements) {
    if (!el || typeof el !== 'object') {
      const err = new Error('Elemento inválido.'); err.status = 400; throw err;
    }
    if (!el.selector) {
      const err = new Error("Elemento inválido: 'selector' obrigatório e válido."); err.status = 400; throw err;
    }
  }
}

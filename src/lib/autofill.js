import { sanitizeString, isValidSelector } from './sanitize.js';

export function buildAutofillPrompt(body, maxElems = 150) {
  const list = (body.elements || []).slice(0, maxElems).map((element) => {
    const selector = (element.selector || '').replace(/\s+/g, ' ').trim();
    const type = (element.type || '').replace(/\s+/g, ' ').trim();
    const name = (element.name || '').replace(/\s+/g, ' ').trim();
    const placeholder = (element.placeholder || '').replace(/\s+/g, ' ').trim();
    const semantic = (element.semantic || '').replace(/\s+/g, ' ').trim();
    const tableContext = element.tableContext && typeof element.tableContext === 'object'
      ? sanitizeString(
        `${element.tableContext.cellText || ''} ${element.tableContext.rowText || ''} ${element.tableContext.innerTableText || ''} ${element.tableContext.outerTableText || ''}`,
        800
      ).replace(/\s+/g, ' ').trim()
      : '';

    return `${selector}|${type}|${name}|${placeholder}|${semantic}|${tableContext}`;
  }).join('\n');

  return `Você é um assistente de preenchimento de formulários. Responda SOMENTE JSON com formato: {"actions":[{"selector":"...","value":"...","simulate":false}]}. Gere valores curtos e seguros (max 200 chars), sem HTML ou javascript:, use emails para campos de email, telefones para phone, nomes para name. Página: ${body.url}\nElementos (cada linha: selector|type|name|placeholder|semantic|tableContext):\n${list}`;
}

export function normalizeAutofillResponse(parsed) {
  if (!parsed || !Array.isArray(parsed.actions)) return null;

  const actions = [];
  for (const item of parsed.actions.slice(0, 200)) {
    if (!item || typeof item.selector !== 'string') continue;
    if (!isValidSelector(item.selector)) continue;

    let selector;
    try {
      selector = sanitizeString(item.selector, 500);
    } catch {
      continue;
    }

    let value;
    if (item.value != null) {
      try {
        value = sanitizeString(item.value, 2000);
      } catch {
        continue;
      }
      if (/^javascript:/i.test(value)) continue;
    }

    const action = { selector };
    if (value !== undefined) action.value = value;
    if (item.simulate) action.simulate = !!item.simulate;
    if (item.delayMs != null) action.delayMs = Number(item.delayMs);
    if (item.check) action.check = !!item.check;
    if (item.radio) action.radio = !!item.radio;
    if (item.hint) action.hint = item.hint;
    actions.push(action);
  }

  return actions.length ? actions : null;
}

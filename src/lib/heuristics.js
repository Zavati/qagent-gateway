import { sanitizeString } from './sanitize.js';
import { isValidSelector } from './sanitize.js';

export function normalizeIncomingElement(el) {
  if (!el || typeof el !== 'object') return null;
  const selector = sanitizeString(el.selector || el.originalSelector || el.original || '', 500);
  const name = sanitizeString(el.name || el.testId || '', 200);
  const label = sanitizeString(el.label || el.ariaLabel || '', 200);
  const placeholder = sanitizeString(el.placeholder || '', 200);
  const type = sanitizeString(el.type || (el.kindDetail && el.kindDetail.includes('email') ? 'email' : '') || '', 50);
  const semantic = sanitizeString(el.semantic || '', 50);
  const text = sanitizeString(el.text || el.value || '', 2000);
  const value = sanitizeString(el.value || '', 2000);
  const kind = sanitizeString(el.kind || el.kindDetail || '', 50);
  const visible = !!el.visible;
  return { selector, name, label, placeholder, type, semantic, text, value, kind, visible, id: el.id || '' };
}

// Lista de CEPs reais (amostra, pode ser expandida ou buscar de API)
const REAL_CEPS = [
  '01001-000', // São Paulo - SP
  '20040-002', // Rio de Janeiro - RJ
  '30130-010', // Belo Horizonte - MG
  '40010-000', // Salvador - BA
  '60010-270', // Fortaleza - CE
  '70040-010', // Brasília - DF
  '80010-000', // Curitiba - PR
  '90010-320', // Porto Alegre - RS
  '64000-080', // Teresina - PI
  '66010-090', // Belém - PA
];

function getRandomRealCep() {
  return REAL_CEPS[Math.floor(Math.random() * REAL_CEPS.length)];
}

export function prefillHeuristics(elements, max = 200) {
  const filled = [];
  const remaining = [];
  const normalized = (elements || []).map(normalizeIncomingElement).filter(Boolean).slice(0, max);
  for (const el of normalized) {
    try {
      const selector = el.selector;
      if (!isValidSelector(selector)) continue;
      const name = (el.name || '').toLowerCase();
      const label = (el.label || '').toLowerCase();
      const placeholder = (el.placeholder || '').toLowerCase();
      const type = (el.type || '').toLowerCase();
      const semantic = (el.semantic || '').toLowerCase();
      const value = (el.value || el.text || '').toString();

      if (value && el.visible) {
        filled.push({ selector: sanitizeString(selector, 500), value: sanitizeString(value, 2000), simulate: false });
        continue;
      }

      const combined = `${selector} ${name} ${label} ${placeholder} ${type} ${semantic}`.toLowerCase();

      if (type === 'email' || combined.includes('email') || combined.includes('e-mail')) {
        filled.push({ selector: sanitizeString(selector, 500), value: 'user@example.com', simulate: false });
        continue;
      }
      if (type === 'tel' || combined.includes('phone') || combined.includes('telephone') || combined.includes('telefone') || combined.includes('cel')) {
        filled.push({ selector: sanitizeString(selector, 500), value: '+5511999999999', simulate: false });
        continue;
      }
      if (combined.includes('name') || combined.includes('nome') || semantic === 'name') {
        filled.push({ selector: sanitizeString(selector, 500), value: 'QA Tester', simulate: false });
        continue;
      }
      if (combined.includes('cep') || combined.includes('zip') || semantic === 'postal_code' || combined.includes('postal')) {
        filled.push({ selector: sanitizeString(selector, 500), value: getRandomRealCep(), simulate: false });
        continue;
      }
      if (combined.includes('linkedin') || combined.includes('linkedinProfile') || combined.includes('linkedinprofile') || combined.includes('url')) {
        filled.push({ selector: sanitizeString(selector, 500), value: 'https://www.linkedin.com/in/example', simulate: false });
        continue;
      }
      if (placeholder && placeholder.includes('@')) {
        filled.push({ selector: sanitizeString(selector, 500), value: 'user@example.com', simulate: false });
        continue;
      }

      remaining.push(el);
    } catch (e) {
      remaining.push(el);
    }
  }
  return { actions: filled, remaining };
}

export function generateAutofillStub(elements) {
  const { actions: filled, remaining } = prefillHeuristics(elements, 50);
  for (const el of (remaining || []).slice(0, 50)) {
    try {
      const selector = sanitizeString(el.selector || '', 500);
      if (!isValidSelector(selector)) continue;
      const placeholder = sanitizeString(el.placeholder || '', 200);
      const type = String(el.type || '').toLowerCase();
      let value = '';
      if (type === 'email') value = 'user@example.com';
      else if (type === 'tel') value = '+5511999999999';
      else if (placeholder) value = placeholder;
      else value = 'test';
      filled.push({ selector, value, simulate: false });
    } catch (e) {
      continue;
    }
  }
  return filled;
}

export function generateCpf() {
  const nums = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += nums[i] * (10 - i);
  let d1 = sum % 11;
  d1 = d1 < 2 ? 0 : 11 - d1;
  sum = 0;
  for (let i = 0; i < 9; i++) sum += nums[i] * (11 - i);
  sum += d1 * 2;
  let d2 = sum % 11;
  d2 = d2 < 2 ? 0 : 11 - d2;
  const full = nums.concat([d1, d2]).join('');
  return `${full.slice(0,3)}.${full.slice(3,6)}.${full.slice(6,9)}-${full.slice(9,11)}`;
}

export function generateCnpj() {
  const nums = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const weights1 = [5,4,3,2,9,8,7,6,5,4,3,2];
  let sum = nums.reduce((acc, d, i) => acc + d * weights1[i], 0);
  let d1 = sum % 11;
  d1 = d1 < 2 ? 0 : 11 - d1;
  const nums2 = nums.concat([d1]);
  const weights2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  sum = nums2.reduce((acc, d, i) => acc + d * weights2[i], 0);
  let d2 = sum % 11;
  d2 = d2 < 2 ? 0 : 11 - d2;
  const full = nums.concat([d1, d2]).join('');
  return `${full.slice(0,2)}.${full.slice(2,5)}.${full.slice(5,8)}/${full.slice(8,12)}-${full.slice(12,14)}`;
}

export function detectCpfCnpjField(el) {
  if (!el) return null;
  const s = `${el.selector || ''} ${el.name || ''} ${el.label || ''} ${el.placeholder || ''} ${el.type || ''} ${el.semantic || ''}`.toLowerCase();
  if (s.includes('cpf')) return 'cpf';
  if (s.includes('cnpj')) return 'cnpj';
  return null;
}

export function applyCpfCnpjReplacement(actions, normalizedElements) {
  if (!Array.isArray(actions) || !Array.isArray(normalizedElements)) return actions;
  const map = new Map(normalizedElements.map(e => [e.selector, e]));
  function generateCnpjSP() {
    // CNPJ de SP: prefixo 01 a 08
    const prefixos = [1,2,3,4,5,6,7,8];
    const prefix = prefixos[Math.floor(Math.random() * prefixos.length)].toString().padStart(2, '0');
    const nums = [parseInt(prefix[0]), parseInt(prefix[1])].concat(Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)));
    const weights1 = [5,4,3,2,9,8,7,6,5,4,3,2];
    let sum = nums.reduce((acc, d, i) => acc + d * weights1[i], 0);
    let d1 = sum % 11;
    d1 = d1 < 2 ? 0 : 11 - d1;
    const nums2 = nums.concat([d1]);
    const weights2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
    sum = nums2.reduce((acc, d, i) => acc + d * weights2[i], 0);
    let d2 = sum % 11;
    d2 = d2 < 2 ? 0 : 11 - d2;
    const full = nums.concat([d1, d2]).join('');
    return `${full.slice(0,2)}.${full.slice(2,5)}.${full.slice(5,8)}/${full.slice(8,12)}-${full.slice(12,14)}`;
  }
  return actions.map(a => {
    try {
      const el = map.get(a.selector);
      const kind = detectCpfCnpjField(el);
      if (kind === 'cpf') return { ...a, value: sanitizeString(generateCpf(), 2000) };
      if (kind === 'cnpj') return { ...a, value: sanitizeString(generateCnpjSP(), 2000) };
    } catch (e) {
      // ignore and keep original
    }
    return a;
  });
}

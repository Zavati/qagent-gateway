const PRIVATE_V4_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^0\./,
];

function isPrivate172(host) {
  const match = /^172\.(\d{1,3})\./.exec(host);
  if (!match) return false;
  const second = Number(match[1]);
  return second >= 16 && second <= 31;
}

function isIpv4(host) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  return host.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function unsafeHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host === 'metadata.google.internal' || host === 'metadata.google.com') return true;
  if (host === '169.254.169.254') return true;
  if (host === '::1' || host === '[::1]') return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  if (isIpv4(host)) return PRIVATE_V4_RANGES.some((pattern) => pattern.test(host)) || isPrivate172(host);
  return false;
}

function normalizeRawHttpOrigin(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function normalizeObservedOrigin(raw) {
  const normalized = normalizeRawHttpOrigin(raw);
  if (!normalized) return null;
  const url = new URL(normalized);
  if (url.protocol !== 'https:') return null;
  if (unsafeHostname(url.hostname)) return null;
  return normalized;
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  const bytes = new TextEncoder().encode(String(value));
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

export function discoveredRuntimeServiceKey(origin) {
  const normalized = normalizeObservedOrigin(origin);
  return normalized ? `discovered-${fnv1a64(normalized)}` : null;
}

export function isDiscoveredRuntimeServiceKey(value) {
  return /^discovered-[0-9a-f]{16}$/.test(String(value || '').trim());
}

function bindingRawOrigin(binding) {
  const scheme = String(binding?.scheme || '').trim().toLowerCase();
  const host = String(binding?.host || binding?.hostname || '').trim();
  if (!scheme || !host) return null;
  const authority = binding?.port && !host.includes(':') ? `${host}:${binding.port}` : host;
  return normalizeRawHttpOrigin(`${scheme}://${authority}`);
}

function evidenceRawOrigin(evidence) {
  const scheme = String(evidence?.scheme || 'https').trim().toLowerCase();
  const host = String(evidence?.host || '').trim();
  if (!host) return null;
  return normalizeRawHttpOrigin(`${scheme}://${host}`);
}

export function observedRuntimeOrigins(endpointDetail, evidence = []) {
  const origins = new Set();
  for (const binding of endpointDetail?.bindings || []) {
    const origin = bindingRawOrigin(binding);
    if (origin) origins.add(origin);
  }
  for (const item of evidence || []) {
    const origin = evidenceRawOrigin(item);
    if (origin) origins.add(origin);
  }
  return [...origins].sort();
}

export function observedRuntimeEnvironmentIds(endpointDetail, evidence = [], origin = null) {
  const normalizedOrigin = normalizeRawHttpOrigin(origin);
  const ids = new Set();
  for (const binding of endpointDetail?.bindings || []) {
    const candidateOrigin = bindingRawOrigin(binding);
    if (normalizedOrigin && candidateOrigin !== normalizedOrigin) continue;
    const environmentId = String(binding?.environmentId || '').trim();
    if (environmentId) ids.add(environmentId);
  }
  for (const item of evidence || []) {
    const candidateOrigin = evidenceRawOrigin(item);
    if (normalizedOrigin && candidateOrigin !== normalizedOrigin) continue;
    const environmentId = String(item?.environmentId || '').trim();
    if (environmentId) ids.add(environmentId);
  }
  return [...ids].sort();
}

export function deriveDiscoveredRuntimeCandidate(endpointDetail, evidence = []) {
  const rawOrigins = observedRuntimeOrigins(endpointDetail, evidence);
  if (rawOrigins.length !== 1) {
    return {
      status: rawOrigins.length > 1 ? 'AMBIGUOUS' : 'UNAVAILABLE',
      origin: null,
      serviceKey: null,
      confidence: null,
      environmentIds: [],
      observedOrigins: rawOrigins,
    };
  }

  const origin = normalizeObservedOrigin(rawOrigins[0]);
  if (!origin) {
    return {
      status: 'UNSAFE',
      origin: null,
      serviceKey: null,
      confidence: null,
      environmentIds: observedRuntimeEnvironmentIds(endpointDetail, evidence, rawOrigins[0]),
      observedOrigins: rawOrigins,
    };
  }

  return {
    status: 'DISCOVERED',
    origin,
    serviceKey: discoveredRuntimeServiceKey(origin),
    confidence: 'HIGH',
    environmentIds: observedRuntimeEnvironmentIds(endpointDetail, evidence, rawOrigins[0]),
    observedOrigins: rawOrigins,
  };
}

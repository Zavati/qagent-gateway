export async function fetchTextWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
      retryAfterMs: resolveRetryAfterMs(response.headers?.get?.('Retry-After'), text),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      text: '',
      retryAfterMs: null,
      error: {
        name: error?.name || 'Error',
        message: error?.message || String(error),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export function parseRetryAfterMs(value, nowMs = Date.now()) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - nowMs);
  }

  return null;
}

function parseDurationMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)(ms|s)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return match[2].toLowerCase() === 'ms'
    ? Math.ceil(amount)
    : Math.ceil(amount * 1000);
}

export function extractRetryDelayMsFromBody(text) {
  if (!text || typeof text !== 'string') return null;

  try {
    const payload = JSON.parse(text);
    const queue = [payload];
    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== 'object') continue;

      for (const [key, value] of Object.entries(current)) {
        if (/retry(?:_|)delay/i.test(key)) {
          const parsed = parseDurationMs(value);
          if (parsed !== null) return parsed;
        }
        if (value && typeof value === 'object') queue.push(value);
      }
    }
  } catch {
    // O corpo pode não ser JSON; o regex abaixo ainda cobre mensagens textuais.
  }

  const match = text.match(/(?:please\s+)?retry\s+in\s+([0-9]+(?:\.[0-9]+)?)\s*(ms|milliseconds?|s|seconds?)/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return /^m/i.test(match[2]) ? Math.ceil(amount) : Math.ceil(amount * 1000);
}

export function resolveRetryAfterMs(retryAfterHeader, bodyText, nowMs = Date.now()) {
  return parseRetryAfterMs(retryAfterHeader, nowMs) ?? extractRetryDelayMsFromBody(bodyText);
}

export function isTransientAiStatus(status) {
  const code = Number(status || 0);
  return code === 0 || code === 408 || code === 409 || code === 429 || code >= 500;
}

export function computeRetryDelayMs(attempt, {
  retryAfterMs = null,
  baseDelayMs = 500,
  maxDelayMs = 2_000,
  jitter = Math.random,
} = {}) {
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.ceil(retryAfterMs);
  }

  const base = Math.max(0, Number(baseDelayMs) || 0);
  const cap = Math.max(base, Number(maxDelayMs) || base);
  if (base === 0) return 0;

  const exponential = Math.min(cap, base * (2 ** Math.max(0, Number(attempt) || 0)));
  const jitterFactor = 0.75 + (Math.max(0, Math.min(1, Number(jitter?.()) || 0)) * 0.5);
  return Math.ceil(exponential * jitterFactor);
}

export function getAiRetryDecision({
  status,
  attempt,
  retries,
  retryAfterMs = null,
  nonRetryable = false,
  maxRetryWaitMs = 2_500,
  baseDelayMs = 500,
  maxDelayMs = 2_000,
} = {}) {
  const maxRetries = Math.max(0, Number.isInteger(retries) ? retries : 0);
  const currentAttempt = Math.max(0, Number(attempt) || 0);

  if (nonRetryable || currentAttempt >= maxRetries || !isTransientAiStatus(status)) {
    return { retry: false, delayMs: 0 };
  }

  const delayMs = computeRetryDelayMs(currentAttempt, {
    retryAfterMs,
    baseDelayMs,
    maxDelayMs,
  });

  // O Gateway é síncrono para o plugin. Não seguramos a conexão por dezenas de
  // segundos quando o provider pede um Retry-After longo (ex.: quota/rate limit).
  if (delayMs > Math.max(0, Number(maxRetryWaitMs) || 0)) {
    return { retry: false, delayMs };
  }

  return { retry: true, delayMs };
}

export async function waitForAiRetry(delayMs) {
  const ms = Math.max(0, Number(delayMs) || 0);
  if (ms <= 0) return;

  if (globalThis.scheduler && typeof globalThis.scheduler.wait === 'function') {
    await globalThis.scheduler.wait(ms);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class AiUpstreamError extends Error {
  constructor(message, {
    provider,
    status = 0,
    upstreamCode = null,
    upstreamMessage = null,
    retryable = false,
    retryAfterMs = null,
    rawText = '',
    transportError = null,
  } = {}) {
    super(message || `Falha no provider de IA ${provider || 'desconhecido'}.`);
    this.name = 'AiUpstreamError';
    this.code = 'AI_UPSTREAM_ERROR';
    this.provider = provider || null;
    this.upstreamStatus = Number(status || 0);
    this.upstreamCode = upstreamCode || null;
    this.upstreamMessage = upstreamMessage || null;
    this.retryable = Boolean(retryable);
    this.retryAfterMs = Number.isFinite(retryAfterMs) ? Math.max(0, Math.ceil(retryAfterMs)) : null;
    this.upstreamFailed = true;
    this.rawText = rawText || '';
    this.contentText = '';
    this.transportError = transportError || null;
  }
}

export function createAiUpstreamError(provider, response, {
  upstreamCode = null,
  upstreamMessage = null,
  retryable = false,
} = {}) {
  const status = Number(response?.status || 0);
  const transportMessage = response?.error?.message || null;
  const detail = upstreamMessage || transportMessage || (status ? `HTTP ${status}` : 'network error');

  return new AiUpstreamError(`${provider || 'AI'} upstream failed (${detail}).`, {
    provider,
    status,
    upstreamCode,
    upstreamMessage: upstreamMessage || transportMessage,
    retryable,
    retryAfterMs: response?.retryAfterMs,
    rawText: response?.text || '',
    transportError: response?.error || null,
  });
}

export function createAiResponseFormatError(provider, {
  rawText = '',
  contentText = '',
  status = 200,
} = {}) {
  const err = new Error(`Failed to get valid JSON from ${provider || 'AI'}`);
  err.name = 'AiResponseFormatError';
  err.code = 'AI_INVALID_JSON';
  err.provider = provider || null;
  err.rawText = rawText || '';
  err.contentText = contentText || '';
  err.upstreamStatus = Number(status || 0);
  err.upstreamFailed = false;
  err.retryable = false;
  return err;
}

export function extractJsonFromText(text) {
  if (!text || typeof text !== 'string') return null;

  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed);
    } catch {}
  }

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '{') continue;

    let depth = 0;
    let inString = false;
    let stringChar = '';
    let escaped = false;

    for (let j = i; j < text.length; j += 1) {
      const char = text[j];

      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === stringChar) {
          inString = false;
          stringChar = '';
        }
        continue;
      }

      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(i, j + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  return null;
}

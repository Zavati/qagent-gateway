function normalizeDimension(value, fallback = 'unknown') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || fallback;
}

function dayBucketUtc(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function metricKey({ day, tenant, cohort }) {
  return `metrics:migration:${day}:tenant:${tenant}:cohort:${cohort}`;
}

function shouldTrackMetrics(env) {
  const raw = String(env?.MIGRATION_METRICS_ENABLED ?? 'true').trim().toLowerCase();
  return !(raw === 'false' || raw === '0' || raw === 'off' || raw === 'no');
}

function createEmptyMetric({ day, tenant, cohort }) {
  return {
    day,
    tenant,
    cohort,
    requestsTotal: 0,
    requestsSuccess: 0,
    credentialClientKey: 0,
    credentialLegacyToken: 0,
    credentialUnknown: 0,
    errors401: 0,
    errors403: 0,
    legacyAccepted: 0,
    legacyBlocked: 0,
    updatedAt: new Date().toISOString(),
  };
}

function applyMetricIncrement(metric, event) {
  metric.requestsTotal += 1;

  if (event.credentialType === 'client_key') metric.credentialClientKey += 1;
  else if (event.credentialType === 'legacy_token') metric.credentialLegacyToken += 1;
  else metric.credentialUnknown += 1;

  if (event.statusCode >= 200 && event.statusCode < 300) metric.requestsSuccess += 1;
  if (event.statusCode === 401) metric.errors401 += 1;
  if (event.statusCode === 403) metric.errors403 += 1;
  if (event.legacyAccepted) metric.legacyAccepted += 1;
  if (event.legacyBlocked) metric.legacyBlocked += 1;

  metric.updatedAt = new Date().toISOString();
  return metric;
}

async function incrementKey(env, dimensions, event) {
  const key = metricKey(dimensions);
  const raw = await env.QAGENT_KV.get(key);
  const current = raw ? JSON.parse(raw) : createEmptyMetric(dimensions);
  const next = applyMetricIncrement(current, event);
  await env.QAGENT_KV.put(key, JSON.stringify(next));
}

export async function trackMigrationMetric(env, event) {
  if (!env?.QAGENT_KV || !shouldTrackMetrics(env)) return;

  const day = dayBucketUtc();
  const tenant = normalizeDimension(event?.tenant, 'unknown');
  const cohort = normalizeDimension(event?.cohort, 'unknown');
  const credentialType = normalizeDimension(event?.credentialType, 'unknown');
  const statusCode = Number(event?.statusCode || 0);

  const normalizedEvent = {
    credentialType,
    statusCode,
    legacyAccepted: Boolean(event?.legacyAccepted),
    legacyBlocked: Boolean(event?.legacyBlocked),
  };

  try {
    await incrementKey(env, { day, tenant, cohort }, normalizedEvent);
    await incrementKey(env, { day, tenant: 'all', cohort: 'all' }, normalizedEvent);
  } catch {
    // métricas não devem quebrar fluxo principal
  }
}

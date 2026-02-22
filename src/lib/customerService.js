export function customerKeyForId(customerId) {
  return `customer:${customerId}`;
}

export function customerEmailIndexKey(email) {
  return `customer_email:${String(email || '').trim().toLowerCase()}`;
}

function nowIso() {
  return new Date().toISOString();
}

async function kvGetJson(env, key) {
  const raw = await env.QAGENT_KV.get(key);
  return raw ? JSON.parse(raw) : null;
}

async function kvPutJson(env, key, value) {
  await env.QAGENT_KV.put(key, JSON.stringify(value));
}

export async function getCustomerByEmail(env, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;

  const idx = await kvGetJson(env, customerEmailIndexKey(normalizedEmail));
  if (!idx?.customerId) return null;

  const customer = await kvGetJson(env, customerKeyForId(idx.customerId));
  if (!customer) return null;

  return { customer, keyHash: idx.keyHash || null };
}

export async function getCustomerById(env, customerId) {
  if (!customerId) return null;
  const raw = await kvGetJson(env, customerKeyForId(customerId));
  return raw || null;
}

export async function createCustomer(env, { email, name = '', company = '', source = 'landing-page', keyHash = null }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const createdAt = nowIso();
  const customerId = `cus_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const customer = {
    customerId,
    email: normalizedEmail,
    name: String(name || '').trim(),
    company: String(company || '').trim(),
    source: String(source || 'landing-page').trim(),
    status: 'active',
    createdAt,
    updatedAt: createdAt,
  };

  await kvPutJson(env, customerKeyForId(customerId), customer);
  await kvPutJson(env, customerEmailIndexKey(normalizedEmail), {
    customerId,
    keyHash,
    updatedAt: createdAt,
  });

  return customer;
}

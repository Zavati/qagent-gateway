import { safeId } from './keyService.js';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function userKey(userId) {
  return `user:${userId}`;
}

function userByEmailKey(email) {
  return `user_by_email:${normalizeEmail(email)}`;
}

async function kvGetJson(env, key) {
  const raw = await env.QAGENT_KV.get(key);
  return raw ? JSON.parse(raw) : null;
}

async function kvPutJson(env, key, value) {
  await env.QAGENT_KV.put(key, JSON.stringify(value));
}

export async function getUserById(env, userId) {
  if (!env?.QAGENT_KV) {
    const err = new Error('KV não configurado (env.QAGENT_KV ausente).');
    err.status = 500;
    throw err;
  }
  if (!userId) return null;
  return kvGetJson(env, userKey(userId));
}

export async function getUserByEmail(env, email) {
  if (!env?.QAGENT_KV) {
    const err = new Error('KV não configurado (env.QAGENT_KV ausente).');
    err.status = 500;
    throw err;
  }
  const norm = normalizeEmail(email);
  if (!norm) return null;
  const userId = await env.QAGENT_KV.get(userByEmailKey(norm));
  if (!userId) return null;
  return kvGetJson(env, userKey(userId));
}

export async function createUser(env, { email, passwordBundle, customerId }) {
  if (!env?.QAGENT_KV) {
    const err = new Error('KV não configurado (env.QAGENT_KV ausente).');
    err.status = 500;
    throw err;
  }

  const normEmail = normalizeEmail(email);
  if (!normEmail) {
    const err = new Error('Email inválido para criar usuário.');
    err.status = 400;
    throw err;
  }

  const existingId = await env.QAGENT_KV.get(userByEmailKey(normEmail));
  if (existingId) {
    const err = new Error('Conta já existente para este email.');
    err.status = 409;
    throw err;
  }

  const now = new Date().toISOString();
  const userId = `usr_${crypto.randomUUID()}`;

  const user = {
    userId,
    email: normEmail,
    passwordHash: passwordBundle?.hash || null,
    passwordSalt: passwordBundle?.salt || null,
    passwordAlgo: passwordBundle?.algo || null,
    passwordIterations: passwordBundle?.iterations || null,
    customerId: customerId || null,
    tokenVersion: 1,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  };

  await kvPutJson(env, userKey(userId), user);
  await env.QAGENT_KV.put(userByEmailKey(normEmail), userId);

  return user;
}

export async function updateUserLoginStats(env, userId, { lastLoginAt = null, tokenVersion = null } = {}) {
  if (!env?.QAGENT_KV) {
    const err = new Error('KV não configurado (env.QAGENT_KV ausente).');
    err.status = 500;
    throw err;
  }
  if (!userId) return null;

  const key = userKey(userId);
  const current = await kvGetJson(env, key);
  if (!current) return null;

  const now = new Date().toISOString();
  const next = { ...current, updatedAt: now };
  if (lastLoginAt) next.lastLoginAt = lastLoginAt;
  if (typeof tokenVersion === 'number') next.tokenVersion = tokenVersion;

  await kvPutJson(env, key, next);
  return next;
}

export { normalizeEmail };

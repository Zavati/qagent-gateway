import { verifySessionToken } from '../lib/sessionTokens.js';
import { getUserById } from '../lib/userService.js';

function getBearerToken(req) {
  const raw = req?.headers?.get?.('Authorization') || req?.headers?.get?.('authorization') || '';
  return String(raw).replace(/^Bearer\s+/i, '').trim();
}

export async function requireConsoleUser(req, env) {
  const sessionToken = getBearerToken(req);
  if (!sessionToken) {
    const err = new Error('Sessão ausente.');
    err.status = 401;
    throw err;
  }

  const verified = await verifySessionToken(env, sessionToken);
  if (!verified.ok) {
    const err = new Error('Sessão inválida ou expirada.');
    err.status = 401;
    throw err;
  }

  const user = await getUserById(env, verified.payload?.sub);
  if (!user) {
    const err = new Error('Sessão inválida.');
    err.status = 401;
    throw err;
  }

  if (typeof user.tokenVersion === 'number' && verified.payload?.ver !== user.tokenVersion) {
    const err = new Error('Sessão revogada. Faça login novamente.');
    err.status = 401;
    throw err;
  }

  if (!user.customerId) {
    const err = new Error('Conta comercial não vinculada ao usuário.');
    err.status = 409;
    err.code = 'ACCOUNT_NOT_LINKED';
    throw err;
  }

  return { user, accountId: user.customerId, session: verified.payload };
}

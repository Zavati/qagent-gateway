import { requireConsoleUser } from '../services/consoleSessionService.js';
import {
  getAccountAiConfigSummary,
  saveAccountAiConfig,
  removeAccountAiConfig,
} from '../services/aiProviderConfigService.js';

async function readJson(req, maxBytes = 20_000) {
  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0) {
    const err = new Error('Body vazio.');
    err.status = 400;
    throw err;
  }
  if (buf.byteLength > maxBytes) {
    const err = new Error('Payload grande demais.');
    err.status = 413;
    throw err;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    const err = new Error('JSON inválido.');
    err.status = 400;
    throw err;
  }
}

export async function getConsoleAiConfig(req, env) {
  const { accountId } = await requireConsoleUser(req, env);
  const configs = await getAccountAiConfigSummary(env, accountId);
  return { status: 'ok', accountId, configs };
}

export async function putConsoleAiConfig(req, env) {
  const { accountId } = await requireConsoleUser(req, env);
  const body = await readJson(req);
  const config = await saveAccountAiConfig(env, accountId, body);
  return { status: 'ok', accountId, config };
}

export async function deleteConsoleAiConfig(req, env) {
  const { accountId } = await requireConsoleUser(req, env);
  const url = new URL(req.url);
  const provider = url.searchParams.get('provider') || '';
  const result = await removeAccountAiConfig(env, accountId, provider);
  return { status: 'ok', accountId, ...result };
}

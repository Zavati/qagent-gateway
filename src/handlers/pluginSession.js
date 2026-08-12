import { createPluginSession } from '../services/pluginAuthService.js';

export async function postPluginSession(req, env) {
  return createPluginSession(req, env);
}

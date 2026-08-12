import { createObservationGrant } from '../services/observationGrantService.js';

export async function postPluginObservationGrant(req, env) {
  return createObservationGrant(req, env);
}

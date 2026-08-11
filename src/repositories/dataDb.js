export function requireDataDb(env) {
  if (!env?.QAGENT_DB) {
    const err = new Error('Data DB não configurado (env.QAGENT_DB ausente).');
    err.status = 503;
    err.code = 'DATA_DB_NOT_CONFIGURED';
    throw err;
  }
  return env.QAGENT_DB;
}

function assertDb(env) {
  if (!env?.QAGENT_DB) {
    const err = new Error('D1 não configurado (env.QAGENT_DB ausente).');
    err.status = 503;
    err.code = 'AI_CONFIG_DB_NOT_CONFIGURED';
    throw err;
  }
  return env.QAGENT_DB;
}

export async function getDefaultAiProviderConfig(env, accountId) {
  if (!accountId) return null;
  const db = assertDb(env);
  return db.prepare(`
    SELECT
      config_id AS configId,
      account_id AS accountId,
      provider,
      credential_type AS credentialType,
      credentials_ciphertext AS credentialsCiphertext,
      credentials_iv AS credentialsIv,
      credentials_key_version AS credentialsKeyVersion,
      generate_tests_model AS generateTestsModel,
      autofill_model AS autofillModel,
      enabled,
      is_default AS isDefault,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM ai_provider_configs
    WHERE account_id = ? AND enabled = 1 AND is_default = 1
    LIMIT 1
  `).bind(accountId).first();
}

export async function getAiProviderConfig(env, accountId, provider) {
  if (!accountId || !provider) return null;
  const db = assertDb(env);
  return db.prepare(`
    SELECT
      config_id AS configId,
      account_id AS accountId,
      provider,
      credential_type AS credentialType,
      credentials_ciphertext AS credentialsCiphertext,
      credentials_iv AS credentialsIv,
      credentials_key_version AS credentialsKeyVersion,
      generate_tests_model AS generateTestsModel,
      autofill_model AS autofillModel,
      enabled,
      is_default AS isDefault,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM ai_provider_configs
    WHERE account_id = ? AND provider = ?
    LIMIT 1
  `).bind(accountId, provider).first();
}

export async function listAiProviderConfigs(env, accountId) {
  if (!accountId) return [];
  const db = assertDb(env);
  const result = await db.prepare(`
    SELECT
      config_id AS configId,
      account_id AS accountId,
      provider,
      credential_type AS credentialType,
      generate_tests_model AS generateTestsModel,
      autofill_model AS autofillModel,
      enabled,
      is_default AS isDefault,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM ai_provider_configs
    WHERE account_id = ?
    ORDER BY is_default DESC, provider ASC
  `).bind(accountId).all();
  return result?.results || [];
}

export async function upsertAiProviderConfig(env, config) {
  const db = assertDb(env);
  const now = new Date().toISOString();
  const configId = config.configId || `aic_${crypto.randomUUID()}`;

  const clearDefault = db.prepare(`
    UPDATE ai_provider_configs
    SET is_default = 0, updated_at = ?
    WHERE account_id = ? AND is_default = 1 AND provider <> ?
  `).bind(now, config.accountId, config.provider);

  const upsert = db.prepare(`
    INSERT INTO ai_provider_configs (
      config_id, account_id, provider, credential_type,
      credentials_ciphertext, credentials_iv, credentials_key_version,
      generate_tests_model, autofill_model, enabled, is_default,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(account_id, provider) DO UPDATE SET
      credential_type = excluded.credential_type,
      credentials_ciphertext = excluded.credentials_ciphertext,
      credentials_iv = excluded.credentials_iv,
      credentials_key_version = excluded.credentials_key_version,
      generate_tests_model = excluded.generate_tests_model,
      autofill_model = excluded.autofill_model,
      enabled = excluded.enabled,
      is_default = 1,
      updated_at = excluded.updated_at
  `).bind(
    configId,
    config.accountId,
    config.provider,
    config.credentialType,
    config.credentialsCiphertext,
    config.credentialsIv,
    config.credentialsKeyVersion,
    config.generateTestsModel || null,
    config.autofillModel || null,
    config.enabled === false ? 0 : 1,
    now,
    now,
  );

  if (typeof db.batch === 'function') {
    await db.batch([clearDefault, upsert]);
  } else {
    await clearDefault.run();
    await upsert.run();
  }

  return getAiProviderConfig(env, config.accountId, config.provider);
}

export async function deleteAiProviderConfig(env, accountId, provider) {
  const db = assertDb(env);
  await db.prepare('DELETE FROM ai_provider_configs WHERE account_id = ? AND provider = ?')
    .bind(accountId, provider)
    .run();
}

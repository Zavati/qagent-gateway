# Auditoria focada — origem do prazo

Fonte: ZIP Gateway 1.0.17 FULL_TEST montado; não deployment remoto. Na base, `src/lib/licenseService.js` linhas3–4 definia `TRIAL_DAYS = 6` e `TRIAL_MS`. `createTrialLicenseForKeyHash` calculava `trialEndsAt`/`expiresAt` com esse intervalo e salvava em `license:${keyHash}`. `getOrCreateLicense` também usava esse intervalo somente para criar uma licença de token legado ainda inexistente.

O signup cria `clientkey:${keyHash}` com customerId, createdAt, lastUsedAt e revokedAt, sem expiresAt; a validade comercial está na licença. O serviço pluginAuth mantém PLUGIN_SESSION_TTL_SECONDS próprio, default900; essa configuração não foi alterada. O grant UI continua respeitando licença/sessão/autorização sem ampliar TTL.

`applyPaymentToLicense` usa períodos do provedor e fallback próprio de30dias. Sua lógica não foi modificada. Alterar trial não altera assinatura paga. Leitura de licença já existente não renova o prazo com a variável.

Saída: imports de trialConfig.js + resolveTrialDays(env)*DAY_MS nos dois pontos de criação; preflight no signup antes de criação de conta/key. Não foi adicionado cron nem extensão automática na autenticação.

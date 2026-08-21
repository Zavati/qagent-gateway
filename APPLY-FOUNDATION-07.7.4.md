# Apply — Foundation 07.7.4

## 1. Criar DLQ uma vez

```bash
npx wrangler queues create qagent-run-dlq
```

Se já existir, apenas confirme com:

```bash
npx wrangler queues list
```

## 2. Gateway

```bash
npm ci
npm run check:07.7.4
npm run test:all
npx wrangler d1 migrations apply QAGENT_DB --remote
npm run deploy
```

A migration esperada é:

```text
0007_foundation_07_7_4_claim_lease_retry.sql
```

Confirme no D1:

```sql
SELECT name
FROM sqlite_master
WHERE type='table'
  AND name IN ('run_execution_attempts','run_execution_claims')
ORDER BY name;
```

## 3. Runner

O mesmo `RUNNER_CONTROL_HMAC_SECRET` já usado na 07.7.3 continua válido.

```bash
npm ci
npm run check:07.7.4
npm run deploy
```

O consumer passa a usar:

```text
max_retries=5
DLQ=qagent-run-dlq
retry_delay=5
max_concurrency=5
```

## 4. Produção — smoke recomendado

Crie um NOVO Run com novo `Idempotency-Key`, usando o mesmo tdv/Environment/scenario READY já validado.

Depois consulte:

```text
GET /v1/console/projects/:projectId/runs/:runId
```

Esperado:

```json
{
  "queue": {
    "status": "RECEIVED",
    "runnerReceivedAt": "..."
  },
  "executionAttempt": {
    "attemptNumber": 1,
    "status": "RECEIVED",
    "heartbeatCount": 1,
    "lastErrorCode": null
  }
}
```

## 5. Auditoria D1

```sql
SELECT
  run_id,
  attempt_id,
  attempt_number,
  status,
  lease_acquired_at,
  lease_expires_at,
  heartbeat_at,
  heartbeat_count,
  queue_delivery_attempt,
  last_error_code,
  next_retry_at,
  received_at,
  terminal_at
FROM run_execution_attempts
ORDER BY created_at DESC
LIMIT 20;
```

E:

```sql
SELECT
  run_id,
  state,
  current_attempt_id,
  current_attempt_number,
  lease_expires_at,
  heartbeat_at,
  updated_at
FROM run_execution_claims
ORDER BY updated_at DESC
LIMIT 20;
```

Depois de `RECEIVED`, o claim deve estar `IDLE` e não conter uma lease ativa.

## 6. Segurança

Não deve aparecer em responses/logs/tabelas públicas:

- leaseToken;
- leaseTokenHash;
- Authorization/Bearer;
- plaintext Secret.

`lease_token_hash` existe apenas no D1 interno.

# Aplicação — Foundation 07.7.3

## 0. Pré-requisitos

- 07.7.2 + 07.7.2-A FIX-2 validadas.
- Gateway atual funcionando com `QAGENT_DB`.
- `qagent-runner` 07.7.3 disponível para deploy.

## 1. Criar a Queue uma única vez

```bash
npx wrangler queues create qagent-run-requests
```

Confirme:

```bash
npx wrangler queues list
```

## 2. Configurar o mesmo HMAC Secret nos dois Workers

Gere um valor randômico de pelo menos 32 bytes e NÃO salve em Git.

No Gateway:

```bash
npx wrangler secret put RUNNER_CONTROL_HMAC_SECRET
```

No `qagent-runner`:

```bash
npx wrangler secret put RUNNER_CONTROL_HMAC_SECRET
```

Cole exatamente o mesmo valor nos dois prompts.

## 3. Gateway

```bash
npm ci
npm run check:07.7.3
npm run test:all
npx wrangler d1 migrations apply QAGENT_DB --remote
npm run deploy
```

A migration nova esperada é:

```text
0006_foundation_07_7_3_run_queue_dispatch.sql
```

Valide no D1:

```sql
SELECT name
FROM sqlite_master
WHERE type='table'
  AND name='run_queue_dispatches';
```

## 4. Runner

```bash
npm ci
npm run check:07.7.3
npm run deploy
```

O Runner possui `workers_dev=false` e não precisa de rota pública. O `/health` existe no código para Service Binding/diagnóstico futuro, mas não cria superfície pública por si só.

## 5. Smoke de produção

Crie um novo Run READY ou repita um Run pré-07.7.3 com o MESMO payload + MESMO `Idempotency-Key`.

Resultado esperado do POST/GET Run:

```text
run.status = QUEUED
queue.status = PUBLISHED ou RECEIVED
queue.dispatchAttemptCount >= 1
```

Após o Runner consumir:

```text
queue.status = RECEIVED
queue.runnerReceivedAt != null
```

D1:

```sql
SELECT
  run_id,
  status,
  dispatch_attempt_count,
  published_at,
  runner_received_at,
  last_error_code
FROM run_queue_dispatches
ORDER BY created_at DESC
LIMIT 20;
```

## 6. Gate de segurança

A mensagem de Queue deve conter somente refs. O Run bundle interno pode conter Runtime Snapshot público e Execution Plan, mas não plaintext Secret.

07.7.3 não deve produzir tráfego HTTP para a aplicação monitorada.

# QAgent — Foundation 07.7.3
## Queue + qagent-runner Foundation

Status: IMPLEMENTADO LOCALMENTE — aguardando validação em produção.

## Objetivo

Transformar um Run materializado pela 07.7.2 em uma mensagem durável de execução e entregá-la ao novo Worker `qagent-runner`, sem executar HTTP externo ainda.

```text
Run CREATED
  -> run_queue_dispatches:PENDING
  -> qagent-run-requests
  -> qagent-runner
  -> Runner Control API
  -> valida Run + Execution Plan + Runtime Snapshot
  -> run_queue_dispatches:RECEIVED
  -> ACK
```

## Contratos

- `qagent.run-requested.v1`
- `qagent.runner-run-bundle.v1`
- `qagent.runner-received.v1`

A Queue transporta somente:

```json
{
  "contractVersion": "qagent.run-requested.v1",
  "runId": "run_...",
  "executionPlanId": "xplan_...",
  "runtimeSnapshotId": "rts_..."
}
```

Não transporta Execution Plan, Runtime Snapshot, base URL, schema, Auth config, Secret ou Bearer.

## Persistência

Migration `0006_foundation_07_7_3_run_queue_dispatch.sql` adiciona `run_queue_dispatches` com estados:

- `PENDING`
- `PUBLISHED`
- `RECEIVED`

O registro é criado atomicamente junto com Run, Runtime Snapshot e Execution Plan. Runs anteriores à 07.7.3 recebem o registro de dispatch de forma lazy no primeiro replay/idempotent retry.

## Semântica de publicação

- `POST Run` persiste primeiro.
- Gateway publica na Queue de forma síncrona antes de responder sucesso.
- Sucesso de publicação move Run de `CREATED` para `QUEUED`.
- Falha de publicação retorna `503 RUN_QUEUE_DISPATCH_FAILED`; o Run permanece persistido e o mesmo `Idempotency-Key` pode tentar a publicação novamente.
- `PUBLISHED` e `RECEIVED` não são reenviados por replay normal.
- O design assume entrega at-least-once; deduplicação/claim/lease completos pertencem à 07.7.4.

## Runner Control API

Rotas internas HMAC-protected no Gateway:

```text
GET  /internal/v1/runner/runs/:runId/bundle
POST /internal/v1/runner/runs/:runId/received
```

Autenticação:

```text
qagent.runner-control.v1
HMAC-SHA256
RUNNER_CONTROL_HMAC_SECRET
clock skew default: 60s
```

O Runner usa Service Binding `RUN_CONTROL_SERVICE -> qagent-gateway`.

## Validação defensiva no Runner

Antes de ACK:

- valida `qagent.run-requested.v1`;
- carrega bundle autoritativo no Gateway;
- valida IDs de Run/Plan/Snapshot;
- aceita apenas Run `CREATED|QUEUED` nesta Foundation;
- valida `qagent.execution-plan.v1`;
- valida `qagent.runtime-snapshot.v1`;
- recalcula `planHash` e `snapshotHash`;
- rejeita qualquer cenário que não esteja `READY`;
- persiste `RECEIVED` no Gateway;
- ACK somente depois da confirmação persistida.

Erros permanentes são ACK/rejeitados para não criar poison message infinito. Falhas transitórias usam `message.retry()`.

## Fora do escopo

07.7.3 NÃO:

- chama API alvo;
- resolve plaintext Secret;
- adquire OAuth token;
- aplica Authorization;
- executa assertion;
- muda Run para RUNNING;
- implementa claim/lease;
- persiste Test Result.

Tudo isso permanece para 07.7.4+.

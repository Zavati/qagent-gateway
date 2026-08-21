# QAgent — Foundation 07.7.4
## Claim / Lease / Retry

Status: IMPLEMENTADO LOCALMENTE — aguardando validação em produção.

## Objetivo

Adicionar ownership durável de consumo antes de qualquer execução HTTP:

```text
Queue delivery
  -> authoritative bundle validation
  -> atomic claim
  -> lease
  -> heartbeat
  -> RECEIVED persistido
  -> ACK
```

A Foundation continua com `httpExecutionEnabled=false`.

## Novos contratos internos

- `qagent.runner-claim.v1`
- `qagent.runner-claim-result.v1`
- `qagent.runner-heartbeat.v1`
- `qagent.runner-retry.v1`
- `qagent.runner-received.v2`

`qagent.runner-received.v1` continua aceito no Gateway durante rolling deploy.

## Persistência

Migration:

```text
0007_foundation_07_7_4_claim_lease_retry.sql
```

Tabelas:

```text
run_execution_attempts
run_execution_claims
```

`run_execution_attempts` é histórico append-oriented por Run/attempt number.
`run_execution_claims` mantém no máximo uma lease ativa por Run.

A lease armazena somente `SHA-256(leaseToken)` no D1. O token bruto existe apenas no canal interno HMAC Runner -> Gateway durante a lease.

## Atomic claim

O claim usa update condicional sobre uma linha única por `run_id`:

```text
IDLE -> ACTIVE
ACTIVE + lease válida -> não adquire
ACTIVE + lease expirada -> tentativa anterior ABANDONED + nova tentativa
```

Duas entregas concorrentes não recebem ownership simultâneo.

## Heartbeat

Default:

```text
RUNNER_LEASE_SECONDS=60
```

O heartbeat só estende a lease quando:

- attemptId é o atual;
- hash do lease token confere;
- lease ainda está ativa;
- Run não está CANCELLED.

## Retry

Falha transitória após claim:

```text
attempt CLAIMED
 -> RETRYABLE
claim ACTIVE
 -> IDLE
Queue message.retry({ delaySeconds })
```

Backoff no Runner:

```text
5s, 10s, 20s, 40s, ...
max 300s
```

Configuração da Queue:

```text
max_retries = 5
dead_letter_queue = qagent-run-dlq
retry_delay = 5
max_concurrency = 5
```

## Duplicate safety

Dois níveis:

1. `run_queue_dispatches.status=RECEIVED` => redelivery recebe ACK sem novo claim;
2. `run_execution_claims.state=ACTIVE` => redelivery não executa e é reagendada para depois da lease.

Gate da Foundation:

```text
duplicate queue delivery never obtains two active execution owners
```

## Cancellation check

- CANCELLED antes do claim -> ACK sem ownership;
- CANCELLED durante heartbeat -> tentativa marcada CANCELLED e lease liberada.

A API pública de cancelamento continua fora desta Foundation.

## Abandoned recovery

Quando uma nova delivery chega após expiração:

```text
attempt N CLAIMED -> ABANDONED
claim expirado -> substituído atomically
attempt N+1 -> CLAIMED
```

Isso cobre crash do Worker / perda de ownership combinada com redelivery at-least-once da Queue.

## Fora do escopo

07.7.4 NÃO:

- chama a API alvo;
- resolve plaintext secrets;
- aplica Authorization;
- executa assertions;
- produz Test Result;
- muda Run para PASSED/FAILED;
- implementa UI de cancelamento.

Próxima Foundation: `07.7.5 — Runtime Integration + Readiness Resolution`.

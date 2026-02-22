# Blueprint técnico — Autenticação, Trial e Pagamento

## Objetivo

Preparar a evolução do modelo atual (token com trial automático) para um modelo orientado a cliente, licença e eventos de pagamento, mantendo compatibilidade durante a migração.

> Decomposição executável em tickets: `docs/tickets-auth-billing-rollout.md`.

## Escopo desta fase (preparação)

- Definir contratos de API e webhooks.
- Definir entidades e chaves no KV.
- Definir máquina de estados da licença.
- Definir idempotência, segurança e auditoria.
- Definir checklist de rollout por fases.

Sem implementação funcional nesta etapa.

## Problema atual e direção alvo

### Hoje

- O endpoint `GET /v1/license` cria trial automaticamente por token.
- O token funciona como identificador primário do usuário.
- Não existe separação formal entre cliente, assinatura e evento financeiro.

### Alvo

- Separar identidade (`customerId`) de credencial técnica (`clientKey`).
- Tratar pagamento por eventos assíncronos idempotentes.
- Permitir upgrade de trial para active sem trocar integração da extensão.

## Modelo de dados (KV)

### 1) Customer

**Chave KV**

`customer:{customerId}`

**Exemplo**

```json
{
  "customerId": "cus_4a2f3c50",
  "email": "cliente@empresa.com",
  "name": "Cliente Exemplo",
  "company": "Empresa Exemplo",
  "createdAt": "2026-02-17T12:00:00.000Z",
  "updatedAt": "2026-02-17T12:00:00.000Z",
  "status": "active"
}
```

### 2) Credencial do cliente (API key)

**Chave KV**

`clientkey:{keyHash}`

**Exemplo**

```json
{
  "keyHash": "sha256:...",
  "customerId": "cus_4a2f3c50",
  "label": "chrome-extension",
  "createdAt": "2026-02-17T12:00:00.000Z",
  "lastUsedAt": null,
  "revokedAt": null
}
```

> Regra: nunca persistir `clientKey` em texto puro no KV; armazenar apenas hash.

### 3) Licença

**Chave KV**

`license:{keyHash}`

**Exemplo**

```json
{
  "licenseId": "lic_a1b2c3d4",
  "customerId": "cus_4a2f3c50",
  "plan": "pro",
  "status": "trial",
  "trialEndsAt": "2026-02-23T12:00:00.000Z",
  "currentPeriodStart": null,
  "currentPeriodEnd": null,
  "provider": "stripe",
  "providerCustomerId": null,
  "providerSubscriptionId": null,
  "createdAt": "2026-02-17T12:00:00.000Z",
  "updatedAt": "2026-02-17T12:00:00.000Z"
}
```

### 4) Evento de pagamento (auditoria e idempotência)

**Chave KV**

`payment_event:{provider}:{eventId}`

**Exemplo**

```json
{
  "provider": "stripe",
  "eventId": "evt_123",
  "type": "checkout.session.completed",
  "receivedAt": "2026-02-17T12:10:00.000Z",
  "processedAt": "2026-02-17T12:10:01.000Z",
  "status": "processed",
  "customerId": "cus_4a2f3c50",
  "keyHash": "sha256:...",
  "rawRef": {
    "checkoutSessionId": "cs_123",
    "subscriptionId": "sub_123"
  }
}
```

## Contratos HTTP (v1)

## 1) Signup + trial (landing page)

`POST /v1/signup-trial`

### Request

Headers:
- `Content-Type: application/json`
- `X-Request-Id: <uuid>` (opcional, recomendado)

Body:

```json
{
  "email": "cliente@empresa.com",
  "name": "Cliente Exemplo",
  "company": "Empresa Exemplo",
  "source": "landing-page",
  "acceptTerms": true,
  "acceptPrivacy": true
}
```

### Response (201)

```json
{
  "status": "ok",
  "customer": {
    "customerId": "cus_4a2f3c50",
    "email": "cliente@empresa.com"
  },
  "license": {
    "status": "trial",
    "plan": "pro",
    "trialEndsAt": "2026-02-23T12:00:00.000Z",
    "daysLeft": 6
  },
  "credentials": {
    "clientKey": "qag_live_xxxxxxxxx",
    "delivery": "webhook:email"
  }
}
```

### Erros

- `400` payload inválido
- `409` email já cadastrado com trial ativo
- `429` rate limit

## 2) Webhook de disparo de email (interno/opcional)

`POST /v1/webhooks/email-dispatched`

### Request

Headers:
- `Content-Type: application/json`
- `X-QAgent-Signature: t=<ts>,v1=<hmac>`

Body:

```json
{
  "eventId": "mail_789",
  "occurredAt": "2026-02-17T12:01:00.000Z",
  "type": "email.dispatched",
  "customerId": "cus_4a2f3c50",
  "email": "cliente@empresa.com",
  "template": "trial_welcome",
  "metadata": {
    "keyHash": "sha256:..."
  }
}
```

### Response (200)

```json
{
  "status": "ok",
  "processed": true
}
```

## 3) Webhook de pagamento (provedor)

`POST /v1/webhooks/payment`

### Request

Headers:
- `Content-Type: application/json`
- `X-QAgent-Signature: t=<ts>,v1=<hmac>` ou assinatura nativa do provedor

Body (evento normalizado):

```json
{
  "provider": "stripe",
  "eventId": "evt_123",
  "eventType": "checkout.session.completed",
  "occurredAt": "2026-02-17T12:10:00.000Z",
  "customer": {
    "customerId": "cus_4a2f3c50",
    "email": "cliente@empresa.com"
  },
  "reference": {
    "clientKey": "qag_live_xxxxxxxxx",
    "providerCustomerId": "cus_stripe_123",
    "providerSubscriptionId": "sub_123"
  },
  "billing": {
    "plan": "pro",
    "currency": "BRL",
    "amount": 5900,
    "interval": "month",
    "periodStart": "2026-02-17T12:10:00.000Z",
    "periodEnd": "2026-03-17T12:09:59.000Z",
    "status": "active"
  }
}
```

### Response (200)

```json
{
  "status": "ok",
  "processed": true,
  "idempotent": false
}
```

### Regra de idempotência

Se `provider + eventId` já tiver sido processado:

```json
{
  "status": "ok",
  "processed": false,
  "idempotent": true
}
```

## 4) Consulta de licença (compatível com extensão atual)

`GET /v1/license`

Headers:
- `Authorization: Bearer <clientKey>`

Response (200):

```json
{
  "status": "ok",
  "license": {
    "status": "trial",
    "plan": "pro",
    "expiresAt": "2026-02-23T12:00:00.000Z",
    "daysLeft": 6
  }
}
```

## Máquina de estados da licença

Estados suportados:

- `trial`
- `active`
- `past_due`
- `grace_period`
- `canceled`
- `expired`
- `revoked`

Transições principais:

1. `trial -> active` quando pagamento confirmado.
2. `trial -> expired` quando `trialEndsAt` passa sem pagamento.
3. `active -> past_due` quando cobrança falha.
4. `past_due -> grace_period` após primeira falha com janela de tolerância.
5. `grace_period -> active` quando regulariza pagamento.
6. `grace_period -> canceled` quando janela encerra sem regularização.
7. `active -> canceled` por cancelamento voluntário.
8. `canceled -> revoked` por fraude/abuso/admin.

Regra de acesso premium sugerida:

- Permitir: `trial`, `active`, `grace_period`.
- Bloquear: `expired`, `canceled`, `revoked`.
- Configurável para `past_due` (permitir ou bloquear via feature flag).

## Segurança e confiabilidade

- Assinatura HMAC obrigatória para webhooks.
- Janela anti-replay por timestamp (ex.: 5 minutos).
- Idempotência por `provider:eventId`.
- Hash de credenciais (`keyHash`) em armazenamento.
- Logs com PII mínima e `requestId`.
- Segredos em ambiente (`wrangler secret put`), nunca em arquivo versionado.

## Observabilidade (mínimo)

Campos mínimos de log por request:

- `requestId`
- `route`
- `statusCode`
- `latencyMs`
- `customerId` (quando houver)
- `keyHashPrefix` (ex.: primeiros 8 chars)
- `provider` e `eventId` (webhook)

## Checklist de rollout (fases)

## Fase 0 — Preparação

- [ ] Criar módulo de domínio de licença separado de `src/index.js`.
- [ ] Definir contratos JSON finais e versionar neste documento.
- [ ] Definir segredos: `WEBHOOK_SIGNING_SECRET`, `PAYMENT_PROVIDER_SECRET`.
- [ ] Revisar `wrangler.jsonc` para remover configurações ambíguas de KV.

## Fase 1 — Signup e trial

- [ ] Implementar `POST /v1/signup-trial`.
- [ ] Gerar `clientKey` + persistir `keyHash`.
- [ ] Criar `customer` e `license` com `status=trial`.
- [ ] Disparar evento de email de boas-vindas com chave.

## Fase 2 — Webhooks

- [ ] Implementar `POST /v1/webhooks/payment` com assinatura.
- [ ] Implementar idempotência por `provider:eventId`.
- [ ] Atualizar estado da licença por tabela de transição.
- [ ] Registrar eventos processados para auditoria.

## Fase 3 — Compatibilidade e migração

- [ ] Manter `GET /v1/license` compatível com extensão atual.
- [ ] Aceitar tokens legados durante janela de migração.
- [ ] Migrar gradualmente para `clientKey` emitido no signup.
- [ ] Adicionar métricas de adoção e erros por coorte.

## Fase 4 — Endurecimento

- [ ] Rotação de chaves/segredos.
- [ ] Revogação de credenciais por cliente.
- [ ] Limites por plano (rate-limit por tier).
- [ ] Testes de contrato para payloads de webhook.

## Critérios de aceite da preparação

- Contratos de payload aprovados por backend + landing + billing.
- Máquina de estados aprovada com regras de acesso premium.
- Estratégia de idempotência e assinatura definida.
- Checklist de rollout validado e priorizado.

## Notas de compatibilidade com o código atual

- A rota `GET /v1/license` já existe e pode ser mantida como ponto de leitura da licença.
- O modelo atual de `token` pode ser tratado como legado; o novo padrão deve ser `clientKey`.
- O envio de chave por email deve ser orientado por evento, sem bloquear o retorno do signup.

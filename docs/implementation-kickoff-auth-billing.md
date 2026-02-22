# Kickoff de implementação — Auth + Trial + Billing

Base de referência:
- [blueprint-auth-billing.md](./blueprint-auth-billing.md)
- [tickets-auth-billing-rollout.md](./tickets-auth-billing-rollout.md)

## Status atual (pré-implementação)

- Baseline de testes do repositório: **verde** (`npm test` passou).
- Arquitetura de licença/token está concentrada em [src/index.js](../src/index.js).
- Já existem validações em [src/lib/validators.js](../src/lib/validators.js), mas apenas para `generate-tests` e `autofill`.
- Não existem rotas de `signup-trial` e `webhooks/payment` implementadas.

## Gaps críticos encontrados

1. **Acoplamento alto no entrypoint**
   - Regras de token, licença, trial, rate-limit e roteamento misturadas no mesmo arquivo.
   - Impacto: aumenta risco de regressão ao introduzir novos estados/eventos.

2. **Modelo de credencial legado**
   - Fluxo atual depende de token direto no header.
   - Impacto: sem separação explícita entre identidade do cliente e chave técnica.

3. **Sem camada de contrato para novos endpoints**
   - Não há validadores para `signup-trial`, `email-dispatched` e `payment webhook`.

4. **Configuração de KV ambígua no wrangler**
   - Há `kv_namespaces` no nível raiz e também dentro de `vars` em [wrangler.jsonc](../wrangler.jsonc).
   - A configuração efetiva deve ficar apenas no nível raiz.

## Decisões prontas para execução

- `clientKey` será credencial de acesso (enviada no `Authorization: Bearer`), persistindo apenas `keyHash`.
- `customerId` será identidade de negócio (separada da credencial).
- Eventos de pagamento serão idempotentes por `provider:eventId`.
- Regra de acesso premium: permitir `trial`, `active`, `grace_period`.

## Sequência de implementação recomendada (primeiras PRs)

## PR-1 (BE-0001 + BE-0002) — Modularização e config

**Objetivo:** reduzir risco antes de adicionar novas rotas.

### Mudanças previstas

- Criar módulos em `src/lib/`:
  - `licenseService.js`
  - `customerService.js`
  - `keyService.js`
  - `paymentEventService.js` (só estrutura inicial)
- Refatorar [src/index.js](../src/index.js) para usar serviços.
- Corrigir [wrangler.jsonc](../wrangler.jsonc): remover `kv_namespaces` de `vars`.

### Critério de pronto

- `src/index.js` com roteamento mais limpo.
- comportamento atual de `GET /v1/license` preservado.
- testes atuais continuam verdes.

## PR-2 (BE-0003 + BE-1001) — Contratos e credencial

**Objetivo:** preparar base para signup.

### Mudanças previstas

- Expandir [src/lib/validators.js](../src/lib/validators.js) com:
  - `validateSignupTrialBody`
  - `validatePaymentWebhookBody`
  - `validateEmailDispatchedBody`
- Criar utilitário de credencial em `src/lib/keyService.js`:
  - `generateClientKey`
  - `hashClientKey`
  - `validateClientKeyFormat`

### Critério de pronto

- Contratos e validações dos novos payloads disponíveis.
- hash de chave padronizado e testado.

## PR-3 (BE-1002) — Endpoint de signup trial

**Objetivo:** colocar aquisição em funcionamento com trial.

### Mudanças previstas

- Implementar `POST /v1/signup-trial`.
- Persistir:
  - `customer:{customerId}`
  - `clientkey:{keyHash}`
  - `license:{keyHash}`
- Resposta conforme blueprint.

### Critério de pronto

- signup cria cliente + licença trial + credencial.
- duplicidade de cadastro retorna `409`.

## PR-4 (BE-2001 + BE-2002) — Webhook seguro e idempotente

**Objetivo:** preparar ativação via pagamento.

### Mudanças previstas

- Implementar verificação de assinatura e anti-replay.
- Implementar `POST /v1/webhooks/payment`.
- Persistir `payment_event:{provider}:{eventId}`.

### Critério de pronto

- replay não duplica processamento.
- webhook sem assinatura válida é rejeitado.

## Plano de testes para início

1. **Smoke atual:** manter `npm test` em todo PR.
2. **Novos unit tests:**
   - geração/hash de `clientKey`.
   - validações de payload dos novos endpoints.
   - idempotência por `provider:eventId`.
3. **Contratos HTTP (mínimo):**
   - `signup-trial` (201/400/409)
   - `webhooks/payment` (200 idempotente, 401 assinatura inválida)

## Checklist operacional (antes da PR-1)

- [ ] Definir segredos no ambiente (`wrangler secret put`):
  - `WEBHOOK_SIGNING_SECRET`
  - `PAYMENT_PROVIDER_SECRET`
- [ ] Confirmar namespace KV de preview e produção.
- [ ] Definir formato final do prefixo de chave (`qag_live_`, `qag_test_`).
- [ ] Definir janela anti-replay (sugestão: 300s).

## Riscos e mitigação

- **Risco:** quebra no fluxo atual da extensão.
  - **Mitigação:** preservar `GET /v1/license` em compatibilidade em todas as PRs iniciais.

- **Risco:** regressão por refatoração em arquivo grande.
  - **Mitigação:** modularização incremental com PR curta e testes a cada etapa.

- **Risco:** inconsistência entre payload do provedor e evento interno.
  - **Mitigação:** normalização explícita + testes de contrato com payload sandbox real.

## Definição de início (Go/No-Go)

**Go** quando:
- baseline de testes verde,
- segredos provisionados,
- PR-1 aprovada.

**No-Go** se:
- KV/segredos não estiverem prontos,
- não houver alinhamento do formato final de `clientKey`.

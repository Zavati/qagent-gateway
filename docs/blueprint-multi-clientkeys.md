# Blueprint técnico — Multi clientKeys por conta

## Objetivo

Permitir que uma mesma conta (customerId) tenha **várias clientKeys ativas ao mesmo tempo**, para cenários como:

- 1 gestor de conta criando N tokens para QAs / times internos;
- uso de ambientes distintos (ex.: "chrome pessoal", "máquina de QA", "pipeline CI");
- rotação gradual de chaves (revogar uma sem derrubar outras integrações).

Tudo isso **sem quebrar**:

- o fluxo atual da extensão (GET /v1/license com Authorization: Bearer <clientKey>);
- o fluxo de signup trial;
- o fluxo de billing + webhooks de pagamento;
- o console já existente (license, payments).

---

## Escopo desta evolução

Este documento descreve apenas o design técnico da evolução para multi-clientKeys. As etapas de implementação incremental aparecem em tickets/tarefas separados.

### O que muda

- Novo endpoint autenticado por sessão de console:
  - `POST /v1/console/clientkeys` — cria uma **nova clientKey** para o mesmo customerId, sem revogar as existentes.
- Endpoint opcional de revogação:
  - `POST /v1/console/clientkeys/revoke` — revoga uma clientKey específica.
- Ajuste do webhook de pagamento:
  - `POST /v1/webhooks/payment` passa a **atualizar a licença de todas as clientKeys** do mesmo customerId, em vez de apenas uma.
- Campos adicionais em estruturas de KV já existentes (compatíveis):
  - `clientkey:{keyHash}` ganha campo opcional `note`.

### O que permanece igual

- Modelo de licença por `license:{keyHash}` (uma licença por clientKey, mesma estrutura de dados).
- Máquina de estados de licença (`trial`, `active`, `expired`, `revoked`, etc.).
- `GET /v1/license` continua validando **apenas pela clientKey fornecida** e lendo `license:{keyHash}`.
- `GET /v1/console/license` continua fornecendo visão consolidada + lista de clientKeys.
- `rotate-clientkey` continua existindo como operação separada.

---

## Modelo de dados (KV) com multi-clientKeys

### 1) clientkey:{keyHash}

**Chave KV:** `clientkey:{keyHash}`

**Estado atual (antes da mudança)**

```json
{
  "keyHash": "sha256:...",
  "customerId": "cus_4a2f3c50",
  "label": "signup-trial",
  "clientKeyPrefix": "qag_live_abc123...",
  "createdAt": "2026-02-17T12:00:00.000Z",
  "lastUsedAt": null,
  "revokedAt": null
}
```

**Estado proposto (após mudança)**

```json
{
  "keyHash": "sha256:...",
  "customerId": "cus_4a2f3c50",
  "label": "qa-joao",
  "note": "Squad pagamentos",
  "clientKeyPrefix": "qag_live_abc123...",
  "createdAt": "2026-03-02T03:00:00.000Z",
  "lastUsedAt": null,
  "revokedAt": null
}
```

- Campo novo: `note` (string opcional, ex.: 0–256 chars), apenas para descrição interna.
- Regra de compatibilidade: docs/código que não conhecem `note` continuam funcionando normalmente.

### 2) license:{keyHash}

**Chave KV:** `license:{keyHash}` (inalterada)

Cada clientKey continua tendo **sua própria licença**, mas todas as licenças de um mesmo `customerId` devem manter o **mesmo estado efetivo** (status, plano, período), de forma que qualquer clientKey ativa represente a assinatura consolidada da conta.

Exemplo após um upgrade para plano pago com 3 clientKeys:

```json
{
  "licenseId": "lic_1",
  "customerId": "cus_4a2f3c50",
  "status": "active",
  "plan": "pro",
  "trialEndsAt": null,
  "currentPeriodStart": "2026-03-02T03:00:00.000Z",
  "currentPeriodEnd": "2026-04-01T03:00:00.000Z",
  "expiresAt": "2026-04-01T03:00:00.000Z",
  "provider": "stripe",
  "providerCustomerId": "cus_stripe_123",
  "providerSubscriptionId": "sub_123",
  "createdAt": "2026-02-17T12:00:00.000Z",
  "updatedAt": "2026-03-02T03:00:00.000Z"
}
```

Esse mesmo shape se repete em `license:{keyHash2}`, `license:{keyHash3}` para o mesmo `customerId`.

### 3) Índice customer_email:{email}

**Chave KV:** `customer_email:{email-lowercase}`

Hoje:

```json
{
  "customerId": "cus_4a2f3c50",
  "keyHash": "sha256:principal...",
  "updatedAt": "2026-02-17T12:00:00.000Z"
}
```

- Continua representando a **clientKey principal** (usada em telas como `/v1/auth/me` e `/v1/console/license` para consolidar a visão de licença).
- O fato de existirem outras clientKeys não exige mudança nessa estrutura; ela só precisa apontar para uma key representativa.

---

## Novos endpoints de console

### 1) POST /v1/console/clientkeys — criar clientKey adicional

Endpoint autenticado via `sessionToken` (mesmo padrão dos demais endpoints de console).

**Autenticação:**

- Header: `Authorization: Bearer <sessionToken>`
- Sessão validada por `verifySessionToken`, vinculada a um `user` com `customerId`.

**Request**

Headers:

- `Content-Type: application/json`

Body (campos opcionais, todos opcionais):

```json
{
  "label": "qa-joao",
  "note": "Squad pagamentos"
}
```

Regras de validação (implementadas em `validateCreateClientKeyBody`):

- `label` opcional, string 1–64 caracteres.
- `note` opcional, string 0–256 caracteres.
- Se body vier vazio, é aceito (usa defaults internos).

**Comportamento**

1. Valida sessão e carrega `user` e `customerId`.
2. Garante que `customerId` existe; caso contrário, retorna erro 409.
3. Aplica limite de segurança `MAX_KEYS_PER_CUSTOMER` (ex.: 50):
   - Varre `clientkey:*` procurando registros com `rec.customerId === user.customerId`.
   - Se o total (incluindo revogadas ou opcionalmente só ativas) >= limite, retorna 409.
4. Gera nova `clientKey` seguindo o mesmo padrão do signup/rotate:
   - `keyMode = env.CLIENT_KEY_MODE` → `"live"` ou `"test"`.
   - `clientKey = generateClientKey(...)`.
   - `keyHash = hashClientKey(clientKey)`.
5. Persiste `clientkey:{keyHash}` com:

```json
{
  "keyHash": "sha256:...",
  "customerId": "cus_4a2f3c50",
  "label": "qa-joao",          // opcional
  "note": "Squad pagamentos",  // opcional
  "clientKeyPrefix": "qag_live_abc123...",
  "createdAt": "2026-03-02T03:00:00.000Z",
  "lastUsedAt": null,
  "revokedAt": null
}
```

6. Cria licença inicial para essa nova key (detalhada abaixo, em "Licença inicial para novas keys").
7. Retorna 201 com a chave completa **somente uma vez**.

**Response (201)**

```json
{
  "status": "ok",
  "clientKey": "qag_live_...",           
  "clientKeyPrefix": "qag_live_abc123...",
  "createdAt": "2026-03-02T03:00:00.000Z"
}
```

Regras adicionais:

- A `clientKey` completa **nunca** é retornada em listagens como `GET /v1/console/license`.
- O prefixo pode ser usado pelo console para exibir/identificar a chave para o usuário.

### 2) POST /v1/console/clientkeys/revoke — revogar uma clientKey específica (opcional)

Endpoint opcional, mas recomendado para gestão operacional de chaves.

**Autenticação:** mesma de `/v1/console/clientkeys`.

**Request**

Body (uma das formas):

```json
{ "prefix": "qag_live_abc123" }
```

ou

```json
{ "keyHash": "sha256:..." }
```

**Comportamento sugerido**

1. Valida sessão, carrega `user` e `customerId`.
2. Resolve `keyHash`:
   - se vier `keyHash`, usa direto;
   - se vier `prefix`, varre `clientkey:*` do `customerId` até encontrar um registro com `clientKeyPrefix` compatível.
3. Carrega `clientkey:{keyHash}` e verifica se pertence ao mesmo `customerId`.
4. Marca `revokedAt` com `now` e sobrescreve em KV.
5. Opcional (recomendado):
   - lê `license:{keyHash}`;
   - seta `status = "revoked"` e atualiza `updatedAt`.
6. Retorna 200 com status genérico:

```json
{
  "status": "ok"
}
```

> Observação: a revogação **não** afeta outras keys do mesmo `customerId`. O modelo é multi-seat: cada clientKey é um assento lógico.

---

## Licença inicial para novas keys

Quando uma nova clientKey é criada via `POST /v1/console/clientkeys`, ela precisa nascer com uma licença coerente com a situação atual do cliente.

### Regra recomendada

1. A partir do `user.customerId`, localizar o `customer` (via `getCustomerById`).
2. Obter o email principal do cliente (customer.email).
3. Usar `getCustomerByEmail(env, email)` para recuperar o `keyHash` principal do índice `customer_email:{email}`.
4. Se existir `keyHash` principal **e** `license:{keyHash}` ativa/trial:
   - clonar essa licença para `license:{newKeyHash}`.
5. Se não existir licença consolidada (cliente muito antigo/edge case):
   - criar uma nova licença trial padrão via `createTrialLicenseForKeyHash(env, { keyHash: newKeyHash, customerId })`.

Exemplo de clonagem:

```js
await kv.put(`license:${newKeyHash}`, JSON.stringify({
  ...licenseConsolidada,
  keyHash: newKeyHash,
  updatedAt: nowISO
}));
```

Por que essa abordagem funciona:

- `GET /v1/license` continua olhando somente para `license:{keyHash}` da key que chega no header.
- Se todas as licenças de um `customerId` tiverem o mesmo status/plano/período, qualquer token ativo terá a mesma "assinatura".

---

## Ajustes no webhook de pagamento para múltiplas keys

### Comportamento atual (simplificado)

No handler `POST /v1/webhooks/payment`:

1. Normaliza o evento (Stripe ou genérico).
2. Resolve `keyHash` principal a partir de:
   - `reference.clientKey`, ou
   - mapeamentos `stripe:cust:{providerCustomerId}` / `stripe:sub:{providerSubscriptionId}`.
3. Chama `applyPaymentToLicense(env, { keyHash, paymentPayload })` **somente para esse keyHash**.
4. Salva `payment_event:{provider}:{eventId}` com esse `keyHash`.

### Comportamento proposto com multi-clientKeys

Objetivo: quando um pagamento é feito para uma conta, **todas** as clientKeys desse `customerId` devem refletir a mesma licença.

Novo fluxo após resolver o `keyHash` principal:

1. Ler `clientkey:{keyHash}` para descobrir o `customerId`.
2. Varre `clientkey:*` no KV para listar todos os registros com `rec.customerId === customerId`.
3. Monta um conjunto `keyHashesDoCliente` com todos os `keyHash` encontrados (inclusive o principal).
4. Para cada `kh` em `keyHashesDoCliente`, chama:

```js
await applyPaymentToLicense(env, { keyHash: kh, paymentPayload: body });
```

5. Mantém o evento `payment_event:{provider}:{eventId}` apontando para o `keyHash` original (principal), para preservar compatibilidade com `GET /v1/console/payments` atual.

### Idempotência e consistência

- `savePaymentEvent` continua garantindo idempotência por `(provider, eventId)`.
- `applyPaymentToLicense` é chamado múltiplas vezes (uma por key do cliente), mas:
  - as transições de estado são bem-definidas e idempotentes para uma mesma combinação `(license atual, paymentPayload)`.
- Em caso de reenvio de webhook, `savePaymentEvent` devolve `created: false` e podemos pular a reaplicação em lote (ou reaplicar sabendo que o contrato de transição é seguro).

---

## Regras de negócio recomendadas

- Definir `MAX_KEYS_PER_CUSTOMER` (por config/env), por exemplo `50`, para evitar abuso.
- Considerar only-count de keys **não revogadas** para esse limite (business decision).
- Nunca retornar `clientKey` completa em listagens; apenas em:
  - `POST /v1/signup-trial` (primeira emissão);
  - `POST /v1/console/rotate-clientkey`;
  - `POST /v1/console/clientkeys` (novo endpoint).
- Manter `rotate-clientkey` com semântica de "trocar chave principal" (revoga a anterior e atualiza índice customer_email).
- Tratar revogação de uma key como operação independente (não afeta as demais).

---

## Impactos esperados no frontend (console)

Com os endpoints e regras acima, o console passa a oferecer:

- Botão "Adicionar token" na tela de licença/clientKeys:
  - Abre modal com campos opcionais `label` e `note`.
  - Chama `POST /v1/console/clientkeys`.
  - Exibe a nova `clientKey` em um modal de cópia única.
  - Atualiza a lista de `clientKeys` chamando `GET /v1/console/license`.
- Botão "Revogar" (opcional) para cada linha de clientKey:
  - Chama `POST /v1/console/clientkeys/revoke`.
  - Recarrega `GET /v1/console/license`.

Do ponto de vista da extensão, nada muda: ela continua recebendo apenas uma string `clientKey`, que agora pode ter sido gerada por esse novo fluxo de multi-tokens.

---

## Próximos passos de implementação

1. Implementar `validateCreateClientKeyBody` em `src/lib/validators.js`.
2. Implementar `handleCreateClientKey` em `src/index.js` com as regras acima.
3. Ajustar `handlePaymentWebhook` para atualizar todas as `license:{keyHash}` de um mesmo `customerId`.
4. (Opcional) Implementar `handleRevokeClientKey` e `POST /v1/console/clientkeys/revoke`.
5. Atualizar `docs/console-implementation.md` com o fluxo de UI (botão "Adicionar token").

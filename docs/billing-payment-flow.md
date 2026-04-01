# QAgent Gateway — Fluxo de Pagamentos (Stripe)

Este documento descreve, de forma técnica, como funciona o fluxo de pagamento no QAgent Gateway usando Stripe:

- quais **rotas HTTP** existem e em que momento são chamadas;
- quais **payloads** (request/response) trafegam entre frontend ↔ gateway ↔ Stripe;
- quais **funções internas** são responsáveis por cada etapa;
- decisões de design ("por quê"), inclusive sobre múltiplos pagamentos para a mesma `clientKey`.

> Nota: este documento complementa o [docs/console-payments-flow.md](console-payments-flow.md), que foca mais na implementação do frontend.

---

## 1. Visão geral

Fluxo simplificado de uma compra/renovação usando Stripe Checkout:

1. Usuário acessa o **console** (app web) e faz login (`/v1/auth/login`).
2. Console obtém dados da licença e histórico de pagamentos via:
   - `GET /v1/console/license`
   - `GET /v1/console/payments`
3. Usuário escolhe um **plano** (produto/price), obtido via:
   - `GET /v1/billing/plans`
4. Console cria uma sessão de Checkout no Stripe chamando:
   - `POST /v1/billing/checkout`
5. Gateway chama Stripe (`/v1/checkout/sessions`) e retorna a `url` de pagamento.
6. Console redireciona o usuário para essa `url` (Stripe Checkout).
7. Stripe processa o pagamento e:
   - redireciona o usuário para `successUrl` ou `cancelUrl` (páginas do console);
   - envia eventos para o webhook do gateway:
     - `POST /v1/webhooks/payment`
8. Gateway:
  - normaliza o evento Stripe (`normalizeStripeEvent`),
  - aplica o pagamento à licença (`applyPaymentToLicense`) **para todas as clientKeys do mesmo customerId** (modo multi-clientKey),
  - persiste evento em `QAGENT_KV` (`savePaymentEvent`).
9. Console, ao carregar a tela de sucesso, chama novamente:
   - `GET /v1/console/license`
   - `GET /v1/console/payments`
   para refletir o status atualizado.

---

## 2. Rotas públicas (frontend ↔ gateway)

### 2.1. `GET /v1/billing/plans`

**Arquivo:** `src/index.js` → `handleBillingPlans`

Retorna catálogo estático inicial de planos (pode ser evoluído no futuro para vir da Stripe ou config).

**Request:**
- Método: `GET`
- Autenticação: não obrigatória (apenas leitura de catálogo).

**Response (exemplo abreviado):**

```json
{
  "status": "ok",
  "plans": [
    {
      "id": "prod_U1WMgGOpb76KGW",
      "object": "product",
      "name": "QAgent",
      "description": "Acesso ao QAgent, plataforma de inteligência para testes de software, geração de casos de teste e automação de evidências.",
      "images": ["https://files.stripe.com/links/..."],
      "default_price": "price_1T3TK6BjKnMOesshUJY95S2l",
      "type": "service",
      "livemode": true,
      "priceId": "price_1T3TK6BjKnMOesshUJY95S2l",
      "price": "79,00",
      "currency": "BRL",
      "mensagem": "Produto destinado a pessoa física."
    }
  ]
}
```

**Por quê:**
- Frontend precisa saber quais planos/`priceId` estão disponíveis.
- Mantemos estrutura similar à do `product` da Stripe para facilitar debug e futura automação.
- Campos `priceId`, `price`, `currency`, `mensagem` ajudam a montar a UI sem chamar Stripe direto no browser.

---

### 2.2. `POST /v1/billing/checkout`

**Arquivo:** `src/index.js` → `handleBillingCheckout`

Cria uma sessão de Checkout na Stripe para um determinado `clientKey` e `priceId`.

**Request:**
- Método: `POST`
- Headers:
  - `Content-Type: application/json`
- Body (exemplo):

```json
{
  "clientKey": "qag_test_nfWEvG7gj0Y7W6Lt3OKHmnJwCjGKq4A78KHXC93V",
  "priceId": "price_1T3TK6BjKnMOesshUJY95S2l",
  "successUrl": "https://app.seusite.com/billing/success",
  "cancelUrl": "https://app.seusite.com/billing/cancel",
  "quantity": 1,
  "metadata": {
    "origin": "console",
    "plan": "pro"
  }
}
```

**Comportamento interno (`handleBillingCheckout`):**

1. Valida tamanho do body com `readJsonWithLimit`.
2. Resolve `clientKey`:
   - `body.clientKey` **ou**, se ausente, `Authorization: Bearer ...` (usado como `clientKey` em alguns fluxos legados).
3. Resolve `priceId`:
   - `body.priceId` **ou** `env.STRIPE_PRICE_ID`.
4. Calcula `successUrl`/`cancelUrl`:
   - `body.successUrl` ou `env.STRIPE_SUCCESS_URL` ou `origin + "/billing/success"`;
   - `body.cancelUrl` ou `env.STRIPE_CANCEL_URL` ou `origin + "/billing/cancel"`.
5. Define `quantity` (default 1).
6. Chama `createCheckoutSession` de `src/lib/stripeService.js`.
7. Retorna JSON:

```json
{
  "status": "ok",
  "sessionId": "cs_test_...",
  "url": "https://checkout.stripe.com/c/pay_cs_test_..."
}
```

**Por quê:**
- Isolar a lógica Stripe no backend evita expor `STRIPE_SECRET_KEY` no frontend.
- `clientKey` é usada como identificador da licença; o webhook usa isso depois para encontrar o `keyHash` correto.
- `successUrl` e `cancelUrl` são URLs do frontend para pós-checkout.

---

### 2.3. `POST /v1/webhooks/payment`

**Arquivo:** `src/index.js` → `handlePaymentWebhook`

Recebe eventos de pagamento (ex.: `checkout.session.completed`) do Stripe **ou** eventos de outros provedores (via webhook assinado do QAgent).

Existem dois modos:

1. **Stripe nativo** (com `Stripe-Signature` e `STRIPE_WEBHOOK_SECRET`).
2. **Webhook genérico QAgent** (com `X-QAgent-Signature`).

#### 2.3.1. Stripe nativo

- Se o header `Stripe-Signature` estiver presente **e** `env.STRIPE_WEBHOOK_SECRET` configurado:
  1. `verifyStripeWebhook(req, env)` (em `src/lib/stripeService.js`) valida a assinatura.
  2. Faz `JSON.parse` do payload.
  3. Chama `normalizeStripeEvent(payloadJson)`, que converte para o contrato interno `paymentWebhook.request`.

**Estrutura interna normalizada (aprox.):**

```json
{
  "provider": "stripe",
  "eventId": "evt_...",
  "eventType": "payment.completed",
  "occurredAt": "2026-02-26T10:05:00.000Z",
  "customer": {
    "customerId": "cus_...",
    "email": "user@example.com"
  },
  "reference": {
    "clientKey": "qag_...",
    "providerCustomerId": "cus_...",
    "providerSubscriptionId": "sub_..."
  },
  "billing": {
    "status": "active",
    "amount": 4900,
    "currency": "usd"
  }
}
```

#### 2.3.2. Webhook genérico QAgent

- Se **não** houver `Stripe-Signature`, o fluxo é:
  1. Lê body bruto com `req.clone().text()`.
  2. Valida assinatura HMAC com `verifyWebhookSignatureOrThrow` (`X-QAgent-Signature`).
  3. Limita tamanho e faz parse JSON com `readJsonWithLimit`.
  4. Garante `occurredAt` (preenche com `now` se ausente).
  5. Permite definir `reference.clientKey` via header `clientKey`/`ClientKey`/`x-client-key`.
  6. Valida contrato com `validatePaymentWebhookBody` (`src/lib/validators.js`).

#### 2.3.3. Persistência e aplicação na licença

Depois de ter um `body` normalizado:

1. Resolve `keyHash` via `hashClientKey(body.reference.clientKey)` quando possível.
2. Se não houver `clientKey`, tenta reconciliar por Stripe customer/subscription via KV:
   - `stripe:cust:<providerCustomerId>`
   - `stripe:sub:<providerSubscriptionId>`
3. Persiste mapeamento `Stripe customer/sub` → `keyHash` para usos futuros.
4. Monta `toSave` e chama `savePaymentEvent` (`src/lib/paymentEventService.js`) para gravar em `payment_event:<provider>:<eventId>`.
5. Chama `applyPaymentToLicense(env, { keyHash, paymentPayload: body })` para atualizar a licença.
6. Retorna JSON indicando se o evento foi processado e se foi idempotente.

**Por quê:**
- Normalizar o contrato (`paymentWebhook.request`) permite lidar com múltiplos provedores no mesmo fluxo.
- Manter eventos em KV (`payment_event:*`) permite montar histórico no console sem depender da Stripe em tempo real.
- `applyPaymentToLicense` centraliza as regras de status (`trial`, `active`, `expired`, etc.).

---

### 2.4. `GET /v1/console/payments`

**Arquivo:** `src/index.js` → `handleConsolePayments`

Retorna o histórico de pagamentos associado ao `customerId` do usuário logado.

**Request:**
- Método: `GET`
- Headers:
  - `Authorization: Bearer <sessionToken>`

**Comportamento interno:**

1. Valida sessão com `verifySessionToken`.
2. Busca o `user` (via `getUserById`) e garante que tem `customerId`.
3. Percorre `QAGENT_KV` para encontrar todas as `clientkey:*` associadas a esse `customerId`, coletando `keyHash`.
4. Percorre `payment_event:*` e filtra os eventos cujo `evt.keyHash` esteja nesse conjunto.
5. Constrói resposta simplificada por evento:

```json
{
  "provider": "stripe",
  "eventId": "evt_...",
  "type": "payment.completed",
  "occurredAt": "2026-02-26T10:05:00.000Z",
  "status": "active",
  "amount": 4900,
  "currency": "usd",
  "link": "https://dashboard.stripe.com/events/evt_..."
}
```

6. Ordena do mais recente para o mais antigo.

**Por quê:**
- Permite ao usuário ver todas as cobranças feitas para qualquer `clientKey` ligada à sua conta.
- Não depende de chamadas diretas à Stripe; usa apenas dados persistidos no próprio KV.

---

### 2.5. `GET /v1/console/license`

**Arquivo:** `src/index.js` → `handleConsoleLicense`

Retorna um resumo da licença atual e a lista de `clientKeys` do cliente.

**Uso no contexto de pagamentos:**
- Após um pagamento bem-sucedido, o frontend chama esta rota para ver se o status mudou para `active` e qual a nova data de expiração (`expiresAt`, `daysLeft`).

---

## 3. Funções internas principais

### 3.1. `createCheckoutSession` (Stripe)

**Arquivo:** `src/lib/stripeService.js`

Responsável por:
- Determinar se o `priceId` é de assinatura (`subscription`) ou pagamento único (`payment`).
- Montar o body da request para `https://api.stripe.com/v1/checkout/sessions`.
- Configurar cabeçalhos, incluindo `Idempotency-Key`.
- Tratar erros de API da Stripe e devolver o JSON da sessão criada.

**Idempotência:**

```js
async function computeDeterministicIdempotencyKey(clientKey, priceId, quantity, metadata, mode, successUrl, cancelUrl) {
  const metaStr = stableStringify(metadata || {});
  const input = `${clientKey}|${priceId}|${String(quantity)}|${String(mode || '')}|${metaStr}|${successUrl || ''}|${cancelUrl || ''}`;
  // SHA-256 → hex → prefixo idem_...
}
```

- A key leva em conta:
  - `clientKey`, `priceId`, `quantity`, `mode`, `metadata`, `successUrl`, `cancelUrl`.
- Motivo:
  - Se todos esses parâmetros forem iguais, chamadas repetidas devem ser idempotentes (não criar várias sessões/pagamentos).
  - Se algum deles mudar (ex.: URLs diferentes), geramos uma nova idempotency key para evitar erro `idempotency_error` da Stripe.

### 3.2. `savePaymentEvent`

**Arquivo:** `src/lib/paymentEventService.js`

- Garante idempotência no lado do gateway:
  - Usa chave `payment_event:<provider>:<eventId>`.
  - Se o evento já existe, retorna `{ created: false }`.
- Adiciona metadados padrão:
  - `receivedAt`, `processedAt`, `status`.

**Por quê:**
- Evita aplicar o mesmo evento de pagamento duas vezes na licença.
- Mantém trilha de auditoria dos eventos recebidos.

### 3.3. `applyPaymentToLicense`

**Arquivo:** `src/lib/licenseService.js`

Função crítica que traduz um pagamento em uma mudança de licença.

Fluxo:

1. Se `keyHash` ausente → `{ updated: false, blocked: true, reason: 'missing_key_hash' }`.
2. Carrega licença atual em `license:<keyHash>`.
3. Determina `targetStatus` via `inferTargetStatusFromPayment`:
   - Usa `billing.status` (quando presente) ou `eventType` (ex.: contém `completed`, `paid`, `failed`, `canceled`).
4. Define período:
   - Usa `paymentPayload.billing.periodStart`/`periodEnd` se vierem do provedor.
   - Caso contrário, para sucesso (`targetStatus === 'active'`), define `periodEnd = now + 30 dias` (`PAID_DAYS`).
5. Se não houver licença atual:
   - Cria uma nova licença com:
     - `status = targetStatus` (ex.: `active`),
     - `plan` (default `'pro'`),
     - `currentPeriodStart`/`currentPeriodEnd` e `expiresAt` baseados no período calculado.
6. Se já houver licença:
   - Verifica se a transição é permitida (`ALLOWED_LICENSE_TRANSITIONS`).
   - Atualiza campos principais, incluindo `expiresAt`.

**Sobre múltiplos pagamentos para a mesma `clientKey`:**

- Cada pagamento bem-sucedido com `targetStatus = 'active'`:
  - **redefine** o `periodEnd`/`expiresAt` para "30 dias a partir de agora" se o provedor não informar período.
- Não há hoje lógica de "empilhar" pagamentos (somar 30 dias em cima de um `expiresAt` existente). Decisão atual:
  - Mantém comportamento simples e previsível para um MVP.
  - Evita bugs complexos de sobreposição de períodos.
- O histórico de todos os pagamentos continua disponível em `payment_event:*` e via `GET /v1/console/payments`.

Se no futuro for necessário acumular períodos (ex.: cada novo pagamento adiciona 30 dias ao vencimento atual se ainda estiver no futuro), a alteração se concentra apenas dentro de `applyPaymentToLicense`.

---

## 4. Comportamento em cenários específicos

### 4.1. Vários pagamentos para a mesma `clientKey`

- **Histórico:**
  - Cada evento é salvo separadamente (`payment_event:stripe:<eventId>`).
  - `GET /v1/console/payments` retorna **lista** com todos os eventos.
- **Licença:**
  - `applyPaymentToLicense` é chamada para cada evento novo (`saved.created === true`).
  - A licença é sempre atualizada para refletir o status mais recente e um novo período padrão (se o provedor não mandar período explícito).

### 4.2. Reprocessamento / reenvio de webhook

- `savePaymentEvent` impede recriação do mesmo evento (`created: false`).
- No handler do webhook, se `created` é falso, a função retorna `{ processed: false, idempotent: true }`, sem reaplicar o pagamento.

### 4.3. Falhas de verificação de assinatura (Stripe ou QAgent)

- Em caso de erro na verificação de assinatura:
  - O webhook responde com erro 4xx (por ex.: 403),
  - Nenhum `payment_event` é salvo,
  - Nenhuma licença é alterada.

---

## 5. Resumo rápido das rotas e responsabilidades

- `GET /v1/billing/plans`
  - Expõe catálogo de produtos/planos para o frontend.
- `POST /v1/billing/checkout`
  - Cria sessão de pagamento na Stripe para um `clientKey` + `priceId`.
- `POST /v1/webhooks/payment`
  - Recebe eventos de pagamento (Stripe ou outros provedores), normaliza, persiste e aplica na licença.
- `GET /v1/console/payments`
  - Lista histórico de pagamentos ligados ao `customerId` do usuário logado.
- `GET /v1/console/license`
  - Retorna status atual da licença e dados de expiração, usados para atualizar a UI após o pagamento.

Com esse desenho, o frontend não precisa falar diretamente com a Stripe: todo o ciclo de vida de pagamento e licença é mediado pelo gateway, com histórico em KV e regras de negócio centralizadas em `licenseService`.

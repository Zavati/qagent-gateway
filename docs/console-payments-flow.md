# Console QAgent — Fluxo de Pagamentos no Frontend

Este documento descreve, passo a passo, como o frontend (console web) deve implementar o fluxo de pagamentos usando o gateway QAgent + Stripe.

Foca em:
- quais endpoints chamar,
- em que ordem,
- quais payloads enviar/receber,
- como amarrar isso com a experiência de UI.

## 1. Visão geral do fluxo

1. Usuário faz login na console e obtém um `sessionToken` (JWT).
2. Front exibe status da licença atual (trial/ativa/expirada) e histórico de pagamentos.
3. Usuário clica em um botão do tipo "Assinar", "Renovar" ou "Atualizar plano".
4. Front chama `POST /v1/billing/checkout` informando o `clientKey` vinculado ao cliente.
5. Gateway cria uma Stripe Checkout Session e retorna uma `url` de pagamento.
6. Front redireciona o usuário para essa `url` (página do Stripe).
7. Usuário conclui (ou cancela) o pagamento no Stripe.
8. Stripe chama o webhook `/v1/webhooks/payment` no gateway, que atualiza licença e registra o evento.
9. Stripe redireciona o usuário de volta para uma `successUrl` ou `cancelUrl` do frontend.
10. Na tela de retorno, o frontend chama novamente as APIs de licença/pagamentos para refletir o novo status.

## 2. Pré-requisitos no frontend

- Ter implementado o login da console conforme [docs/console-implementation.md](console-implementation.md):
  - `POST /v1/auth/login`.
  - `GET /v1/auth/me`.
- Guardar o `sessionToken` retornado no login (por exemplo, em `localStorage` ou `sessionStorage`).
- Ter uma forma de saber qual `clientKey` usar para pagamentos:
  - Ou o backend da console guarda o `clientKey` completo retornado no `POST /v1/signup-trial`.
  - Ou o usuário informa a `clientKey` manualmente em algum momento (menos recomendado).
- Configurar variável de ambiente no frontend, por exemplo `NEXT_PUBLIC_API_BASE_URL`, apontando para o gateway (ex.: `https://api.apiqagent.com`).

## 3. Endpoints envolvidos no fluxo de pagamento

### 3.1. Obter status de licença e clientKeys (pós-login)

- Método: `GET`
- URL: `/v1/console/license`
- Headers:
  - `Authorization: Bearer <sessionToken>`

**Resposta (exemplo):**

```json
{
  "status": "ok",
  "license": {
    "status": "trial",
    "plan": "pro",
    "expiresAt": "2026-03-20T12:00:00.000Z",
    "daysLeft": 17
  },
  "clientKeys": [
    {
      "label": "signup-trial",
      "prefix": "live_xxxxxxxxxxxx",
      "createdAt": "2026-02-26T10:00:00.000Z",
      "revokedAt": null
    }
  ]
}
```

Uso no front:
- Mostrar status atual da assinatura na tela (plano, dias restantes).
- Mostrar a lista de `clientKeys` pela **identidade** (label/prefixo), não pelo valor completo.

> Observação: este endpoint **não retorna** o `clientKey` completo, apenas prefixos e metadados. O `clientKey` completo deve ser armazenado pelo seu backend/app no momento do signup trial ou rotação.

### 3.2. Listar histórico de pagamentos

- Método: `GET`
- URL: `/v1/console/payments`
- Headers:
  - `Authorization: Bearer <sessionToken>`

**Resposta (exemplo):**

```json
{
  "status": "ok",
  "payments": [
    {
      "provider": "stripe",
      "eventId": "evt_1ABCDEFG...",
      "type": "payment.completed",
      "occurredAt": "2026-02-26T10:05:00.000Z",
      "status": "active",
      "amount": 4900,
      "currency": "usd",
      "link": "https://dashboard.stripe.com/events/evt_1ABCDEFG..."
    }
  ]
}
```

Uso no front:
- Popular tabela/aba "Histórico de pagamentos" com:
  - Data (`occurredAt`).
  - Provedor (`provider`).
  - Tipo/descrição (`type`).
  - Valor (`amount` + `currency`) — geralmente `amount / 100` se tratar de centavos.
  - Status (`status`).
  - Link de detalhes no Stripe (`link`), quando existir.

### 3.3. Criar sessão de pagamento (Stripe Checkout)

- Método: `POST`
- URL: `/v1/billing/checkout`
- Headers:
  - `Content-Type: application/json`

> Importante:
> - Esse endpoint usa **`clientKey`** como identificador do cliente para o billing.
> - Não envie o `sessionToken` nesse endpoint como Bearer esperando que faça autenticação de usuário; a autenticação de billing é feita pela `clientKey`.

**Request (recomendado):**

```json
{
  "clientKey": "live_xxx_client_key_do_usuario",
  "priceId": "price_1T3TK6BjKnMOesshUJY95S2l",
  "successUrl": "https://app.seusistema.com/billing/success",
  "cancelUrl": "https://app.seusistema.com/billing/cancel",
  "quantity": 1,
  "metadata": {
    "origin": "console",
    "plan": "pro"
  }
}
```

Campos:
- `clientKey` (recomendado/essencial):
  - Chave real usada pelo cliente na extensão/integracão.
  - Permite que o webhook depois associe o pagamento corretamente a essa licença.
- `priceId` (opcional se o backend tiver `STRIPE_PRICE_ID`):
  - ID do price no Stripe (ex.: `price_...`).
  - O backend tenta buscar o price e deduz se é pagamento único ou assinatura.
- `successUrl` (opcional):
  - URL de retorno em caso de sucesso.
  - Default: `env.STRIPE_SUCCESS_URL` ou `origin + "/billing/success"`.
- `cancelUrl` (opcional):
  - URL de retorno em caso de cancelamento.
  - Default: `env.STRIPE_CANCEL_URL` ou `origin + "/billing/cancel"`.
- `quantity` (opcional, padrão `1`).
- `metadata` (opcional):
  - Objeto com informações adicionais (ex.: de onde veio a compra, plano, etc.).

**Resposta (sucesso):**

```json
{
  "status": "ok",
  "sessionId": "cs_test_a1B2C3D4...",
  "url": "https://checkout.stripe.com/c/pay_cs_test_a1B2C3D4..."
}
```

Uso no front:

```ts
// Exemplo TypeScript/JS simplificado
const res = await fetch(`${API_BASE_URL}/v1/billing/checkout`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ clientKey, priceId, successUrl, cancelUrl, quantity, metadata }),
});

if (!res.ok) {
  // Tratar erro 4xx/5xx
}

const data = await res.json();
if (data.status === 'ok' && data.url) {
  window.location.href = data.url; // redireciona para o Stripe Checkout
}
```

## 4. Fluxo completo de pagamento no frontend

### 4.1. Tela de planos / billing

1. Rota protegida (ex.: `/billing`), acessível só se houver `sessionToken` válido.
2. Ao montar a página:
   - Chamar `GET /v1/console/license` (Bearer `sessionToken`) para saber status atual.
   - Opcionalmente chamar `GET /v1/console/payments` para preencher histórico.
3. Renderizar UI com:
   - Status da assinatura (trial/active/expired).
   - Botão "Assinar" ou "Renovar" conforme o caso.

### 4.2. Clique em "Assinar" / "Renovar"

Ao clicar:

1. Obter o `clientKey` vinculado a esse usuário (armazenado no backend/app).
2. Chamar `POST /v1/billing/checkout` com o body descrito em 3.3.
3. Se resposta `status === "ok"` e `url` preenchida:
   - Fazer `window.location.href = url`.

### 4.3. Pagamento no Stripe

- Usuário é levado para a página de Checkout do Stripe.
- Stripe exibe formulário de cartão, etc.
- No Stripe Dashboard/configuração do Checkout, você define ou herda as mesmas URLs de `successUrl`/`cancelUrl`.

### 4.4. Webhook de pagamento (backend)

Enquanto isso, no backend:

- Stripe chama `/v1/webhooks/payment` com os eventos de Checkout/Subscription.
- O gateway:
  - Valida a assinatura (quando `STRIPE_WEBHOOK_SECRET` estiver configurado).
  - Normaliza o evento (`normalizeStripeEvent`).
  - Atualiza as licenças via `applyPaymentToLicense`.
  - Salva o evento em `payment_event:*` para ser consultado por `/v1/console/payments`.

> Isso significa que o frontend **não precisa** chamar diretamente nenhuma API do Stripe.
> Todo o fluxo de billing é tratado pelo gateway.

### 4.5. Tela de sucesso (`/billing/success`)

Depois que o pagamento é concluído, o Stripe redireciona o usuário para a `successUrl` configurada (por ex.: `https://app.seusistema.com/billing/success`).

Na montagem da página `/billing/success`:

1. Ler (se quiser) o parâmetro `session_id` da query string.
2. Chamar `GET /v1/console/license` com `Authorization: Bearer <sessionToken>` para obter o novo status.
3. Chamar `GET /v1/console/payments` para atualizar o histórico.
4. Exibir mensagem do tipo:
   - "Pagamento confirmado! Seu plano agora é PRO".
   - Mostrar dados atualizados da licença e, se fizer sentido, o último pagamento.

### 4.6. Tela de cancelamento (`/billing/cancel`)

Se o usuário cancelar o pagamento no Stripe, ele é redirecionado para `cancelUrl`.

Na montagem da página `/billing/cancel`:

1. Mostrar mensagem do tipo: "Pagamento cancelado, nenhuma cobrança foi aplicada".
2. Opcionalmente chamar `GET /v1/console/license` e `GET /v1/console/payments` apenas para garantir que nada foi alterado.

## 5. Recomendações de UX

- **Feedback de carregamento**: ao clicar em "Assinar", mostre um spinner enquanto a chamada a `/v1/billing/checkout` é feita.
- **Tratamento de erros**:
  - Se `/v1/billing/checkout` retornar erro 400/500, exiba mensagem amigável e logue o erro de forma silenciosa (Sentry, console, etc.).
  - Em caso de repetidos erros 5xx, ofereça suporte manual (link para suporte/email).
- **Sessão expirada**:
  - Se qualquer chamada `GET /v1/console/*` retornar 401, limpe o `sessionToken` e redirecione para `/login`.
- **Valores monetários**:
  - Formate `amount` para a moeda local (ex.: `amount / 100` com `Intl.NumberFormat`).

## 6. Resumo rápido de chamadas

1. **Login** (já implementado):
   - `POST /v1/auth/login` → guarda `sessionToken`.
2. **Carregar status da conta**:
   - `GET /v1/console/license` (Bearer `sessionToken`).
   - `GET /v1/console/payments` (Bearer `sessionToken`).
3. **Iniciar pagamento**:
   - `POST /v1/billing/checkout` com `{ clientKey, priceId, successUrl, cancelUrl, ... }`.
   - Redirecionar para `data.url`.
4. **Após retorno do Stripe (success)**:
   - `GET /v1/console/license` (Bearer `sessionToken`).
   - `GET /v1/console/payments` (Bearer `sessionToken`).

Com esse fluxo implementado, o frontend passa a ter um caminho completo de assinatura/renovação, totalmente apoiado nos endpoints existentes do gateway, sem integração direta com o Stripe a partir da UI.
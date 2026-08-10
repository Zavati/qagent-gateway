# QAgent Phase 2 — Foundation 05.2 — Subscription Billing Fix

## Objetivo

Fechar o ciclo básico de assinatura Stripe antes das próximas features do QAgent.

## Eventos de entitlement suportados

- `checkout.session.completed` — ativação inicial quando o Checkout está pago.
- `invoice.paid` — renovação paga.
- `invoice.payment_succeeded` — renovação paga (compatibilidade com o destino atual).
- `invoice.payment_failed` — marca a licença como `past_due` sem conceder um novo período.
- `customer.subscription.updated` — sincroniza status/período/cancelamento agendado.
- `customer.subscription.deleted` — marca a licença como `canceled`.

Eventos como `payment_intent.succeeded` são reconhecidos e ignorados para entitlement, evitando processamento duplicado do mesmo pagamento.

## Mudanças importantes

### Período real da Stripe

Renovações usam `period.start/end` das linhas da Invoice ou os períodos reais da Subscription. O fallback de 30 dias permanece somente quando não existe nenhum período preciso disponível, como compatibilidade de ativação inicial.

### Não depender da ordem dos webhooks

O Stripe não garante ordem de entrega. O QAgent agora:

- persiste `qagentKeyHash` na Checkout Session;
- em assinatura, também persiste `qagentKeyHash` em `subscription_data.metadata`;
- reconcilia invoices e subscriptions pelo hash, customer ou subscription id;
- ignora eventos de billing mais antigos que o último estado já aplicado.

### clientKey não vai mais para Stripe

A `clientKey` é credencial de autenticação do QAgent e não deve ser armazenada como metadata externa. Novos Checkouts enviam somente o SHA-256 (`qagentKeyHash`). O normalizador ainda lê `metadata.clientKey` para compatibilidade com Checkouts antigos.

### Idempotência

A verificação de `payment_event:<provider>:<eventId>` ocorre antes da mutação da licença. Reentregas do mesmo Stripe Event retornam `idempotent: true` sem executar a transição novamente.

### Falha de pagamento

`invoice.payment_failed` altera o status para `past_due`, mas não usa o período da invoice não paga para estender `expiresAt/currentPeriodEnd`.

### Cancelamento agendado

Uma Subscription `active` com `cancel_at_period_end=true` permanece `active` até o fim do período pago e registra `cancelAtPeriodEnd` / `cancelAt`. O cancelamento efetivo ocorre com `customer.subscription.deleted`.

### Verificação de assinatura Stripe

- suporta múltiplas assinaturas `v1` durante rotação do signing secret;
- valida timestamp;
- tolerância padrão: 300 segundos (`STRIPE_WEBHOOK_MAX_SKEW_SEC`).

## Eventos recomendados no Stripe Event Destination

Manter apenas os eventos necessários ao QAgent:

- `checkout.session.completed`
- `invoice.payment_succeeded` (ou `invoice.paid`; o backend suporta ambos)
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

`payment_intent.succeeded` não é necessário para entitlement.

## Testes

```bash
npm run test:stripe-billing
npm run test:all
```

O teste de billing cobre:

- metadata sem clientKey bruta;
- invoice atual com `parent.subscription_details`;
- invoice chegando antes do checkout;
- período real de 31 dias;
- preservação do período após checkout sem período explícito;
- replay de eventId;
- payment failed sem extensão indevida;
- renovação;
- cancelamento no fim do período;
- cancelamento efetivo;
- evento fora de ordem;
- reativação após nova compra;
- múltiplas assinaturas Stripe `v1` e tolerância temporal.

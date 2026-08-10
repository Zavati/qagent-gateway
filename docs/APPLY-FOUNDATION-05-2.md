# Foundation 05.2 — Safe Update

Copie os arquivos deste pacote sobre a raiz do `qagent-gateway` Foundation 05.

Este pacote propositalmente NÃO contém:

- `wrangler.jsonc`
- `.dev.vars`
- secrets
- migrations

Assim, seus bindings/IDs reais da Cloudflare não são sobrescritos.

Depois rode:

```bash
npm install
npm run test:all
npx wrangler dev --port 8787
```

Não existe migration nova nesta Foundation.

Antes do deploy, confirme no Stripe Event Destination os eventos:

- `checkout.session.completed`
- `invoice.payment_succeeded` (ou `invoice.paid`)
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

`payment_intent.succeeded` não é necessário para entitlement e pode ser removido do destino.

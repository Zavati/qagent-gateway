# QAgent Gateway — Inventário de Rotas

Inventário criado durante a Phase 2 / Foundation 02.

| Método | Rota | Domínio atual | Observação |
|---|---|---|---|
| GET | `/privacy-policy` | Public | HTML público; ainda tratado antes do router principal |
| GET/POST | `/health` | System | Health check |
| GET | `/debug/openai-models` | Debug/AI | Diagnóstico OpenAI |
| GET | `/debug/payment-event/:provider/:eventId` | Debug/Billing | Diagnóstico de evento de pagamento |
| POST | `/v1/auth/login` | Auth | Login |
| POST | `/v1/auth/forgot-password` | Auth | Recuperação de senha |
| POST | `/v1/auth/reset-password` | Auth | Reset de senha |
| GET | `/v1/auth/me` | Auth | Sessão atual |
| GET | `/v1/console/license` | Console | Dados de licença |
| GET | `/v1/console/payments` | Console | Histórico de pagamentos |
| POST | `/v1/console/rotate-clientkey` | Console/Auth | Rotação de clientKey |
| GET | `/v1/license` | License | Trial/licença da extensão |
| POST | `/v1/signup-trial` | Signup | Criação de trial |
| GET | `/v1/billing/plans` | Billing | Planos disponíveis |
| POST | `/v1/billing/checkout` | Billing | Checkout Stripe |
| POST | `/v1/webhooks/email-dispatched` | Webhook | Confirmação de disparo de e-mail |
| POST | `/v1/webhooks/payment` | Webhook/Billing | Processamento de pagamento |
| POST | `/v1/generate-tests` | AI | Geração de casos de teste |
| POST | `/v1/autofill` | AI | Preenchimento assistido |

## Próxima decomposição sugerida

A partir deste inventário, os próximos módulos podem ser extraídos por domínio nesta ordem:

1. `system/public` — baixo risco;
2. `debug` — baixo risco;
3. `ai` — alto valor e necessário para AI Engine/Gemini;
4. `auth`;
5. `console`;
6. `billing/webhooks`.

A extração deve preservar método, path, status codes e payloads existentes.

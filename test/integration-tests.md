# Testes Integrados — QAgent Gateway

Guia de testes end-to-end para validar o fluxo completo de signup, trial, webhooks e autenticação.

## Pré-requisitos

1. **URL base do worker** (ajustar conforme ambiente):
   ```bash
   export BASE_URL="http://localhost:8787"  # desenvolvimento local
   # ou
   export BASE_URL="https://api.apiqagent.com"  # produção
   ```

2. **Variáveis de ambiente** configuradas no `wrangler.jsonc`:
   - `QAGENT_KV` (binding do KV)
   - `WEBHOOK_SIGNING_SECRET` (para validação de assinatura)
   - `EMAIL_DISPATCH_WEBHOOK_URL` (opcional)
   - `OPENAI_API_KEY` (para endpoints de IA)

3. **Ferramentas**:
   - `curl`
   - `jq` (opcional, para formatação JSON)
   - `openssl` (para gerar assinaturas HMAC)

---

## Fluxo 1: Signup Trial (End-to-End)

### 1.1 Criar novo trial

**Endpoint:** `POST /v1/signup-trial`

**Request:**
```bash
curl -X POST "$BASE_URL/v1/signup-trial" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teste@example.com",
    "name": "João Silva",
    "company": "Acme Corp",
    "source": "landing-page",
    "acceptTerms": true,
    "acceptPrivacy": true
  }'
```

**Response esperado (201):**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "customer": {
    "customerId": "cust_abc123...",
    "email": "teste@example.com"
  },
  "license": {
    "status": "trial",
    "plan": "pro",
    "trialEndsAt": "2026-03-21T...",
    "daysLeft": 30
  },
  "credentials": {
    "clientKey": "qagent_live_xxxxxxxxxxxxxxxxxxxx",
    "delivery": "webhook:email"
  }
}
```

**⚠️ Importante:** Salvar o `clientKey` retornado para os próximos testes!

```bash
export CLIENT_KEY="qagent_live_xxxxxxxxxxxxxxxxxxxx"
```

**Testes de validação:**

- **409 Conflict** - Email já existe com trial ativo:
  ```bash
  curl -X POST "$BASE_URL/v1/signup-trial" \
    -H "Content-Type: application/json" \
    -d '{
      "email": "teste@example.com",
      "name": "João Silva",
      "acceptTerms": true,
      "acceptPrivacy": true
    }'
  # Esperado: { "status": "error", "message": "Email já cadastrado com trial ativo." }
  ```

- **400 Bad Request** - Campos obrigatórios ausentes:
  ```bash
  curl -X POST "$BASE_URL/v1/signup-trial" \
    -H "Content-Type: application/json" \
    -d '{
      "email": "invalido"
    }'
  # Esperado: erro de validação
  ```

---

## Fluxo 2: Verificar Licença

### 2.1 GET com clientKey (novo fluxo)

**Endpoint:** `GET /v1/license`

**Request:**
```bash
curl -X GET "$BASE_URL/v1/license" \
  -H "Authorization: Bearer $CLIENT_KEY"
```

**Response esperado (200):**
```json
{
  "status": "ok",
  "credential": {
    "type": "client_key"
  },
  "migration": {
    "legacyAccepted": false,
    "legacySunsetAt": null,
    "policy": "global_allowed",
    "tenant": null,
    "cohort": null
  },
  "license": {
    "status": "trial",
    "plan": "pro",
    "expiresAt": "2026-03-21T...",
    "daysLeft": 30
  }
}
```

### 2.2 GET com token legado (compatibilidade)

```bash
export LEGACY_TOKEN="seu-token-antigo-aqui"

curl -X GET "$BASE_URL/v1/license" \
  -H "Authorization: Bearer $LEGACY_TOKEN"
```

**Response esperado (200) quando janela de migração está aberta:**
```json
{
  "credential": { "type": "legacy_token" },
  "migration": {
    "legacyAccepted": true,
    "legacySunsetAt": "2026-06-01T00:00:00Z",
    "policy": "global_allowed"
  },
  "license": { ... }
}
```

### 2.3 Teste de bloqueio por tenant/cohort

```bash
# Tenant forçado a usar clientKey
curl -X GET "$BASE_URL/v1/license" \
  -H "Authorization: Bearer $LEGACY_TOKEN" \
  -H "X-QAgent-Tenant: acme-enforced"
# Esperado: 403 "Token legado desabilitado"

# Com clientKey funciona normalmente
curl -X GET "$BASE_URL/v1/license" \
  -H "Authorization: Bearer $CLIENT_KEY" \
  -H "X-QAgent-Tenant: acme-enforced"
# Esperado: 200 OK
```

**⚠️ Nota:** Configure no `wrangler.jsonc`:
```jsonc
MIGRATION_REQUIRE_CLIENTKEY_TENANTS = "acme-enforced,beta-company"
MIGRATION_REQUIRE_CLIENTKEY_COHORTS = "early-adopters,premium"
```

---

## Fluxo 3: Webhook de Pagamento

### 3.1 Preparar assinatura HMAC

O webhook requer assinatura válida no header `X-QAgent-Signature`.

**Gerar assinatura:**
```bash
# Configurar o segredo compartilhado (mesmo valor do wrangler.jsonc)
export WEBHOOK_SECRET="seu-segredo-compartilhado-aqui"

# Payload do webhook
export PAYLOAD='{
  "provider": "stripe",
  "eventId": "evt_test_12345",
  "eventType": "payment.succeeded",
  "customer": {
    "customerId": "cust_abc123"
  },
  "reference": {
    "clientKey": "'$CLIENT_KEY'",
    "providerCustomerId": "cus_stripe_xyz",
    "providerSubscriptionId": "sub_stripe_123"
  },
  "billing": {
    "amount": 4900,
    "currency": "BRL",
    "status": "paid",
    "paidAt": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
  },
  "occurredAt": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
}'

# Gerar assinatura HMAC-SHA256
export SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

echo "Signature: $SIGNATURE"
```

**⚠️ Windows PowerShell:** Use esta alternativa:
```powershell
$secret = "seu-segredo-compartilhado-aqui"
$payload = @"
{
  "provider": "stripe",
  "eventId": "evt_test_12345",
  ...
}
"@

$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = [Text.Encoding]::UTF8.GetBytes($secret)
$hash = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($payload))
$signature = [BitConverter]::ToString($hash).Replace("-", "").ToLower()
Write-Host "Signature: $signature"
```

### 3.2 Enviar webhook de pagamento aprovado

**Endpoint:** `POST /v1/webhooks/payment`

**Request:**
```bash
curl -X POST "$BASE_URL/v1/webhooks/payment" \
  -H "Content-Type: application/json" \
  -H "X-QAgent-Signature: $SIGNATURE" \
  -d "$PAYLOAD"
```

**Response esperado (200):**
```json
{
  "status": "ok",
  "processed": true,
  "idempotent": false,
  "transition": {
    "updated": true,
    "blocked": false,
    "reason": "trial_to_active",
    "finalStatus": "active"
  }
}
```

### 3.3 Teste de idempotência

Reenviar o mesmo webhook (mesmo `eventId`):

```bash
curl -X POST "$BASE_URL/v1/webhooks/payment" \
  -H "Content-Type: application/json" \
  -H "X-QAgent-Signature: $SIGNATURE" \
  -d "$PAYLOAD"
```

**Response esperado (200):**
```json
{
  "status": "ok",
  "processed": false,
  "idempotent": true
}
```

### 3.4 Verificar transição de estado

Após pagamento aprovado, a licença deve estar `active`:

```bash
curl -X GET "$BASE_URL/v1/license" \
  -H "Authorization: Bearer $CLIENT_KEY"
```

**Response esperado:**
```json
{
  "license": {
    "status": "active",
    "plan": "pro",
    "expiresAt": "2027-02-19T...",
    "daysLeft": 365
  }
}
```

### 3.5 Outros tipos de pagamento

**Pagamento falhou:**
```bash
PAYLOAD_FAILED='{
  "provider": "stripe",
  "eventId": "evt_failed_001",
  "eventType": "payment.failed",
  "reference": { "clientKey": "'$CLIENT_KEY'" },
  "billing": { "status": "failed", "failureReason": "insufficient_funds" },
  "occurredAt": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
}'

SIGNATURE_FAILED=$(echo -n "$PAYLOAD_FAILED" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

curl -X POST "$BASE_URL/v1/webhooks/payment" \
  -H "Content-Type: application/json" \
  -H "X-QAgent-Signature: $SIGNATURE_FAILED" \
  -d "$PAYLOAD_FAILED"

# Esperado: transição para "past_due" ou "grace_period"
```

**Assinatura cancelada:**
```bash
PAYLOAD_CANCELED='{
  "provider": "stripe",
  "eventId": "evt_cancel_001",
  "eventType": "subscription.canceled",
  "reference": { "clientKey": "'$CLIENT_KEY'" },
  "billing": { "status": "canceled" },
  "occurredAt": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
}'

# ... gerar assinatura e enviar
# Esperado: transição para "canceled"
```

---

## Fluxo 4: Webhook de Email Dispatched

### 4.1 Confirmar envio de email

**Endpoint:** `POST /v1/webhooks/email-dispatched`

**Request:**
```bash
# Recuperar o eventId do signup (normalmente vem do serviço de email)
export EMAIL_EVENT_ID="email_evt_abc123"

PAYLOAD_EMAIL='{
  "eventId": "'$EMAIL_EVENT_ID'",
  "template": "trial_welcome",
  "status": "sent",
  "sentAt": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
}'

SIGNATURE_EMAIL=$(echo -n "$PAYLOAD_EMAIL" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

curl -X POST "$BASE_URL/v1/webhooks/email-dispatched" \
  -H "Content-Type: application/json" \
  -H "X-QAgent-Signature: $SIGNATURE_EMAIL" \
  -d "$PAYLOAD_EMAIL"
```

**Response esperado (200):**
```json
{
  "status": "ok",
  "processed": true
}
```

---

## Fluxo 5: Endpoints de Produção (IA)

### 5.1 Generate Tests

**Endpoint:** `POST /v1/generate-tests`

**Request:**
```bash
curl -X POST "$BASE_URL/v1/generate-tests" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLIENT_KEY" \
  -d '{
    "prompt": "Como QA, preciso testar a tela de login",
    "context": {
      "issueKey": "QA-123",
      "summary": "Validar formulário de login",
      "description": "Campos: email, password, botão submit"
    },
    "outputFormat": "gherkin"
  }'
```

**Response esperado (200):**
```json
{
  "status": "ok",
  "tests": "Feature: Login...\n  Scenario: ...",
  "meta": {
    "model": "gpt-4o",
    "tokensUsed": 150,
    "cached": false
  }
}
```

### 5.2 Autofill

**Endpoint:** `POST /v1/autofill`

**Request:**
```bash
curl -X POST "$BASE_URL/v1/autofill" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CLIENT_KEY" \
  -d '{
    "url": "https://example.com/form",
    "elements": [
      {
        "selector": "#email",
        "type": "email",
        "name": "email",
        "placeholder": "Digite seu email"
      },
      {
        "selector": "#phone",
        "type": "tel",
        "name": "phone"
      }
    ]
  }'
```

**Response esperado (200):**
```json
{
  "status": "ok",
  "actions": [
    {
      "selector": "#email",
      "value": "usuario@example.com"
    },
    {
      "selector": "#phone",
      "value": "(11) 98765-4321"
    }
  ]
}
```

---

## Fluxo 6: Testes de Segurança

### 6.1 Assinatura inválida (webhook)

```bash
curl -X POST "$BASE_URL/v1/webhooks/payment" \
  -H "Content-Type: application/json" \
  -H "X-QAgent-Signature: assinatura_falsa_12345" \
  -d '{
    "provider": "stripe",
    "eventId": "evt_hack_001"
  }'
```

**Response esperado (403):**
```json
{
  "status": "error",
  "message": "Assinatura inválida"
}
```

### 6.2 Token ausente

```bash
curl -X GET "$BASE_URL/v1/license"
```

**Response esperado (401):**
```json
{
  "status": "error",
  "message": "Token ausente. Vá em IA e cole seu license token."
}
```

### 6.3 Token inválido

```bash
curl -X GET "$BASE_URL/v1/license" \
  -H "Authorization: Bearer token_muito_curto"
```

**Response esperado (403):**
```json
{
  "status": "error",
  "message": "Token inválido."
}
```

### 6.4 Rate limit

```bash
# Enviar múltiplas requisições rapidamente
for i in {1..20}; do
  curl -X POST "$BASE_URL/v1/generate-tests" \
    -H "Authorization: Bearer $CLIENT_KEY" \
    -H "Content-Type: application/json" \
    -d '{"prompt":"teste"}' &
done
wait

# Esperado: após limite, retornar 429 com header Retry-After
```

---

## Fluxo 7: Health Check e Diagnóstico

### 7.1 Health

```bash
curl -X GET "$BASE_URL/health"
```

**Response esperado (200):**
```json
{
  "ok": true
}
```

### 7.2 Debug OpenAI Models

```bash
curl -X GET "$BASE_URL/debug/openai-models"
```

**Response esperado (200):**
```json
{
  "status": "ok",
  "models": ["gpt-4o", "gpt-4o-mini", "..."]
}
```

---

## Cenários de Teste Completos

### Cenário 1: Novo usuário (happy path)

1. ✅ **Signup trial** → 201 Created
2. ✅ **GET license** → trial, 30 dias
3. ✅ **Webhook payment approved** → transição trial→active
4. ✅ **GET license** → active, 365 dias
5. ✅ **Generate tests** → funcionando com plan pro

### Cenário 2: Migração de token legado

1. ✅ **GET license** com legacy token → 200 OK (janela aberta)
2. ✅ Configurar tenant enforced
3. ❌ **GET license** com legacy token + header tenant → 403 Forbidden
4. ✅ **GET license** com clientKey + header tenant → 200 OK

### Cenário 3: Falha de pagamento

1. ✅ **Signup trial** → 201
2. ⏰ Trial expira (simular mudando `trialEndsAt`)
3. ✅ **Webhook payment failed** → transição trial→past_due
4. ❌ **Generate tests** → 403 (fora do período de grace)

### Cenário 4: Idempotência de webhooks

1. ✅ **Webhook payment** (eventId = evt_001) → processed=true
2. ✅ **Webhook payment** (eventId = evt_001) → idempotent=true
3. ✅ **GET license** → estado inalterado (sem duplicação)

---

## Automatização dos Testes

### Script Bash completo

Salve como `test/run-integration-tests.sh`:

```bash
#!/bin/bash
set -e

BASE_URL="${BASE_URL:-http://localhost:8787}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-dev-webhook-secret}"

echo "🧪 Iniciando testes integrados..."
echo "Base URL: $BASE_URL"

# 1. Signup
echo "📝 Teste 1: Signup Trial"
SIGNUP_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/signup-trial" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teste-'$(date +%s)'@example.com",
    "name": "Test User",
    "acceptTerms": true,
    "acceptPrivacy": true
  }')

CLIENT_KEY=$(echo "$SIGNUP_RESPONSE" | jq -r '.credentials.clientKey')
echo "✅ Client Key: $CLIENT_KEY"

# 2. Get License
echo "📝 Teste 2: Verificar Licença"
LICENSE_RESPONSE=$(curl -s -X GET "$BASE_URL/v1/license" \
  -H "Authorization: Bearer $CLIENT_KEY")

STATUS=$(echo "$LICENSE_RESPONSE" | jq -r '.license.status')
echo "✅ License Status: $STATUS"

# 3. Payment Webhook
echo "📝 Teste 3: Webhook de Pagamento"
PAYLOAD=$(cat <<EOF
{
  "provider": "stripe",
  "eventId": "evt_test_$(date +%s)",
  "eventType": "payment.succeeded",
  "reference": {
    "clientKey": "$CLIENT_KEY"
  },
  "billing": {
    "amount": 4900,
    "currency": "BRL",
    "status": "paid",
    "paidAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  },
  "occurredAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
)

SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')

PAYMENT_RESPONSE=$(curl -s -X POST "$BASE_URL/v1/webhooks/payment" \
  -H "Content-Type: application/json" \
  -H "X-QAgent-Signature: $SIGNATURE" \
  -d "$PAYLOAD")

FINAL_STATUS=$(echo "$PAYMENT_RESPONSE" | jq -r '.transition.finalStatus')
echo "✅ Final Status: $FINAL_STATUS"

# 4. Verificar transição
echo "📝 Teste 4: Verificar Transição de Estado"
LICENSE_AFTER=$(curl -s -X GET "$BASE_URL/v1/license" \
  -H "Authorization: Bearer $CLIENT_KEY")

NEW_STATUS=$(echo "$LICENSE_AFTER" | jq -r '.license.status')
echo "✅ Novo Status: $NEW_STATUS"

echo ""
echo "🎉 Todos os testes passaram!"
```

**Executar:**
```bash
chmod +x test/run-integration-tests.sh
./test/run-integration-tests.sh
```

---

## Checklist de Validação

Antes de considerar a implementação completa, validar:

- [ ] Signup trial cria customer + license + clientKey
- [ ] ClientKey é retornado no response (mas não armazenado em texto puro)
- [ ] GET /v1/license aceita clientKey e token legado (durante janela)
- [ ] Feature flags de migração funcionam (tenant/cohort)
- [ ] Webhook de pagamento valida assinatura HMAC
- [ ] Idempotência de webhooks (mesmo eventId)
- [ ] Transições de estado (trial→active, active→past_due, etc.)
- [ ] Rate limit aplicado corretamente
- [ ] Logs estruturados com requestId (observabilidade)
- [ ] Erros retornam formato padronizado (code, message, requestId)
- [ ] CORS headers corretos
- [ ] Métricas de migração registradas (BE-3003)

---

## Troubleshooting

### Erro: "KV não configurado"
Verifique binding no `wrangler.jsonc`:
```jsonc
[[kv_namespaces]]
binding = "QAGENT_KV"
id = "seu-kv-namespace-id"
```

### Erro: "Assinatura inválida"
1. Confirmar que `WEBHOOK_SIGNING_SECRET` está configurado
2. Verificar que a assinatura está sendo gerada corretamente
3. Usar `req.clone().text()` para não consumir o body antes da verificação

### Erro: "Token legado desabilitado"
Configurar janela de migração:
```jsonc
ALLOW_LEGACY_LICENSE_TOKEN = "true"
LEGACY_TOKEN_MIGRATION_UNTIL = "2026-06-01T00:00:00Z"
```

### Webhook não dispara email
1. Verificar `EMAIL_DISPATCH_WEBHOOK_URL` configurado
2. Observar logs: `email_dispatch_async_error`
3. Endpoint externo deve aceitar POST com JSON

---

## Próximos Passos

1. ✅ Implementar métricas de adoção (BE-3003) - **ticket atual**
2. ⏳ Dashboard de migração (queries no KV)
3. ⏳ Rotação de segredos (BE-4001)
4. ⏳ Revogação de clientKey (BE-4002)
5. ⏳ Testes de caos (BE-4004)

---

## Referências

- [Blueprint Auth/Billing](../docs/blueprint-auth-billing.md)
- [Tickets de Rollout](../docs/tickets-auth-billing-rollout.md)
- [Contratos API](../src/lib/contracts.js)

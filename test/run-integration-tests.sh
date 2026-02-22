#!/bin/bash
# Script de testes integrados end-to-end para QAgent Gateway
# Valida fluxo completo: signup → license → payment webhook → state transition

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configurações
BASE_URL="${BASE_URL:-http://localhost:8787}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-dev-webhook-secret}"
TEST_EMAIL="teste-$(date +%s)@example.com"

# Contador de testes
PASSED=0
FAILED=0

# Funções auxiliares
print_header() {
  echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}  $1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_test() {
  echo -e "\n${YELLOW}📝 Teste $1: $2${NC}"
}

print_success() {
  echo -e "${GREEN}✅ $1${NC}"
  ((PASSED++))
}

print_error() {
  echo -e "${RED}❌ $1${NC}"
  ((FAILED++))
}

print_info() {
  echo -e "   $1"
}

# Gerar assinatura HMAC-SHA256
generate_signature() {
  local payload="$1"
  echo -n "$payload" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}'
}

# Verificar dependências
check_dependencies() {
  print_header "Verificando dependências"
  
  for cmd in curl jq openssl; do
    if ! command -v $cmd &> /dev/null; then
      print_error "$cmd não encontrado. Instale antes de continuar."
      exit 1
    fi
  done
  
  print_success "Todas as dependências estão instaladas"
}

# Inicialização
print_header "QAgent Gateway - Testes Integrados"
echo -e "Base URL: ${BLUE}$BASE_URL${NC}"
echo -e "Test Email: ${BLUE}$TEST_EMAIL${NC}"
echo -e "Webhook Secret: ${BLUE}${WEBHOOK_SECRET:0:8}...${NC}"

check_dependencies

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 1: Health Check
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print_test "1" "Health Check"

HEALTH_RESPONSE=$(curl -s -X GET "$BASE_URL/health")
HEALTH_OK=$(echo "$HEALTH_RESPONSE" | jq -r '.ok')

if [ "$HEALTH_OK" = "true" ]; then
  print_success "Health check passou"
  print_info "$HEALTH_RESPONSE"
else
  print_error "Health check falhou"
  print_info "$HEALTH_RESPONSE"
  exit 1
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 2: Signup Trial
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print_test "2" "Signup Trial (POST /v1/signup-trial)"

SIGNUP_PAYLOAD=$(cat <<EOF
{
  "email": "$TEST_EMAIL",
  "name": "Test User Integration",
  "company": "Test Corp",
  "source": "integration-test",
  "acceptTerms": true,
  "acceptPrivacy": true
}
EOF
)

SIGNUP_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/v1/signup-trial" \
  -H "Content-Type: application/json" \
  -d "$SIGNUP_PAYLOAD")

SIGNUP_HTTP_CODE=$(echo "$SIGNUP_RESPONSE" | tail -n1)
SIGNUP_BODY=$(echo "$SIGNUP_RESPONSE" | head -n-1)

if [ "$SIGNUP_HTTP_CODE" = "201" ]; then
  print_success "Signup retornou 201 Created"
  
  CLIENT_KEY=$(echo "$SIGNUP_BODY" | jq -r '.credentials.clientKey')
  CUSTOMER_ID=$(echo "$SIGNUP_BODY" | jq -r '.customer.customerId')
  LICENSE_STATUS=$(echo "$SIGNUP_BODY" | jq -r '.license.status')
  DAYS_LEFT=$(echo "$SIGNUP_BODY" | jq -r '.license.daysLeft')
  
  print_info "Client Key: $CLIENT_KEY"
  print_info "Customer ID: $CUSTOMER_ID"
  print_info "License Status: $LICENSE_STATUS"
  print_info "Days Left: $DAYS_LEFT"
  
  if [ "$LICENSE_STATUS" = "trial" ]; then
    print_success "Licença criada com status 'trial'"
  else
    print_error "Licença deveria estar 'trial', mas está '$LICENSE_STATUS'"
  fi
  
  if [ -n "$CLIENT_KEY" ] && [ "$CLIENT_KEY" != "null" ]; then
    print_success "Client Key gerado corretamente"
  else
    print_error "Client Key não foi retornado"
    exit 1
  fi
else
  print_error "Signup falhou com código $SIGNUP_HTTP_CODE"
  print_info "$SIGNUP_BODY"
  exit 1
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 3: Verificar Licença (GET /v1/license)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print_test "3" "Verificar Licença (GET /v1/license)"

LICENSE_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/v1/license" \
  -H "Authorization: Bearer $CLIENT_KEY")

LICENSE_HTTP_CODE=$(echo "$LICENSE_RESPONSE" | tail -n1)
LICENSE_BODY=$(echo "$LICENSE_RESPONSE" | head -n-1)

if [ "$LICENSE_HTTP_CODE" = "200" ]; then
  print_success "GET /v1/license retornou 200 OK"
  
  CREDENTIAL_TYPE=$(echo "$LICENSE_BODY" | jq -r '.credential.type')
  LICENSE_STATUS=$(echo "$LICENSE_BODY" | jq -r '.license.status')
  LICENSE_PLAN=$(echo "$LICENSE_BODY" | jq -r '.license.plan')
  LEGACY_ACCEPTED=$(echo "$LICENSE_BODY" | jq -r '.migration.legacyAccepted')
  
  print_info "Credential Type: $CREDENTIAL_TYPE"
  print_info "License Status: $LICENSE_STATUS"
  print_info "Plan: $LICENSE_PLAN"
  print_info "Legacy Accepted: $LEGACY_ACCEPTED"
  
  if [ "$CREDENTIAL_TYPE" = "client_key" ]; then
    print_success "Tipo de credencial correto: client_key"
  else
    print_error "Tipo de credencial deveria ser 'client_key', mas é '$CREDENTIAL_TYPE'"
  fi
  
  if [ "$LEGACY_ACCEPTED" = "false" ]; then
    print_success "Não está usando token legado"
  fi
else
  print_error "GET /v1/license falhou com código $LICENSE_HTTP_CODE"
  print_info "$LICENSE_BODY"
  exit 1
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 4: Signup Duplicado (409 Conflict)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print_test "4" "Signup Duplicado - deve retornar 409 Conflict"

DUPLICATE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/v1/signup-trial" \
  -H "Content-Type: application/json" \
  -d "$SIGNUP_PAYLOAD")

DUPLICATE_HTTP_CODE=$(echo "$DUPLICATE_RESPONSE" | tail -n1)
DUPLICATE_BODY=$(echo "$DUPLICATE_RESPONSE" | head -n-1)

if [ "$DUPLICATE_HTTP_CODE" = "409" ]; then
  print_success "Signup duplicado bloqueado corretamente (409)"
  print_info "$(echo "$DUPLICATE_BODY" | jq -r '.message')"
else
  print_error "Esperado 409, mas recebeu $DUPLICATE_HTTP_CODE"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 5: Webhook de Pagamento Aprovado
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print_test "5" "Webhook de Pagamento Aprovado"

EVENT_ID="evt_test_$(date +%s)"
PAYMENT_PAYLOAD=$(cat <<EOF
{
  "provider": "stripe",
  "eventId": "$EVENT_ID",
  "eventType": "payment.succeeded",
  "customer": {
    "customerId": "$CUSTOMER_ID"
  },
  "reference": {
    "clientKey": "$CLIENT_KEY",
    "providerCustomerId": "cus_stripe_test123",
    "providerSubscriptionId": "sub_stripe_test456"
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

PAYMENT_SIGNATURE=$(generate_signature "$PAYMENT_PAYLOAD")

PAYMENT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/v1/webhooks/payment" \
  -H "Content-Type: application/json" \
  -H "X-QAgent-Signature: $PAYMENT_SIGNATURE" \
  -d "$PAYMENT_PAYLOAD")

PAYMENT_HTTP_CODE=$(echo "$PAYMENT_RESPONSE" | tail -n1)
PAYMENT_BODY=$(echo "$PAYMENT_RESPONSE" | head -n-1)

if [ "$PAYMENT_HTTP_CODE" = "200" ]; then
  print_success "Webhook de pagamento aceito (200)"
  
  PROCESSED=$(echo "$PAYMENT_BODY" | jq -r '.processed')
  IDEMPOTENT=$(echo "$PAYMENT_BODY" | jq -r '.idempotent')
  TRANSITION_UPDATED=$(echo "$PAYMENT_BODY" | jq -r '.transition.updated')
  TRANSITION_BLOCKED=$(echo "$PAYMENT_BODY" | jq -r '.transition.blocked')
  FINAL_STATUS=$(echo "$PAYMENT_BODY" | jq -r '.transition.finalStatus')
  
  print_info "Processed: $PROCESSED"
  print_info "Idempotent: $IDEMPOTENT"
  print_info "Transition Updated: $TRANSITION_UPDATED"
  print_info "Transition Blocked: $TRANSITION_BLOCKED"
  print_info "Final Status: $FINAL_STATUS"
  
  if [ "$PROCESSED" = "true" ]; then
    print_success "Pagamento processado com sucesso"
  else
    print_error "Pagamento não foi processado"
  fi
  
  if [ "$TRANSITION_UPDATED" = "true" ]; then
    print_success "Licença atualizada após pagamento"
  else
    print_error "Licença não foi atualizada"
  fi
  
  if [ "$FINAL_STATUS" = "active" ]; then
    print_success "Status final correto: active"
  else
    print_error "Status final deveria ser 'active', mas é '$FINAL_STATUS'"
  fi
else
  print_error "Webhook de pagamento falhou com código $PAYMENT_HTTP_CODE"
  print_info "$PAYMENT_BODY"
  exit 1
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 6: Idempotência do Webhook
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print_test "6" "Idempotência - reenviar mesmo webhook"

IDEMPOTENT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/v1/webhooks/payment" \
  -H "Content-Type: application/json" \
  -H "X-QAgent-Signature: $PAYMENT_SIGNATURE" \
  -d "$PAYMENT_PAYLOAD")

IDEMPOTENT_HTTP_CODE=$(echo "$IDEMPOTENT_RESPONSE" | tail -n1)
IDEMPOTENT_BODY=$(echo "$IDEMPOTENT_RESPONSE" | head -n-1)

if [ "$IDEMPOTENT_HTTP_CODE" = "200" ]; then
  IDEMPOTENT_FLAG=$(echo "$IDEMPOTENT_BODY" | jq -r '.idempotent')
  PROCESSED_AGAIN=$(echo "$IDEMPOTENT_BODY" | jq -r '.processed')
  
  if [ "$IDEMPOTENT_FLAG" = "true" ] && [ "$PROCESSED_AGAIN" = "false" ]; then
    print_success "Idempotência funcionando corretamente"
    print_info "Webhook com mesmo eventId não foi reprocessado"
  else
    print_error "Idempotência falhou: idempotent=$IDEMPOTENT_FLAG, processed=$PROCESSED_AGAIN"
  fi
else
  print_error "Teste de idempotência falhou com código $IDEMPOTENT_HTTP_CODE"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 7: Verificar Transição de Estado (trial → active)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print_test "7" "Verificar Transição de Estado (trial → active)"

LICENSE_AFTER_PAYMENT=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/v1/license" \
  -H "Authorization: Bearer $CLIENT_KEY")

LICENSE_AFTER_HTTP=$(echo "$LICENSE_AFTER_PAYMENT" | tail -n1)
LICENSE_AFTER_BODY=$(echo "$LICENSE_AFTER_PAYMENT" | head -n-1)

if [ "$LICENSE_AFTER_HTTP" = "200" ]; then
  NEW_STATUS=$(echo "$LICENSE_AFTER_BODY" | jq -r '.license.status')
  NEW_DAYS=$(echo "$LICENSE_AFTER_BODY" | jq -r '.license.daysLeft')
  
  print_info "Novo Status: $NEW_STATUS"
  print_info "Novo Days Left: $NEW_DAYS"
  
  if [ "$NEW_STATUS" = "active" ]; then
    print_success "Transição trial → active confirmada"
  else
    print_error "Status deveria ser 'active', mas é '$NEW_STATUS'"
  fi
  
  # Verificar que daysLeft aumentou (de ~30 para ~365)
  if [ "$NEW_DAYS" -gt 100 ]; then
    print_success "Days left aumentou corretamente (agora $NEW_DAYS dias)"
  else
    print_error "Days left não aumentou como esperado ($NEW_DAYS dias)"
  fi
else
  print_error "GET /v1/license após pagamento falhou"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 8: Assinatura Inválida (segurança)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print_test "8" "Segurança - Assinatura Inválida"

INVALID_SIGNATURE="assinatura_falsa_12345"

INVALID_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/v1/webhooks/payment" \
  -H "Content-Type: application/json" \
  -H "X-QAgent-Signature: $INVALID_SIGNATURE" \
  -d '{"provider":"test","eventId":"evt_invalid"}')

INVALID_HTTP_CODE=$(echo "$INVALID_RESPONSE" | tail -n1)
INVALID_BODY=$(echo "$INVALID_RESPONSE" | head -n-1)

if [ "$INVALID_HTTP_CODE" = "403" ] || [ "$INVALID_HTTP_CODE" = "401" ]; then
  print_success "Assinatura inválida bloqueada corretamente ($INVALID_HTTP_CODE)"
  print_info "$(echo "$INVALID_BODY" | jq -r '.message')"
else
  print_error "Esperado 401/403, mas recebeu $INVALID_HTTP_CODE"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 9: Token Ausente
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print_test "9" "Segurança - Token Ausente"

NO_TOKEN_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/v1/license")

NO_TOKEN_HTTP=$(echo "$NO_TOKEN_RESPONSE" | tail -n1)
NO_TOKEN_BODY=$(echo "$NO_TOKEN_RESPONSE" | head -n-1)

if [ "$NO_TOKEN_HTTP" = "401" ]; then
  print_success "Token ausente bloqueado corretamente (401)"
  print_info "$(echo "$NO_TOKEN_BODY" | jq -r '.message')"
else
  print_error "Esperado 401, mas recebeu $NO_TOKEN_HTTP"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 10: Token Inválido
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print_test "10" "Segurança - Token Inválido (muito curto)"

INVALID_TOKEN_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/v1/license" \
  -H "Authorization: Bearer short")

INVALID_TOKEN_HTTP=$(echo "$INVALID_TOKEN_RESPONSE" | tail -n1)
INVALID_TOKEN_BODY=$(echo "$INVALID_TOKEN_RESPONSE" | head -n-1)

if [ "$INVALID_TOKEN_HTTP" = "403" ]; then
  print_success "Token inválido bloqueado corretamente (403)"
  print_info "$(echo "$INVALID_TOKEN_BODY" | jq -r '.message')"
else
  print_error "Esperado 403, mas recebeu $INVALID_TOKEN_HTTP"
fi

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# RELATÓRIO FINAL
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
print_header "Relatório Final"

TOTAL=$((PASSED + FAILED))
SUCCESS_RATE=$(awk "BEGIN {printf \"%.1f\", ($PASSED/$TOTAL)*100}")

echo ""
echo -e "Total de testes: ${BLUE}$TOTAL${NC}"
echo -e "Passou: ${GREEN}$PASSED${NC}"
echo -e "Falhou: ${RED}$FAILED${NC}"
echo -e "Taxa de sucesso: ${GREEN}$SUCCESS_RATE%${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}🎉 Todos os testes passaram!${NC}"
  echo ""
  echo "Recursos criados neste teste:"
  echo "  - Email: $TEST_EMAIL"
  echo "  - Client Key: $CLIENT_KEY"
  echo "  - Customer ID: $CUSTOMER_ID"
  echo "  - Event ID: $EVENT_ID"
  echo ""
  exit 0
else
  echo -e "${RED}❌ Alguns testes falharam. Revise os erros acima.${NC}"
  exit 1
fi

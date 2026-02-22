# Testes Integrados - Guia Rápido

## Arquivos Criados

1. **[integration-tests.md](./integration-tests.md)** - Documentação completa com todos os comandos curl
2. **[run-integration-tests.sh](./run-integration-tests.sh)** - Script bash automatizado (Linux/Mac)
3. **[run-integration-tests.ps1](./run-integration-tests.ps1)** - Script PowerShell automatizado (Windows)

## Como Executar

### Desenvolvimento Local (Wrangler)

1. **Iniciar o worker local:**
   ```bash
   npm run dev
   # ou
   npx wrangler dev
   ```

2. **Em outro terminal, executar os testes:**
   
   **Windows (PowerShell):**
   ```powershell
   .\test\run-integration-tests.ps1 -BaseUrl "http://localhost:8787" -WebhookSecret "dev-webhook-secret"
   ```
   
   **Linux/Mac (Bash):**
   ```bash
   chmod +x test/run-integration-tests.sh
   BASE_URL="http://localhost:8787" WEBHOOK_SECRET="dev-webhook-secret" ./test/run-integration-tests.sh
   ```

### Produção

**Windows:**
```powershell
.\test\run-integration-tests.ps1 -BaseUrl "https://api.apiqagent.com" -WebhookSecret "seu-segredo-real"
```

**Linux/Mac:**
```bash
BASE_URL="https://api.apiqagent.com" WEBHOOK_SECRET="seu-segredo-real" ./test/run-integration-tests.sh
```

## Testes Executados

O script automatizado valida:

1. ✅ **Health Check** - Verifica se o worker está rodando
2. ✅ **Signup Trial** - Cria novo cliente com trial (201 Created)
3. ✅ **Get License** - Verifica licença com clientKey (200 OK)
4. ✅ **Signup Duplicado** - Valida bloqueio de email duplicado (409 Conflict)
5. ✅ **Payment Webhook** - Simula pagamento aprovado com assinatura HMAC
6. ✅ **Idempotência** - Verifica que mesmo eventId não é reprocessado
7. ✅ **State Transition** - Confirma transição trial → active
8. ✅ **Security - Invalid Signature** - Valida bloqueio de assinatura inválida (403)
9. ✅ **Security - No Token** - Valida bloqueio sem token (401)
10. ✅ **Security - Invalid Token** - Valida bloqueio de token inválido (403)

## Resultado Esperado

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Relatório Final
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total de testes: 10
Passou: 10
Falhou: 0
Taxa de sucesso: 100%

🎉 Todos os testes passaram!
```

## Testes Manuais com Curl

Para testar chamadas individuais, consulte [integration-tests.md](./integration-tests.md) que contém:

- Exemplos de curl para cada endpoint
- Payloads completos
- Respostas esperadas
- Casos de erro
- Cenários de teste completos

### Exemplo: Signup Trial

```bash
curl -X POST "http://localhost:8787/v1/signup-trial" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teste@example.com",
    "name": "João Silva",
    "acceptTerms": true,
    "acceptPrivacy": true
  }'
```

### Exemplo: Webhook com Assinatura

```bash
# 1. Preparar payload
PAYLOAD='{"provider":"stripe","eventId":"evt_123","eventType":"payment.succeeded"}'

# 2. Gerar assinatura HMAC
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "dev-webhook-secret" | awk '{print $2}')

# 3. Enviar webhook
curl -X POST "http://localhost:8787/v1/webhooks/payment" \
  -H "Content-Type: application/json" \
  -H "X-QAgent-Signature: $SIGNATURE" \
  -d "$PAYLOAD"
```

## Dependências

- **curl** - Fazer requisições HTTP
- **jq** - Processar JSON (opcional, mas recomendado)
- **openssl** - Gerar assinaturas HMAC

**Windows:** Instale via [Chocolatey](https://chocolatey.org/)
```powershell
choco install curl jq openssl
```

**Mac:** Instale via Homebrew
```bash
brew install curl jq openssl
```

**Linux:** Já devem estar instalados, senão:
```bash
sudo apt-get install curl jq openssl  # Debian/Ubuntu
sudo yum install curl jq openssl      # RHEL/CentOS
```

## Configuração do Ambiente

Antes de executar os testes, certifique-se de que o `wrangler.jsonc` está configurado:

```jsonc
{
  "vars": {
    "ENVIRONMENT": "development",
    "WEBHOOK_SIGNING_SECRET": "dev-webhook-secret",
    "ALLOW_LEGACY_LICENSE_TOKEN": "true",
    "CLIENT_KEY_MODE": "test"
  },
  "kv_namespaces": [
    {
      "binding": "QAGENT_KV",
      "id": "seu-kv-namespace-id",
      "preview_id": "seu-preview-kv-id"
    }
  ]
}
```

## Troubleshooting

### Erro: "KV não configurado"
- Verifique que `QAGENT_KV` está no binding do wrangler.jsonc
- Crie um KV namespace: `npx wrangler kv:namespace create QAGENT_KV`

### Erro: "Assinatura inválida"
- Confirme que `WEBHOOK_SIGNING_SECRET` está configurado
- Verifique que o mesmo valor está sendo usado no script e no worker

### Erro: "Connection refused"
- Certifique-se de que o worker está rodando (`npm run dev`)
- Verifique a porta correta (padrão: 8787)

### Script não executa (Bash)
```bash
chmod +x test/run-integration-tests.sh
```

### Script não executa (PowerShell)
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

## Próximos Passos

Após validar todos os testes:

1. ✅ Revisar logs estruturados (observabilidade)
2. ✅ Implementar métricas de migração (BE-3003)
3. ⏳ Dashboard de adoção de clientKey vs legacy
4. ⏳ Testes de carga (rate limiting)
5. ⏳ Testes de caos (falhas de webhook)

## Referências

- [Blueprint Auth/Billing](../docs/blueprint-auth-billing.md)
- [Tickets de Rollout](../docs/tickets-auth-billing-rollout.md)
- [Contratos API](../src/lib/contracts.js)

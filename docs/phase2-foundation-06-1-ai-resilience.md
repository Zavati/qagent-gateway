# QAgent Phase 2 — Foundation 06.1 — AI Resilience & Diagnostics

## Contexto

A Foundation 06 validou a arquitetura BYOAI multi-provider com OpenAI e Gemini. O primeiro teste E2E real do Gemini revelou uma falha importante de resiliência: respostas HTTP de erro, inclusive `429`, podiam gerar novas tentativas e posteriormente um `repairJson()`, multiplicando chamadas ao provider e mascarando o diagnóstico original.

## Regra arquitetural

A camada de IA agora separa dois tipos de falha:

1. **Upstream failure** — rede, timeout ou HTTP não-2xx. Pode receber retry somente quando for transitório. Nunca recebe repair.
2. **Response format failure** — HTTP 2xx recebido com sucesso, mas o conteúdo não contém JSON válido/esperado. Não repete a geração completa; o serviço pode executar um único repair.

Fluxo:

```text
AI Engine
  -> Provider
    -> HTTP client
      -> 2xx + JSON válido       => sucesso
      -> 2xx + JSON inválido     => AI_INVALID_JSON -> repair 1x
      -> 4xx não transitório     => AI_UPSTREAM_ERROR -> sem retry/repair
      -> 429 longo/quota         => AI_UPSTREAM_ERROR -> sem espera longa/repair
      -> 408/5xx/rede transitório=> retry curto limitado
```

## Política de retry

- Não retentar: 400, 401, 403, 404.
- Transitórios: rede/status 0, 408, 429 e 5xx.
- OpenAI também aceita 409 como transitório, alinhado ao comportamento documentado do SDK oficial.
- Retry usa backoff curto e jitter.
- `Retry-After`/retry delay do provider é respeitado quando couber na janela síncrona configurada.
- Se o provider pedir espera maior que `AI_MAX_RETRY_WAIT_MS`, o Gateway não mantém a requisição aberta por dezenas de segundos.
- Quota/billing OpenAI conhecidos (`credit_balance_exhausted`, spend/usage limits, `insufficient_quota`) não recebem retry.

## Observabilidade

Campos seguros de diagnóstico:

- provider
- model
- errorCode QAgent
- upstreamStatus
- upstreamCode
- retryable
- retryAfterMs
- rawTextLength

API keys e credenciais descriptografadas não são logadas.

## Compatibilidade

- OpenAI permanece registrado e funcional.
- Gemini permanece registrado e funcional.
- Configuração por organização continua soberana.
- Plugin não precisa ser alterado nesta Foundation.
- Console não precisa ser alterado nesta Foundation.
- Sem migration.

## Próxima fronteira

Com a camada de IA fechada, o próximo domínio pode evoluir para Data Foundation / QA Runs / Findings mantendo o AI Engine como dependência isolada e substituível.

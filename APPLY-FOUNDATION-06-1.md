# Foundation 06.1 — AI Resilience & Diagnostics — Safe Update

Aplique este pacote sobre a raiz do `qagent-gateway` já atualizado com a Foundation 06.

## Objetivo

Fechar a camada multi-provider OpenAI + Gemini com uma política consistente de erro, retry, repair e diagnóstico antes de iniciar Data Foundation / QA Runs / Findings.

## O que muda

- Erros HTTP/rede não entram mais em `repairJson()`.
- `repairJson()` fica reservado a respostas HTTP válidas cuja saída não seja JSON válido/esperado.
- Resposta 2xx com JSON inválido não repete a geração completa; segue para um único repair no serviço chamador.
- `400`, `401`, `403` e `404` não são retentados.
- Erros transitórios (`408`, `409` para OpenAI, `429`, rede e `5xx`) podem ser retentados com backoff curto.
- `429` com `Retry-After` acima do limite síncrono configurado não segura o Worker por dezenas de segundos; o erro é propagado para diagnóstico/fallback.
- Erros de quota/billing conhecidos da OpenAI não são retentados.
- Logs de IA passam a registrar provider, model, upstream status/code, retryable e retryAfterMs sem registrar API keys.
- `/v1/generate-tests` mantém o contrato de fallback atual (stub), mas agora inclui metadados seguros do erro upstream e não multiplica chamadas em falhas não reparáveis.
- Autofill preserva `429` e `Retry-After` quando o provider está limitado.

## Configurações opcionais

```env
AI_MAX_RETRY_WAIT_MS=2500
AI_RETRY_BASE_DELAY_MS=500
AI_RETRY_MAX_DELAY_MS=2000
```

Os defaults acima já funcionam sem adicionar as variáveis ao ambiente.

## Testes adicionados

`test/test-ai-resilience.js` cobre:

- parse de `Retry-After`;
- retry delay vindo do corpo do Gemini;
- ausência de retry em erro 400 Gemini;
- ausência de retry em 429 longo Gemini;
- retry de 503 Gemini seguido de sucesso;
- JSON inválido Gemini sem repetição da geração completa;
- ausência de retry em quota/billing 429 OpenAI;
- retry de 500 OpenAI seguido de sucesso.

Também foram ampliados:

- `test/test-generateTests.js` — erro upstream não chama repair; JSON inválido chama exatamente um repair.
- `test/test-autofill-ai-service.js` — preservação de 429/retryAfter.

## Aplicação

```bash
npm install
npm run test:all
npx wrangler dev --port 8787
```

Não há migration nova.

Este pacote não contém:

- `.dev.vars`
- `wrangler.jsonc`
- secrets
- migrations

## Validação esperada do caso de quota Gemini

Para um `429 too_many_requests` com retry sugerido de ~55s, uma única chamada do plugin deve gerar uma única chamada ao Gemini (sem 3 retries + repair). O response de fallback deve conter metadados semelhantes a:

```json
{
  "mode": "stub",
  "provider": "gemini",
  "upstreamStatus": 429,
  "upstreamCode": "too_many_requests",
  "retryable": true,
  "retryAfterMs": 55000,
  "repairAttempts": 0
}
```

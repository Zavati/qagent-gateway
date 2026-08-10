# QAgent Phase 2 — Foundation 06: Gemini Provider

## Objetivo

Adicionar Google Gemini ao AI Engine existente sem alterar o contrato público do plugin nem criar um fluxo paralelo de configuração.

A partir deste corte, a organização pode escolher `openai` ou `gemini` na configuração de IA do Console. O Gateway resolve provider, modelos e credenciais em runtime e mantém as credenciais somente no backend.

## Arquitetura

```text
Plugin Chrome MV3
        |
        | endpoints atuais
        v
Gateway / AI Engine
        |
        +--> Provider Registry --> OpenAIProvider --> OpenAI
        |
        +--> Provider Registry --> GeminiProvider --> Gemini Interactions API
        ^
        |
AI config da organização (D1 + AES-GCM)
```

O plugin não conhece o provider utilizado pela organização.

## Decisões deste corte

### 1. Mesmo contrato de provider

`GeminiProvider` implementa o mesmo contrato já usado por OpenAI:

```text
generateJson(...)
repairJson(...)
```

Handlers e features continuam chamando somente o AI Engine.

### 2. Interactions API

A integração Gemini usa a Google Gemini Interactions API.

Versão padrão:

```text
v1
```

Override técnico opcional:

```dotenv
GEMINI_API_VERSION=v1
```

A Foundation usa `v1` por padrão porque os recursos centrais da Interactions API estão disponíveis na versão estável.

### 3. Structured JSON

As chamadas pedem resposta de texto com MIME type JSON:

```json
{
  "response_format": {
    "type": "text",
    "mime_type": "application/json"
  }
}
```

O client ainda aplica parsing defensivo para preservar o comportamento esperado pelo AI Engine e pelo repair de JSON.

### 4. BYOAI permanece por organização

Ordem de resolução da credencial Gemini:

```text
1. credentials.apiKey da organização, descriptografada em runtime
2. GEMINI_API_KEY do ambiente, apenas quando o modo de configuração permitir fallback
```

A chave da organização nunca é enviada ao plugin ou ao Console depois de salva.

### 5. Credencial Google

O catálogo expõe Gemini com:

```text
provider: gemini
credentialType: api_key
field: credentials.apiKey
```

O valor é enviado ao Gemini no header `x-goog-api-key` pelo Gateway.

> Nota validada em 2026-08-10: o Google está migrando Gemini API de Standard API Keys para Auth Keys. Novas chaves do Google AI Studio já são Auth Keys e continuam sendo informadas ao QAgent no mesmo campo `apiKey`.

## Catálogo do Console

`GET /v1/console/ai-providers` passa a retornar também:

```json
{
  "id": "gemini",
  "name": "Google Gemini",
  "credentialTypes": [
    {
      "id": "api_key",
      "fields": [
        {
          "id": "apiKey",
          "label": "Gemini API Key",
          "type": "secret",
          "requiredOnCreate": true
        }
      ]
    }
  ],
  "capabilities": ["test_generation", "autofill"]
}
```

Como o Console da Foundation 05 já é orientado pelo catálogo, não existe alteração de código obrigatória no `qagent-consol` neste corte.

## Troca de provider

A troca continua sendo feita pela configuração da organização.

Exemplo conceitual:

```json
{
  "provider": "gemini",
  "credentialType": "api_key",
  "credentials": {
    "apiKey": "<CHAVE_GEMINI_DA_ORGANIZACAO>"
  },
  "models": {
    "generateTests": "gemini-3.6-flash",
    "autofill": "gemini-3.6-flash"
  },
  "enabled": true
}
```

Ao salvar Gemini como configuração default da conta, as próximas chamadas do plugin passam pelo `GeminiProvider` sem alteração no plugin.

OpenAI continua armazenado e suportado. Para voltar, basta salvar/selecionar a configuração OpenAI como default pelo mesmo fluxo existente.

## Código adicionado

```text
src/ai/providers/geminiProvider.js
src/lib/geminiClient.js
src/lib/aiHttp.js
```

`aiHttp.js` contém utilitários HTTP/JSON neutros de provider. `src/lib/openai.js` continua exportando os mesmos helpers anteriores para preservar compatibilidade dos imports existentes.

## Código alterado

```text
src/ai/aiEngine.js
src/ai/providerCatalog.js
src/lib/openai.js
src/services/autofillAiService.js
src/index.js
.dev.vars.example
package.json
```

## Testes

Novo teste dedicado:

```text
test/test-gemini-provider.js
```

Também foram ampliados:

```text
test/test-ai-engine.js
test/test-ai-provider-catalog.js
test/test-ai-provider-config-service.js
test/test-ai-runtime-config.js
```

Cobertura principal:

- Gemini registrado no AI Engine;
- Gemini exposto no catálogo;
- configuração BYOAI aceita `gemini`;
- credencial da organização vence `GEMINI_API_KEY` do ambiente;
- fallback por ENV continua disponível conforme `AI_CONFIG_MODE`;
- modelo `models/...` é normalizado antes da chamada;
- chamada usa `/v1/interactions`;
- chave é enviada em `x-goog-api-key`;
- system instruction é encaminhada;
- resposta JSON em `model_output` é extraída e convertida;
- OpenAI continua passando pela suíte existente.

## D1 / migrations

Não existe migration nova nesta Foundation.

A tabela `ai_provider_configs` já suporta múltiplos providers por organização e o catálogo/serviço existente valida o tipo de credencial.

## Console

Nenhuma alteração de código necessária.

O Console já:

1. consulta o catálogo do Gateway;
2. cria o seletor de provider dinamicamente;
3. renderiza os campos de credencial definidos pelo catálogo;
4. salva modelos e credencial pela API atual.

Adicionar Gemini no catálogo do Gateway é suficiente para a opção aparecer.

## Plugin

Nenhuma alteração.

Os endpoints públicos permanecem os mesmos:

```text
POST /v1/generate-tests
POST /v1/autofill
```

A resolução do provider permanece totalmente server-side.

## Validação automatizada

```bash
npm install
npm run test:all
```

Baseline deste pacote: suíte completa verde, incluindo OpenAI e Gemini.

## Validação ponta a ponta recomendada

1. Subir Gateway Foundation 06.
2. Abrir `/ai-settings` no Console.
3. Confirmar que aparecem `OpenAI` e `Google Gemini`.
4. Selecionar `Google Gemini`.
5. Informar uma Gemini Auth API Key válida da organização.
6. Informar modelos de geração de testes e autofill.
7. Salvar.
8. Confirmar via `GET /v1/console/ai-config` que `gemini` está default e `credentialsConfigured=true`.
9. Executar geração de testes pelo plugin.
10. Executar autofill pelo plugin.
11. Confirmar que nenhuma alteração do plugin foi necessária.
12. Voltar a OpenAI no Console e repetir um fluxo para confirmar troca reversível.

## Limite da validação deste pacote

Os testes automatizados mockam a chamada HTTP ao Gemini. Uma chamada real não foi executada porque nenhuma Gemini API Key foi fornecida para este corte.

A validação final da credencial/modelo real deve ser feita no ambiente do QAgent após aplicar o pacote.

## Próximo corte

Com OpenAI e Gemini funcionando pelo mesmo AI Engine, a base multi-provider fica concluída para avançar para:

```text
Data Foundation
  -> QA Runs
  -> Findings
  -> Screen Auditor
```

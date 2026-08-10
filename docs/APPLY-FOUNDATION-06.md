# Foundation 06 — Gemini Provider — Safe Update

Copie os arquivos deste pacote sobre a raiz do `qagent-gateway` Foundation 05.2.

Este pacote propositalmente NÃO contém:

- `wrangler.jsonc`
- `.dev.vars`
- secrets
- migrations
- arquivos do `qagent-consol`
- arquivos do plugin

Assim, bindings/IDs reais da Cloudflare, secrets e configurações locais não são sobrescritos.

## O que entra nesta Foundation

- `GeminiProvider` no AI Engine;
- Gemini no Provider Registry default;
- Gemini no catálogo consumido pelo Console;
- client REST da Gemini Interactions API;
- Interactions API estável `v1` por padrão;
- autenticação via `x-goog-api-key`;
- suporte ao BYOAI já existente por organização;
- parsing JSON compartilhado entre providers sem quebrar os imports OpenAI existentes;
- testes do novo provider e regressão dos componentes de IA.

Não existe migration nova nesta Foundation.

## Depois de copiar

```bash
npm install
npm run test:all
npx wrangler dev --port 8787
```

## Configuração local opcional

Somente para fallback por ENV/local, se necessário:

```dotenv
GEMINI_API_KEY=<SUA_CHAVE_LOCAL>
GEMINI_API_VERSION=v1
```

No fluxo BYOAI normal, a chave deve ser cadastrada no Console para a organização e permanece criptografada no D1 pelo mecanismo já existente.

## Teste pelo Console

Em `/ai-settings`:

1. selecionar `Google Gemini`;
2. informar a Gemini API Key da organização;
3. informar os modelos;
4. salvar;
5. confirmar que Gemini ficou como provider default.

Exemplo de modelo para o primeiro teste:

```text
gemini-3.6-flash
```

A lista real de modelos disponíveis depende da conta/chave Google utilizada.

### Atenção às chaves Google — agosto/2026

Prefira uma **Auth API Key** criada atualmente no Google AI Studio. O Google informa que Standard API Keys serão rejeitadas pela Gemini API em setembro de 2026.

Para o QAgent, a Auth API Key continua sendo cadastrada normalmente no campo `Gemini API Key`.

## Teste ponta a ponta

Com Gemini salvo no Console:

1. usar o plugin normalmente;
2. gerar casos de teste;
3. validar autofill;
4. confirmar que a resposta veio sem alteração do plugin;
5. voltar para OpenAI no Console;
6. repetir um fluxo para confirmar que OpenAI continua funcionando.

## Resultado esperado

```text
Plugin (inalterado)
  -> Gateway
  -> config da organização
  -> AI Engine
  -> provider default da organização
       -> OpenAIProvider
       ou
       -> GeminiProvider
```

## Observação

A suíte automatizada do pacote valida o contrato Gemini usando mock HTTP. O teste com uma chave Gemini real deve ser executado após aplicar o pacote no ambiente local/dev.

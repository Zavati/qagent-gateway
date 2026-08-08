# QAgent Phase 2 — Foundation 03: AI Engine

## Objetivo

Desacoplar as features de IA do provider OpenAI sem alterar os endpoints públicos existentes.

A partir deste corte, `generate-tests` e `autofill` dependem de uma interface interna de AI Engine. OpenAI passa a ser o primeiro provider registrado nessa camada.

## Arquitetura

```text
generate-tests ─┐
                ├──> AI Engine ──> Provider Registry ──> OpenAIProvider ──> OpenAI
     autofill ──┘
```

Próximo provider planejado:

```text
AI Engine
   ├── OpenAIProvider
   └── GeminiProvider
```

## Novos módulos

```text
src/ai/
  aiEngine.js
  providerRegistry.js
  providers/
    openaiProvider.js

src/services/
  autofillAiService.js
```

## Responsabilidades

### `AiEngine`

- resolve o provider configurado;
- delega geração estruturada;
- delega reparo de JSON;
- impede que handlers conheçam SDK/API específica de um fornecedor.

### `ProviderRegistry`

- registra providers por nome;
- resolve o provider em runtime;
- permite adicionar Gemini e providers corporativos sem alterar as features.

### `OpenAIProvider`

- encapsula autenticação OpenAI;
- chama a Responses API através do client existente;
- suporta `systemPrompt` e `userPrompt`;
- mantém compatibilidade do repair de geração de casos.

### `autofillAiService`

- executa heurísticas locais;
- chama AI Engine apenas para campos restantes;
- normaliza ações;
- tenta repair quando a resposta é recuperável;
- não mascara falhas HTTP/rede do provider.

## Configuração

Novas configurações não secretas:

```text
AI_PROVIDER=openai
GENERATE_TESTS_MODEL=gpt-4o-mini
AUTOFILL_MODEL=gpt-4o-mini
```

Secret do provider atual:

```text
OPENAI_API_KEY=...
```

`GENERATE_TESTS_MODEL` agora é independente de `AUTOFILL_MODEL`.

Para compatibilidade, se `GENERATE_TESTS_MODEL` não existir, geração de testes ainda usa `AUTOFILL_MODEL` antes de cair no default `gpt-4o-mini`.

## Compatibilidade externa

Nenhum endpoint foi alterado:

```text
POST /v1/generate-tests
POST /v1/autofill
```

O plugin atual não precisa conhecer `AI_PROVIDER`.

## Logging

Foi removido o logging de previews extensos de resposta do LLM no fluxo de geração de casos.

Agora são registrados somente metadados como:

- status;
- existência de JSON;
- tamanho da resposta;
- tentativa de repair;
- erro do provider.

Também não retornamos mais conteúdo bruto do LLM no `meta` do stub; somente o tamanho da resposta recebida.

## Testes adicionados

```text
test/test-ai-engine.js
test/test-openai-provider.js
test/test-autofill-ai-service.js
```

Cobertura principal:

- resolução do provider default;
- seleção por `AI_PROVIDER`;
- provider não suportado;
- delegação de repair;
- payload da Responses API;
- system prompt;
- API key ausente;
- autofill somente heurístico;
- autofill IA + heurística;
- repair do autofill;
- falha upstream não mascarada;
- modelo independente para geração de casos.

## Validação

```bash
npm install
npm run test:all
npx wrangler dev --port 8787
```

Validar no plugin:

1. `/v1/license`;
2. `/v1/generate-tests`;
3. `/v1/autofill`.

Validar no Console os fluxos já cobertos anteriormente.

## Próximo corte recomendado

**Foundation 04 — Gemini Provider**

Objetivo:

1. criar `GeminiProvider`;
2. usar o mesmo contrato `generateJson/repairJson`;
3. adicionar `GEMINI_API_KEY`;
4. adicionar configuração de modelo Gemini;
5. testar troca somente via configuração do Gateway;
6. manter plugin sem conhecimento do fornecedor.

Depois disso, avançar para a Data Foundation/D1.

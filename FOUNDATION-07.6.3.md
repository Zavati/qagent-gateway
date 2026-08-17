# Foundation 07.6.3 — AI Test Design Engine

## Objetivo

Conectar o `CatalogTestDesignContextV1` validado ao AI Engine provider-agnostic do Gateway e produzir um `TestSpecificationV1` normalizado pelo QAgent.

## Boundary

```text
CatalogTestDesignContextV1
        ↓
Prompt v1 determinístico
        ↓
OpenAI / Gemini / BYOAI
        ↓
TestDesignModelOutputV1
        ↓
Contract + Grounding validation
        ↓
System-owned Automation Readiness
        ↓
TestSpecificationV1
```

## Nova rota

```http
POST /v1/console/projects/:projectId/intelligence/endpoints/:endpointId/test-design
Authorization: Bearer <console-session>
```

A rota é síncrona e efêmera nesta Foundation. Não persiste Test Specifications; persistência pertence às próximas subfases.

## Regras importantes

- Contexto do Catalog é tratado como dado não confiável, nunca como instrução de prompt.
- Nenhuma URL/baseUrl é enviada para a IA pelo contrato de contexto.
- A IA não escolhe endpoint, method, path, apiServiceKey ou Auth Profile.
- Evidence/Schema refs inventadas são rejeitadas.
- Uma tentativa de repair estruturado é permitida quando a saída viola o contrato.
- Saída ainda inválida após repair retorna `AI_TEST_DESIGN_OUTPUT_INVALID` (502).
- `Automation Readiness` é calculado exclusivamente pelo QAgent.
- Sem API Service configurado, cenários válidos são gerados, mas ficam `NEEDS_ENVIRONMENT`.
- Sem Auth Profile para cenário `REQUIRED`, readiness fica `NEEDS_AUTH` quando runtime já está associado.
- Não há migration nesta Foundation.

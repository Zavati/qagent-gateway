# QAgent Phase 2 — Foundation 05: AI Provider Catalog

## Objetivo

Dar ao Console uma fonte de verdade para saber quais motores de IA e tipos de credencial o Gateway suporta.

Novo endpoint autenticado:

```text
GET /v1/console/ai-providers
```

Resposta conceitual:

```json
{
  "status": "ok",
  "mode": "account_preferred",
  "accountConfigurationAllowed": true,
  "accountConfigurationRequired": false,
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "credentialTypes": [
        {
          "id": "api_key",
          "fields": [
            {
              "id": "apiKey",
              "type": "secret",
              "requiredOnCreate": true
            }
          ]
        }
      ],
      "capabilities": ["test_generation", "autofill"]
    }
  ]
}
```

## Estrutura

```text
src/ai/providerCatalog.js
src/services/aiProviderCatalogService.js
```

`aiProviderConfigService` também passa a consultar o mesmo catálogo para validar provider e credential type. Isso evita regras duplicadas.

## Próximo passo

Foundation 06 deverá adicionar Gemini ao catálogo e ao AI Engine sem alterar o contrato do Console.

# QAgent Foundation 07.7.8 FIX-1 — Secret-Safe Test Design Generation

## Objetivo

Impedir que a IA materialize password, token, API key, client secret, Authorization, Cookie ou outro material sensível dentro do Test Design, sem degradar a geração para `AI_TEST_DESIGN_OUTPUT_INVALID` quando o endpoint possui campos sensíveis legítimos no request schema.

## Problema real reproduzido

A IA gerava cenários de update de perfil com campos como `newPassword` e `newPasswordConfirmation` preenchidos com valores fictícios. O contrato corretamente bloqueava o draft com `TEST_DESIGN_SECRET_MATERIAL_FORBIDDEN`, mas o repair podia repetir outro valor fictício e a geração terminava em 502.

O contrato não foi relaxado. Ele continua sendo a última barreira fail-closed.

## Pipeline novo

```text
AI output
→ normalização segura
→ Secret-Safe Test Design Sanitizer v1
→ Contract Validator
→ Semantic Grounding Guard
→ Observed Auth Bridge
→ Test Specification
→ Test Registry
```

O sanitizer executa antes da primeira validação contratual e também depois de um eventual contract repair.

## Regras determinísticas

### Request body / query / path params

Campos sensíveis são removidos completamente. Não são substituídos por `null`, placeholder, valor fake ou variável textual.

O cenário recebe:

```text
automationHints.needsData = true
```

com blocker seguro indicando que o dado deve ser fornecido por mecanismo seguro de runtime/test data.

### Auth headers

Headers como `Authorization`, `Cookie`, `X-API-Key` e equivalentes são removidos do draft. Eles pertencem ao Auth Runtime, não ao Test DSL.

### Assertions e extracts

Assertions/extracts que tentem validar ou capturar material sensível de alta confiança são removidos e o cenário passa para revisão. O contrato também passa a rejeitar diretamente selectors sensíveis como `access_token`, `refresh_token`, `password`, `clientSecret` etc.

Selectors de domínio legítimos como `$.tokens` ou valores textuais contendo a palavra `token` não são bloqueados por substring genérica.

## Prompt

- `qagent.test-design-prompt.v6.2`
- `qagent.test-design-repair-prompt.v1.1`

O prompt agora ordena explicitamente:

- omitir campos sensíveis completamente;
- nunca trocar um secret proibido por outro valor fictício;
- nunca usar `${SECRET}`, `{{password}}`, `fake-token`, `senha123` etc.;
- usar `automationHints.needsData=true` quando a execução depender de dado sensível;
- não gerar assertions/extracts sobre secrets.

## Diagnostics

Novo bloco seguro:

```json
{
  "secretSafeSanitizer": {
    "sanitizerVersion": "qagent.secret-safe-test-design-sanitizer.v1",
    "sanitizedScenarioCount": 2,
    "removedMaterialCount": 4,
    "requestSecretRemovalCount": 4,
    "authHeaderRemovalCount": 0,
    "assertionRemovalCount": 0,
    "extractRemovalCount": 0,
    "needsDataScenarioCount": 2,
    "reviewRequiredScenarioCount": 0
  }
}
```

Os diagnostics podem registrar paths de campo, mas nunca valores removidos.

## Segurança

- nenhum secret é retornado ao Console;
- nenhum secret é enviado ao Test Registry;
- nenhum secret vai para Queue, Runtime Snapshot ou Execution Plan;
- o sanitizer não cria placeholders executáveis;
- o validator permanece estrito;
- Auth continua exclusivamente no Auth Runtime / Secret Vault;
- futura Test Data Runtime será responsável por resolver dados sensíveis/fixos/gerados sem persistir material proibido no Test Design.

## Escopo técnico

Gateway apenas.

Sem migration.

Sem alteração no Runner.

Sem alteração obrigatória no Console.

## Estado

```text
LOCAL VALIDATED ✅
PRODUCTION GATE PENDING
```

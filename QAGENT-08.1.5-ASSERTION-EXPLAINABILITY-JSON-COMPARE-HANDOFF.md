# QAgent 08.1.5 — Assertion Explainability & JSON Compare

Data: 2026-09-09. Entrega de código local; não houve deploy, execução em produção nem escrita em KV/D1 remoto.

## 1. Bases utilizadas

- Runner: `qagent-runner-main (1)(1).zip`, enviado nesta etapa.
- Results: `qagent-test-results-main (1).zip`, enviado nesta etapa.
- Gateway: `qagent-gateway-08.1.4-FIX-2.2-attention-execution-identity-recovery.zip`, último disponível nesta conversa.
- Console: `qagent-console-08.1.4-FIX-2.1-api-identity-projection.zip`, último disponível nesta conversa.

Aplicar sobre essas bases ou conferir o diff antes de integrar a branches mais recentes. Cada ZIP contém o repositório completo com arquivos na raiz, sem `node_modules`, `.git`, caches ou builds. As alterações cumulativas dessas bases foram preservadas; não houve refactor geral.

## 2. Auditoria: causas confirmadas no código

O exemplo fornecido registra SCHEMA_TYPE_MISMATCH em `$.meta.total`, mas não armazena tipo esperado/recebido. Não é possível afirmar qual era o par original de tipos apenas a partir desse resultado histórico.

No Runner, o validador gerava `expectedTypes` e `actualType`. A projeção usada pelo `resultsClient` procurava `expectedType` e `actualTypes`. Isso descartava o detalhe do tipo na transmissão. O Results já tinha colunas para os campos resumidos; esse era um defeito de mapeamento no produtor, não de persistência desses dois campos.

A sanitização de JSON no Runner convertia números, booleanos e null em strings. Por isso o preview antigo não é evidência confiável do tipo primitivo original. A correção mantém tipos não sensíveis e continua aplicando redaction. Não reinterpreta previews antigos como se preservassem tipos.

Na Console, `AssertionRow` priorizava o identificador de schema em vez do caminho. Agora o resumo enfatiza o campo e o motivo da assertion, e uma nova seção explica a falha antes dos painéis de Evolution/request.

## 3. Implementação e semântica

### Runner

Preservado o algoritmo de aprovação/reprovação existente. O validador agora associa a cada divergência um JSON Pointer da resposta (`instancePointer`) e da regra do schema (`schemaPointer`). A lista e os tipos originais seguem para o Results.

O snapshot esperado vem do Execution Plan já validado. A projeção de schema é somente estrutural: `type`, `properties`, `items`, formatos suportados e `x-qagent-partial`. Não há valores de exemplo, defaults, enums ou conteúdo de request. Não introduz `required` nem `additionalProperties` como novas regras de teste.

Credenciais usadas na execução podem fornecer pistas transitórias de redaction por WeakMap. Elas não são propriedades enumeráveis do resultado, não entram em logs nem no envelope. O diagnóstico ampliado não é anexado aos logs do Control Plane.

### Test Results

Novo wire `qagent.execution-result-ingest.v1.2`, mantendo aceitação de v1 e v1.1. Normalização das versões antigas conserva os bytes canônicos dos payloads antigos testados, preservando idempotência/fingerprint.

Nova evidência por assertion: `diagnostics`, persistida como JSON nullable e devolvida no detalhe e histórico. Contrato estrito com whitelist de campos/regras/tipos e rejeição de material não permitido. Não aceita provenance `LEGACY_EXECUTION_PLAN` enviado pelo Runner; essa provenance é exclusiva da leitura pelo Gateway.

### Gateway

Para SCHEMA FAILED antigo sem diagnóstico, a leitura tenta usar `getExecutionPlanForRun`. Confere organização, projeto, Run, Execution Plan, Test Design Version, runtime snapshot e ambiente; confere também cenário único, índice/tipo/ref da assertion e snapshot único. Não usa latest do Catalog.

O enriquecimento é somente na resposta: `source=LEGACY_EXECUTION_PLAN`. Não altera a evidência persistida nem muda o resultado. O tipo recebido histórico permanece ausente quando não foi registrado. Plano ausente/indisponível não derruba a leitura; a Console apresenta comparação parcial.

### Console

Novo componente full-width `AssertionCompare`, somente leitura:

- resumo de assertions passadas, falhadas e não avaliadas;
- seleção de divergência, anterior/próxima e foco nos dois painéis;
- schema esperado versus resposta sanitizada, com linhas numeradas e destaque da regra/campo;
- mapeamento por JSON Pointer completo, incluindo arrays e nomes repetidos, sem busca por substring;
- rolagem sincronizada opcional e filtro de divergência selecionada + contexto;
- fallback aproximado no ancestral quando o campo não existe no preview;
- avisos de schema/preview truncado, material protegido e diagnóstico histórico parcial;
- STATUS e CONTENT_TYPE tratados como comparação de metadados, não como falso diff de JSON.

O lado esquerdo é contrato estrutural, não uma resposta esperada inventada. Linhas são do JSON formatado para exibição, não offsets do payload original. O componente não recalcula falhas, não chama IA, não aprova proposals e não altera versões. Valores exatos de JSON_PATH_EQUALS que não foram armazenados não são reconstruídos. Folding de objetos e comparação com execução anterior não fazem parte desta entrega.

## 4. Contrato novo

`assertions[].diagnostics` usa `qagent.assertion-diagnostics.v1`. Exemplo SINTÉTICO, não reconstrução dos tipos ausentes do resultado enviado:

```json
{
  "contractVersion": "qagent.assertion-diagnostics.v1",
  "source": "RUNNER_EVALUATION",
  "schemaRef": "csv_example",
  "schemaHash": "sha256:example",
  "schemaVersionId": "csv_example",
  "expectedSchema": {
    "type": "object",
    "properties": {
      "meta": {
        "type": "object",
        "properties": { "total": { "type": "integer" } }
      }
    }
  },
  "schemaTruncated": false,
  "schemaRedacted": false,
  "issueCount": 1,
  "issuesTruncated": false,
  "issues": [{
    "code": "SCHEMA_TYPE_MISMATCH",
    "path": "$.meta.total",
    "instancePointer": "/meta/total",
    "schemaPointer": "/properties/meta/properties/total/type",
    "expectedTypes": ["integer"],
    "actualType": "string",
    "format": null,
    "redacted": false
  }]
}
```

`schemaHash` identifica o snapshot original, não o hash da projeção sanitizada. O preview novo informa `previewTruncated`, `redacted` e `typesPreserved`. A Console nunca deduz o tipo avaliado a partir do preview antigo.

Limites: 32 divergências exibidas por assertion; validador já limitado a 100 ocorrências; `issuesTruncated` sinaliza lista incompleta (ao atingir o limite, a contagem não é total exato). Projeção até 200 nós/depth16/12.000 caracteres de schema. Diagnóstico limitado a aproximadamente 30.000 caracteres, com defesa de 32.768 na persistência. O produtor reduz/omite diagnósticos opcionais se o envelope se aproxima do limite existente de 512 KiB. O enriquecimento histórico tem orçamento de 128 KiB por resposta. Estes limites não resolvem possíveis envelopes legados já oversized por outros campos.

## 5. Migration e ordem de publicação — IMPORTANTE

Há UMA migration nova, SOMENTE no Test Results:

`migrations/0004_foundation_08_1_5_assertion_diagnostics.sql`

Ela adiciona `assertion_results.diagnostics_json` nullable com validação JSON/tamanho. Não reescreve linhas históricas.

Ordem recomendada:

1. Conferir e aplicar a migration no D1 do Test Results.
2. Publicar Test Results atualizado (aceita v1/v1.1/v1.2).
3. Publicar Gateway.
4. Validar build e publicar Console.
5. Publicar Runner por último, pois ele passa a emitir v1.2.

Não publicar o Runner novo antes do Results compatível. Sem migration nova no Gateway, Console ou Runner. Binding/flags/secrets existentes foram preservados.

Dentro do repositório `qagent-test-results`, conferir o ambiente selecionado e as migrations pendentes:

```bash
npx wrangler d1 migrations list qagent-test-results --remote
```

Conferir a lista antes de confirmar a aplicação (o comando aplica todas as pendentes, não apenas 0004):

```bash
npx wrangler d1 migrations apply qagent-test-results --remote
```

A sintaxe dos comandos e o uso do database_name foram verificados na documentação oficial: https://developers.cloudflare.com/workers/wrangler/commands/d1/ e https://developers.cloudflare.com/d1/reference/migrations/. Estes comandos NÃO foram executados contra a conta do usuário.

Rollback: voltar primeiro o Runner para o wire antigo; manter o Results compatível com as versões já persistidas. A coluna nullable pode permanecer. Não remover linhas históricas e não fazer down-migration destrutiva.

## 6. Validação realizada

Node 22.16.0; SQLite local in-memory pela API experimental do Node. Testes determinísticos, sem chamadas a ambientes do cliente.

52 checks novos de domínio passaram: Runner 13, Results 16, Gateway 11, Console 12. Também passou harness do componente real transpilado, verificando árvore/seleção anterior-próxima/contexto/legado/STATUS/ausência de painel quando PASSED. O harness usa hooks e JSX simulados; NÃO equivale a hidratação de React/Next em produção.

Integração adicional passou: fixture gerada pelo Assertion Engine e sanitizador do Runner -> envelope real -> contrato estrito do Results -> modelo de persistência. Roundtrip/idempotência/replay conflitante e isolamento de leitura foram testados em SQLite. JSON Schema v1.2 validou o fixture. Normalizações v1/v1.1 foram comparadas byte a byte com o código original e permaneceram iguais para os fixtures antigos testados.

Regressão por scripts independentes (não confundir quantidade de scripts com quantidade de assertions):

| Repositório | Passaram | Falharam |
|---|---:|---:|
| Runner | 20 | 1 |
| Test Results | 10 | 0 |
| Gateway | 61 | 0 |
| Console, incluindo harness novo | 38 | 5 |

As SEIS falhas também foram reproduzidas nos ZIPs originais, sem este patch:

- Runner `test:f07-7-10-b-fix-2`: espera `RUNNER_MUTATION_EXECUTION_ENABLED=false`, enquanto o wrangler enviado já define true. A configuração e o teste não foram relaxados para forçar um verde.
- Console `test:f07-6-4`, `test:f07-7-8-b`, `test:f07-6-5-e`, `test:f07-6-5-e-fix-1`, `test:f07-6-5-e-fix-2`: verificações estáticas antigas por regex contra código preexistente. Arquivos afetados por essas verificações não foram alterados para mascarar os erros.

`npm run check:08.1.5`: Gateway, Test Results e Console passaram. A cadeia da Console não inclui esses cinco scripts históricos; eles foram rodados separadamente. A cadeia do Runner continua bloqueada pelo teste preexistente de flag; os demais scripts foram executados individualmente.

Sintaxe/transpilação TS/TSX dos arquivos alterados passou. Renderização ESTÁTICA do componente foi inspecionada no Chromium em 1440px e 390px, sem overflow horizontal do documento. Prévia usa dados sintéticos.

### Limitações de validação

A instalação das dependências da Console (`npm ci`) não concluiu: resolução DNS de `registry.npmjs.org` falhou neste ambiente. Consequentemente não houve build completo Next, nem typecheck semântico completo, nem E2E da aplicação Next hidratada. Antes da publicação, executar no ambiente de CI/desenvolvimento com rede:

```bash
npm ci
npm run check:08.1.5
npm run build
```

O script do componente usa TypeScript já presente em devDependencies, sem adicionar dependência. Aqui foi usado TypeScript global porque a instalação local estava indisponível. Não houve deploy nem validação remota. Estes fatos constam em `validation-summary.json`; não considerar esta entrega como prova de smoke de produção.

## 7. Smoke após publicação

Abrir primeiro o resultado histórico enviado. Esperar ver a explicação em `$.meta.total` e destaque no preview disponível. Se o snapshot original ainda existir, o lado esquerdo deve ser enriquecido e rotulado histórico/parcial. O tipo recebido ausente deve continuar “Não registrado”. Não esperar a recuperação retroativa de todos os detalhes que nunca foram salvos.

Executar um novo teste de schema conhecido em ambiente de teste autorizado. Conferir no GET `diagnostics.source=RUNNER_EVALUATION`, schemaRef/hash, expectedTypes/actualType e pointers, e comparar com as linhas selecionadas na Console. Usar fixtures com number/string, null, boolean, arrays e campos repetidos; conferir proteção para tokens/cookies e limites.

No caso STATUS expected400/actual422, ver comparação HTTP explícita, sem schema inventado. Confirmar que a tela não dispara execução, não grava Test Design e não altera o verdict original ao navegar.

## 8. Fora do escopo

Não alterados billing/free trial/ClientKey/KV, política de mutações, Auth Runtime, Registry, Catalog, Normalizer, Test Evolution e Request Repair Binding Reconciliation. FIX-2.3 de request repair discutida antes NÃO está implicitamente incluída nesta entrega. Não há novas regras automáticas de evolução/aprovação.

## 9. Arquivos de código alterados/adicionados

### runner

- `package.json` (modified)
- `src/assertionDiagnostics.js` (added)
- `src/assertionEngine.js` (modified)
- `src/consumer.js` (modified)
- `src/executionEvidence.js` (modified)
- `src/httpExecutor.js` (modified)
- `src/resultsClient.js` (modified)
- `src/structuralSchemaValidator.js` (modified)
- `test/fixtures/assertionCompareFixture.js` (added)
- `test/test-08-1-5-assertion-explainability.js` (added)
- `test/test-foundation-07-7-10-b-fix-3-3-execution-evidence.js` (modified)
- `test/test-foundation-07-7-9-b-results-ingestion.js` (modified)

### results

- `contracts/qagent.execution-result-ingest.v1.2.schema.json` (added)
- `migrations/0004_foundation_08_1_5_assertion_diagnostics.sql` (added)
- `package.json` (modified)
- `scripts/verify-assertion-compare-runner.mjs` (added)
- `src/assertionDiagnosticsContract.js` (added)
- `src/contracts.js` (modified)
- `src/resultIngestionService.js` (modified)
- `src/resultRepository.js` (modified)
- `test/fixtures/assertion-explainability-envelope.json` (added)
- `test/test-08-1-5-assertion-explainability.js` (added)
- `test/test-foundation-07-7-10-b-fix-3-3-sanitized-evidence.js` (modified)
- `test/test-foundation-07-7-10-b-fix-3-mutation-refs.js` (modified)
- `test/test-foundation-07-7-9-c-sql.js` (modified)

### gateway

- `package.json` (modified)
- `src/handlers/consoleAutomation.js` (modified)
- `src/lib/assertionDiagnostics.js` (added)
- `src/lib/assertionJsonPath.js` (added)
- `src/services/assertionComparisonService.js` (added)
- `test/test-08-1-5-assertion-explainability.js` (added)

### console

- `app/projects/automation/result/page.tsx` (modified)
- `components/automation/AssertionCompare.tsx` (added)
- `lib/automation.ts` (modified)
- `lib/jsonCompare.d.mts` (added)
- `lib/jsonCompare.mjs` (added)
- `package.json` (modified)
- `test/fixtures/assertion-explainability-envelope.json` (added)
- `test/test-08-1-5-component.mjs` (added)
- `test/test-08-1-5-json-compare.mjs` (added)

Cada repositório recebe também este handoff. Logs e manifestos de validação estão no ZIP de validação que acompanha a entrega.

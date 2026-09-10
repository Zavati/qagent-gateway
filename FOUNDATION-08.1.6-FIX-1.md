# QAgent 08.1.6 FIX-1
# Lazy Operational Presence & Test Readiness Explorer

Data: 10/09/2026. Entrega de fontes baseada nos três ZIPs 08.1.6 desta conversa.

## 1. Estado da entrega

Implementados Console, Gateway e Test Registry. As três cadeias `check:08.1.6-fix1` passaram localmente. Os 31 testes novos por serviço e 18 checkpoints de interação no Chromium passaram. O teste usa transporte local e SQLite; não houve acesso a API de cliente, Cloudflare remoto, IA ou deploy.

**Gate pendente:** instalação lockada e build completo do Next/React/Cloudflare no ambiente de release. `npm ci` falhou por EAI_AGAIN no registro npm; `npm run build` não conseguiu encontrar o executável Next. O teste visual/interativo utilizou React 18.2.0 instalado no ambiente e adaptadores de Next/plataforma, não Next 16.2.11 / React 19.2.3 do projeto. A entrega não afirma aprovação desse build nem do smoke em produção.

Esta FIX é uma leitura e navegação da prontidão persistida, não uma correção automática do gerador. Não muda assertions, massa, readiness, origem, políticas de baseline, mutações, Auth, Results ou Attention. Runner, Normalizer, Catalog, Evolution, Observation, Plugin e Orchestrator não foram alterados.

## 2. Instalação — preservar sua configuração atual

Publicar na ordem **Test Registry → Gateway → Console**, depois dos checks/builds e revisão dos diffs.

**Nenhuma migration nova.** O Registry precisa já estar com as migrations anteriores da 08.1.6, incluindo `0006_foundation_08_1_6_baseline_provenance.sql`, aplicadas. Não executar migrations indiscriminadamente como parte desta FIX.

Os ZIPs completos conservam `wrangler*`, IDs de banco, bindings, secrets/configurações declaradas, migrations e lockfiles dos ZIPs de origem. Nenhum desses arquivos foi alterado nesta FIX. Isso não significa que representem alterações que você fez localmente após gerar os ZIPs.

**Importante para o piloto:** o Gateway de origem declara `OBSERVED_BASELINE_GENERATION_ENABLED="false"`. Você já ativou a flag e sua lista de projetos no deployment. Preserve os valores atuais ao mesclar os fontes; não substitua seu `wrangler.jsonc`/variáveis publicadas pelo arquivo antigo por engano. A leitura de prontidão não depende dessa flag: mostra as versões já persistidas mesmo com novas gerações pausadas.

O pacote `CHANGED-FILES.zip` contém somente arquivos novos/alterados separados por repositório; não inclui `wrangler*`, migrations ou lockfiles. Pode ser usado para aplicar esta FIX sem substituir esses arquivos de configuração. Ainda assim, revise os diffs se houve alterações locais nos mesmos componentes.

Em cada repositório, com o toolchain do projeto:

```bash
npm ci
npm run test:f08-1-6-fix1
npm run check:08.1.6-fix1
```

Na Console:

```bash
npm run build
```

Use o fluxo habitual de publicação de cada repositório. **Não precisa remonitorar, regenerar Test Designs, materializar suites nem executar testes da aplicação para usar a nova visão**: ela lê as versões atuais existentes. Nenhum clique de indicador inicia uma geração ou execução.

## 3. Top Endpoints sob demanda

O componente Operational Presence / Top Endpoints foi mantido, não removido.

| Interação | Implementação |
|---|---|
| Entrar no Catalog, recarregar ou mudar projeto | Começa recolhido; zero request do Top. |
| Primeira expansão por mouse/teclado | Consulta `catalog/endpoints?limit=8`. |
| Cliques durante carregamento | Uma request ativa por componente/escopo. |
| Recolher em voo | AbortController; resposta atrasada ignorada; cancelamento não vira erro. |
| Reabrir após carga concluída na mesma visita | Reutiliza cache em memória ainda válido. |
| Atualizar o card | Invalida e consulta explicitamente. |
| Atualizar geral com card recolhido | Invalida sem consultar e sem abrir. |
| Atualizar geral com card aberto | Uma nova consulta; mantém aberto. |
| Filtrar tabela ou clicar em indicador | Não abre nem consulta Top. |
| Mudar conta/projeto/sair | Descarta cache e impede resposta de escopo anterior. |
| Erro do Top | Erro e retry locais; não elimina indicadores/tabela. |

A request de `limit=50` da tabela de descoberta é independente e continua legítima com o Top recolhido. Não alteramos a seleção/ranking das barras.

A expansão usa botão com aria-expanded/aria-controls, Enter/Espaço e foco visível. Não guarda preferência de aberto em localStorage. Dados do Top não são carregados por hover, viewport, summary ou polling de geração.

## 4. Consulta implementada

### Gateway — público, exige sessão Console e associação do projeto

```http
GET /v1/console/projects/:projectId/intelligence/test-readiness
GET /v1/console/projects/:projectId/intelligence/test-readiness/endpoints/:endpointId/scenarios
```

### Registry — privado, somente Service Binding existente

```http
GET /v1/test-registry/projects/:projectId/test-readiness
GET /v1/test-registry/projects/:projectId/test-readiness/endpoints/:endpointId/scenarios
```

Contratos:

- `qagent.project-test-readiness.v1`: indicadores e endpoints.
- `qagent.test-readiness-scenarios.v1`: detalhe seguro de cenários da versão selecionada.
- `qagent.test-readiness-projection.v1`: revisão do modelo de leitura.

**Fronteira real de autenticação:** Gateway usa requireConsoleTenant/getOrganizationProject; o client acessa `TEST_REGISTRY_SERVICE` por Service Binding privado com headers de tenant derivados no servidor, como no Registry existente. Não foi criado nem exigido HMAC novo nessa fronteira e não existe fallback para uma URL pública do Registry. Não exponha o Registry publicamente com esses headers como única proteção. O cursor não substitui autenticação.

### Parâmetros

| Nome | Regra |
|---|---|
| `view` | summary/endpoints, padrão endpoints. Não usado no detalhe. |
| `readiness` | CSV de READY, NEEDS_DATA, REVIEW_REQUIRED, NEEDS_AUTH, NEEDS_ENVIRONMENT. |
| `generationClass` | CSV de OBSERVED_BASELINE, AI_EXPLORATORY, LEGACY. |
| `baselineGap` | RESPONSE_PARTIAL, REQUEST_PARTIAL, BOTH_PARTIAL, OTHER; exige exatamente baseline + NEEDS_DATA. |
| `q` | Busca literal de até 120 caracteres no path/título do Test Design. Não é regex nem SQL LIKE. |
| `method` | Método HTTP normalizado. |
| `apiServiceKey` | Chave de serviço da versão do teste, não serviceId de discovery. |
| `baselineEnvironmentId` | Ambiente da fonte; permitido apenas com origem exclusivamente baseline. Não é seleção de runtime de execução. |
| `limit` | 1–100; padrão 25 endpoints / 50 cenários no detalhe. |
| `cursor` | Opaco, vinculado a escopo, filtros, limite e revisão. Summary não aceita cursor. |
| `testDesignVersionId` | Obrigatório somente no detalhe; fixa a versão do Test Design. |

Parâmetros desconhecidos, duplicados, vazios explícitos, combinações contraditórias e enums inválidos retornam 400. A opção “Com pendências” equivale ao OR de quatro estados não READY, sem criar novo estado persistido.

Dentro de um filtro CSV os valores são OR. Entre filtros os valores são AND **no mesmo cenário**. Exemplo: baseline READY + exploratório NEEDS_DATA não corresponde a baseline NEEDS_DATA.

### Exemplos no contexto autenticado

```http
GET /v1/console/projects/:projectId/intelligence/test-readiness?view=summary

GET /v1/console/projects/:projectId/intelligence/test-readiness?readiness=NEEDS_DATA&generationClass=OBSERVED_BASELINE&baselineGap=RESPONSE_PARTIAL&limit=25

GET /v1/console/projects/:projectId/intelligence/test-readiness?readiness=REVIEW_REQUIRED&generationClass=AI_EXPLORATORY&limit=25

GET /v1/console/projects/:projectId/intelligence/test-readiness/endpoints/:endpointId/scenarios?testDesignVersionId=:versionId&readiness=NEEDS_DATA&generationClass=OBSERVED_BASELINE&baselineGap=RESPONSE_PARTIAL&limit=50
```

Use IDs da resposta atual, não placeholders. Não enviar organizationId na query nem credenciais em URL.

### Envelope

`data` inclui organizationId/projectId derivados, contrato, `readinessRevision`, `computedAt`, `readinessBasis: LATEST_PERSISTED_TEST_DESIGN`, filtros canônicos, `projectSummary`, `filteredSummary`, `page`, `items` e `integrity`.

- `projectSummary`: todas as versões atuais ACTIVE do projeto, sem filtros da tabela.
- `filteredSummary`: todos os cenários/endereços que correspondem ao recorte, antes do LIMIT.
- `items`: uma linha por endpoint, com método/rota, Test Design/vN, contagem correspondente, estados/origens, até cinco IDs de cenário em preview e sinalização de truncamento. O preview não altera os totais.
- `page`: limit/hasMore/nextCursor; paginação por endpoint_id ASC.
- `integrity`: quantidade de fallbacks legados e metadados desconhecidos/incompletos. Não inventa dados ausentes.
- `view=summary`: sem linhas de endpoint/cenário (`items: []`), só agregados.

O label de elegibilidade informa `INVENTORY_POLICY_NOT_RUNTIME_AUTHORIZATION`. READY não significa PASSED e essa política não substitui a autorização contextual de execução. Um endpoint pode ter simultaneamente cenários prontos e pendentes.

## 5. Origem, agrupamento e buckets

O Registry consulta roots ACTIVE e suas latest_version_id, com a projeção imutável da mesma versão. Usa funções JSON do SQLite/D1 e parâmetros vinculados, filtra por cenário, agrupa por endpoint e só então aplica a paginação. Não filtra somente os 50 itens do inventário compact e não faz fan-out de um detalhe por endpoint no Gateway.

Agregados/revisão/página são obtidos em um batch de leituras do Registry. A revisão considera **todas** as versões atuais, inclusive as sem READY. Não reaproveita inventoryFingerprint, que reflete a seleção READY. Nova versão pendente, arquivamento ou alteração de roots invalida cursor anterior.

Em projeções legadas vazias/ausentes, a consulta extrai metadados da especificação da mesma versão, sem backfill nem gravação. Projeção inválida/divergente retorna erro seguro em vez de zero pendências. Estados desconhecidos permanecem no denominador com integridade explícita.

Categorias de baseline mutuamente exclusivas:

| Bucket | Regra |
|---|---|
| READY | readiness persistido READY; cobertura real mostrada separadamente. |
| RESPONSE_PARTIAL | NEEDS_DATA, request COMPLETE, response PARTIAL. |
| REQUEST_PARTIAL | NEEDS_DATA, request PARTIAL, response COMPLETE ou NO_BODY. |
| BOTH_PARTIAL | NEEDS_DATA, request e response PARTIAL. |
| OTHER | Outras baselines NEEDS_DATA; não inferir a causa. |
| REVIEW_REQUIRED / NEEDS_AUTH / NEEDS_ENVIRONMENT | Respectivo readiness persistido. |
| UNKNOWN | Estado não reconhecido; incluído no total e sinalizado. |

NO_BODY não é parcial por si só. Self-check é apresentado por contagem real, sem deduzir PASSED de COMPLETE. Dois cenários do mesmo endpoint contam como dois cenários e um endpoint.

## 6. Indicadores e navegação

O API Catalog mantém gráficos de descoberta e acrescenta “Prontidão dos testes” / “Observed Baseline Insights”:

- Test Designs, baselines, AI_EXPLORATORY, LEGACY, total, READY, elegíveis pela política.
- Situação das baselines por cobertura, com cenários e endpoints distintos.
- Atalhos NEEDS_DATA geral, REVIEW_REQUIRED, NEEDS_AUTH, NEEDS_ENVIRONMENT e “Com pendências”.

Os números vêm do Registry, não são constantes. A UI usa **Situação atual**. Não existe nesta entrega snapshot de “Antes da ativação”; os mockups com valores antigos não foram tratados como histórico real. A data indica consulta das versões atuais, não uma janela de Results nem atualização por execução.

A região inferior possui abas Descoberta / Prontidão dos testes. Discovery preserva seus filtros e cursor; readiness usa query, DTOs e paginação próprios. Não simula combinar lifecycle/confidence com readiness filtrando uma página parcial.

Clique “Ver endpoints” em um bucket:

1. Troca para Prontidão.
2. Limpa filtros de prontidão incompatíveis e aplica o predicado completo.
3. Reinicia cursor/linhas e consulta o backend.
4. Rola/foca a região da tabela, sem abrir Top.
5. Permite “Ver cenários” (consulta sob demanda) e “Abrir Test Design” (link real, nova aba suportada).

Busca usa debounce de 300 ms. Respostas antigas são abortadas/ignoradas. Falha em “carregar mais” mantém a página já carregada. Cursor desatualizado exige “Atualizar resultados” antes de continuar; não mistura versões de leituras distintas.

Filtros de readiness são preservados na URL com `catalogView`, `testReadiness`, `testOrigin`, `baselineGap`, `readinessQ`, `readinessMethod`, `readinessService` e `baselineEnvironmentId`. `catalogQuery` mantém o retorno do detalhe. Os filtros de discovery continuam independentes.

Ao observar um job ativo chegar ao fim, o callback invalida resumo/listagem uma vez; não carrega Top e não reconsulta a cada tick. Jobs históricos já concluídos não geram invalidação repetitiva.

## 7. Detalhe seguro e versão pinada

A expansão lê somente a versão pedida e o recorte dos cenários. Retorna título sanitizado/limitado, IDs, readiness/origem, allowlist de blockers e motivos de cobertura, dados públicos de provenance e expiração separada.

Não retorna request, response, assertions com valores, massa FIXED, cookies/tokens, credenciais ou a especificação completa. Mensagens livres não reconhecidas são omitidas e sinalizadas; o painel diz “Detalhe não registrado nesta versão” quando não houver motivo codificado disponível. Não deduz redaction, profundidade ou truncamento a partir de PARTIAL.

Se a versão deixou de ser atual, o detalhe ainda pode ser lido por ID com `isLatest:false` e `latestTestDesignVersionId`. O link para o editor leva o pin. A tela do endpoint não opera silenciosamente a versão nova: mostra aviso e exige abrir explicitamente a versão atual. Se não conseguir resolver o pin, não oferece geração/execução implícita. Cenário existente na versão correspondente recebe foco/destaque; cenário ausente não foca outro arbitrariamente.

**Não foi criado um editor de versões históricas.** O diagnóstico pinado permanece no explorer; o editor existente continua sobre a versão atual, com proteção contra navegação desatualizada.

## 8. Erros e limites

| Código | Significado / resposta |
|---|---|
| TEST_READINESS_QUERY_INVALID | 400, query inválida. |
| TEST_READINESS_CURSOR_INVALID | 400, cursor de outro escopo/filtro/limite ou inválido. |
| TEST_READINESS_CURSOR_STALE | 409, conjunto atual mudou. Recarregar. |
| TEST_READINESS_VERSION_NOT_FOUND | 404, versão não pertence ao escopo/endpoint. |
| TEST_READINESS_CORRUPT_PROJECTION | Registry 500 / Gateway 502, inconsistência; não mascarar como vazio. |
| TEST_READINESS_READ_UNAVAILABLE | 503, leitura indisponível. |
| TEST_READINESS_UPSTREAM_INCOMPATIBLE | 503, Registry sem a rota nova. Conferir ordem de publicação. |
| TEST_READINESS_RESPONSE_INVALID | 502, payload/escopo/contadores fora do contrato ou acima do limite. |
| TEST_READINESS_UPSTREAM_TIMEOUT | 504, timeout incluindo leitura do body upstream. |

Client limitado a 1 MiB por response; timeout usa configuração existente TEST_REGISTRY_TIMEOUT_MS, padrão 10s e bounds 1–30s. Detalhes: 50 por página padrão, até 100; guard de artefato de detalhe em 1000 cenários (geração atual possui limite menor). Queries não logam valores de request nem textos arbitrários de erro upstream.

Cursor possui checksum e vinculação de campos; **não é uma assinatura nem uma credencial**. Escopo autenticado é conferido independentemente. Read-only responses do Gateway usam cache privado/no-store.

A leitura não torna readiness dinâmico por expiração. O detalhe pode informar `sourceExpired`, mas não reescreve a versão; runtime continua responsável por suas verificações. Nem a existência de READY nem selfCheck PASSED garante funcionamento/estado externo.

## 9. Smoke no ambiente do piloto

1. Publicar Registry, Gateway e Console; preservar flags/IDs atuais. Não regenerar só para testar a tela.
2. Abrir API Catalog com Network limpo. Top começa fechado, nenhuma request de Top `limit=8`; discovery `limit=50` é esperada.
3. Expandir: uma request. Recolher/reabrir: cache. Atualizar geral fechado: sem request de Top. Atualizar aberto: uma.
4. Conferir os contadores reais do inventário atual. A fixture de 20:40 tinha 30 Test Designs / 268 cenários / 36 baselines / 232 AI / 0 LEGACY; os números podem mudar após novas versões.
5. Clicar NEEDS_DATA — resposta parcial: na fixture, 7 cenários / 6 endpoints. GET job-titles aparece uma vez, com duas baselines.
6. Clicar request parcial: fixture 3 cenários / 3 endpoints. NEEDS_DATA geral é 36 cenários /15 endpoints, não 36 baselines.
7. Expandir um endpoint: somente agora ocorre GET .../scenarios. Conferir versão, códigos disponíveis e ausência de payloads sensíveis.
8. Abrir cenário, conferir foco; voltar deve restaurar filtros e manter Top fechado. Se houve nova geração, aviso de versão antiga é esperado.
9. Em projeto maior, carregar página seguinte. Gerar versão em outra aba antes da segunda página deve invalidar cursor; recarga começa uma leitura nova.
10. Nenhuma consulta, expansão ou filtro deve criar Run, proposal, Test Design ou gravação de artifacts.

Após esse smoke podemos voltar a tratar as pendências do gerador por categoria. READY com schema parcial, intenção negativa perdida e diagnóstico de execução continuam backlog separado; esta tela não muda esses estados automaticamente.

## 10. Validação e desempenho

Consultar `QAGENT-08.1.6-FIX-1-VALIDATION-REPORT.md` e o ZIP de logs.

- 16 novos testes Registry, 9 Gateway, 6 Console: **31/31**.
- Três cadeias cumulativas `check:08.1.6-fix1`: exit 0.
- **18/18 checkpoints** interativos de componentes reais com React instalado/Chromium, adaptadores de Next/autenticação/plataforma e HTTP local para Gateway/Registry reais sobre SQLite.
- Typecheck restrito de DTOs/estados/components com stand-ins de React/Next: passou; não substitui declarações oficiais.
- Benchmark de 2000 endpoints ×20 cenários =40000: summary ~2,49s local; filtro parcial ~2,39s; busca ~1,88s; zero writes durante leituras. Não é latência de D1 remoto nem SLA.

A paginação limita a resposta, mas os agregados ainda percorrem metadados do projeto. O benchmark confirma correção e custo local, não escalabilidade ilimitada. Para volumes maiores, medir D1 real (tempo/linhas/custo) e considerar uma projeção normalizada/indexada com migration separada. Nenhuma migration de performance foi feita às cegas.

## 11. Rollback

A UI pode voltar ao modo Discovery ou à versão anterior; as rotas novas podem permanecer sem consumidor. Nenhuma tabela foi criada e nenhum dado foi transformado por essa leitura. Não remover migrations/colunas da 08.1.6 nem rebaixar leitores de baseline para reverter apenas esta FIX.

## 12. Arquivos da implementação

### Registry

- `src/domain/testReadinessContracts.js`: query, buckets, cursor, sanitização e validação.
- `src/repository/testReadinessRepository.js`: SQL, revisão, agregados, paginação, detalhe somente leitura.
- `src/routes/testReadinessRoutes.js` e `src/index.js`: rotas privadas escopadas.
- Testes em `test/readiness-*.test.mjs`, helpers e fixture anonimizada.

### Gateway

- `src/contracts/testReadiness.js`: contrato idêntico ao Registry.
- `src/services/testReadinessClient.js`, reexports em `testRegistryClient.js`.
- `src/handlers/consoleTestReadiness.js`, wiring no router e `src/index.js`.
- `test/test-foundation-08-1-6-fix1-readiness.mjs`.

### Console

- `lib/testReadiness.ts`, contrato compartilhado e declarações.
- Disclosure de Top e alterações de apresentação em CatalogTopEndpointsChart.
- Insights, Filters, Table, Scenarios e Workspace de prontidão.
- Wiring em API Catalog; callback no ProjectTestDesignGeneration.
- Pin/foco/retorno em endpoint/page.tsx e CatalogEndpointTestDesign.
- Teste `test/test-08-1-6-fix1-readiness.mjs`.

Os três módulos JS de contrato são idênticos por hash; preservar sincronização quando alterar a versão de leitura. O manifesto inclui hashes de entrada e todos os arquivos novos/modificados, e os diffs estão no pacote de validação. Nenhum arquivo de entrada foi sobrescrito.

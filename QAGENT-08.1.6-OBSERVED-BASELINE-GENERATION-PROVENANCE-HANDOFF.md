# QAgent 08.1.6 — Observed Baseline Generation & Provenance

## 1. Estado da entrega

**Implementação entregue nos fontes; validação funcional local concluída. Build/release e smoke no ambiente do cliente ainda são gates pendentes.** Não houve deploy, chamada à aplicação do cliente, acesso a D1/KV remoto ou chamada real a provedor de IA.

A 08.1.5 permanece preservada. A 08.1.6 adiciona origem rastreável, geração determinística e políticas de comparação; não reescreve Results, Test Designs, schemas ou suites históricos. As novas colunas são aditivas. Campos de estado operacional da inbox podem mudar em resposta a uma revisão humana explícita, como previsto na FIX-2.

O Gateway é entregue com `OBSERVED_BASELINE_GENERATION_ENABLED="false"`. Isso é proposital: todos os receptores, migrations e leitores precisam estar preparados antes de ativar a geração para o primeiro projeto. O Normalizer começa a publicar o sinal aditivo quando sua nova versão é implantada.

## 2. Bases utilizadas

Os ZIPs completos mantêm os demais recursos das versões recebidas. `SOURCE-AND-CHANGE-MANIFEST.json` no pacote de validação contém os nomes e hashes dos ZIPs de entrada e a lista de arquivos alterados/criados. Gateway/Runner/Results/Console partiram da 08.1.5; Registry, Catalog, Normalizer e demais fontes partiram dos ZIPs mais recentes enviados nesta conversa. Evolution partiu da última versão disponível: 08.1.3-C FIX-4. Mudanças locais posteriores devem ser reconciliadas antes de aplicar estes arquivos.

**Serviços alterados:** Normalizer, Catalog, Gateway, Test Registry, Runner, Test Results, Test Evolution, Console.

**Sem alteração:** Plugin e Observation. Os componentes de captura/sanitização desses dois serviços foram usados nos testes locais, mas seus ZIPs não precisam ser substituídos para esta entrega.

## 3. Fluxo implementado

```text
Plugin / Observation existentes
  -> Normalizer: inferência v2 + captura segura correlacionada + autoconsistência
  -> Catalog: fonte durável, deduplicada por família e com retenção explícita
  -> Gateway: baselines obrigatórias + cenários exploratórios da IA
  -> Registry: versões imutáveis / origem no inventário e no snapshot da suite
  -> Gateway: resolve a fonte EXATA / verifica ambiente, hash, prazo e overrides
  -> Runner: executa request congelada / valida contrato e política aprovados
  -> Results: persiste provenance e comparação de perfil no resultado imutável
  -> Console: origem / cobertura / diferenças / revisão humana de fonte e política
  -> Evolution: protege baseline; exploração continua com política anterior
```

Uma origem incompleta não é substituída por request aleatória ou por outro sample do reservatório. O caso continua visível com necessidade de dados/contexto; não é promovido a uma regressão pronta.

## 4. Contratos novos e compatibilidade

| Contrato | Finalidade |
|---|---|
| `qagent.structural-inference.v2` | Inferência que distingue tipos, presença observada e cobertura parcial. |
| `qagent.observed-baseline-capture.v1` | Request segura correlacionada + identidade/cobertura da observação; sem valores de resposta. |
| `qagent.observed-baseline-source.v1` | Provenance pública e referência à fonte exata. |
| `qagent.observed-comparison.v1` | Política `STRUCTURE` ou `CONTROLLED_STATE`. |
| `qagent.execution-result-ingest.v1.3` | Extensão aditiva de scenario results com origem/baseline/comparação. |

O envelope Catalog continua `qagent.catalog-update.v1`, com sinal `observedBaseline` opcional validado. Mensagens antigas são aceitas e permanecem legadas. Results aceita as versões antigas de ingestão; dados 08.1.6 não são aceitos silenciosamente sob o envelope 1.2. O Runner usa 1.3 quando existe a nova classificação de origem; casos legados conservam o formato antigo.

A provenance pública contém IDs da origem, escopo, método/rota/origin, status/content-type, versão/hash exatos do schema, fingerprint da request capturada, versão de inferência, cobertura, perfil das listas, política e expiração. **Não contém request/body de resposta bruto ou credenciais.**

Os módulos `src/baselineContract.js` de Gateway/Registry/Runner/Results/Evolution são cópias idênticas por serviço para manter os repositórios implantáveis separadamente. O manifesto registra seus hashes; mantenha-os sincronizados ao alterar esse contrato.

## 5. Fidelidade da inferência e das assertions

### Inferência

- Primitivas continuam tipadas: integer/number/boolean/null/string. Strings com zeros à esquerda não são convertidas globalmente.
- Redaction e truncamento produzem cobertura parcial/unknown, não um falso tipo `string` nem propriedade de negócio `_qagent`.
- Limites de profundidade/amostragem/propriedades são identificados explicitamente. Não foram removidos os limites de captura.
- Formato `date` exige uma data de calendário compatível com a regra executada, não somente aparência por regex.
- `x-qagent-observed-required` descreve a presença observada; para itens de arrays, é a interseção das amostras examinadas.
- `authObserved` desconhecido gera `AUTH_CONTEXT_UNAVAILABLE` e impede READY da baseline.

### Execução

O validador não acusa `unknown != integer` como defeito funcional. Schemas parciais/desconhecidos tornam a assertion não avaliável, com `ASSERTION_SCHEMA_EVIDENCE_INCOMPLETE`, em vez de falso verde ou falso bug.

Nas baselines, campos selecionados em `x-qagent-observed-required` são protegidos. Código de ausência: `SCHEMA_OBSERVED_PROPERTY_MISSING`. A semântica histórica de schemas sem política de baseline não ganha required de forma retroativa.

O comparador 08.1.5 reconhece os diagnósticos adicionais e mantém os avisos de evidência histórica parcial. Resultados antigos não recebem tipos recebidos inventados.

## 6. Fonte durável no Catalog

Nova tabela: `catalog_observed_baselines`. O materializador atua quando evento, schemas e captura ainda estão correlacionados. Guarda a request segura selecionada em coluna própria e metadata em `document_json`, sem depender da retenção/pruning do reservatório agregado.

A consolidação de schemas pode limpar o JSON transitório. O materializador de baseline recupera **a versão exata persistida**, verificando versão/hash/escopo/direção/status. A confirmação da baseline e a limpeza do sinal transitório são feitas em batch atômico. Redelivery não duplica a fonte.

Família considera endpoint/ambiente, status, schemas, chaves de query, perfil de listas e cobertura. Não cria teste para cada chamada ou cada valor volátil. Uma lista preenchida e uma vazia podem coexistir. Não é uma garantia de cobertura de toda combinação funcional que compartilhe estrutura.

Leituras autenticadas existentes do Catalog recebem rotas novas:

```http
GET /v1/catalog/endpoints/:endpointId/observed-baselines
GET /v1/catalog/endpoints/:endpointId/observed-baselines/:baselineId
```

Usam o HMAC/escopo existentes. A listagem é metadata-only. A leitura exata, interna e assinada usada pelo runtime, inclui request segura apenas enquanto disponível. Não exponha essa leitura por uma rota Console não autenticada.

As rotas retornam JSON diretamente, sem aplicar snake_case -> camelCase recursivamente dentro da request de negócio. Nomes de parâmetros/campos são preservados.

### Limites e retenção

| Limite | Valor inicial |
|---|---|
| Retenção da request reutilizável da fonte | 30 dias a partir de observedAt; leitura não renova. |
| Famílias ativas por endpoint/ambiente | 8, com no máximo 2 fontes incompletas para não consumir todo o orçamento. |
| Fontes retornadas por listagem | 32, com `itemsTruncated` quando necessário. |
| Baselines selecionadas pelo gerador | Até 12 por pack; preserva as já protegidas, ou bloqueia se exceder o limite total. |
| Total de cenários do pack | 20. |
| Request segura | Até 16 KiB, 512 nós, profundidade 8, arrays de até 20 elementos, strings até 256 bytes. |
| Perfil de listas | Até 32 caminhos; presença/estado, sem conteúdo dos elementos. |

O orçamento omitido aparece em diagnósticos; não se promete cobertura de todas as observações. O sweep de recuperação/expiração é limitado e usa o agendamento já existente do Catalog. A indisponibilidade por expiração é imediata na leitura, mesmo antes da purga física em lote. Fontes expiradas mantêm metadata para auditoria, mas `request_json` é apagado pelo sweep.

**Importante:** esse TTL é da fonte reutilizável no Catalog. Não foi implementada uma política global de exclusão de cópias em Execution Plans antigos; eles seguem a retenção existente do Gateway. Exclusão autorizada/privacidade deve considerar também esses registros. Não interprete 30 dias como promessa de eliminação global de todos os dados do sistema.

## 7. Dados suportados e limitações explícitas

A baseline usa a amostra segura da mesma transação. QUERY conserva representação lexical (por exemplo `1.00`) quando disponível. PATH_PARAM precisa de correspondência segura ao placeholder; repetições ambíguas bloqueiam. Body JSON suporta objetos, arrays, tipos escalares e null dentro dos limites. Form-urlencoded tem suporte limitado a amostra segura até 256 caracteres.

Query repetida não preservada pela captura atual, body ausente/suprimido/truncado, campos proibidos ou body incompatível com método seguro geram PARTIAL. Não há fallback aleatório. Corpos binários/multipart e replay geral de todo protocolo HTTP não fazem parte desta entrega.

Headers de negócio não capturados dependem da configuração do serviço. O fingerprint é `CANONICAL_CAPTURED_REQUEST_DATA`, **não o hash dos bytes exatos de toda a request HTTP**. Credenciais permanecem no Auth Runtime/Vault. Origem/ambiente e resolução de autenticação são conferidos; mudar identidade/estado de negócio fora desses controles ainda pode alterar a resposta legitimamente.

Configurações `USER_DEFINED`/legadas de massa não são sobrescritas. Conflito com valores necessários à baseline bloqueia com diagnóstico; um FIXED equivalente não é alterado.

## 8. Geração e preservação

Flag do Gateway:

```json
{
  "OBSERVED_BASELINE_GENERATION_ENABLED": "false",
  "OBSERVED_BASELINE_PROJECT_IDS": ""
}
```

`true` habilita; CSV de projetos restringe o piloto. CSV vazio com a flag true permite todos os projetos: preencha o projeto de piloto antes de habilitar. A revisão humana também respeita esse gate.

Com o recurso habilitado, o sistema cria baselines antes de juntar a saída da IA. A IA não recebe os valores seguros armazenados na fonte e não escolhe/edita sua proveniência. Mesmo uma saída somente negativa mantém o sucesso observado. Se o provedor falhar e existir baseline disponível, o pack pode ser `OBSERVED_ONLY`, com erro de exploração identificado, sem perder a proteção.

Classificações:
- `OBSERVED_BASELINE`: contrato e request fundamentados em fonte selecionada.
- `AI_EXPLORATORY`: hipótese/variação adicional; não substitui a baseline.
- ausência do campo: legado; a UI não inventa uma origem retroativa.

Referências de baseline são VERSION + HASH. O Catalog busca versões explicitamente solicitadas fora da janela das 50 mais novas. O Gateway não usa `versions[0]` como substituto de uma versão faltante. Uma referência não encontrada é erro explícito. TRACK legado continua representando a semântica antiga de ponteiro corrente; a geração de baselines não usa TRACK para o contrato protegido.

Regeneração preserva fonte, política e identidade operacional dos casos já protegidos, inclusive após uma revisão humana. Registry impede descarte/enfraquecimento silencioso e verifica o parent da revisão no append otimista.

## 9. Políticas de comparação

### STRUCTURE — padrão

Protege status observado, content type quando conhecido, versão exata do schema, presença e tipos sustentados pela fonte. Se a lista passa de preenchida a vazia, a comparação de perfil mostra `CHANGED_PROFILE`, mas não inventa uma falha de cardinalidade.

### CONTROLLED_STATE — consentimento explícito

Na Console, confirmar que massa, filtros e estado serão mantidos. A confirmação é enviada ao Gateway, que registra o ator autenticado e o ambiente. Além da estrutura, protege os estados EMPTY/NON_EMPTY observados nos caminhos de listas; código de falha `SCHEMA_OBSERVED_ARRAY_STATE_MISMATCH`.

**Limite importante:** isso não verifica automaticamente a identidade de uma solicitação/funcionário específico, não compara todos os valores e não cria fixtures externas. A confirmação declara uma precondição; não comprova que o banco da aplicação foi restaurado. Um teste de identidade/valor de negócio específico continua exigindo assertion e contexto apropriados. O painel explica esse limite. A 08.1.6 não é replay universal byte-a-byte nem uma comprovação de que o comportamento observado esteja correto do ponto de vista do negócio.

## 10. Runtime, suite e Results

Registry persiste origem na versão imutável, inventário e snapshot da suite. Contagens por origem usam todo o inventário, não apenas a página compacta exibida.

Gateway recupera a fonte exata pelo ID, verifica escopo/ambiente/origin, disponibilidade/prazo, fingerprint da request e hash do schema. Dados são congelados no Execution Plan. Não são resolvidos em outro sample do endpoint. Runner repete verificações de consistência e expiração antes da execução.

Suite mantém baselines de outros ambientes/expiradas como unidades retidas por política, com contagens e motivos. Elas não são despachadas. Casos elegíveis do ambiente e exploração continuam executando. A decisão do snapshot usa createdAt imutável para consistência de retry; o runtime verifica a expiração real de novo.

Results recebe provenance validada, incluindo environment/endpoint/método/path/origin e comparação de perfil sem valores. Novas colunas conservam os dados no detalhe e no histórico de cenário. O resultado não é recalculado na leitura. A classificação da comparação de perfil não substitui o verdict das assertions.

## 11. Evolution e revisão humana de baseline

A inspeção da Evolution usa o Test Design autoritativo para detectar baseline. Retorna `OBSERVED_BASELINE_PASSED` ou `OBSERVED_BASELINE_PROTECTED`; não propõe aceitar 422 no lugar do sucesso ou trocar schema/massa automaticamente. Guards de aplicação/Registry/Human Request Repair também impedem um atalho para enfraquecer a baseline.

Os negativos exploratórios seguem o fluxo existente, inclusive aprendizagem de 400/422 quando sustentada pela mesma intenção. As autorizações de mutação e limites de execução não foram ampliados.

### Operação humana implementada

Na seção Test Design do endpoint: **Revisar origem / política**. Consulta as fontes metadata-only do mesmo escopo, compara versão/hash/fingerprint/perfil/retenção, exige motivo e confirmação. Permite aprovar uma nova captura ou mudar STRUCTURE -> CONTROLLED_STATE em outra versão.

Usa o POST de geração existente com opções restritas:

```json
{
  "baselineOptions": {
    "mode": "STRUCTURE",
    "replace": {
      "scenarioId": "baseline_...",
      "newBaselineId": "obl_...",
      "sourceTestDesignVersionId": "tdv_atual",
      "confirm": true,
      "reasonCode": "APPROVED_PRODUCT_CHANGE"
    }
  }
}
```

Outros motivos: RECAPTURE_SOURCE, CORRECT_GENERATION, COMPARISON_POLICY_REVIEW. CONTROLLED_STATE também exige `confirmControlledContext:true`. O usuário não pode enviar um ator arbitrário: o Gateway usa a identidade autenticada.

Cria vN+1 com source/política aprovada, parent, ator/data/motivo. Preserva o scenarioId operacional, os outros casos e os Results antigos. Registry verifica a versão parent de novo para impedir race; atualizar a página é necessário em conflito.

**Salvar revisão não executa.** Atualize/materialize o snapshot da suite antes de reexecutar. Quando existe pendência correspondente, a projeção de Attention passa para PENDING_VERIFICATION com pin da nova versão, sem fabricar Human Repair/proposal. O evento de auditoria é idempotente. Se Registry já salvou e D1 da inbox falhar, a resposta continua indicando o salvamento e traz `attentionProjection:DEFERRED`; a Console avisa que a fila ficou pendente de reconciliação. Não existe transação distribuída Registry + Gateway.

## 12. Migrações e ativação

| Serviço | Migration NOVA | Binding no repositório |
|---|---|---|
| Catalog | `0018_observed_baseline_sources.sql` | CATALOG_DB |
| Test Registry | `0006_foundation_08_1_6_baseline_provenance.sql` | TEST_REGISTRY_DB |
| Test Results | `0005_foundation_08_1_6_baseline_provenance.sql` | RESULTS_DB |

**Nenhuma migration nova no Gateway, Normalizer, Runner ou Evolution.** No Gateway, migrations da 08.1.4/FIX-2 e estrutura anterior continuam necessárias.

Primeiro execute checks/builds no seu ambiente e confira os diffs/configurações/secrets. Depois, dentro de CADA repositório indicado, confira o destino e liste as pendentes:

```bash
# Catalog
npx wrangler d1 migrations list CATALOG_DB --remote
# Após conferir o banco e as migrations:
npx wrangler d1 migrations apply CATALOG_DB --remote

# Test Registry
npx wrangler d1 migrations list TEST_REGISTRY_DB --remote
npx wrangler d1 migrations apply TEST_REGISTRY_DB --remote

# Test Results
npx wrangler d1 migrations list RESULTS_DB --remote
npx wrangler d1 migrations apply RESULTS_DB --remote
```

O comando aplica todas as migrations pendentes do diretório, não apenas a 08.1.6. A opção --remote opera no destino remoto configurado. Os nomes de banco recebidos incluem `qagent-catalog-dev` e `qagent-test-registry-dev`; não deduza que sejam descartáveis pelo nome. Confirme conta/binding/ambiente no seu processo de publicação. Não foi executado nenhum comando remoto nesta entrega.

Referência de sintaxe consultada: Cloudflare, `https://developers.cloudflare.com/workers/wrangler/commands/d1/` (10/09/2026).

### Ordem de rollout recomendada para estes fontes

1. Resolver gates de release pendentes, verificar configurações e aplicar migrations nos três receptores.
2. Publicar Test Results, Test Registry e Catalog.
3. Publicar Gateway com geração desligada; publicar Runner, Test Evolution e Console compatíveis.
4. Publicar Normalizer 08.1.6. Plugin/Observation permanecem os atuais. Confirmar o sinal novo chegando ao Catalog.
5. Ativar no Gateway `OBSERVED_BASELINE_GENERATION_ENABLED="true"` com `OBSERVED_BASELINE_PROJECT_IDS="ID_DO_PROJETO_PILOTO"`.
6. Fazer novo monitoramento de um fluxo controlado; gerar Test Design; preparar snapshot novo; executar smoke abaixo.

A ordem específica dentro de 2/3 pode variar, mas os receptores precisam aceitar os contratos antes de os emissores começarem a utilizá-los. **Não publique o Normalizer primeiro contra um Catalog antigo.** Results 1.3 precisa estar pronto antes de Runner produzir resultados 08.1.6.

## 13. Smoke de aceite no ambiente

- Monitorar sucesso JSON com inteiros/booleanos/null, query válida, lista preenchida; gerar mesmo quando a IA retorna só negativos. Baseline deve existir, READY quando contexto/massa completos.
- Abrir o caso e conferir evento/sessão/ambiente/versão/hash/política/expiry; fonte segura não deve aparecer enviada ao provedor IA.
- Executar nas mesmas condições: request usa a massa correlacionada, sem randomizar limit ou trocar filtros.
- Alterar deliberadamente o tipo de um campo protegido: assertion falha com caminho e tipos; Comparison 08.1.5 destaca a regra.
- Remover campo de envelope protegido: SCHEMA_OBSERVED_PROPERTY_MISSING, não falso verde.
- Observar lista vazia depois: a primeira baseline não desaparece nem acompanha o current do Catalog. STRUCTURE mostra diferença de perfil; CONTROLLED_STATE explicitamente aprovado falha para mudança de EMPTY/NON_EMPTY.
- Testar 204 legítimo: não exige schema/body fictício.
- Testar origem parcial/expirada e outro ambiente: visível/bloqueada, sem execução silenciosa e sem massa sintética substituta.
- Aprovar nova fonte/política: nova versão, mesmo scenarioId, outros casos preservados; PENDING_VERIFICATION quando havia atenção; nenhuma execução iniciada pelo Save; novo snapshot necessário.
- Confirmar que negativos exploratórios continuam separados e que auth/mutação/tenants mantêm seus guardrails.

Esse smoke não foi executado em produção; é o próximo gate necessário antes de declarar a 08.1.6 fechada no ambiente real.

## 14. Validação realmente executada

- **35/35 testes de integração e operação locais**: atravessam amostragem/ingestão, fila simulada do Normalizer, Catalog real sobre SQLite, geração com IA controlada, Registry, snapshot, materialização, Runner, Results e política Evolution. Incluem referência histórica fora de 50 versões, tipos/ausência/listas, redaction/profundidade, auth desconhecida, validade da origem, scope/TTL/overrides, revisão humana/version race, Attention e motivos de retenção na suite.
- **31/31 testes novos por serviço**, independentes da cadeia antiga: Gateway 5, Runner 5, Registry 4, Results 4, Evolution 4, Console 3, Normalizer 4, Catalog 2. Parte repete guards em repositórios independentes; não são 31 defeitos distintos corrigidos.
- `npm run check:08.1.6` passou em Gateway, Results, Registry, Evolution e Console. A cadeia Console aqui é de scripts, NÃO Next build. Registry incluiu seus 56 testes existentes; Evolution incluiu seus 43 existentes.
- A bateria ampliada executou **153 scripts individuais**, com 147 aprovados. As seis falhas também ocorreram nos fontes originais: uma do Runner, cinco verificações estáticas antigas da Console. Logs comparativos incluídos. Não foram enfraquecidas assertions para encobrir essas falhas.
- O Runner mantém `RUNNER_MUTATION_EXECUTION_ENABLED=true`, como no ZIP recebido; um teste legado espera false. A cadeia cumulativa para ali. Os demais scripts foram executados individualmente e os testes novos passaram. A decisão de configuração/teste deve ser reconciliada no gate de release; esta entrega não desliga/relaxa a política para obter verde.
- Fixtures SQLite funcionais de Registry/Results foram atualizadas para aplicar as migrations novas antes de chamar os repositórios. Testes dedicados a migrations históricas mantiveram a intenção e verificações de backfill.
- Typecheck direto do Normalizer passou com TypeScript global 5.8.3. Catalog passou com um shim local de tipos de runtime; componentes novos passaram em checagem restrita com stand-ins de React/Next. Esses shims estão apenas na validação e não substituem as dependências/typegen oficiais.
- **Limites de release:** `npm ci` da Console falhou com `EAI_AGAIN` no registry npm. Não houve `next build` bem-sucedido nem hidratação/browser real da aplicação. Normalizer/Catalog não puderam executar a cadeia oficial Wrangler/Vitest (`wrangler: not found`). Não se declara aprovação desses gates.
- Nenhuma API do cliente, provedor de IA, banco remoto ou deployment foi executado. O transporte da fila/HTTP é simulado e SQLite não é emulador Cloudflare. O índice dos logs e JSON de resultados informa cada comando/exit.

### Comandos no ambiente de release

```bash
npm ci
npm run test:f08-1-6
npm run check:08.1.6
```

Na Console, também `npm run build`. Em Catalog/Normalizer, `npm run check:08.1.6` executa typegen/typecheck/Vitest existentes antes dos testes novos. Não contorne o teste de configuração do Runner sem reconciliar a intenção da política.

## 15. Rollback e limitações remanescentes

Desligar a flag interrompe novas gerações/revisões de baseline, mas NÃO transforma baselines existentes em exploração nem remove os guards do runtime. Conservar os serviços capazes de ler os novos contratos enquanto houver Test Designs/Plans/Results 08.1.6.

Não remover as colunas/tabelas ou publicar leitores antigos contra dados novos sem plano de compatibilidade. As migrations são aditivas; não há down migration automática nem alteração retroativa de esquemas antigos nesta entrega.

Não converter automaticamente testes antigos em baseline por mera semelhança de endpoint. Remonitore, selecione fonte verificável e gere uma nova versão. Não ampliar expectativa de sucesso para 4xx nem converter strings numéricas em massa para esconder diagnóstico legado.

Ainda fora da promessa desta entrega: replay byte-a-byte completo, fixture/reset universal de aplicações, comparação de identidade de todo objeto de negócio, semântica de valores voláteis, limpeza global distribuída de dados, calibração autônoma ampla de negativos e garantia de zero falsos positivos em produção. O núcleo entregue evita substituições silenciosas e deixa limites de evidência visíveis; validação no domínio real continua necessária.

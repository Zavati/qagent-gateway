# UI-TD-3 — plano observado por referências

Novos lotes usam `qagent_ui_test_design_compiler_v2`, `qagent.ui-test-design-compilation.v2` e `qagent.ui-test-design.v2`. O perfil v2 tem `coveragePolicy: ALL_OBSERVED`; não recebe cotas globais de checks, nós ou bytes observados. A evidência permanece no bundle imutável, identificado por escopo, captura, versão, source hash e manifest hash. O contrato do plano usa regras finitas, versionadas, e seleção integral das seções.

O limite de transporte continua protegendo cada resposta/registro. Ele limita o pequeno contrato por referências; a quantidade total de evidência não é copiada para esse contrato. A leitura detalhada avança por páginas e não produz truncamento global da observação.

## Compatibilidade

Versões e jobs v1 continuam aceitos explicitamente. O compilador e o perfil salvos em cada job são usados no callback e nas tentativas subsequentes. Não se reescrevem candidatos, versões ou resultados históricos. Repetir uma operação com parâmetros diferentes permanece conflito; para gerar um plano v2 a partir de uma fonte antiga, criar uma nova operação. Publicações repetidas reconciliam os mesmos bytes/hash e não criam versões duplicadas.

## Cobertura e resultados

`validationUnitsPlanned` indica unidades de evidência incluídas no plano, não assertions já executadas. `validationUnitsExecuted` e `checksGenerated` são zero neste contrato de referências. Checkpoints instáveis, fixtures indisponíveis e comparadores pendentes não são removidos nem promovidos a PASS. O plano exige percorrer todas as seções e o conteúdo de todos os artefatos; pendências impedem uma conclusão integral de sucesso.

A integridade dos artefatos declarada no plano corresponde à verificação realizada na montagem do bundle. A compilação v2 verifica o manifesto e a origem; os blobs não são todos baixados novamente. A leitura do conteúdo de um artefato revalida seus bytes e SHA256. Nenhum desses serviços executa o Browser Runner ou chama IA para gerar o plano.

## Implantação

Não há nova migration, secret ou binding para este incremento. Atualizar os consumidores e qagent-ui antes de habilitar o novo default no Gateway. Manter as configurações Wrangler e os segredos já utilizados no ambiente. O Console anterior deve ser atualizado para apresentar o novo contrato; versões v1 permanecem legíveis.

## Gateway

`GET /v1/console/projects/:projectId/environments/:environmentId/ui-test-design/designs/:versionId/evidence` aceita `section`, `cursor`, `limit` (1–50) e `artifactId` apenas para `ARTIFACT_CONTENT`. As seções são ACTIONS, CHECKPOINTS, INTERACTIONS, FIXTURES, DOCUMENTS, RESOURCES, STATE_RESOURCES, ARTIFACTS, SOURCE_METADATA e ARTIFACT_CONTENT.

O servidor busca a versão exata no Registry, valida contrato/hash/escopo e revalida a fonte. Ele envia somente a specification persistida a `POST /internal/ui/v1/test-design/plan-page`, assinada pelo principal existente `test-design`. O navegador não fornece uma specification alternativa. A resposta deve corresponder ao mesmo source/hash, seção e artefato.

O deadline do fix1 continua cobrindo cabeçalhos e corpo das respostas.

Verificação: `npm run test:ui-td3` e `npm run test:router`.

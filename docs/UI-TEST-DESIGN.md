# Gateway 1.1.0 — Test Design UI observado

O Console usa `GET/POST /v1/console/projects/:projectId/environments/:environmentId/ui-test-design/...`.
Recursos: `sources`, `jobs`, `jobs/:jobId`, `jobs/:jobId/items`,
`jobs/:jobId/cancel`, `designs` e `designs/:versionId`.

O tenant vem da sessão; projeto e ambiente passam pela validação existente. Viewer só
consulta. Operações de escrita exigem owner/admin/member. IDs seguem o contrato UI
(3–180 caracteres). A geração admite 1–50 versões de bundle explícitas. O Gateway
rejeita duplicatas; `operationId` estável permite recuperar um pedido sem duplicar lote.

O Orchestrator chama os callbacks assinados `POST /internal/v1/ui-test-design/compile`
e `.../publish`. A compilação e a publicação são separadas. Não há chamada de IA nem
dependência de configuração de provedor no caminho UI.

## Configuração adicional

No `wrangler.jsonc` já existente, acrescentar ao array `services`:

```json
{ "binding": "UI_SERVICE", "service": "qagent-ui" }
```

Preservar os bindings existentes `TEST_REGISTRY_SERVICE` e
`TEST_GENERATION_ORCHESTRATOR_SERVICE`. Caso haja ambientes nomeados, acrescentar o
binding no ambiente de implantação apropriado.

Configurar `UI_TEST_DESIGN_SECRET` com o mesmo valor no Gateway e no qagent-ui. Essa
credencial usa o principal dedicado `test-design`; não reutilizar o segredo de operador.
Registry/Orchestrator usam `TEST_GENERATION_INTERNAL_HMAC_SECRET`, já existente no
fluxo de geração. O mesmo valor precisa estar no novo leitor/escritor UI do Registry.

A publicação e a leitura exata verificam acesso atual à fonte, escopo, captura,
sourceHash e manifestHash. Uma versão persistida não concede leitura de uma fonte
revogada. O receipt precisa coincidir com versão solicitada, domínio e hash do conteúdo.
Listas validam metadados e escopo sem carregar specification inteira.

O corpo de compilação canônico tem teto de 768 KiB; transporte limitado a 1 MiB. As
respostas novas são JSON compacto para respeitar esse orçamento. Os contratos e o
formato das respostas API anteriores são mantidos.

## Verificação

`npm run test:ui-test-design`: 14 testes de roteamento, sessão/escopo, roles, bounds,
HMAC, hashes, receipts, paginação, revogação e erros limitados. Router legado e testes
selecionados de recuperação API passaram. A raiz do release inclui integração real
entre Gateway/UI/Orchestrator/Registry, com infraestrutura local controlada.

Não há migration nova no Gateway. Nenhum secret ou deploy remoto foi executado.

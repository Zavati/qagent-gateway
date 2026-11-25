# UI-EXEC-1 — execução de UI em lotes

> Documento histórico da UI-EXEC-1. Para a implantação atual do Gateway 1.4.0, a automação conjunta e o runner hospedado, use [UI-EXEC-2](UI-EXEC-2.md).

Gateway **1.3.0**. A aba Automação e o CI usam o mesmo controle de execução UI. O serviço `qagent-ui-runner` executa o navegador; o Gateway admite as versões, entrega evidências autorizadas, controla a posse dos itens e publica resultados. Os endpoints e as filas de execução de API permanecem independentes.

## Configuração e implantação

1. Aplicar `migrations/0022_ui_execution_control_plane.sql` no `QAGENT_DB` do Gateway, usando o procedimento de migrations já utilizado pelo projeto. A migration é aditiva e pode ser aplicada novamente.
2. Criar um bucket R2 privado para resultados UI e adicionar o binding **`UI_EXECUTION_RESULTS`**. O `wrangler.jsonc` contém `qagent-ui-execution-results-dev` como nome de referência: ajuste para o ambiente efetivo. A implantação não cria o bucket automaticamente.
3. Configurar **`UI_EXECUTION_SECRET`**, com o mesmo valor de 32 a 512 caracteres, no Gateway e no `qagent-ui`. Este segredo é exclusivo do principal interno `execution` e não deve ser fornecido ao Runner. Manter os segredos existentes de Test Design e Registry.
4. Configurar **`UI_EXECUTION_PROFILES_JSON`** e **`UI_EXECUTION_TOKENS_JSON`** nos ambientes efetivamente publicados. Os exemplos abaixo são modelos sem credenciais utilizáveis.
5. Publicar o Gateway e o `qagent-ui` compatível. Configurar o novo Runner com sua credencial de máquina e a preparação local do ambiente. A Console pode consultar os perfis e criar o lote antes de um Runner estar conectado; os itens ficam na fila durável D1.

Exemplo de perfil:

```json
[
  {
    "profileId": "profile_stg_chromium",
    "name": "STG · Chromium",
    "scope": {
      "organizationId": "org_EXEMPLO",
      "projectId": "prj_EXEMPLO",
      "environmentId": "env_EXEMPLO"
    },
    "targetBaseUrl": "https://stg.example.test/",
    "allowedOrigins": ["https://stg.example.test", "https://api.stg.example.test"],
    "originMap": {
      "https://observed.example.test": "https://stg.example.test"
    },
    "preparationKey": "prepare_stg",
    "viewport": { "width": 1440, "height": 900 },
    "deviceScaleFactor": 1,
    "locale": "pt-BR",
    "timezoneId": "America/Sao_Paulo",
    "stepTimeoutMs": 7000,
    "modeTimeoutMs": 600000
  }
]
```

As origens são valores HTTP(S) exatos, sem credenciais, caminhos ou curingas. O destino de cada `originMap` precisa estar em `allowedOrigins`. O perfil controla os destinos aceitos; a configuração de preparação no Runner contém autenticação, dados iniciais e restauração necessários a cada modo. `targetBuildRef` é informado ao criar o lote e preservado junto ao perfil; a preparação do Runner é responsável por verificar o build no destino.

Exemplo de configuração de credencial:

```json
[
  {
    "tokenSha256": "SUBSTITUIR_PELO_SHA256_HEXADECIMAL_DO_BEARER_TOKEN",
    "organizationId": "org_EXEMPLO",
    "projectId": "prj_EXEMPLO",
    "environmentId": "env_EXEMPLO",
    "permissions": ["read", "create", "execute"]
  }
]
```

O Runner recebe o token original, com 32–512 caracteres alfanuméricos ou `._~-`. O Gateway armazena somente seu SHA-256 na configuração. Cada token corresponde a um único escopo. Uma credencial `read` pode consultar resultados; `create` admite/cancela lotes; `execute` permite claim, heartbeat, fontes, upload de evidência e publicação de resultado. O CI habitual precisa das três permissões. Retirar um hash da configuração revoga a credencial nas próximas requisições; não é necessário reiniciar ou alterar versões salvas no Registry.

Uma forma de fornecer os valores, sem problemas de aspas no Git Bash, é usar o prompt interativo de `npx wrangler secret put NOME_DA_VARIAVEL` e colar o valor completo. Para o perfil, também pode ser usada uma variável normal do Worker. Não incluir tokens originais ou segredos em ZIPs, commits ou comandos de exemplo compartilhados.

## Contrato HTTP

Bases:

- Console: `/v1/console/projects/:projectId/environments/:environmentId/ui-executions`
- CI/Runner: `/v1/automation/projects/:projectId/environments/:environmentId/ui-executions`

Respostas usuais: `{ "status": "ok", "data": ... }`. Erros: `{ "status": "error", "code": "...", "message": "..." }`. A Console usa sua sessão existente; a superfície de máquina usa `Authorization: Bearer ...`. As operações sempre conferem organização, projeto e ambiente, além do estado ativo da organização e da propriedade do ambiente.

| Operação | Rota relativa | Uso |
| --- | --- | --- |
| GET | `/profiles` | Perfis configurados para o escopo. |
| GET | `/inventory` | Todas as páginas do Registry, última versão de cada design, diagnóstico de legados. `inventoryComplete:true` somente depois da travessia completa. |
| POST | `/batches` | Admissão das versões exatas; retorna 202 com lote durável. |
| GET | `/batches?limit=20&cursor=...` | Histórico paginado e gate calculado. |
| GET | `/batches/:batchId` | Itens, resultados e pendências. |
| POST | `/batches/:batchId/cancel` | Cancela itens na fila e sinaliza os que estão em execução. |
| POST | `/batches/:batchId/claim` | Somente máquina; `{workerId}`. Entrega uma observação, com Replay + Live no mesmo claim. |
| POST | `/batches/:batchId/items/:itemId/heartbeat` | Somente máquina; `{claimToken}`. |
| POST | `/batches/:batchId/items/:itemId/source` | Plano admitido e fonte completa, autorizada novamente pelo `qagent-ui`. |
| POST | `/batches/:batchId/items/:itemId/artifacts/:artifactId` | Bytes verificados pelo `qagent-ui`; exige `{claimToken}` e declaração no bundle. |
| POST | `/batches/:batchId/items/:itemId/evidence/:evidenceId` | Bytes de evidência; headers `X-QAgent-Claim-Token`, `X-QAgent-SHA256`, `Content-Type`. |
| GET | `/batches/:batchId/items/:itemId/evidence/:evidenceId` | Download autenticado, no mesmo escopo. |
| POST | `/batches/:batchId/items/:itemId/result` | `{claimToken,result}`; publicação idempotente de resultado do par. |
| GET | `/batches/:batchId/report?format=json` | Documento JSON do lote, com referências e rotas autenticadas das páginas. |
| GET | `/batches/:batchId/report?format=junit` | JUnit XML para CI; pendências viram erros, nunca sucesso vazio. |

Os downloads de relatório e artefato devolvem o conteúdo diretamente, sem envelope JSON.

Exemplo de admissão:

```json
{
  "operationId": "uiexop_IDENTIFICADOR_UNICO",
  "testDesignVersionIds": ["uitdv_VERSAO_IMUTAVEL_A", "uitdv_VERSAO_IMUTAVEL_B"],
  "profileId": "profile_stg_chromium",
  "targetBuildRef": "commit:IDENTIDADE_DO_BUILD",
  "trigger": {
    "kind": "CI",
    "provider": "github-actions",
    "commitSha": "IDENTIDADE_DO_COMMIT",
    "branch": "main",
    "pipelineRunId": "IDENTIDADE_DO_PIPELINE"
  }
}
```

`operationId`, IDs de worker/evidência e outros IDs aceitam letras, números, `_` e `-`, de 3 a 180 caracteres. Uma nova intenção de executar usa outro `operationId`. Repetir exatamente a mesma requisição recupera o lote existente, inclusive após perda do ACK; alterar seu conteúdo com o mesmo `operationId` resulta em 409. A ordem selecionada também faz parte da identidade do pedido.

## Admissão e imutabilidade

A admissão lê as versões compactas do Registry, com quatro chamadas em paralelo, e revalida hash, escopo e acesso à fonte. Somente planos `qagent.ui-test-design.v2` entram na execução. O perfil, o build solicitado, os IDs selecionados e as compilações ficam imutáveis no R2. Uma transação D1 publica o lote e todos os seus itens, ou nenhum deles. O HTTP de admissão termina depois dessas leituras/gravadas de controle; não aguarda abertura de navegador ou execução de passos.

As chamadas ao Registry reutilizam o transporte e o HMAC existentes. O proxy de execução usa `UI_EXECUTION_SECRET`, principal `execution`, e o corpo exato `{scope,source,specification,specificationHash,artifactId?}`. O cliente fornece somente um claim e, quando pertinente, um ID de artefato: não pode substituir o plano, hashes ou URLs da fonte. A fonte é reautorizada no `qagent-ui` a cada leitura; o claim e o cancelamento são conferidos novamente após a resposta do upstream.

## Fila, cancelamento e recuperação

`ui_execution_items` é uma fila durável por consulta. O claim transfere `QUEUED → RUNNING` usando uma única instrução SQL com seleção e condição de estado. O hash do token de posse é persistido; concorrentes não adquirem o mesmo item. O Runner renova uma concessão de **90 segundos** com heartbeat, normalmente a cada 20–30 segundos.

O cancelamento marca os itens ainda na fila como `CANCELLED` e reduz para até 30 segundos a concessão restante de itens ativos. O heartbeat retorna `cancelRequested:true` e deixa de estender a concessão. O Runner pode enviar o resultado de cancelamento dentro desse período. Mesmo se chegar um resultado de sucesso numa corrida de cancelamento, o lote cancelado não recebe gate de aprovação.

A expiração é reconciliada nas consultas, heartbeats e tentativas de claim. Um item expirado termina como `ERROR`, com `UI_EXECUTION_LEASE_EXPIRED`, e não volta automaticamente à fila: a etapa Live pode já ter alterado o ambiente. O operador/CI precisa criar uma nova execução explícita após restaurar/verificar o ambiente. Essa regra evita repetir interações por causa de uma falha de transporte.

Reenvios idênticos de evidência e resultado são aceitos. Conteúdo divergente para a mesma identidade retorna 409. A verificação da concessão ocorre também na escrita D1 final; uma expiração durante upload no R2 não publica a evidência nem finaliza o item. Objetos não referenciados podem permanecer após essas corridas; uma futura rotina de limpeza deve conferir referências D1 antes de removê-los. Não há remoção automática de evidências válidas nesta entrega.

## Relatórios completos sem copiar o conteúdo para D1

D1 guarda escopo, identidades, estado, posse, hashes, contagens pequenas de páginas e referências R2. Compilações, resultados completos, screenshots e páginas NDJSON ficam no R2. O conjunto lógico não é truncado para caber numa coluna de banco.

O resultado tem dois modos, na ordem `UI_REPLAY`, `UI_LIVE`. Coleções extensas usam `externalized:true`, arrays `checks`, `pending` e `network` vazios e `reportPages` com `{evidenceId,collection,count,sha256,byteLength,contentType}`. Cada página é enviada antes do resultado, como `application/x-ndjson`, e também aparece no array `evidence` do par. O Gateway mede as linhas e os status a partir dos bytes enviados, verifica correspondência entre recibos/escopo/claim e contagens, e rejeita IDs de checks repetidos entre páginas do mesmo modo. `checksPending` conta checks pendentes; a coleção `pending` pode conter diagnósticos complementares e não precisa ter a mesma quantidade.

Limites operacionais por transferência: admissão 64 KiB de referências; resultado compacto 1 MiB; cada evidência/artefato 16 MiB; fonte completa 20 MiB. A recomendação é dividir NDJSON em páginas próximas de 256 KiB. Esses limites protegem uma requisição e não autorizam omitir linhas ou evidências: o Runner pagina o conjunto e conserva as contagens. O download JSON aponta todas as páginas com rotas autenticadas; o Runner pode produzir também o relatório agregado no diretório local do CI.

## Estado e gate

O estado do lote descreve processamento: `QUEUED`, `RUNNING`, `COMPLETED`, `CANCELLED`. O gate descreve a avaliação: `PASSED`, `FAILED`, `INCOMPLETE`. `COMPLETED` não significa teste aprovado.

Para um modo declarar `PASSED`, precisa ter execução de navegador, pelo menos um check aprovado, nenhum check falho/pendente, nenhuma pendência de cobertura, todas as ações e checkpoints planejados executados, contagens consistentes com as páginas e com a versão imutável. Um par passa apenas com os dois modos aprovados. Um lote passa apenas após todos os seus itens terminarem aprovados e sem cancelamento.

O JUnit tem dois testcases por observação, inclusive quando o trabalho ainda não começou. Falhas de asserção produzem `<failure>`; fila, bloqueio, ausência de comparador, timeout ou cancelamento produzem `<error>`. O JSON preserva os motivos e os contadores para uma leitura mais detalhada.

## Verificação local

```bash
npm run test:ui-exec1
npm run test:router
npm run test:ui-td3
```

`test:ui-exec1` usa SQLite real (`node:sqlite`, Node 24 recomendado), aplicando a migration e executando as instruções de produção. Cobre isolamento entre escopos, atomicidade e rollback, claims concorrentes, snapshot imutável, fencing, expiração, cancelamento, perda de ACK, resultados divergentes, integridade de páginas, duplicidade de checks e gates JSON/JUnit. O R2 e os serviços são substitutos locais; os testes não publicam Workers, não acessam banco remoto e não executam a aplicação observada.

# UI-EXEC-2 — Gateway 1.4.0

Esta entrega mantém os serviços de execução API e UI separados e acrescenta uma admissão durável para o botão conjunto da Console. A execução de navegador é feita pelo serviço `qagent-ui-runner` hospedado em Cloudflare Containers; o Gateway conserva a autoridade sobre os itens, claims, cancelamento e resultados.

## Implantação

Preserve as configurações da conta e mescle o arquivo de referência. O Gateway precisa destes acréscimos:

```jsonc
{
  "services": [
    // Acrescentar aos bindings existentes.
    { "binding": "UI_RUNNER", "service": "qagent-ui-runner" }
  ],
  "triggers": { "crons": ["* * * * *"] }
}
```

Use um segredo de 32–512 caracteres com o mesmo valor no Gateway e no Worker do runner, sem substituir os segredos existentes de Registry, Test Design ou execução API:

```bash
npx wrangler secret put UI_RUNNER_DISPATCH_SECRET
npx wrangler d1 migrations apply QAGENT_DB --remote
npx wrangler deploy
```

A migração nova é `0023_ui_hosted_automation.sql`; a `0022` continua necessária. A conta de referência chama o banco `qagent-dev`, mas o comando usa o binding `QAGENT_DB`. Confirme o binding do seu projeto. Publique o serviço do runner antes do Gateway que o referencia. A Console e o Gateway continuam oferecendo execução individual API ou UI.

Não há Queue Cloudflare adicional para UI: as tabelas D1 existentes são a fila de trabalho, e a nova tabela de dispatch guarda a solicitação de despertar. O cron recupera a ativação quando o envio ao serviço falha ou o HTTP do usuário é encerrado. Apenas itens `QUEUED` podem ser assumidos; uma lease expirada termina em erro e nunca volta automaticamente à fila.

## Perfil temporariamente sem autenticação

O Gateway aceita `preparationMode: "UNAUTHENTICATED"` em `UI_EXECUTION_PROFILES_JSON`. O runner abre a aplicação sem usar autenticação/preparação local e conserva as pendências de autenticação, build e dados que não foram verificados. Login ausente, redirects e 401/403 são resultados reais; o modo não afirma que o ambiente foi preparado. O padrão de perfis antigos continua `REQUIRE_ADAPTER`.

```json
[
  {
    "profileId": "profile_stg_chromium",
    "name": "STG Chromium",
    "scope": {
      "organizationId": "org_SEU_ORG",
      "projectId": "prj_SEU_PROJETO",
      "environmentId": "env_SEU_AMBIENTE"
    },
    "targetBaseUrl": "https://stg.sua-aplicacao.example/",
    "allowedOrigins": ["https://stg.sua-aplicacao.example"],
    "preparationMode": "UNAUTHENTICATED",
    "viewport": { "width": 1280, "height": 720 },
    "stepTimeoutMs": 7000,
    "modeTimeoutMs": 600000
  }
]
```

Troque os placeholders por valores reais. Preserve o perfil de renderização e o mapeamento de origens que já configurou. Os tokens de máquina existentes em `UI_EXECUTION_TOKENS_JSON` continuam sendo a autoridade do runner para ler/assumir itens de um único projeto/ambiente. O segredo de dispatch autentica a comunicação Gateway→controle do container; ele não substitui o token de execução.

## Admissão conjunta

```text
POST /v1/console/projects/:projectId/environments/:environmentId/automation-runs
GET  /v1/console/projects/:projectId/environments/:environmentId/automation-runs?limit=20&cursor=...
GET  /v1/console/projects/:projectId/environments/:environmentId/automation-runs/:automationRunId
```

```json
{
  "operationId": "automation_operacao_unica",
  "api": {
    "suiteVersionId": "suitev_VERSAO_EXISTENTE",
    "confirmDiscoveredRuntime": true,
    "confirmProductionMutation": false
  },
  "ui": {
    "testDesignVersionIds": ["uitdv_VERSAO_EXISTENTE"],
    "profileId": "profile_stg_chromium",
    "targetBuildRef": "commit:REFERENCIA_DO_BUILD"
  }
}
```

Um domínio pode ser `null`, mas não ambos. Repetir exatamente a operação devolve a mesma execução conjunta; mudar o conteúdo usando o mesmo `operationId` devolve 409. O registro do pedido é gravado antes de criar os filhos. A criação API reutiliza `createSuiteRunV1`, a mesma versão de suite, o mesmo controle de mutações, a mesma fila e a mesma lógica de autenticação que já existiam. A criação UI reutiliza a admissão de batch imutável.

Os retornos usam `{status:"ok",data:...}`. O objeto `data` tem `contractVersion:"qagent.automation-run.v1"`, `automationRunId`, `operationId`, `scope`, datas, `status` e os domínios:

- `api`: `admission`, `errorCode`, `suiteRunId`, `suiteRun` (envelope API existente).
- `ui`: `admission`, `errorCode`, `batchId`, `batch` (BatchDetail UI existente).
- `admission`: `NOT_REQUESTED`, `PENDING`, `ADMITTED` ou `ERROR`.
- `status`: `PENDING`, `RUNNING`, `COMPLETED` ou `NEEDS_ATTENTION`. A conclusão do processamento não declara os testes aprovados; os resultados pertencem a cada filho.

Uma falha transitória na leitura de filho mantém seu identificador e `ADMITTED`, retorna o erro de leitura e deixa o parent consultável como `PENDING`/`RUNNING`. A Console pode continuar acompanhando o filho sem criar outro. Falha permanente de admissão em um domínio não apaga o outro. O cancelamento UI continua no endpoint de batch; não foi adicionado um cancelamento conjunto fictício para API.

A superfície conjunta é Console autenticada. O token de máquina UI não recebe implicitamente permissão para disparar API. O pipeline UI mantém a superfície `/v1/automation/.../ui-executions` já entregue.

## Despertar do runner

Destino fixo pelo service binding `UI_RUNNER`, POST `/internal/ui-runner/v1/dispatch`:

```json
{
  "contractVersion": "qagent.ui-runner-dispatch.v1",
  "scope": {"organizationId":"org_...","projectId":"prj_...","environmentId":"env_..."},
  "batchId": "uieb_..."
}
```

Headers `X-QAgent-Runner-Time` (epoch em segundos) e `X-QAgent-Runner-Signature` (HMAC-SHA256 hexadecimal). Mensagem assinada:

```text
QAGENT_UI_RUNNER_HTTP_V1
POST
/internal/ui-runner/v1/dispatch
<timestamp>
<SHA256 dos bytes exatos do body>
```

O retorno de aceitação exige `{status:"ok",data:{accepted:true,batchId}}`. O timeout de transporte é 8 segundos, inclusive quando um binding ignora `AbortSignal`. O ACK confirma apenas a ativação durável, não a aprovação ou o término do teste. O mesmo lote pode ser reafirmado a cada minuto; os claims D1 impedem duplicação de itens. Erros usam backoff até cinco minutos, e ficam visíveis em `BatchDetail.hosting`.

## Evidências progressivas e falhas de container

O upload já existente aceita os headers opcionais `X-QAgent-Evidence-Mode` (`UI_REPLAY`/`UI_LIVE`) e `X-QAgent-Evidence-Kind` (código maiúsculo). Hash, tamanho, item, escopo e claim são verificados; repetições devem conservar também esses rótulos. Contagens NDJSON continuam calculadas dos bytes, não de declarações do runner.

`BatchDetail.items[].evidence` expõe os anexos duravelmente recebidos mesmo quando `result` é `null`. `partialEvidence:true` identifica esse caso. Se o runtime morrer, a lease expira como erro, os anexos já publicados continuam acessíveis e não constituem aprovação. Escritas de claims expiradas continuam rejeitadas.

## Verificação local

```bash
npm run test:ui-exec2
npm run test:router
npm run test:f07-7-10-b-fix-1
```

Os testes usam SQLite real e a admissão API/dispatch de produção, com Registry e rede simulados. Eles cobrem persistência antes dos filhos, falha no ACK da fila API, recuperação de UI, erros independentes, duplicação de clique, escopo, paginação, HMAC, timeout, despertar concorrente, lease sem reexecução e evidências parciais. Um teste remoto de Chromium/Containers continua sendo parte da aceitação após o deploy.

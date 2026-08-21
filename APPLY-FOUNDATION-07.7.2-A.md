# Apply — Foundation 07.7.2-A
## Execution Readiness Bridge Hardening

Esta etapa é **Gateway-only**.

Não há migration nova.
Não há mudança de Registry.
Não há mudança de Console.

## 1. Atualizar o repositório

Preserve `.git/` e substitua os arquivos versionados pelo snapshot 07.7.2-A.

Nunca copie para Git:

```text
node_modules/
.wrangler/
.dev.vars
.env
.env.*
secrets
```

## 2. Instalar e validar

```bash
npm ci
npm run check:07.7.2-a
npm run test:all
```

## 3. Deploy

```bash
npm run deploy
```

Não execute migration para esta subfase.

## 4. Validação real recomendada

No projeto que possui:

```text
API Service: sestsenat-api
Base URL: https://api-sestsenat.studionmx.com
Auth Profile: sest-senat-bearer
```

regere o Test Design de:

```text
GET /api/myself
```

Verifique no POST:

```json
{
  "runtimeMapping": {
    "status": "MATCHED",
    "resolutionSource": "ORIGIN",
    "selectedApiServiceKey": "sestsenat-api"
  }
}
```

`environmentCoverageStatus` pode ser `NONE`, `PARTIAL` ou `COMPLETE`; isso agora representa cobertura diagnóstica, não seleção do serviço.

No cenário candidato:

```text
spec.target.apiServiceKey = sestsenat-api
```

Se Auth for REQUIRED e o profile for selecionado:

```text
spec.auth.authProfileRef = authp_...
```

Sem data/review blockers, esperado:

```text
automation.readiness = READY
```

## 5. Run gate

Depois que houver um `READY` persistido em `tdv_*`, usar o POST Run da 07.7.2 com:

```text
testDesignVersionId
environmentId
scenarioIds
Idempotency-Key
```

Esperado:

```text
Run = CREATED
Execution Plan persistido
Runtime Snapshot persistido
HTTP NÃO executado
```

## 6. Rollback

Rollback é somente do Gateway para o snapshot 07.7.2 anterior.

Não há D1 a reverter.

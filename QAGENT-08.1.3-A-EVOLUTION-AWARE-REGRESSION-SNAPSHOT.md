# QAgent 08.1.3-A — Evolution-Aware Regression Snapshot

## Objetivo

Garantir que uma Test Design Version criada pelo Test Evolution nunca seja ignorada silenciosamente pela próxima regressão CURRENT.

A Suite Version continua imutável. O QAgent passa a comparar o snapshot materializado com o inventário atual e explicar por que ele ficou desatualizado, incluindo Test Designs evoluídos (`RESULT_EVOLUTION`).

## Problema validado

O Test Evolution já pode criar uma versão derivada, por exemplo:

```text
v4 FAILED
→ TEST_DATA_DRIFT
→ AUTO_SAFE
→ v5
→ rerun PASSED
```

Uma Suite Version previamente materializada continua corretamente pinada em v4. Isso é necessário para reprodutibilidade, mas a UI precisa impedir que essa Suite antiga seja usada como regressão CURRENT sem deixar claro que existe v5.

## Contrato novo

O endpoint existente:

```text
GET /v1/console/projects/:projectId/automation/suites/auto-ready/latest
```

agora recebe do Registry um bloco adicional:

```json
{
  "snapshot": {
    "contractVersion": "qagent.evolution-aware-regression-snapshot.v1",
    "state": "OUTDATED",
    "outdatedReason": "TEST_DESIGN_EVOLVED",
    "suiteInventoryFingerprint": "...",
    "currentInventoryFingerprint": "...",
    "changedTestDesignCount": 1,
    "evolvedTestDesignCount": 1,
    "versionChangedTestDesignCount": 0,
    "addedTestDesignCount": 0,
    "removedTestDesignCount": 0,
    "noLongerReadyTestDesignCount": 0,
    "changes": [
      {
        "changeType": "TEST_DESIGN_EVOLVED",
        "endpointId": "cep_*",
        "testDesignId": "td_*",
        "from": {
          "testDesignVersionId": "tdv_old",
          "testDesignVersion": 4
        },
        "to": {
          "testDesignVersionId": "tdv_new",
          "testDesignVersion": 5,
          "readyScenarioCount": 6
        },
        "evolution": {
          "proposalId": "tep_*",
          "sourceTestDesignVersionId": "tdv_old"
        }
      }
    ]
  }
}
```

Estados:

```text
NOT_MATERIALIZED
CURRENT
OUTDATED
```

Razão prioritária desta Foundation:

```text
TEST_DESIGN_EVOLVED
```

Outras mudanças continuam identificáveis como:

```text
SELECTION_POLICY_CHANGED
PROJECT_TEST_INVENTORY_CHANGED
```

## Comportamento

```text
Suite snapshot vN (pina TD v4)
        ↓
Test Evolution cria TD v5
        ↓
Registry mantém suitev_N imutável
        ↓
latest snapshot state = OUTDATED
outdatedReason = TEST_DESIGN_EVOLVED
        ↓
Console desabilita Execute Regression
        ↓
UI mostra "1 Test Design evoluiu · v4 → v5"
        ↓
Prepare/Atualizar regressão
        ↓
materializa suitev_N+1 pinando TD v5
        ↓
latest snapshot state = CURRENT
        ↓
execução liberada
```

## Imutabilidade

Nenhuma Suite Version existente é alterada.

Um replay explícito de uma `suiteVersionId` histórica continua usando as Test Design Versions históricas. Apenas a regressão CURRENT exige materialização do inventário atual.

## Performance

O comportamento anterior de `latest` continua O(1) quando o parâmetro interno `snapshot=1` não é solicitado.

O Gateway usa:

```text
/v1/test-registry/projects/:projectId/suites/auto-ready/latest?view=compact&snapshot=1
```

Somente essa leitura de UX executa a comparação evolution-aware. Não existe N+1 por endpoint.

## Serviços alterados

```text
qagent-test-registry
qagent-gateway
qagent-console
```

Não alterados:

```text
qagent-test-evolution
qagent-test-results
qagent-runner
qagent-catalog
```

## Migration

Nenhuma migration nova.

A detecção usa dados já persistidos:

```text
test_suites
test_suite_versions
test_suite_version_items
test_designs
test_design_versions.version_origin_json
test_design_versions.derivation_key
test_design_execution_inventory
```

## Guardrails

- Suite Version histórica nunca é atualizada in-place.
- Execução CURRENT permanece bloqueada enquanto snapshot estiver OUTDATED.
- `RESULT_EVOLUTION` é identificado a partir da provenance persistida no Registry.
- Tenant/project scope é mantido em todas as consultas.
- `changes` é bounded e pode ser truncado sem afetar os contadores.
- Nenhuma IA é usada para determinar CURRENT/OUTDATED.

## Validação local

### Test Registry

```text
48/48 PASS
```

Inclui teste real SQLite:

```text
materializa Suite com v1
→ cria derived v2 via RESULT_EVOLUTION
→ Suite antiga permanece pinada em v1
→ snapshot fica OUTDATED / TEST_DESIGN_EVOLVED
→ materializa nova Suite
→ snapshot vira CURRENT
→ Suite histórica ainda executa v1
```

### Gateway

```text
check:08.1.3-a PASS
```

Valida BFF, contrato e `snapshot=1`.

### Console

```text
check:08.1.3-a PASS
```

Além disso, os arquivos TypeScript/TSX alterados passaram por type/syntax check isolado.

## Deploy

Ordem:

```text
1. qagent-test-registry
2. qagent-gateway
3. qagent-console
```

Sem migration.

## Production validation

### 1. Ler snapshot

```http
GET /v1/console/projects/:projectId/automation/suites/auto-ready/latest
```

Se existe uma Suite anterior à Evolution, esperar:

```text
snapshot.state = OUTDATED
snapshot.outdatedReason = TEST_DESIGN_EVOLVED
snapshot.evolvedTestDesignCount >= 1
```

### 2. Materializar CURRENT

```http
POST /v1/console/projects/:projectId/automation/suites/auto-ready/materialize
```

Deve criar nova `suiteVersionId` quando o inventory fingerprint mudou.

### 3. Ler novamente

Esperar:

```text
snapshot.state = CURRENT
snapshot.changedTestDesignCount = 0
```

### 4. Executar regressão

O Suite Run novo deve fan-out usando a Test Design Version evoluída, enquanto uma Suite Version histórica continua reproduzindo sua versão antiga quando explicitamente solicitada.

## Próxima Foundation

```text
08.1.3-B — Pending Review Reconciliation
```

Depois:

```text
08.1.3-C — Request Payload Evolution
```

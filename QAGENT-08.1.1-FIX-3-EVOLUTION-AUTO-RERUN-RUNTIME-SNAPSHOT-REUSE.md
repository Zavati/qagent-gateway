# QAgent 08.1.1 FIX-3 — Evolution Auto-Rerun Runtime Snapshot Reuse

## Objetivo

Fechar o loop do Test Evolution após um `AUTO_APPLIED` em método seguro (`GET`, `HEAD`, `OPTIONS`) quando o Runtime original foi resolvido por `DISCOVERED_OBSERVATION`.

Antes do FIX-3:

```text
Execution FAILED
→ Test Evolution identifica causa
→ AUTO_SAFE aplica vN+1
→ bounded rerun solicitado
→ createRunV1 redescobre runtime
→ RUN_DISCOVERED_RUNTIME_CONFIRMATION_REQUIRED
→ rerun não é criado
```

Depois do FIX-3:

```text
Execution FAILED
→ Test Evolution identifica causa
→ AUTO_SAFE aplica vN+1
→ bounded rerun solicitado
→ sourceRunId acompanha a recomendação
→ Gateway carrega o Runtime Snapshot do Run original
→ valida que o runtime foi confirmado e realmente executado
→ reutiliza somente o target descoberto já confirmado
→ rematerializa nova vN+1
→ Auth Runtime JIT novo
→ Test Data Runtime novo
→ cria novo Run
→ Runner executa
```

## Princípio de segurança

O FIX-3 **não clona o Runtime Snapshot inteiro**.

Reutilizado:

- `sourceRunId`;
- `sourceRuntimeSnapshotId`;
- `apiServiceKey`;
- `baseUrl` já confirmado;
- confidence do runtime descoberto.

Nunca reutilizado:

- cookies;
- sessão HTTP;
- bearer token;
- segredo resolvido;
- credencial materializada;
- valores GENERATED do Run anterior;
- valores FIXED/OBSERVED congelados do Run anterior;
- Auth Runtime materializado.

O novo Run continua resolvendo o Environment atual, Auth Profile atual, Auth JIT e Test Data da nova Test Design Version.

## Guardrails do source Run

O runtime descoberto só pode ser reutilizado se:

1. source Run existir;
2. organization/project forem idênticos;
3. Environment for idêntico;
4. o source Run tiver executado o mesmo scenarioId;
5. Runtime Snapshot não exigir confirmação;
6. `runtimeReadinessStatus = READY`;
7. `httpExecutionStatus = COMPLETED`;
8. existir ao menos uma resposta HTTP;
9. source runtime for `DISCOVERED_OBSERVATION`;
10. no materializer, endpoint da nova Test Design Version for o mesmo endpoint do source Run;
11. service key reutilizado existir no snapshot original.

Qualquer divergência falha fechado.

## Explicit Config

Se o source Run usava `EXPLICIT_CONFIG`, o FIX-3 **não congela o Base URL antigo**. O novo Run resolve novamente a configuração atual do Environment.

Isto evita transformar Runtime Snapshot em configuração permanente.

## Contratos

A recomendação de rerun do Test Evolution agora inclui:

```json
{
  "requested": true,
  "reason": "SAFE_METHOD_AUTO_RERUN_ALLOWED",
  "testDesignVersionId": "tdv_...",
  "environmentId": "env_...",
  "scenarioId": "test_001",
  "sourceRunId": "run_..."
}
```

O Gateway usa internamente:

```text
qagent.evolution-runtime-reuse.v1
```

O novo Runtime Snapshot continua usando:

```text
resolution.source = DISCOVERED_OBSERVATION
requiresExecutionConfirmation = false
```

Não foi criado um novo `resolution.source`, preservando compatibilidade com Runner e D1 existentes.

Para auditoria, o snapshot novo pode carregar:

```json
{
  "resolution": {
    "source": "DISCOVERED_OBSERVATION",
    "confidence": "HIGH",
    "requiresExecutionConfirmation": false,
    "reuse": {
      "contractVersion": "qagent.evolution-runtime-reuse.v1",
      "kind": "EVOLUTION_CONFIRMED_RUNTIME_REUSE",
      "sourceRunId": "run_...",
      "sourceRuntimeSnapshotId": "rts_..."
    }
  }
}
```

## Serviços alterados

### qagent-gateway

Arquivos principais:

- `src/services/evolutionRerunService.js` — novo;
- `src/services/runService.js`;
- `src/services/executionPlanMaterializerService.js`;
- `src/handlers/consoleTestEvolution.js`;
- `src/handlers/testEvolutionQueue.js`;
- `test/test-foundation-08-1-1-fix-3-evolution-runtime-reuse.js`;
- `package.json` — adicionados scripts de teste focados.

### qagent-test-evolution

- `src/service.js` — `rerunRecommendation()` agora inclui `sourceRunId`;
- `test/evolution-v2-rerun-runtime-reuse.test.mjs`.

## Serviços não alterados

- Runner;
- Test Registry;
- Test Results;
- Console;
- Catalog;
- Normalizer;
- Observation;
- Plugin.

## Migration

**Nenhuma migration nova.**

O FIX-3 preserva os valores já aceitos pelo D1:

- `EXPLICIT_CONFIG`;
- `DISCOVERED_OBSERVATION`.

## Regressão executada

Test Evolution:

```text
21 tests
21 PASS
0 FAIL
```

Gateway:

```text
npm run check:08.1.1-fix-3

Foundation 08.1 AI/BYOAI             PASS
Foundation 08.1 queue depth guard    PASS
07.6.1 Test Design Contract          PASS
07.6.3-C Semantic Guard              PASS
07.7.8 Secret-Safe                   PASS
Router                               PASS
08.1.1 FIX-3 Runtime Reuse           PASS
```

O teste FIX-3 verifica explicitamente que:

- runtime descoberto confirmado é reutilizado sem novo prompt;
- Catalog não é consultado novamente para redescobrir o target;
- auth/test data antigos não fazem parte do reuse token;
- explicit config é resolvido de forma nova;
- tentativa de reutilizar runtime em outro endpoint falha fechado.

## Ordem de deploy

1. `qagent-test-evolution`
2. `qagent-gateway`

Não há migration.

A ordem é apenas para que o `sourceRunId` já esteja presente na recomendação. O Gateway também possui fallback para `proposal.source.runId`, portanto a transição é compatível.

## Smoke test recomendado

Repetir:

```text
POST /v1/console/projects/:projectId/test-evolution/proposals/:proposalId/analyze
```

Para o proposal já `APPLIED`, o Test Evolution retorna novamente a recomendação de bounded rerun.

Esperado:

```json
{
  "autoApplied": true,
  "rerun": {
    "requested": true,
    "reason": "SAFE_METHOD_AUTO_RERUN_ALLOWED",
    "status": "CREATED",
    "run": {
      "runId": "run_...",
      "status": "QUEUED",
      "runtimeReuse": {
        "sourceRunId": "run_5d9b4b3c-d187-4d5d-a8b7-f4ff797c88dc",
        "reusedDiscoveredRuntime": true,
        "strategy": "CONFIRMED_SOURCE_RUNTIME_TARGET"
      }
    }
  }
}
```

Depois consultar o novo Run/Results e validar:

```text
v5
limit/offset NUMBER
runtime target reutilizado
Auth JIT novo
HTTP 200 esperado
```

## Loop fechado esperado

```text
FAIL
→ diagnose
→ TEST_DATA_DRIFT
→ AUTO_SAFE
→ v4 → v5
→ reuse confirmed runtime target
→ fresh Auth JIT
→ fresh Test Data
→ rerun
→ validate correction
```

Este é o primeiro ciclo completo de self-healing de execução do QAgent sem transformar comportamento incorreto da aplicação em expectation aceita automaticamente.

# Apply — Foundation 07.7.8-B

## Ordem de deploy

### 1. Gateway

```bash
npm ci
npm run check:07.7.8-b
npm run test:all
npm run deploy
```

Não existe migration nova.

### 2. Console

```bash
npm ci
npm run test:f07-7-8-b
npm run build
npm run deploy
```

### 3. Runner

Nenhum redeploy é obrigatório para a 07.7.8-B. O Runner 07.7.8 permanece compatível porque o Test Spec continua entregando apenas `auth.requirement` + `authProfileRef`.

## Gate funcional recomendado

No Project Buggy Cars Rating:

- 0 API Services explícitos;
- 1 Environment STG;
- Auth Profile `Token Autenticado` ativo;
- credential configurada em STG;
- endpoint GET observado com Bearer.

Gerar novamente o Test Design.

Esperado em diagnostics:

```text
builderVersion = qagent.catalog-context-builder.v1.4
runtimeMapping.status = DISCOVERED
runtimeMapping.runtimeSource = DISCOVERED_OBSERVATION
auth.observationStatus = REQUIRED
auth.observedScheme = BEARER
auth.resolutionStatus = AUTO_MATCHED
auth.resolutionSource = OBSERVED_AUTH_AND_ENVIRONMENT
auth.compatibleProfileCount = 1
auth.candidateProfileCount = 1
auth.defaultSelected = true
auth.selectedAuthProfileRef = authp_...
auth.selectedProfileName = Token Autenticado
```

Esperado no Test Spec:

```json
{
  "auth": {
    "requirement": "REQUIRED",
    "authProfileRef": "authp_..."
  }
}
```

No Console deve aparecer `Auth resolvido automaticamente` e o card deve exibir o profile associado.

## Casos fail-closed

- 2 Auth Profiles Bearer compatíveis => `AMBIGUOUS`, sem seleção automática;
- credential apenas em outro Environment => `UNAVAILABLE`;
- profile incompatível com o esquema observado => não selecionado;
- nenhum credential value aparece em diagnostics/UI.

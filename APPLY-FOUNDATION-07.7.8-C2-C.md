# Apply — Foundation 07.7.8-C2-C

## Pré-requisitos

- qagent-catalog 07.7.8-C2-B deployado e migration 0013 aplicada;
- qagent-normalizer 07.7.8-C2-A deployado;
- Reservoir validado em produção.

## Gate local

```bash
npm ci
npm run check:07.7.8-c2-c
```

Gate esperado:

```text
Foundation 07.7.8-C2-C Hybrid Test Data Planner tests passed ✅
gateway router tests passed ✅
```

## Deploy

Não há migration nova no Gateway.

```bash
npm run deploy
```

## Validação funcional

1. Capture um POST/PUT JSON depois de C2-A/B.
2. Confirme massa no Catalog Reservoir.
3. Regenere o Test Design.
4. Verifique diagnostics:
   - `plannerVersion = qagent.test-data-planner.v1.2`
   - `strategy = HYBRID`
   - `observedValueMetadataCount > 0`
   - `observedSampleMetadataCount > 0`
5. Em endpoint com selector referencial observado, confirme:

```json
{
  "target": "BODY",
  "selector": "$.leaveTypeId",
  "source": "OBSERVED",
  "valueType": "INTEGER",
  "bindingKey": "BODY:$.leaveTypeId"
}
```

6. Confirme que nenhum literal observado aparece no Test Design.
7. Enquanto C2-D não estiver deployada, cenário com OBSERVED deve permanecer NEEDS_DATA e conter blocker `QAgent Observed Test Data`.

## OrangeHRM

Para `PUT /web/index.php/api/v2/pim/employees/{id}/custom-fields` com `$.custom2="teste"`:

- `$.custom2` deve continuar GENERATED em HYBRID (free text);
- `{id}` continua FIXED/NEEDS_DATA nesta Foundation, pois PATH_PARAM observed resolution não faz parte de C2-C BODY.

Para Leave Requests, depois de nova observação C2-A/B:

- `$.leaveTypeId` deve preferir OBSERVED;
- `$.empNumber` deve preferir OBSERVED;
- `$.duration.type` pode preferir OBSERVED;
- `$.comment` deve permanecer GENERATED.

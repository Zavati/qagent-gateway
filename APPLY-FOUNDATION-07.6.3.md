# APPLY — Foundation 07.6.3

## Aplicação

Substitua os arquivos do snapshot preservando `.git`.

```bash
npm ci
npm run test:f07-6-1
npm run test:f07-6-2
npm run test:f07-6-3
npm run test:router
npm run test:all
```

Não há migration nova.

## Validação real

Use um endpoint já validado pela 07.6.2:

```http
POST https://api.apiqagent.com/v1/console/projects/<PROJECT_ID>/intelligence/endpoints/<ENDPOINT_ID>/test-design
Authorization: Bearer <CONSOLE_SESSION_TOKEN>
```

Sem body.

### Esperado

- HTTP 200;
- `status = ok`;
- `data.specification.specificationVersion = qagent.test-spec.v1`;
- `data.specification.scenarios.length > 0`;
- `generation.provider/model/contextFingerprint` preenchidos;
- Evidence/Schema refs pertencem ao contexto da 07.6.2;
- sem `rawText`, prompt, credential ou API key na resposta;
- se `runtimeMapping = UNMATCHED`, `summary.byReadiness.NEEDS_ENVIRONMENT` deve refletir os cenários gerados.

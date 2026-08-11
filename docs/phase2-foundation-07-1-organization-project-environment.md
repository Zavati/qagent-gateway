# QAgent Phase 2 — Foundation 07.1
## Organization → Project → Environment

### Objetivo
Criar a raiz relacional multi-tenant do QAgent sem quebrar Auth/Billing/ClientKeys/BYOAI existentes.

### Decisão de compatibilidade
- `organization_id` é a identidade permanente do tenant no Data DB.
- `customerId` atual permanece temporariamente em Auth/Billing/AI Config.
- `organizations.legacy_customer_id` cria a ponte de migração.
- `clientKey` não é FK de nenhuma entidade nova.

### Provisionamento de Organization
Na primeira chamada autenticada às novas APIs, `requireConsoleTenant()`:
1. valida a sessão atual;
2. obtém `user.customerId` como referência legada;
3. procura `organizations.legacy_customer_id`;
4. cria a Organization se necessário;
5. registra o usuário atual em `organization_members`;
6. retorna `organizationId` para todo domínio novo.

### Entidades
- `organizations`
- `organization_members`
- `projects`
- `environments`

Todos os Projects são consultados por `(organization_id, project_id)`.
Todos os Environments são consultados por `(organization_id, project_id, environment_id)`.
Isso impede acesso cruzado entre tenants mesmo que um ID válido de outro tenant seja conhecido.

### Endpoints
- `GET /v1/console/organization`
- `PATCH /v1/console/organization`
- `GET /v1/console/projects`
- `POST /v1/console/projects`
- `GET /v1/console/projects/:projectId`
- `PATCH /v1/console/projects/:projectId`
- `DELETE /v1/console/projects/:projectId` (soft archive)
- `GET /v1/console/projects/:projectId/environments`
- `POST /v1/console/projects/:projectId/environments`
- `GET /v1/console/projects/:projectId/environments/:environmentId`
- `PATCH /v1/console/projects/:projectId/environments/:environmentId`
- `DELETE /v1/console/projects/:projectId/environments/:environmentId` (soft archive)

### Environment inicial
Campos desta etapa:
- name
- slug
- environmentType: `DEV | QA | STG | PROD | CUSTOM`
- webBaseUrl
- isDefault
- status

API Services, Environment Variables e Auth Profiles entram nas próximas Foundations 07.x.

### Regras
- primeiro Environment ativo de um Project vira default automaticamente;
- só pode existir um Environment default ativo por Project;
- Project/Environment usam soft archive;
- URLs aceitam apenas HTTP/HTTPS nesta camada de configuração;
- proteção SSRF será aplicada no Execution Plane/Runner, não no cadastro.

### Aplicação local
```bash
npm install
npm run db:migrate:local
npm run test:router
npm run test:f07-data
npm test
```

### Smoke API
Após login no Console e com `<SESSION_TOKEN>`:

```bash
curl http://localhost:8787/v1/console/organization \
  -H "Authorization: Bearer <SESSION_TOKEN>"

curl -X POST http://localhost:8787/v1/console/projects \
  -H "Authorization: Bearer <SESSION_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"QAgent Platform","description":"Foundation 07"}'

curl -X POST http://localhost:8787/v1/console/projects/<PROJECT_ID>/environments \
  -H "Authorization: Bearer <SESSION_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"STG","environmentType":"STG","webBaseUrl":"https://stg.example.com"}'
```

### Próxima etapa
Depois de validar este slice no Gateway e no Console:
1. Environment API Services/Base URLs;
2. Environment Variables;
3. Secret Vault + Auth Profiles.

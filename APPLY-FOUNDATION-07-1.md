# APPLY — QAgent Foundation 07.1
## Organization → Project → Environment

Este pacote não altera Auth/Billing/ClientKeys/BYOAI existentes. Ele adiciona a nova raiz relacional multi-tenant ao Gateway.

## 1. Copie os arquivos do patch
Aplique os arquivos mantendo a mesma estrutura de diretórios no repositório `qagent-gateway`.

## 2. Instale/restaure dependências
Se `node_modules/.bin/wrangler` não existir:

```bash
npm install
```

## 3. Aplique a migration local

```bash
npm run db:migrate:local
```

A migration esperada é:

```text
0002_foundation_07_organization_project_environment.sql
```

## 4. Rode os testes

```bash
npm run test:router
npm run test:f07-data
npm test
```

## 5. Suba o Gateway local

```bash
npm run dev
```

## 6. Faça login no Console
Use o fluxo de login já existente e copie o Bearer session token usado pelo Console.

## 7. Resolva/provisione a Organization

```bash
curl http://localhost:8787/v1/console/organization \
  -H "Authorization: Bearer <SESSION_TOKEN>"
```

Na primeira chamada, o Gateway cria a Organization vinculada ao `customerId` legado e registra o usuário atual como `owner`.

## 8. Crie um Project

```bash
curl -X POST http://localhost:8787/v1/console/projects \
  -H "Authorization: Bearer <SESSION_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "QAgent Platform",
    "description": "Projeto principal da plataforma"
  }'
```

Guarde o `project.projectId` retornado.

## 9. Crie DEV

```bash
curl -X POST http://localhost:8787/v1/console/projects/<PROJECT_ID>/environments \
  -H "Authorization: Bearer <SESSION_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "DEV",
    "environmentType": "DEV",
    "webBaseUrl": "https://dev.example.com"
  }'
```

O primeiro Environment ativo é `isDefault: true` automaticamente.

## 10. Crie STG

```bash
curl -X POST http://localhost:8787/v1/console/projects/<PROJECT_ID>/environments \
  -H "Authorization: Bearer <SESSION_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "STG",
    "environmentType": "STG",
    "webBaseUrl": "https://stg.example.com"
  }'
```

## 11. Liste a árvore

```bash
curl http://localhost:8787/v1/console/projects \
  -H "Authorization: Bearer <SESSION_TOKEN>"

curl http://localhost:8787/v1/console/projects/<PROJECT_ID>/environments \
  -H "Authorization: Bearer <SESSION_TOKEN>"
```

## Critério de aceite
- Organization possui `organizationId` próprio.
- `customerId` aparece somente como ponte legada (`legacy_customer_id`).
- Project sempre pertence a uma Organization.
- Environment sempre pertence à mesma Organization do Project.
- primeiro Environment vira default.
- apenas um Environment ativo pode ser default por Project.
- IDs de outro tenant retornam 404 nas APIs por escopo de `organizationId`.
- Foundation 06 continua funcionando.

# QAgent Phase 2 — Foundation 07.4.2-E
## Plugin Tenant Binding Consistency

### Problema corrigido
O Console e o Plugin usam o mesmo `listOrganizationProjects()`. Portanto, quando o Console possui Projects mas `POST /v1/plugin/session` devolve `projects: []`, a divergência ocorre antes da consulta: no account/tenant resolvido pela ClientKey.

### Regra
A ClientKey continua sendo credencial, nunca tenant/FK arbitrária. O Gateway valida a cadeia:

`ClientKey -> clientKey.customerId -> customer -> Console user.customerId -> organization -> projects`

Se uma ClientKey legada ainda válida apontar para um `customerId` diferente daquele atualmente vinculado ao login do mesmo email, o Gateway **não migra silenciosamente de tenant**. A requisição falha com HTTP 409 e código:

`PLUGIN_CLIENT_KEY_STALE_ACCOUNT_BINDING`

A ação correta é rotacionar a ClientKey no Console e usar a nova chave.

### Segurança
Também falhamos em divergências entre `clientKey.customerId` e `license.customerId` com:

`PLUGIN_CLIENT_KEY_ACCOUNT_MISMATCH`

Isso evita que dados históricos inconsistentes atravessem organizations.

### Cobertura
`test/test-plugin-session.js` agora cobre:

- Organization com múltiplos Projects;
- Environments isolados por Project;
- criação da sessão `qps_*`;
- ClientKey com vínculo legado de account;
- rejeição de cross-tenant silencioso.

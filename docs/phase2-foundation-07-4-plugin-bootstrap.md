# QAgent Phase 2 — Foundation 07.4.2-B
## Plugin V2 Bootstrap

### Objetivo
Conectar o novo Chrome Plugin V2 à hierarquia multi-tenant usando ClientKey somente no handshake.

### Endpoint
`POST /v1/plugin/session`

Headers:
- `Authorization: Bearer <clientKey>`
- `X-QAgent-Plugin-Version: <version>`

### Segurança
- a ClientKey nunca é devolvida pela API;
- ClientKey continua sendo credencial e nunca FK;
- ClientKey é convertida em `keyHash` no Gateway;
- chaves revogadas são rejeitadas;
- licença precisa estar `trial`, `active` ou `grace_period`;
- o Gateway resolve `organization_id` a partir da ClientKey;
- o token de sessão do plugin é aleatório, curto e persistido no KV apenas pelo hash;
- TTL padrão: 15 minutos, configurável por `PLUGIN_SESSION_TTL_SECONDS` entre 5 e 60 minutos;
- nenhum Secret Vault, Auth Profile ou Environment secret é exposto ao plugin.

### Resposta
A resposta contém:
- token efêmero `qps_*`;
- expiração;
- organization segura;
- Projects ativos;
- Environments ativos de cada Project.

O token `qps_*` será a credencial usada futuramente pelo Observation Ingestion.

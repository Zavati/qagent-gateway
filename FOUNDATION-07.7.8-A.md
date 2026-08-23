# QAgent Foundation 07.7.8-A — Dynamic Form / OAuth Password

## Objetivo

Fechar o segundo caminho do Auth Runtime: quando o Environment não possui um Bearer/API key pronto, o Runner deve obter uma credencial efêmera chamando o endpoint de autenticação da própria aplicação e usar o token apenas em memória.

A Foundation mantém o contrato de segurança da 07.7.8: Secret Vault e master keys ficam no Gateway; Queue, Runtime Snapshot, Execution Plan, logs e Results Plane nunca recebem username/password/token em plaintext.

## Escopo implementado

### HTTP Login JSON/Form

O tipo persistido existente `login_http_json` foi evoluído de forma backward-compatible para suportar:

- `bodyEncoding = json | form`;
- `usernameField` e `passwordField` configuráveis;
- `staticBody` seguro;
- token em JSON ou Header;
- `scheme` e `targetHeader` configuráveis.

Para `bodyEncoding=form`, o Runner envia `application/x-www-form-urlencoded` usando `URLSearchParams`, permitindo representar OAuth Password / Resource Owner Password legado sem criar uma regra específica da aplicação.

Exemplo de configuração:

```json
{
  "targetMode": "runtime_origin",
  "apiServiceKey": null,
  "path": "/prod/oauth/token",
  "method": "POST",
  "bodyEncoding": "form",
  "usernameField": "username",
  "passwordField": "password",
  "staticBody": {
    "grant_type": "password"
  },
  "tokenSource": "json",
  "tokenJsonPath": "access_token",
  "targetHeader": "Authorization",
  "scheme": "Bearer"
}
```

`tokenJsonPath` deve refletir o campo real retornado pelo endpoint de login.

### Dynamic Auth Target Bootstrap

Dynamic Auth agora aceita:

```text
targetMode = api_service
```

ou:

```text
targetMode = runtime_origin
```

`api_service` preserva o comportamento explícito anterior.

`runtime_origin` usa o origin exato do(s) cenário(s) que referenciam aquele Auth Profile. O Gateway materializa e congela esse target no Runtime Snapshot antes da Queue.

Se os cenários que usam o mesmo Auth Profile apontarem para mais de um service target, o Run falha fechado com `RUN_AUTH_RUNTIME_ORIGIN_AMBIGUOUS`.

### Frozen target

O Runtime Snapshot passa a manter, dentro do Auth Profile não sensível:

```json
{
  "target": {
    "source": "SCENARIO_RUNTIME",
    "apiServiceKey": "discovered-...",
    "path": "/prod/oauth/token",
    "method": "POST"
  }
}
```

A Base URL continua vindo de `runtimeSnapshot.apiServices[apiServiceKey]`.

O Runner Control devolve o target congelado e resolve somente credentials JIT.

### Auth exchange no Runner

Fluxo:

```text
Run / Runtime Snapshot
→ Auth Profile REQUIRED
→ Runner Control /auth-material
→ credentials JIT
→ POST login endpoint
→ token em memória
→ Authorization: Bearer <token>
→ requests de teste
→ descarta token
```

O exchange dinâmico:

- passa pelo Egress/SSRF Guard;
- usa origin congelada;
- bloqueia redirects;
- respeita timeout;
- limita request e response;
- trata network/timeout/5xx como retryable;
- trata 4xx do login como erro permanente de auth;
- nunca persiste body, password ou token.

### Cache por attempt

Um Auth Profile dinâmico é resolvido uma vez por attempt.

Exemplo com 3 cenários REQUIRED usando o mesmo profile:

```text
requiredScenarioCount = 3
resolvedProfileCount = 1
dynamicExchangeCount = 1
cacheHitCount = 2
```

## Console

A UI passa a oferecer:

- `Mesmo origin do runtime/teste (zero-config)`;
- `API Service configurada`;
- Body JSON ou Form URL Encoded;
- nomes dos campos username/password;
- static fields JSON;
- token em JSON/Header;
- preset `OAuth Password / Form`.

O preset configura:

```text
runtime_origin
form-urlencoded
username
password
grant_type=password
access_token
Authorization
Bearer
```

O usuário ainda deve confirmar o `path` e o `tokenJsonPath` reais da aplicação.

## Compatibilidade

- Auth Profile `login_http_json` antigo continua funcionando com `bodyEncoding=json` implícito.
- Dynamic Auth com `apiServiceKey` antigo continua como `targetMode=api_service` implícito.
- `oauth2_client_credentials` também pode usar `targetMode=runtime_origin`.
- Não há migration D1 nesta Foundation; `config_json` já suporta os novos campos.

## Segurança

Continuam proibidos em persistência/logs:

```text
password
username quando usado como credential material
access token
refresh token
Authorization value
clientSecret
API key
JWT
```

`staticBody` não aceita campos com nomes sensíveis. Em `form`, aceita somente valores escalares e nomes seguros.

## Estado

```text
Gateway tests                 PASS
Gateway full test:all         PASS
Runner regression 07.7.3-8   PASS
Runner 07.7.8-A               PASS
Console source-level test     PASS
Console full build            não executado no pacote de referência: dependencies ausentes
Production gate               PENDING
```

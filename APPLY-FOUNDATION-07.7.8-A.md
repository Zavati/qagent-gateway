# Apply — Foundation 07.7.8-A Dynamic Form / OAuth Password

## Ordem de deploy

### 1. Gateway

```bash
npm ci
npm run check:07.7.8-a
npm run test:all
npm run deploy
```

Não há migration D1.

### 2. Runner

```bash
npm ci
npm run check:07.7.8-a
npm run deploy
```

Manter:

```text
RUNNER_HTTP_EXECUTION_ENABLED=true
RUNNER_ASSERTION_ENGINE_ENABLED=true
RUNNER_AUTH_RUNTIME_ENABLED=true
RUNNER_HTTP_ALLOW_SIDE_EFFECT_METHODS=false
RUNNER_HTTP_MAX_REDIRECTS=0
RUNNER_HTTP_ALLOW_INSECURE_HTTP=false
```

Não configurar Secret Vault master key no Runner.

### 3. Console

Aplicar o patch 07.7.8-A no repo atual e executar:

```bash
npm ci
npm run test:f07-7-8-a
npm run build
npm run deploy
```

## Configuração do smoke Buggy Cars

Para validar login dinâmico sem token estático:

1. crie/ative um Auth Profile `HTTP Login (JSON / Form)`;
2. target: `Mesmo origin do runtime/teste (zero-config)`;
3. path: `/prod/oauth/token`;
4. aplique `Preset OAuth Password / Form`;
5. confirme `usernameField=username` e `passwordField=password`;
6. static fields: `{ "grant_type": "password" }`;
7. token source: JSON;
8. token path: use o campo REAL retornado pelo login (normalmente `access_token`, mas confirmar no response);
9. target header: `Authorization`;
10. scheme: `Bearer`;
11. salve username/password no Secret Vault para STG.

### Atenção ao auto-match

Se o projeto mantiver simultaneamente o Bearer estático e o Login dinâmico como dois profiles compatíveis no mesmo Environment, o 07.7.8-B deve retornar `AMBIGUOUS` por segurança.

Para o smoke, deixe somente um Auth Profile compatível ativo/configurado em STG, ou faça seleção explícita quando essa UI existir.

## Tail

```bash
npx wrangler tail qagent-runner --format pretty
```

Esperado para 3 cenários com o mesmo Auth Profile:

```text
run_auth_runtime_summary
requiredScenarioCount = 3
resolvedProfileCount = 1
dynamicExchangeCount = 1
cacheHitCount = 2
profiles[0].targetSource = SCENARIO_RUNTIME
profiles[0].bodyEncoding = form
profiles[0].targetPath = /prod/oauth/token
```

Depois:

```text
run_http_scenario_result
statusCode = 200
```

para os requests autenticados e assertions determinísticas.

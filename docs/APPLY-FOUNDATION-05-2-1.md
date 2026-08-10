# Foundation 05.2.1 — CORS Fix

Corrige o preflight CORS para os endpoints de configuração de IA.

## Alterações
- Access-Control-Allow-Methods passa a aceitar GET, POST, PUT, DELETE e OPTIONS.
- Adiciona Vary: Origin.
- Testes cobrem PUT, DELETE e Authorization.

## Aplicação
Copie os arquivos sobre a Foundation 05.2 atual:
- src/lib/http.js
- test/run-tests.js

Depois rode:

```bash
npm run test:all
npx wrangler dev --port 8787
```

Não contém wrangler.jsonc, migrations ou secrets.

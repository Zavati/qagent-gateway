# Gateway 1.0.18 — alterações verificáveis

Base: `qagent-gateway-1.0.17-FULL-TEST-COMPLETO.zip`

SHA-256: `a46eb6538f7e62cfb918aae455a6225b6e7eaebf324178bf23463ccc43bcef52`

Base disponível na conversa; não é verificação do checkout/deployment atual.

| Operação | Arquivo |
|---|---|
| MODIFY | `.gitignore` |
| MODIFY | `package-lock.json` |
| MODIFY | `package.json` |
| MODIFY | `src/index.js` |
| MODIFY | `src/lib/licenseService.js` |
| ADD | `src/lib/trialConfig.js` |
| ADD | `test/trial-duration-config.test.mjs` |
| ADD | `test/trial-extension.test.mjs` |
| ADD | `test/trial-tools.test.mjs` |
| ADD | `tools/configure-trial.mjs` |
| ADD | `tools/extend-trials.mjs` |
| ADD | `tools/trial-extension-lib.mjs` |
| ADD | `tools/trial-tools-lib.mjs` |
| MODIFY | `wrangler.jsonc` |

14 caminhos alterados; 564 arquivos da base permanecem byte a byte idênticos. Dependências não mudaram. O lockfile mudou somente nas duas versões raiz.

`wrangler.jsonc` recebeu apenas `QAGENT_TRIAL_DAYS`. O checker aplica essa entrada sem substituir suas outras variáveis/IDs/bindings locais.

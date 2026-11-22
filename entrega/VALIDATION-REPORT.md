# Gateway 1.0.18 — validação da alteração de trial

## Base e escopo
Base: qagent-gateway-1.0.17-FULL-TEST-COMPLETO.zip.
SHA-256: a46eb6538f7e62cfb918aae455a6225b6e7eaebf324178bf23463ccc43bcef52.
Base disponível no chat, não commit/deployment verificado. Somente Gateway alterado.

## Executado nesta rodada
- 73 novos testes Node passaram: configuração 30/90, valores inválidos, signup antes de side effects, ausência de extensão automática, fallback pago preservado; prévia sem escrita, extensão vigente/vencida, identidade/plano preservados, revogação/billing/metadata/TTL físico, conflito, repetição idempotente, perda de confirmação, rollback protegido, parser JSONC e adaptação de comandos Wrangler.
- 98 comandos de teste existentes, executados diretamente a partir de package.json: 98/98 na base e 98/98 na saída. Não são 98 casos individuais; cada comando pode executar vários casos. `test:all` (agregador) e integração PowerShell remota não foram duplicados/executados.
- 10 controles do checker de integração passaram: dry-run sem escrita, conflito, aplicação, repetição, preservação de flag UI e de QAGENT_TRIAL_DAYS=90, rollback e proteção contra alterações posteriores.
- node --check: src/index.js, src/lib/licenseService.js e src/lib/trialConfig.js passaram.
- Dependências do package-lock idênticas; mudanças somente em versões raiz 1.0.17 -> 1.0.18.

## Real versus simulado
Os testes são os runners Node reais do projeto e os novos node:test, sem adaptador Vitest alternativo. As APIs de infraestrutura externas (KV, Wrangler subprocess, transporte e serviços) usam fixtures/stubs locais nos testes. Não equivalem a consultar/escrever no KV remoto nem a um smoke Chrome/Cloudflare. A ferramenta administrativa foi verificada com adapter de comandos simulado; não usou credenciais reais.

## Não executado / limitações
- Deploy e extensão de licenças reais NÃO executados.
- Não há conector Cloudflare disponível nesta sessão; a busca de integração não retornou plugin utilizável.
- npm ci não concluiu dentro do limite local da tentativa; npm ping falhou com EAI_AGAIN para registry.npmjs.org. Wrangler não ficou disponível; bundling/dry-run oficial não foi homologado.
- Nenhuma afirmação de lock distribuído ou atomicidade de atualização KV: manutenção com escritor único é pré-requisito operacional para apply/rollback.
- Igualdade do registro numa leitura pós-write não prova propagação global instantânea.
- O checker preserva outras edições locais, mas não certifica sua compatibilidade; conflitos nos caminhos alterados precisam de integração.

## Evidências
`logs/regression.json` registra cada comando e exit code. `logs/new-tests.log`, `logs/checker-tests.json`, `logs/npm-ping.log` e logs individuais das rotinas acompanham esta entrega. O SHA do ZIP final é entregue separadamente.

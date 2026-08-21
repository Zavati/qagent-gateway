# qagent-gateway

## Blueprint técnico

- Veja o plano de evolução de autenticação + pagamento em `docs/blueprint-auth-billing.md`.
- Veja a decomposição em tickets por fase em `docs/tickets-auth-billing-rollout.md`.
- Veja o plano de kickoff para início da implementação em `docs/implementation-kickoff-auth-billing.md`.

## Métricas de migração (BE-3003)

As métricas de adoção de credencial são armazenadas diariamente no KV com estrutura:

**Chave KV:** `metrics:migration:{YYYY-MM-DD}:tenant:{tenant-id}:cohort:{cohort-id}`

**Valores rastreados:**
- `requestsTotal` — total de requests no endpoint `/v1/license`
- `requestsSuccess` — requests com status 2xx
- `credentialClientKey` — contagem de novas `clientKey`
- `credentialLegacyToken` — contagem de tokens legados
- `errors401` / `errors403` — erros de autenticação
- `legacyAccepted` / `legacyBlocked` — tokens legados aceitos ou bloqueados pela janela

**Agregados:**
- Tenant/cohort específico: `tenant:{id}:cohort:{id}`
- Global: `tenant:all:cohort:all`

**Query exemplo (CLI):**
```bash
wrangler kv:key get --namespace-id=<KV_ID> "metrics:migration:2026-02-19:tenant:all:cohort:all"
```

**Exemplo de resposta:**
```json
{
  "day": "2026-02-19",
  "tenant": "all",
  "cohort": "all",
  "requestsTotal": 150,
  "requestsSuccess": 145,
  "credentialClientKey": 80,
  "credentialLegacyToken": 70,
  "errors401": 2,
  "errors403": 3,
  "legacyAccepted": 67,
  "legacyBlocked": 3,
  "updatedAt": "2026-02-19T14:30:12.345Z"
}
```

---npm install --pasta backend
Run backend remote 
npx wrangler dev --remote

run backend local 
npx wrangler dev --remote --port 8787
npx wrangler dev --local --port 8787



1) Como o QAgent funciona hoje (arquitetura completa)

Pensa em 4 “peças”:

A) Popup (UI da extensão)

É a telinha com abas (Run / IA / Export etc).

Ela faz 3 coisas principais:

manda “Ler tela” (scan)

manda “Gerar casos” (IA)

renderiza/exporta resultado

📌 O popup não faz IA e não chama OpenAI direto.

B) Content Script (rodando na página do Jira)

É o código que você injeta na aba ativa (Jira).

Quando você clica “Ler tela”, ele:

detecta se está em Jira

extrai issueKey, title, description

monta um objeto scan e devolve pro popup

📌 Ele só lê/extraí. Não faz requests externos sensíveis.

C) Service Worker (background da extensão)

É o “cérebro” que recebe mensagens do popup e:

injeta content scripts (quando precisa)

chama o gateway (Cloudflare Worker)

retorna resposta pro popup

Fluxo típico:

Popup → chrome.runtime.sendMessage → Service Worker → fetch → Gateway → volta.

📌 Tudo que é “rede / API / backend” passa por aqui.

D) Gateway (Cloudflare Worker em api.apiqagent.com)

Esse é o teu backend em produção.

Ele tem rotas:

GET /v1/license → cria trial automaticamente no KV

POST /v1/generate-tests → chama OpenAI e devolve JSON com os casos

/health, /debug, etc

E ele faz as proteções:

só aceita host api.apiqagent.com (bloqueia *.workers.dev)

valida token (Authorization Bearer)

rate limit

payload limit

trial gating (trial/active ok, expired bloqueia)

2) O que significa “trial automático”
Como acontece o trial

o plugin manda: GET /v1/license com Authorization: Bearer <token>

o gateway olha o KV:

se não existe licença pra aquele token → cria:

status: trial

expiresAt: now + 6 dias

se existe e já passou do expiresAt → vira expired

o gateway devolve:

status + daysLeft

Isso é ótimo porque:

qualquer pessoa que instalar já entra em trial

sem cadastro

sem login

backend controla tudo

📌 O token é o “identificador” do usuário nesse MVP.

3) Fluxo completo “Gerar casos” (o caminho real)
Quando você clica em “Gerar casos”

Popup valida que você fez scan e está no Jira

Popup pede ao storage um token (ou cria um novo)

Popup pede status da licença via background:

QAGENT_LICENSE_GET

Background chama:

GET https://api.apiqagent.com/v1/license

Se a licença estiver OK:

popup chama QAGENT_GENERATE

Background chama:

POST https://api.apiqagent.com/v1/generate-tests

Gateway valida:

token permitido

trial/active

rate limit

chama OpenAI

Volta JSON com os casos → popup renderiza → exporta

---

4) Novo endpoint: POST /v1/autofill (contrato e testes)

Resumo do contrato (obrigatório)

Endpoint: POST /v1/autofill
Headers:
- Content-Type: application/json
- Optional: Authorization: Bearer <token> (mesma lógica que /v1/generate-tests)
- Optional: X-QAgent-License: <license> (o SW pode enviar o token por esse header)
Timeout: 20–30s (Worker aborta com timeout)

Payload esperado (do popup → background → backend)
{
  url: string,
  title?: string,
  elements: [
    {
      selector: string,
      label?: string,
      name?: string,
      id?: string,
      placeholder?: string,
      kind?: "input"|"textarea"|"select",
      type?: string|null,
      semantic?: string|null,
      maxlength?: number|null,
      minlength?: number|null,
      min?: string|null,
      max?: string|null,
      pattern?: string|null
    },
    ...
  ],
  meta?: { source: "popup.autofill", ts: number }
}

Resposta esperada do backend
Success (200): { actions: [ { selector: string, value?: string, simulate?: boolean, delayMs?: number, check?: boolean, radio?: boolean, hint?: {...} }, ... ] }
Em erros: status apropriado (4xx/5xx) e um body JSON com message.

Regras / validação no backend
- Validar cada ação: selector obrigatório, tipo e tamanho do value razoável (ex: < 2000 chars), não permitir código JS embutido (recusar javascript:), sanitizar strings.
- Retornar apenas ações com selectors válidos (ou explicar quais foram descartadas nos logs).
- Rate-limit e autenticação: mesma política que /v1/generate-tests.
- CORS: permitir requisições vindas do popup (ou deixar o SW chamar direto ao mesmo domínio, mas CORS precisa estar ok para debugging).
- Logging minimal (req id, url, decisões) para diagnóstico.

Implementação incremental / testes
- Rota /v1/autofill no Worker que valida e retorna actions (mock).
- Test local: apontar iaFillUrl no popup → habilitar iaAssist → acionar preenchimento; ver logs do SW (service worker) e devolver ações mock (ex.: set value para alguns selectors).
- Validar flow end-to-end: popup → SW QAGENT_AUTOFILL → backend → SW retorna actions → popup aplica via QAGENT_FILL.

Testando localmente com mock SW

- Inicie o Worker localmente (ex.: `npx wrangler dev --local --port 8787`).
- Execute o mock do SW para simular o background chamando o endpoint:

```bash
QAGENT_AUTOFILL_URL=http://127.0.0.1:8787/v1/autofill QAGENT_TEST_TOKEN=<token> npm run mock-sw
```

- O script exibirá status e o JSON retornado. Ajuste `QAGENT_TEST_TOKEN` para um token válido (>= 24 chars) para evitar validação de token no backend.





rodar local 19/02
cd C:\git\qagent-gateway
npm install
$env:STRIPE_SECRET_KEY="sk_test_..."
$env:STRIPE_WEBHOOK_SECRET="whsec_..."
$env:WEBHOOK_SIGNING_SECRET="dev-webhook-secret"
$env:STRIPE_PRICE_ID="price_..."
$env:STRIPE_SUCCESS_URL="https://example.com/success"
$env:STRIPE_CANCEL_URL="https://example.com/cancel"
$env:BASE_URL="http://localhost:8787"
$env:CLIENT_KEY="qagent_live_xxx"   # do signup
$env:EMAIL_DISPATCH_WEBHOOK_URL = 'http://127.0.0.1:3030'
$env:CLIENT_KEY = 'qag_test_gpwz8H70Dnj0cRPy36oZr81Po90WXS3Dm4MlhCUT'
$env:WEBHOOK_SECRET = 'dev-webhook-secret-change-in-production'
$env:MAILERSEND_API_KEY = 'mlsn'
npx wrangler dev
npm run dev


para secrete SESSION_SECRET usar o comando 
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
Para gerar. 


Atualizar prod 
# will prompt to paste the secret
npx wrangler secret put MAILERSEND_API_KEY


teste web hook 
$env:WEBHOOK_SIGNING_SECRET='dev-webhook-secret-change-in-production'
$env:CLIENT_KEY = $env:CLIENT_KEY
.\test\sign-and-send.ps1


20/02
Resumo curto — status atual

Pronto: integração Stripe básica, endpoint de checkout, normalização de eventos, verificação de assinatura (HMAC + Stripe fallback), persistência idempotente em KV, fallback de reconciliação (stripe:cust: / stripe:sub:), scripts test/sign-and-send.*.
Faltando (recomendado antes de produção):
Config ops: garantir variáveis de ambiente em produção (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID, STRIPE_SUCCESS_URL, STRIPE_CANCEL_URL, QAGENT_KV, WEBHOOK_SIGNING_SECRET se usado).
Testes automatizados: unidade/integração para reconciliação e idempotência (recomendo adicionar antes do deploy).
Endpoint de debug: GET /debug/payment-event/:provider/:eventId para inspecionar eventos processados (útil em staging/produção inicial).
Documentação / scripts: finalizar docs/test/integration-tests.md e adicionar npm script para sign-and-send.
Observabilidade: logs/alertas para falhas de webhook e eventos repetidos; métricas de KV erros.
Segurança/ops: roll de segredos, validar quem tem acesso ao webhook secret, usar secret manager, revisar rate limits e retries.
Validação final: testar em Stripe Test Mode com cartões de teste (ex.: 4242...), confirmar que o webhook chega e a licença transita para active.
Checklist mínimo para subir e testar em produção (ou em staging real):

Env: configurar todas as variáveis listadas acima no ambiente do Worker.
Webhook no Stripe: apontar o webhook para a URL publicada e salvar o STRIPE_WEBHOOK_SECRET (o código usa isso quando presente).
KV: confirmar binding QAGENT_KV existe e tem capacidade.
Deploy: npx wrangler publish (ou o processo de CI/CD que você usa).
Testes manuais: criar uma sessão de Checkout em Test Mode, completar compra com cartão de teste, observar:
evento recebido com assinatura válida,
evento salvo em KV (payment_event:stripe:<eventId>),
stripe:cust:<id>/stripe:sub:<id> gravados (se aplicável),
licença transitada para active.
Não usar cartão real até validar comportamento de retries/erros e logs; depois, se desejar, testar com produção real e monitorar cobranças.
Quer que eu:

A) implemente agora o endpoint debug GET /debug/payment-event/:provider/:eventId, ou
B) adicione os testes automatizados para reconciliação/idempotência, ou
C) crie o npm script que executa sign-and-send.sh e finalize integration-tests.md?
Responda A, B ou C (ou combine) que eu inicio a tarefa escolhida.}



📋 Resumo do que alterar (ordem de prioridade)
Variável	Status	Teste	Produção	Prioridade
STRIPE_SECRET_KEY	❌ Crítica	sk_test_...	sk_live_...	🔴 1️⃣ AGORA
STRIPE_WEBHOOK_SECRET	❌ Crítica	whsec_test_...	whsec_live_...	🔴 1️⃣ AGORA
STRIPE_PRICE_ID	⚠️ Funcional	price_test_...	price_live_...	🟠 2️⃣ Junto
STRIPE_SUCCESS_URL	✅ Opcional	(vazio)	https://app.apiqagent.com/billing/success	🟡 3️⃣ Recomendado
STRIPE_CANCEL_URL	✅ Opcional	(vazio)	https://app.apiqagent.com/billing/cancel	🟡 3️⃣ Recomendado

## Phase 2 — AI Engine

O Gateway possui uma camada interna independente de fornecedor para recursos de IA.

Configuração local padrão:

```text
AI_PROVIDER=openai
GENERATE_TESTS_MODEL=gpt-4o-mini
AUTOFILL_MODEL=gpt-4o-mini
```

Detalhes em `docs/phase2-foundation-03-ai-engine.md`.

## Phase 2 — BYOAI local foundation

A configuração de IA por conta foi introduzida na Foundation 04. Veja:

`docs/phase2-foundation-04-byoai-config.md`

Primeiro setup local após atualizar:

```bash
npm run db:migrate:local
npm run test:all
npx wrangler dev --port 8787
```

A chave `AI_CREDENTIALS_KEY_V1` deve existir somente em `.dev.vars` local ou como secret no ambiente implantado.


Comando node para gerar chave aleatoria 
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
---

## Foundation 07.6.5-C — Test Registry Persistence

The Test Design POST now persists the final validated `qagent.test-spec.v1` in the independent Test Registry through the Cloudflare `TEST_REGISTRY_SERVICE` binding.

Validation commands:

```bash
npm run check:07.6.5-c
npm run test:all
```

The Browser never calls the Registry directly. Gateway tenant/project authorization remains authoritative.


## Foundation 07.6.5-D — Retrieval API

O Gateway expõe `GET /v1/console/projects/:projectId/intelligence/endpoints/:endpointId/test-design` para recuperar a latest immutable Test Design Version via `TEST_REGISTRY_SERVICE`, após autenticação Console e autorização do Project. Consulte `FOUNDATION-07.6.5-D.md` e `APPLY-FOUNDATION-07.6.5-D.md`.

## Foundation 07.7.2 — Run Contract + Execution Plan

O Gateway cria Runs imutavelmente vinculados a `testDesignVersionId`, Environment, Runtime Snapshot e Execution Plan. Somente cenários `READY` são aceitos; nenhum HTTP é executado nesta Foundation.

## Foundation 07.7.2-A — Execution Readiness Bridge Hardening

O Catalog Context Builder v1.1 separa identidade lógica do API Service da resolução física de Environment. Um origin observado pode resolver um único `apiServiceKey` mesmo quando o `environmentId` observado pelo Knowledge Layer não coincide com o ID do Environment configurado no Control Plane. Ambiguidade continua fail-closed.

Validação:

```bash
npm run check:07.7.2-a
npm run test:all
```

Consulte `FOUNDATION-07.7.2-A.md` e `APPLY-FOUNDATION-07.7.2-A.md`.

## Foundation 07.7.2-A FIX-2 — Observed Auth Signal Bridge

Gateway support is implemented for safe optional Catalog Evidence fields `authObserved` and `authScheme`.

The deterministic bridge converts observed authentication into system-owned Test Specification auth requirements and fails closed to `NEEDS_AUTH` when a compatible Auth Profile is unavailable.

Production activation also requires upstream propagation through Plugin → Observation → Normalizer → Catalog. See:

- `FOUNDATION-07.7.2-A-FIX-2.md`
- `UPSTREAM-AUTH-SIGNAL-CONTRACT-07.7.2-A-FIX-2.md`
- `APPLY-FOUNDATION-07.7.2-A-FIX-2.md`

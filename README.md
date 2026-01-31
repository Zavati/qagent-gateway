# qagent-gateway


npm install --pasta backend
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
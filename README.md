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
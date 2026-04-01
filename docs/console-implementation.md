# Console QAgent — Plano de Implementação

Este documento descreve um plano pragmático para implementar a área logada (console web) por cima dos endpoints já existentes no gateway.

## 1. Objetivo

Oferecer um painel simples onde o usuário possa:

- Entrar com email/senha (ou redefinir senha).
- Ver status da licença (trial/ativa, plano, dias restantes).
- Ver e rotacionar sua clientKey (token usado na extensão).
- Ver histórico básico de pagamentos.

Foco: fluxo funcional e seguro, sem necessidade de UI complexa no primeiro release.

## 2. Endpoints disponíveis (backend pronto)

Autenticação e conta:

- `POST /v1/signup-trial` — cria trial + (opcionalmente) usuário com senha.
- `POST /v1/auth/login` — autentica e retorna `session.token`.
- `GET /v1/auth/me` — valida sessão e retorna `user`, `session`, `license`.
- `POST /v1/auth/forgot-password` — recebe `email`, envia link mágico de reset.
- `POST /v1/auth/reset-password` — recebe `token` + nova senha, troca senha e opcionalmente já loga.

Console (requer `Authorization: Bearer <sessionToken>`):

- `GET /v1/console/license` — retorna licença consolidada + lista de clientKeys.
- `GET /v1/console/payments` — retorna lista de pagamentos recentes.
- `POST /v1/console/rotate-clientkey` — gera nova clientKey principal e revoga a anterior.
- `POST /v1/console/clientkeys` — cria uma clientKey **adicional** para o mesmo customerId, sem revogar as existentes.
   - Opcional futuro: `POST /v1/console/clientkeys/revoke` para revogar uma key específica.

## 3. Stack sugerida

Sugestão mínima para começar rápido:

- **Frontend**: app SPA simples (React/Next.js ou mesmo uma página única estática com JS + fetch).
- **Autenticação**: guardar `sessionToken` em `localStorage` ou `sessionStorage`, e enviar em `Authorization: Bearer` em todas as chamadas.
- **Build/Deploy**: servir o console separado (por exemplo em `app.apiqagent.com`) apontando para o gateway `api.apiqagent.com`.

Pode ser iterado depois para algo mais estruturado (Next.js, Tailwind, etc.).

## 4. Fluxos principais

### 4.1 Login

1. Tela `/login` com campos `email` e `password`.
2. Ao enviar, chamar `POST /v1/auth/login`.
3. Se sucesso:
   - Guardar `session.session.token` em `localStorage`.
   - Redirecionar para `/dashboard`.
4. Em erro 401, mostrar mensagem genérica: "Email ou senha inválidos." (backend já mantém mensagem genérica).

### 4.2 Esqueci minha senha

1. Link na tela de login: "Esqueci minha senha" levando para `/forgot-password`.
2. Tela com campo `email` e botão.
3. Ao enviar, chamar `POST /v1/auth/forgot-password`.
4. Independente da existência da conta, backend responde 200 com mensagem genérica; front exibe algo como:
   - "Se encontrarmos uma conta com este email, enviaremos um link de recuperação."

### 4.3 Resetar senha via link mágico

1. A partir do email, usuário clica em link do tipo:
   - `https://app.apiqagent.com/reset-password?token=fpw_...`
2. Tela `/reset-password`:
   - Lê `token` da query string.
   - Exibe campos `password` e `passwordConfirmation`.
3. Ao enviar, chamar `POST /v1/auth/reset-password` com:

   ```json
   {
     "token": "<token_da_url>",
     "password": "NovaSenha123",
     "passwordConfirmation": "NovaSenha123"
   }
   ```

4. Se sucesso, backend pode retornar já uma nova `session`:
   - Guardar `session.token` e redirecionar para `/dashboard`.
5. Em erro (token inválido/expirado), mostrar mensagem genérica e sugerir pedir um novo link.

### 4.4 Dashboard (visão geral)

Rota protegida `/dashboard` (só acessível se houver `sessionToken` válido; caso contrário redirecionar para `/login`).

Ao montar a página:

1. Chamar `GET /v1/auth/me` com `Authorization: Bearer <sessionToken>`.
2. Se 401, limpar sessão local e redirecionar para `/login`.
3. Mostrar:
   - Email do usuário.
   - Status da licença (`status`, `plan`, `daysLeft`).
   - Prefixo da clientKey atual (se vier na `license`/`clientKeys`).

### 4.5 Licença + clientKeys

Na mesma `/dashboard` ou em página `/license`:

1. Chamar `GET /v1/console/license`.
2. Exibir:
   - Bloco "Minha licença": status, plano, `expiresAt`, `daysLeft`.
   - Tabela/Lista "Minhas chaves": para cada item de `clientKeys`:
     - `label` (ex.: `signup-trial`, `rotated`).
     - `prefix` (exibir apenas o prefixo, nunca a chave inteira).
     - `createdAt`, `revokedAt`.

### 4.6 Rotacionar clientKey

Na mesma tela de chaves:

1. Botão "Gerar nova chave".
2. Ao clicar, chamar `POST /v1/console/rotate-clientkey`.
3. Em sucesso:
   - Resposta incluirá `clientKey` completa + resumo de licença.
   - Mostrar a nova `clientKey` em um modal, com instrução clara para copiar e salvar.
   - Atualizar a lista de `clientKeys` chamando novamente `GET /v1/console/license`.

### 4.7 Histórico de pagamentos

Página `/payments` ou seção no dashboard:

1. Chamar `GET /v1/console/payments`.
2. Exibir tabela com colunas:
   - Data (`occurredAt`).
   - Provedor (`provider`).
   - Tipo/descrição (`type`).
   - Valor (`amount` + `currency`, quando presentes).
   - Status (`status`).
   - Link para evento no provedor (quando `link` vier preenchido).

## 5. Tarefas de implementação (frontend)

Checklist sugerido para amanhã:

1. **Infra básica**
   - [ ] Criar projeto frontend (ex.: Next.js/React) em repositório próprio ou pasta separada.
   - [ ] Configurar `.env` com `API_BASE_URL` apontando para o gateway.
   - [ ] Criar helper de `apiClient` para fazer `fetch` com `Authorization: Bearer <sessionToken>` quando existir.

2. **Autenticação**
   - [ ] Implementar página `/login` com consumo de `POST /v1/auth/login`.
   - [ ] Implementar armazenamento do `sessionToken` (localStorage/sessionStorage).
   - [ ] Criar HOC/guard (ou hook) para rotas protegidas (`/dashboard`, `/license`, `/payments`).

3. **Fluxo de senha**
   - [ ] Implementar página `/forgot-password` consumindo `POST /v1/auth/forgot-password`.
   - [ ] Implementar página `/reset-password` lendo `token` da URL e chamando `POST /v1/auth/reset-password`.

4. **Dashboard e console**
   - [ ] Implementar `/dashboard` chamando `GET /v1/auth/me`.
   - [ ] Implementar seção/página de licença consumindo `GET /v1/console/license`.
   - [ ] Implementar botão de rotação de clientKey usando `POST /v1/console/rotate-clientkey` e exibindo a nova chave.
   - [ ] Implementar página/aba de pagamentos usando `GET /v1/console/payments`.

5. **UX e ajustes finais**
   - [ ] Tratar erros HTTP (401, 4xx, 5xx) com mensagens amigáveis.
   - [ ] Adicionar loading states nas chamadas assíncronas.
   - [ ] Garantir que ao deslogar (botão "Sair") o `sessionToken` seja removido e usuário volte para `/login`.

Com esse plano, o backend atual já cobre tudo; o foco amanhã passa a ser apenas a implementação da camada de UI consumindo os endpoints acima.

## 6. Stack recomendada (UI moderna)

Para ter algo atual, bonito e com boa DX, a sugestão é:

- **Framework**: Next.js 15+ (App Router) com React 18.
- **Linguagem**: TypeScript.
- **Estilos**: Tailwind CSS.
- **Componentes/UI**: shadcn/ui (ou outro kit de componentes baseado em Radix UI).
- **Ícones**: Lucide Icons.

Benefícios:

- Rotas e layouts já resolvidos (App Router) para `/login`, `/dashboard`, etc.
- Fácil de colocar temas, tipografia e espaçamentos consistentes.
- Rápido para chegar em uma UI limpa, responsiva e moderna.

### 6.1. Convenções gerais

- Configurar `NEXT_PUBLIC_API_BASE_URL` apontando para o gateway (ex.: `https://api.apiqagent.com`).
- Criar um pequeno cliente de API que:
   - Lê `sessionToken` de `localStorage`/`sessionStorage` (apenas no client side).
   - Envia `Authorization: Bearer <sessionToken>` quando existir.
   - Centraliza tratamento de erros (401, 4xx, 5xx).

## 7. Estrutura de pastas frontend (sugestão)

Estrutura mínima sugerida para o projeto Next.js (App Router):

```text
frontend/
   app/
      layout.tsx
      page.tsx                 # root (pode redirecionar para /dashboard ou /login)
      login/
         page.tsx
      forgot-password/
         page.tsx
      reset-password/
         page.tsx
      dashboard/
         page.tsx
      license/
         page.tsx
      payments/
         page.tsx
   components/
      ui/                      # componentes base (botão, input, card etc. - shadcn/ui)
      layout/
         Shell.tsx              # layout com header, sidebar, etc.
      auth/
         LoginForm.tsx
         ForgotPasswordForm.tsx
         ResetPasswordForm.tsx
      console/
         LicenseSummary.tsx
         ClientKeysList.tsx
         RotateClientKeyModal.tsx
         PaymentsTable.tsx
   lib/
      apiClient.ts             # helper para chamadas HTTP com Bearer token
      auth.ts                  # helpers para login/logout, getSessionToken
      routes.ts                # caminhos de rotas centralizados (opcional)
   styles/
      globals.css
      tailwind.css
   public/
      favicon.ico
      logo.svg
```

### 7.1. Guardas de rota (rotas protegidas)

- Rotas `/dashboard`, `/license` e `/payments` devem ser protegidas.
- No App Router, isso pode ser feito com:
   - **Middleware** lendo cookies/localStorage (dependendo da estratégia) e redirecionando para `/login` se não houver sessão.
   - Ou um **Client Component** que checa sessão via hook (ex.: `useRequireAuth`) antes de renderizar o conteúdo.

## 8. Resumo de rotas e payloads (frontend ↔ backend)

Abaixo uma consolidação rápida das rotas de frontend e dos payloads esperados pelos endpoints do gateway.

### 8.1. Mapa de rotas do frontend

- `/login`
   - Tela de login.
   - Chama `POST /v1/auth/login`.
- `/forgot-password`
   - Tela de recuperação de senha.
   - Chama `POST /v1/auth/forgot-password`.
- `/reset-password?token=...`
   - Tela de definição de nova senha.
   - Lê `token` da query string.
   - Chama `POST /v1/auth/reset-password`.
- `/dashboard`
   - Visão geral da conta.
   - Chama `GET /v1/auth/me` (e opcionalmente `GET /v1/console/license`).
- `/license`
   - Detalhes da licença e clientKeys.
   - Chama `GET /v1/console/license` e `POST /v1/console/rotate-clientkey`.
- `/payments`
   - Histórico de pagamentos.
   - Chama `GET /v1/console/payments`.

### 8.2. `POST /v1/auth/login`

**Request (frontend → backend):**

```json
{
   "email": "user@example.com",
   "password": "SenhaForte123"
}
```

**Response (backend → frontend, forma aproximada):**

```json
{
   "version": "v1-2026-02-19",
   "status": "ok",
   "user": {
      "userId": "usr_...",
      "email": "user@example.com",
      "name": "User Name"
   },
   "session": {
      "token": "sess_...",
      "createdAt": "2026-02-25T10:00:00.000Z",
      "expiresAt": "2026-03-25T10:00:00.000Z"
   },
   "license": {
      "status": "trial",
      "plan": "starter",
      "daysLeft": 13
   }
}
```

O front **precisa** guardar `session.token` (por exemplo em `localStorage`) e usar esse valor como Bearer token nas chamadas autenticadas.

### 8.3. `POST /v1/auth/forgot-password`

**Request:**

```json
{
   "email": "user@example.com"
}
```

**Response (sempre 200 se formato válido):**

```json
{
   "version": "v1-2026-02-19",
   "status": "ok"
}
```

O front sempre exibe uma mensagem genérica de sucesso, sem indicar se o email existe ou não.

### 8.4. `POST /v1/auth/reset-password`

Já exemplificado acima, consolidando aqui:

**Request:**

```json
{
   "token": "fpw_...",
   "password": "NovaSenha123",
   "passwordConfirmation": "NovaSenha123"
}
```

**Response (pode já incluir sessão):**

```json
{
   "version": "v1-2026-02-19",
   "status": "ok",
   "session": {
      "token": "sess_...",
      "expiresAt": "2026-03-25T10:00:00.000Z"
   }
}
```

Se vier `session.token`, o front já pode considerar o usuário logado e redirecionar para `/dashboard`.

### 8.5. `GET /v1/auth/me`

**Headers:**

```http
Authorization: Bearer sess_...
```

**Response (forma aproximada):**

```json
{
   "version": "v1-2026-02-19",
   "status": "ok",
   "user": {
      "userId": "usr_...",
      "email": "user@example.com",
      "name": "User Name"
   },
   "session": {
      "token": "sess_...",
      "expiresAt": "2026-03-25T10:00:00.000Z"
   },
   "license": {
      "status": "trial|active|expired",
      "plan": "starter|pro|enterprise",
      "daysLeft": 13
   }
}
```

### 8.6. `GET /v1/console/license`

**Headers:**

```http
Authorization: Bearer sess_...
```

**Response (forma aproximada):**

```json
{
   "version": "v1-2026-02-19",
   "status": "ok",
   "license": {
      "status": "trial|active|expired",
      "plan": "starter|pro|enterprise",
      "daysLeft": 13,
      "trialEndsAt": "2026-03-05T10:00:00.000Z",
      "expiresAt": "2026-03-25T10:00:00.000Z"
   },
   "clientKeys": [
      {
         "label": "signup-trial",
         "prefix": "qag_abc123",
         "createdAt": "2026-02-20T10:00:00.000Z",
         "revokedAt": null
      }
   ]
}
```

O front sempre mostra apenas o `prefix` da chave, nunca a chave inteira.

### 8.7. `POST /v1/console/rotate-clientkey`

**Headers:**

```http
Authorization: Bearer sess_...
```

**Request body:**

Normalmente não é necessário enviar body; um objeto vazio é suficiente:

```json
{}
```

**Response (forma aproximada):**

```json
{
   "version": "v1-2026-02-19",
   "status": "ok",
   "license": {
      "status": "active",
      "plan": "starter",
      "daysLeft": 30
   },
   "clientKey": {
      "full": "qag_...",      
      "prefix": "qag_abc123",
      "label": "rotated",
      "createdAt": "2026-02-26T10:00:00.000Z"
   }
}
```

O front deve:

- Exibir `clientKey.full` **apenas uma vez** em modal (para o usuário copiar).
- Atualizar a lista chamando novamente `GET /v1/console/license`.

### 8.8. `GET /v1/console/payments`

**Headers:**

```http
Authorization: Bearer sess_...
```

**Response (forma aproximada):**

```json
{
   "version": "v1-2026-02-19",
   "status": "ok",
   "payments": [
      {
         "occurredAt": "2026-02-20T10:00:00.000Z",
         "provider": "stripe",
         "type": "invoice.paid",
         "amount": 1990,
         "currency": "usd",
         "status": "paid",
         "link": "https://dashboard.stripe.com/payments/xyz"
      }
   ]
}
```

O front transforma `amount` em valor legível (`amount / 100`, se for centavos) e exibe link do provedor quando existir.

---

Com essas seções adicionais (stack, estrutura de pastas, mapa de rotas e exemplos de payloads), o time de frontend já tem insumo suficiente para implementar o console em cima do gateway atual, com uma UI moderna e organizada.

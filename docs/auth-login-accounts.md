# Design de contas de usuário, login e console

## Objetivo

Adicionar uma camada de "conta de usuário" (email + senha + sessão) sobre o modelo atual de clientKey/licença/pagamento, sem quebrar a integração existente da extensão, permitindo:

- criação de conta com trial via `/v1/signup-trial`;
- login e sessão segura (JWT/HMAC) para área logada;
- visualização e gestão de clientKeys, licença e pagamentos em uma "console API";
- alinhamento com boas práticas de autenticação e armazenamento seguro de credenciais.

Este documento foca em design (Fase 0). Implementação virá em fases seguintes.

---

## Visão geral do modelo atual

Baseado em:
- [blueprint-auth-billing.md](./blueprint-auth-billing.md)
- [implementation-kickoff-auth-billing.md](./implementation-kickoff-auth-billing.md)
- código atual em [src/index.js](../src/index.js) e `src/lib/*`.

### Entidades existentes em KV

- `customer:{customerId}` — identidade de negócio (email, nome, empresa etc.).
- `clientkey:{keyHash}` — credencial técnica (hash da clientKey) ligada a um `customerId`.
- `license:{keyHash}` — licença associada àquela clientKey (status, plano, período, expiracão).
- `payment_event:{provider}:{eventId}` — auditoria e idempotência de pagamento.
- `stripe:cust:{providerCustomerId}` / `stripe:sub:{providerSubscriptionId}` — mapeamento Stripe → `keyHash`.
- `access_token:{tokenHash}` — tokens de acesso de 30 dias emitidos após pagamento.

### Fluxos principais atuais

1. **Trial + clientKey (signup-trial)**
   - `POST /v1/signup-trial` cria:
     - `customer:{customerId}`
     - `clientKey` + `keyHash` + `clientkey:{keyHash}`
     - `license:{keyHash}` em `status: "trial"` com ~6 dias.
   - Resposta inclui `clientKey` (texto puro) e status da licença.

2. **Uso da API premium**
   - Extensão chama `/v1/generate-tests` e `/v1/autofill` com:
     - `Authorization: Bearer <clientKey>` (ou token legado, durante migração).
   - Backend resolve licença via `getOrCreateLicense` + `assertPremiumAllowed`.

3. **Pagamento e upgrade para plano pro**
   - `POST /v1/billing/checkout` cria sessão Stripe com `metadata.clientKey`.
   - Webhook Stripe `POST /v1/webhooks/payment` valida assinatura, normaliza evento, localiza `keyHash` e aplica `applyPaymentToLicense`.
   - Para eventos bem-sucedidos (`payment.completed`), `applyPaymentToLicense` muda licença para `active` e, se período não informado pelo provedor, define `expiresAt` para +30 dias.

> Hoje não existe conceito de "usuário logado"; apenas cliente (customer) e chaves técnicas.

---

## Objetivo da nova camada de contas

Adicionar uma entidade de **usuário** e uma camada de **autenticação de sessão** para permitir uma área logada (web/app) onde o cliente pode:

- ver e gerenciar suas clientKeys;
- ver status da licença (trial vs pro, dias restantes);
- ver histórico básico de pagamentos;
- no futuro, gerenciar billing (upgrade/downgrade) e dados de perfil.

A extensão continua usando `clientKey` da mesma forma; a camada de login é complementar.

---

## Novas entidades em KV

### 1) Usuário de conta (user)

**Chave KV**  
`user:{userId}`

**Exemplo**

```json
{
  "userId": "usr_01HYYYYYYYYY",
  "email": "cliente@empresa.com",
  "passwordHash": "base64:pdkdf2:...",
  "passwordSalt": "base64:...",
  "passwordAlgo": "pbkdf2-sha256",
  "passwordIterations": 150000,
  "customerId": "cus_4a2f3c50",
  "tokenVersion": 1,
  "createdAt": "2026-02-25T12:00:00.000Z",
  "updatedAt": "2026-02-25T12:00:00.000Z",
  "lastLoginAt": null
}
```

### 2) Índice por email

**Chave KV**  
`user_by_email:{email-lowercase}` → `userId`

- Suporta lookup rápido para login.
- Garante unicidade de email (um usuário por email).

> Observação: o vínculo com billing continua via `customerId` (existente). O usuário é uma "persona" que controla aquele customer.

---

## Contratos HTTP propostos (camada de conta)

### 1) Signup trial com criação de conta

Reuso do endpoint atual com campos adicionais de senha.

`POST /v1/signup-trial`

**Headers**
- `Content-Type: application/json`

**Body (estendido)**

```json
{
  "email": "cliente@empresa.com",
  "name": "Cliente Exemplo",
  "company": "Empresa Exemplo",
  "source": "landing-page",
  "acceptTerms": true,
  "acceptPrivacy": true,
  "password": "SenhaForte!123",
  "passwordConfirmation": "SenhaForte!123"
}
```

**Comportamento**

- Validações adicionais:
  - força mínima da senha (tamanho, classes de caracteres, blacklist básica);
  - `password === passwordConfirmation`;
  - email normalizado para lowercase.
- Se já existir `user_by_email:<email>`:
  - se houver licença ativa/trial associada, retorna `409` genérico ("conta já existente"), sem expor detalhes.
- Caso contrário:
  - cria `customer`, `clientkey`, `license` como hoje;
  - cria `user` + `user_by_email` com hash de senha;
  - opcionalmente, já emite token de sessão para login imediato (ver sessão abaixo).

**Response (201)** — compatível com blueprint atual, com inclusão opcional de `sessionToken`:

```json
{
  "status": "ok",
  "customer": { "customerId": "cus_...", "email": "cliente@empresa.com" },
  "license": { "status": "trial", "plan": "pro", "trialEndsAt": "...", "daysLeft": 6 },
  "credentials": { "clientKey": "qag_test_xxx", "delivery": "webhook:email" },
  "session": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresAt": "2026-02-25T18:00:00.000Z"
  }
}
```

### 2) Login

`POST /v1/auth/login`

**Headers**
- `Content-Type: application/json`

**Body**

```json
{
  "email": "cliente@empresa.com",
  "password": "SenhaForte!123"
}
```

**Comportamento**

- Localiza `userId` em `user_by_email:<email-lower>`.
- Se não existir, retorna erro genérico `401` ("credenciais inválidas").
- Se existir, busca `user:{userId}`, recalcula hash com salt e iterações, compara em tempo constante.
- Em caso de sucesso:
  - atualiza `lastLoginAt` e, opcionalmente, `tokenVersion`;
  - gera token de sessão assinado (ver abaixo);
  - responde com token e metadados de expiração.
- Aplica rate limit por IP/email e lockout curto após N falhas.

**Response (200)**

```json
{
  "status": "ok",
  "session": {
    "token": "<jwt-like>",
    "expiresAt": "2026-02-25T18:00:00.000Z"
  }
}
```

### 3) Dados do usuário logado

`GET /v1/auth/me`

**Headers**
- `Authorization: Bearer <sessionToken>`

**Comportamento**

- Valida assinatura do token; checa expiração (`exp`) e `tokenVersion`.
- Carrega `user:{userId}` e, a partir de `customerId`, resolve informação de licença principal (via `keyHash`/`license:{keyHash}`).

**Response (200)**

```json
{
  "status": "ok",
  "user": {
    "userId": "usr_...",
    "email": "cliente@empresa.com"
  },
  "license": {
    "status": "active",
    "plan": "pro",
    "expiresAt": "2026-03-27T04:15:00.971Z",
    "daysLeft": 30
  }
}
```

> Todos os endpoints de "console" descritos a seguir assumem autenticação via `Authorization: Bearer <sessionToken>`.

---

## Console API (área logada)

### 1) Ver licença e clientKeys

`GET /v1/console/license`

- A partir do `user.customerId`, busca todas as `clientkey:{keyHash}` associadas e suas respectivas licenças.
- Retorna visão consolidada:

```json
{
  "status": "ok",
  "license": {
    "status": "active",
    "plan": "pro",
    "expiresAt": "2026-03-27T04:15:00.971Z",
    "daysLeft": 30
  },
  "clientKeys": [
    {
      "label": "chrome-extension",
      "prefix": "qag_test_3349zPzW...",
      "createdAt": "2026-02-25T12:00:00.000Z",
      "revokedAt": null
    }
  ]
}
```

### 2) Rotacionar clientKey

`POST /v1/console/rotate-clientkey`

- Gera nova `clientKey` + `keyHash` para o mesmo `customerId`.
- Atualiza `license` para apontar para o novo `keyHash` (preservando status, plano, período).
- Marca clientKey antiga com `revokedAt`.
- Retorna nova `clientKey` para o usuário copiar em integrações.

### 3) Ver histórico de pagamentos

`GET /v1/console/payments`

- Lista últimos `payment_event:{provider}:{eventId}` associados ao(s) `keyHash` do usuário.
- Retorna data, valor, status, provedor, link para eventId no painel do provedor (quando aplicável).

---

## Modelo de sessão e segurança

### Token de sessão

- Formato: JWT-like assinado com HMAC SHA-256.
- Segredo: `SESSION_SECRET` configurado via `wrangler secret`.
- Claims sugeridos:

```json
{
  "sub": "usr_01HYYYYYYYYY",
  "email": "cliente@empresa.com",
  "ver": 1,
  "iat": 1730188800,
  "exp": 1730232000,
  "iss": "qagent-gateway",
  "aud": "qagent-console"
}
```

- Duração típica: 12–24h.
- Revogação simples: campo `tokenVersion` em `user`; se `token.ver !== user.tokenVersion`, token é considerado inválido.

### Hash de senha

- Utilizar WebCrypto `PBKDF2` com SHA-256:
  - salt aleatório 16–32 bytes por usuário;
  - iterações mínimas: 100k (ajustável via config); 
  - comprimento de saída: 256 bits.
- Armazenar apenas:
  - `passwordHash`, `passwordSalt`, `passwordIterations`, `passwordAlgo`.
- Comparação de hash em tempo constante (evitar leaks por timing).

### Proteção de login

- Rate limit por IP/email em `/v1/auth/login`.
- Lockout breve (ex.: 5–10 minutos) após N tentativas falhas.
- Mensagens de erro sempre genéricas ("credenciais inválidas").
- Nunca indicar se o email existe ou não.

---

## Fases de implementação

### Fase 1 — Infra de senha e usuário

1. Criar `src/lib/passwords.js` com helpers:
   - `hashPassword(plain) -> { hash, salt, iterations, algo }`
   - `verifyPassword(plain, { hash, salt, iterations, algo }) -> boolean`.
2. Criar `src/lib/userService.js` com operações em KV:
   - `createUser(env, { email, passwordHashBundle, customerId })`
   - `getUserByEmail(env, email)`
   - `getUserById(env, userId)`
   - `updateUserLoginStats(env, userId, { lastLoginAt, tokenVersion? })`.
3. Estender `handleSignupTrial` para criar usuário (mas ainda sem emitir sessão, se preferir rollout gradual).

### Fase 2 — Login e sessão

4. Implementar `POST /v1/auth/login` em [src/index.js](../src/index.js) usando `userService` + `passwords`.
5. Implementar `GET /v1/auth/me` para validar token e retornar user + license.
6. Adicionar `SESSION_SECRET` ao pipeline de deploy (GitHub Actions + wrangler).

### Fase 3 — Console API

7. Implementar `/v1/console/license` baseado em `customerId` → `clientkey` → `license`.
8. Implementar `/v1/console/rotate-clientkey` com rotação segura de chaves.
9. Implementar `/v1/console/payments` listando eventos de pagamento relevantes.

### Fase 4 — Hardening e UX

10. Adicionar rate limit + lockout em `/v1/auth/login`.
11. Especificar fluxo de "esqueci minha senha" (link mágico via email) para futura implementação.
12. Atualizar documentação pública (site/README) com fluxo de conta e console.

---

## Compatibilidade e migração

- A integração existente (extensão) continua usando apenas `clientKey` em `Authorization: Bearer`.
- A nova camada de conta é opt-in para quem quiser painel e gestão de billing.
- Usuários legados (com clientKey enviada apenas por email) poderão, em uma fase futura, passar por um fluxo de "crie sua senha" baseado em link mágico enviado para o mesmo email cadastrado.

Este design fecha a Fase 0. Próximo passo: iniciar Fase 1 implementando `passwords.js`, `userService.js` e estendendo `/v1/signup-trial` conforme descrito acima.

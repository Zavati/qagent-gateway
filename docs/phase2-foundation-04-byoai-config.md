# QAgent Phase 2 — Foundation 04: BYOAI / Account AI Configuration

## Objetivo

Permitir que cada conta/empresa do QAgent utilize o próprio motor de IA e as próprias credenciais, sem enviar a chave do provider para a extensão.

Este corte prepara o backend para BYOAI (Bring Your Own AI / Bring Your Own Key).

## Decisão arquitetural

A configuração de IA pertence à **conta/organização** e não ao browser.

No modelo atual, `customerId` é usado como `accountId`. Quando o domínio `accounts` for introduzido no D1, essa associação poderá ser migrada sem alterar o contrato do AI Engine.

Fluxo:

```text
Plugin
  ↓ clientKey
Gateway
  ↓ licença
customerId/accountId
  ↓
ai_provider_configs (D1)
  ↓
provider + modelo + credencial criptografada
  ↓
AI Engine
```

A extensão nunca recebe a credencial de IA.

## Compatibilidade

`AI_CONFIG_MODE=account_preferred` é o modo padrão deste corte:

1. se a licença estiver vinculada a uma conta e ela possuir configuração no D1, utiliza a configuração da conta;
2. caso contrário, utiliza o provider/modelo/chave do ambiente, preservando o funcionamento atual.

Modos suportados:

- `env`: somente configuração do ambiente;
- `account_preferred`: conta primeiro, ENV como fallback;
- `account_required`: exige configuração da conta e não aceita fallback.

No futuro, contas enterprise poderão usar `account_required`.

## Segurança das credenciais

As credenciais cadastradas são criptografadas na aplicação com AES-256-GCM antes de serem persistidas no D1.

O D1 armazena apenas:

- ciphertext;
- IV;
- versão da chave de criptografia.

A chave mestra não fica no banco.

### Desenvolvimento local

Adicionar em `.dev.vars`:

```dotenv
AI_CREDENTIALS_ACTIVE_KEY_VERSION=v1
AI_CREDENTIALS_KEY_V1=<BASE64URL_32_BYTES>
```

Gerar uma chave local:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

### Produção

A chave deverá ser configurada como Worker Secret (ou solução equivalente de secrets), nunca como `vars` versionada.

Exemplo futuro:

```bash
npx wrangler secret put AI_CREDENTIALS_KEY_V1
```

O campo `credentials_key_version` permite rotação futura de chave sem alterar o schema.

## D1

Foi adicionada a primeira migration da Fase 2:

```text
migrations/0001_ai_provider_configs.sql
```

Tabela:

```text
ai_provider_configs
```

Ela suporta mais de um provider por conta e um provider default.

Campos principais:

- config_id;
- account_id;
- provider;
- credential_type;
- credentials_ciphertext;
- credentials_iv;
- credentials_key_version;
- generate_tests_model;
- autofill_model;
- enabled;
- is_default;
- timestamps.

## Configuração local do D1

O `wrangler.jsonc` contém uma identificação local placeholder para permitir o início da Data Foundation sem vincular este pacote a um D1 de produção.

Antes de qualquer deploy remoto, criar o banco real e substituir `database_id`.

Para desenvolvimento local:

```bash
npm run db:migrate:local
```

Consultar migrations:

```bash
npm run db:migrations:list:local
```

Depois:

```bash
npx wrangler dev --port 8787
```

## APIs de configuração

As APIs usam a sessão autenticada do Console.

### Listar configurações

```http
GET /v1/console/ai-config
Authorization: Bearer <SESSION_TOKEN>
```

A resposta nunca contém a credencial descriptografada.

Exemplo:

```json
{
  "status": "ok",
  "accountId": "cus_xxx",
  "configs": [
    {
      "provider": "openai",
      "credentialType": "api_key",
      "generateTestsModel": "gpt-4o-mini",
      "autofillModel": "gpt-4o-mini",
      "enabled": true,
      "isDefault": true,
      "credentialsConfigured": true
    }
  ]
}
```

### Criar/alterar

```http
PUT /v1/console/ai-config
Authorization: Bearer <SESSION_TOKEN>
Content-Type: application/json
```

```json
{
  "provider": "openai",
  "credentialType": "api_key",
  "credentials": {
    "apiKey": "<CHAVE_DA_EMPRESA>"
  },
  "models": {
    "generateTests": "gpt-4o-mini",
    "autofill": "gpt-4o-mini"
  },
  "enabled": true
}
```

Ao alterar somente os modelos, `credentials.apiKey` pode ser omitido e a credencial existente é preservada.

### Remover

```http
DELETE /v1/console/ai-config?provider=openai
Authorization: Bearer <SESSION_TOKEN>
```

## Provider habilitado neste corte

Somente `openai` pode ser cadastrado pela API na Foundation 04.

Isso é intencional.

Primeiro provamos todo o caminho BYOAI com o provider atual:

```text
Console/API → D1 → decrypt → runtime resolver → AI Engine → OpenAI
```

Depois adicionaremos o Gemini sem criar outra arquitetura paralela.

## Google / Gemini / Vertex

O schema possui `credential_type` propositalmente.

Não devemos assumir que toda integração Google será somente uma API key simples.

Próximas opções previstas:

```text
gemini
  └── authorization/api key

vertex_ai
  └── Google Cloud IAM / service account
```

A implementação exata será feita no próximo corte de provider Google.

## Regra de política corporativa

Quando existe configuração da conta, os modelos cadastrados pela organização têm precedência sobre qualquer modelo solicitado pelo browser.

Exemplo:

```text
Plugin pede: model-x
Empresa configurou: model-corporativo

Resultado: model-corporativo
```

O browser não pode contornar a política de IA da organização.

## Código adicionado

```text
src/security/credentialCrypto.js
src/repositories/aiProviderConfigRepository.js
src/services/aiRuntimeConfigService.js
src/services/aiProviderConfigService.js
src/services/consoleSessionService.js
src/handlers/consoleAiConfig.js
migrations/0001_ai_provider_configs.sql
```

## Integrações alteradas

`generate-tests` e `autofill` agora recebem `accountId` a partir da licença.

Quando há configuração da conta:

```text
AI Engine request
  provider = provider da empresa
  model = modelo da empresa
  credentials = credenciais descriptografadas em memória
```

A credencial existe descriptografada apenas durante a chamada ao provider e não é retornada ao cliente.

## Próximo corte

Foundation 05 — Google AI Provider.

A proposta é implementar primeiro o contrato Google em cima dessa base, incluindo teste de conexão e tratamento explícito dos tipos de credencial, antes de expor a opção no Console.

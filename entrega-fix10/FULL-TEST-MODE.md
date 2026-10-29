# QAgent 08.2-A.2 FIX-10 — Capture modes

## Objetivo
Permitir alternar a política de evidência da captura UI por Environment sem recompilar o Plugin.

Modos:

- `PROTECTED`: comportamento anterior. Valores/textos/screenshot só entram por allowlists explícitas e dados pessoais são pseudonimizados/omitidos.
- `FULL_TEST`: captura ampla de evidência funcional no escopo de rede autorizado: valores de inputs não secretos, textos, screenshot do viewport e dados pessoais/test-data necessários ao replay. Não transforma credenciais em evidência.

O modo é transportado no contrato `qagent.ui-capture-policy.v1` como `mode`. Ausência de `mode` continua significando `PROTECTED` para compatibilidade.

## Hard deny irremovível
Mesmo em `FULL_TEST`, permanecem bloqueados/redigidos:

- password/passwd/pwd;
- Authorization/Bearer;
- cookies e session identifiers quando identificados por chave;
- access/refresh/id tokens, JWT;
- QAgent authorities (`qps_`, `qog_`, `qos_`, `qug_`, `qus_`, `qag_`);
- client secret/API key/CSRF/OTP;
- private keys;
- input `password`, `hidden`, `file`, autocomplete de password/OTP;
- elementos marcados `data-private`, `data-qagent-private`, `data-sensitive`;
- HTML executável em conteúdo observado.

`FULL_TEST` não é um bypass de autenticação e não permite capturar rotas de auth bloqueadas pelo escopo de rede.

## Toggle existente
Usa a Environment Variable já existente:

`QAGENT_UI_CAPTURE_POLICY`

Tipo: JSON.

### FULL_TEST

```json
{
  "enabled": true,
  "mode": "FULL_TEST",
  "startMode": "CURRENT_DOCUMENT"
}
```

Quando `FULL_TEST` é usado e as listas abaixo são omitidas, o Gateway aplica defaults amplos:

- `publicTextSelectors`: `body`
- `valueSelectors`: inputs não password/hidden/file + textarea + select
- `screenshotSelectors`: `body`
- `maskSelectors`: campos/elementos de segredo hard-deny

`networkPaths` continua herdado dos API Services same-origin. Ele não é automaticamente ampliado para hosts externos.

### PROTECTED

```json
{
  "enabled": true,
  "mode": "PROTECTED",
  "startMode": "CURRENT_DOCUMENT"
}
```

Nesse modo, se selectors não forem informados, ficam vazios como antes.

### Desligar captura UI

```json
{
  "enabled": false
}
```

Isso desliga a captura UI daquele Environment. O monitoramento API não é alterado.

## Seletores explícitos
Mesmo em `FULL_TEST`, selectors explícitos no JSON sobrescrevem os defaults. Portanto, não grave `valueSelectors: []` se a intenção for usar o default amplo do modo FULL_TEST.

## Compatibilidade
Observation anuncia capability `FULL_TEST_CAPTURE`. Plugin 2.0.20 recusa iniciar uma captura `FULL_TEST` caso o Observation não anuncie essa capacidade. Isso evita produtor novo contra consumer antigo.

## Deploy
Ordem recomendada:

1. Observation 0.1.6
2. Gateway 1.0.17
3. Plugin 2.0.20
4. alterar `QAGENT_UI_CAPTURE_POLICY` para `FULL_TEST`
5. iniciar nova Observation Session

Não há migration, fila, binding, bucket, database ou secret novo nesta FIX.

## Smoke FULL_TEST
No console do Service Worker do Plugin procure `capture.created`. Deve mostrar `policy.mode: FULL_TEST` e, usando defaults, contadores de selectors maiores que zero.

Depois de preencher um campo funcional seguro e navegar:

- não deve aparecer `UI_VALUE_NOT_AUTHORIZED` para o campo comum;
- `ACTION_VALUE_JSON` deve existir para fill/select elegível;
- query/body/response com e-mail/telefone de massa de teste podem permanecer completos;
- password/token/cookie continuam omitidos/redigidos;
- checkpoint deve poder carregar texto semântico e screenshot autorizada;
- ingestão continua `ASYNC_QUEUE` / `DURABLE_RECEIPT`.

Para uma baseline realmente completa desde o primeiro carregamento, use `startMode: NEXT_NAVIGATION` e inicie a captura antes da navegação/reload que define o início da jornada. `CURRENT_DOCUMENT` continua registrando honestamente `INITIAL_DOCUMENT_ALREADY_LOADED` quando aplicável.

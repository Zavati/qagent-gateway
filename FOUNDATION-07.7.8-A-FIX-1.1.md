# QAgent Foundation 07.7.8-A FIX-1.1 — Generic HTML Attribute CSRF Config

## Objetivo

Ampliar o contrato de `login_http_json + resultMode=cookie_session` para suportar aplicações que publicam o CSRF no HTML inicial como atributo de uma tag/componente server-rendered, em vez de `<input name="...">`.

## Contrato adicional

O extractor existente continua suportado:

```json
{
  "kind": "HTML_INPUT_BY_NAME",
  "name": "_token",
  "injectField": "_token"
}
```

Novo extractor determinístico:

```json
{
  "kind": "HTML_ATTRIBUTE_BY_TAG",
  "tag": "auth-login",
  "attribute": ":token",
  "injectField": "_token"
}
```

O Gateway aceita apenas tag + atributo exatos. CSS selectors, XPath e JavaScript arbitrário continuam fora do contrato.

## Compatibilidade

- `basic`: sem alteração.
- `api_key`: sem alteração.
- `oauth2_client_credentials`: sem alteração.
- `login_http_json` token JSON/header: sem alteração.
- `HTML_INPUT_BY_NAME`: preservado.
- Sem migration.

## Runner

O Runner precisa implementar o dispatch de `HTML_ATTRIBUTE_BY_TAG` no extractor stateful. Este ZIP do Gateway não contém o repositório Runner.

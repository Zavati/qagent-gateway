# Architectural Requirement — Zero-Config Auth Resolution

## Princípio

Configuração explícita continua sendo a autoridade, mas a ausência de API Service explícito não pode impedir a associação de um Auth Profile quando o QAgent já possui evidência suficiente para resolver runtime e autenticação com segurança.

## Regra

Quando um endpoint possui:

- runtime `DISCOVERED_OBSERVATION` seguro;
- autenticação observada sanitizada;
- exatamente um Auth Profile compatível;
- credencial configurada no Environment observado;

o QAgent deve selecionar o Auth Profile automaticamente.

## Precedência

1. configuração explícita e compatível;
2. auto-match por auth observado + Environment;
3. ambiguidade => intervenção do usuário;
4. ausência de profile compatível => `NEEDS_AUTH`.

## Environment isolation

Credentials são Environment-scoped. Um runtime descoberto em STG não pode utilizar uma credential configurada apenas em DEV/PROD.

## Segurança

Nunca propagar:

- secretId para Test Design/Console;
- credential value;
- Authorization value;
- token/JWT;
- API key;
- password/client secret.

Somente referências públicas e metadata não sensível podem ser exibidas.

## UX

O Console deve explicar a decisão automática em vez de esconder o vínculo:

```text
Auth resolvido automaticamente
Token Autenticado · BEARER observado · credential compatível em STG
```

Quando houver múltiplos candidatos, deve informar a ambiguidade e nunca escolher silenciosamente.

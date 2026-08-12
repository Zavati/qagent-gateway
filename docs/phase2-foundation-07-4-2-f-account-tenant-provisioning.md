# Foundation 07.4.2-F — Account Tenant Provisioning

## Objetivo

Garantir que uma conta criada pelo Console através de `POST /v1/signup-trial` já nasça com o tenant raiz necessário para as próximas etapas da plataforma.

## Fluxo novo

Quando o signup contém senha e cria um usuário do Console com sucesso, o Gateway também provisiona:

- `organizations`: uma Organization vinculada ao `customerId` legado;
- `organization_members`: o usuário recém-criado como `owner` ativo.

A resposta `201` passa a incluir `organization.organizationId`, `organization.name` e `organization.role`.

## Compatibilidade

O fluxo legado de trial sem senha continua funcionando sem exigir D1.

O fallback de criação de Organization no Plugin é mantido temporariamente para contas antigas. No Console, uma conta antiga cuja Organization já exista mas ainda não possua membership reconhece o usuário primário pelo mesmo email do customer e o registra como `owner`.

## Invariantes

Para novos signups do Console:

`Customer -> User -> Organization -> owner membership`

Project e Environment continuam sendo criados posteriormente pelo onboarding do Console.

## Teste

```bash
npm run test:signup-tenant
```

O teste cobre criação, vínculo owner e reprovisionamento idempotente.

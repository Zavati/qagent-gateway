# Phase 2 — Foundation 02

## Objetivo

Remover o roteamento HTTP do bloco monolítico de `src/index.js` sem alterar contratos públicos.

## Alterações

- criado `src/routing/gatewayRouter.js`;
- criada resolução centralizada de método + path;
- adicionada resolução da rota dinâmica `/debug/payment-event/:provider/:eventId`;
- criado teste unitário do router;
- `test:all` passa a incluir os testes de roteamento;
- removido `remote: true` do KV padrão do `wrangler.jsonc`.

## Desenvolvimento local

O comando padrão passa a trabalhar com recursos locais simulados:

```bash
npx wrangler dev --port 8787
```

Para forçar todos os bindings para modo local, quando necessário:

```bash
npx wrangler dev --local --port 8787
```

Não configurar o namespace KV de produção como binding remoto de desenvolvimento.
Quando precisarmos validar bindings remotos, será criado um ambiente de desenvolvimento/staging com recursos separados.

## Compatibilidade

Nenhum endpoint público foi renomeado ou removido nesta etapa.

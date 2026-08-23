# Validation — Foundation 07.7.8-B

## Gateway

Validado localmente:

- runtime descoberto com `0 API Services` + Bearer observado + 1 profile STG => `AUTO_MATCHED`;
- `authProfileRef` é materializado no Test Spec;
- cenário sem outros blockers fica `READY`;
- profile configurado apenas em Environment diferente não é utilizado;
- 2 profiles compatíveis => `AMBIGUOUS` e `NEEDS_AUTH`;
- nenhum secret/token entra no Context, diagnostics ou spec;
- regressão 07.6.1 → 07.7.8 passou no `check:07.7.8-b`;
- `npm run test:all` passou incluindo 07.7.8-B.

## Console

Teste source-level passou para:

- banner de auto-match;
- visibilidade do Auth Profile por cenário;
- estado ambíguo;
- estado indisponível;
- novos tipos de diagnostics.

O build completo do Console deve ser executado no repositório normal com dependências instaladas antes do deploy.

## Production gate pendente

Regerar um endpoint GET protegido no Buggy Cars após deploy e confirmar:

```text
auth.resolutionStatus = AUTO_MATCHED
selectedProfileName = Token Autenticado
scenario.spec.auth.authProfileRef != null
```

Se não houver blocker de massa/semântica, o cenário deve ficar `READY`.

Um POST que requer body pode continuar `NEEDS_DATA`; isso é independente da resolução de Auth.

# Validation — Foundation 07.7.8 FIX-1

## Local

Executado sobre o Gateway 07.7.8-A mais recente.

### Gate específico

```bash
npm run test:f07-7-8-fix-1
```

Resultado:

```text
Foundation 07.7.8 FIX-1 Secret-Safe Test Design Generation tests passed ✅
```

Cobertura do gate:

- contrato continua rejeitando draft não sanitizado;
- `newPassword`, `newPasswordConfirmation`, `clientSecret` e Authorization são removidos deterministicamente;
- valores removidos não aparecem no resultado/diagnostics;
- cenário recebe `needsData` quando request depende de secret;
- assertion/extract sensível é removido e exige revisão;
- selectors legítimos como `$.tokens` continuam válidos;
- sanitizer evita repair de IA desnecessário para esse caso;
- specification final continua válida;
- nenhum credential do provider aparece no retorno.

### Regression chain

```bash
npm run check:07.7.8-fix-1
```

Resultado: PASS ✅

Inclui regressões 07.6.1 → 07.7.8-A, Auth, Mixed Auth, Dynamic Form, Runner Control Plane e router.

### Full Gateway

```bash
npm run test:all
```

Resultado: PASS ✅

## Production gate

Pendente.

Critério de aceite:

1. regenerar o endpoint real que antes retornava `TEST_DESIGN_SECRET_MATERIAL_FORBIDDEN`;
2. geração retornar `status=ok` e persistir versão;
3. specification final não conter password/token/secret material;
4. cenário dependente do dado sensível ficar `NEEDS_DATA`/`REVIEW_REQUIRED`;
5. `AI_TEST_DESIGN_OUTPUT_INVALID` não ocorrer por simples presença de campo sensível modelado;
6. diagnostics não exporem valor removido.

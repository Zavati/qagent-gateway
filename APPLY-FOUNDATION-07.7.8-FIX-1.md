# Apply — Foundation 07.7.8 FIX-1

## Componente

`qagent-gateway`

Não há migration, mudança no Runner ou configuração nova de binding/secret.

## Aplicação

Substitua o Gateway pela versão entregue e execute:

```bash
npm ci
npm run check:07.7.8-fix-1
npm run test:all
npm run deploy
```

## Verificações esperadas

```text
Foundation 07.7.8 FIX-1 Secret-Safe Test Design Generation tests passed ✅
Foundation 07.7.8-A Dynamic Form / OAuth Password gateway tests passed ✅
Foundation 07.7.8-B FIX-1 Mixed Auth Evidence Resolution tests passed ✅
gateway router tests passed ✅
```

## Sem migration

Não execute migration nova para esta Foundation.

## Production gate recomendado

Regenere o endpoint que anteriormente falhava por conter `newPassword` no body.

Esperado:

```text
POST .../test-design
→ status ok
```

Diagnostics:

```text
promptVersion = qagent.test-design-prompt.v6.2
repairPromptVersion = qagent.test-design-repair-prompt.v1.1
```

Se o provider ainda emitir material sensível:

```text
secretSafeSanitizer.removedMaterialCount > 0
secretSafeSanitizer.needsDataScenarioCount > 0
```

Se o provider já obedecer o prompt, o sanitizer pode corretamente reportar zero remoções.

Em ambos os casos o Test Design persistido não pode conter valores/campos proibidos de password/token/secret.

Cenários que dependem desses dados devem ficar `NEEDS_DATA` ou `REVIEW_REQUIRED`, nunca `READY` por meio de valor inventado.

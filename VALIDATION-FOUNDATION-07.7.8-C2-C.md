# Validation — Foundation 07.7.8-C2-C

## Automated

Executado na entrega:

```bash
npm test
npm run check:07.7.8-c2-c
```

PASS.

O gate encadeado cobre Foundation 07.7.2 até 07.7.8-C, além do novo teste C2-C.

## Acceptance

- [ ] Catalog Reservoir query disponível
- [ ] Planner diagnostics v1.2
- [ ] `strategy=HYBRID`
- [ ] referential selector com 2xx observado -> OBSERVED
- [ ] free text -> GENERATED
- [ ] explicit FIXED/SECRET vence OBSERVED
- [ ] sensitive selector nunca vira OBSERVED
- [ ] literal observado não aparece no prompt/context/specification
- [ ] Environment coverage parcial -> NEEDS_DATA
- [ ] NEGATIVE missing-body não é repopulado pelo baseline
- [ ] OBSERVED permanece NOT READY até C2-D
- [ ] suites/Runner existentes continuam executando somente scenarios READY antigos

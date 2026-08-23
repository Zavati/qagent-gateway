# QAgent Foundation 07.7 — Runner Foundation — estado até 07.7.8 FIX-1

## Estado

```text
07.7.1 Runtime Audit                                      DONE
07.7.2 Run Contract + Immutable Execution Plan           DONE
07.7.2-A Runtime / Test Design Bridge                    DONE
07.7.3 Queue + qagent-runner                             DONE
07.7.4 Claim / Lease / Retry                             PROD VALIDATED
07.7.5 Runtime Integration + Readiness                   PROD VALIDATED
07.7.6 HTTP Executor v1                                  PROD VALIDATED
07.7.6-A Zero-Config Runtime Bootstrap                   PROD VALIDATED
07.7.6 FIX-1 HTTP Network Diagnostics                    PROD VALIDATED
07.7.6 FIX-2 Workers Fetch Invocation Hardening          PROD VALIDATED
07.7.7 Assertion Engine v1                               PROD VALIDATED
07.7.8 Auth Runtime                                      PROD VALIDATED
07.7.8-B Zero-Config Auth Resolution                     PROD VALIDATED
07.7.8-B FIX-1 Mixed Auth Evidence Resolution            PROD VALIDATED
07.7.8-A Dynamic Form / OAuth Password                   PROD VALIDATED
07.7.8 FIX-1 Secret-Safe Test Design Generation         LOCAL VALIDATED / PROD GATE PENDING
```

## 07.7.8 FIX-1

A IA deixa de ser responsável por obedecer sozinha à fronteira de secrets.

```text
AI output
→ deterministic Secret-Safe Sanitizer
→ strict Contract Validator
→ Semantic Guard
→ Auth Bridge
→ Registry
```

Campos sensíveis de request são removidos e viram dependência explícita de runtime/test data. Auth headers ficam exclusivamente com Auth Runtime. Assertions/extracts sobre secret são removidos e exigem revisão.

Prompt: `qagent.test-design-prompt.v6.2`.

Repair Prompt: `qagent.test-design-repair-prompt.v1.1`.

Sanitizer: `qagent.secret-safe-test-design-sanitizer.v1`.

## Production gate

Reexecutar a geração do endpoint real de update de perfil que anteriormente falhava em:

```text
TEST_DESIGN_SECRET_MATERIAL_FORBIDDEN
modelOutput.scenarios[0].request.body.newPassword
```

Esperado:

```text
status ok
Test Design persistido
nenhum password/token/secret material
cenário dependente → NEEDS_DATA / REVIEW_REQUIRED
```

## Próximos passos

1. 07.7.8-C — Test Data Runtime v1: GENERATED / FIXED / SECRET;
2. Execution Journal para liberar side-effect methods com segurança;
3. 07.7.9 — Execution Results Plane + Console;
4. 07.7.10 — Production Hardening.

# QAgent Foundation 07.7 — Runner Foundation — estado até 07.7.8-A

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
07.7.8-A Dynamic Form / OAuth Password                   LOCAL VALIDATED / PROD GATE PENDING
```

## 07.7.8-A

Dois modos de autenticação passam a coexistir:

```text
TOKEN ESTÁTICO
Secret Vault → header/query → test request

TOKEN DINÂMICO
Secret Vault username/password
→ login endpoint JIT
→ token em memória
→ test request
```

Dynamic Login aceita JSON ou `application/x-www-form-urlencoded`.

`targetMode=runtime_origin` permite onboarding sem API Service manual quando o login pertence ao mesmo origin do endpoint testado.

`targetMode=api_service` continua disponível para IdP/API de identidade em outro origin.

## Production gate

Usar Buggy Cars ou aplicação equivalente:

```text
POST /prod/oauth/token
form-urlencoded
grant_type=password
username=<Secret Vault>
password=<Secret Vault>
```

extrair o token real do response e executar um GET protegido.

Esperado:

```text
dynamicExchangeCount = 1
Auth Runtime COMPLETED
HTTP 2xx
Assertions PASSED
Run PASSED
```

## Próximos passos

1. 07.7.8 FIX-1 — Secret-Safe Test Design Generation;
2. 07.7.8-C — Test Data Runtime (GENERATED / FIXED / SECRET);
3. Execution Journal para side-effect methods;
4. 07.7.9 — Execution Results Plane + Console.

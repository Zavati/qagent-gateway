# Validation — Foundation 07.7.8-C Test Data Runtime

## Package review

Original delivery was not accepted as production-ready without changes.

Corrections applied during review:

```text
SECRET enforcement for sensitive selectors       FIXED
Project/Environment/Endpoint scope precedence     FIXED
Endpoint scope environment isolation              FIXED
canonical path placeholder inference              FIXED
AUTO type-aware resolution                        FIXED
readiness ownership / no false READY              FIXED
BODY/PATH/QUERY planner coverage                  FIXED
generatorConfig prompt/persistence hardening      FIXED
nested JSON_SCHEMA sensitive-field defense        FIXED
optional JSON properties not fabricated           FIXED
Catalog Context binding cap                       FIXED
```

## Local validation

### Gateway

```bash
npm run test:f07-7-8-c
npm run check:07.7.8-c
```

Result:

```text
07.6.1 Test Design Contract                       PASS
07.6.2 Catalog Context Builder                    PASS
07.6.3-C Semantic Grounding Guard                 PASS
07.7.2 Run Contract                               PASS
07.7.2-A Readiness Bridge                         PASS
07.7.2-A FIX-2 Auth Signal Bridge                 PASS
07.7.3 Queue                                      PASS
07.7.4 Claim/Lease/Retry                          PASS
07.7.5 Runtime Integration                        PASS
07.7.6 HTTP Executor Control Plane                PASS
07.7.6-A Zero-Config Runtime                      PASS
07.7.6 FIX-1 Network Diagnostics                  PASS
07.7.7 Assertion Engine                           PASS
07.7.8 Auth Runtime                               PASS
07.7.8-B Zero-Config Auth                         PASS
07.7.8-B FIX-1 Mixed Auth                         PASS
07.7.8-A Dynamic Form Auth                        PASS
07.7.8 FIX-1 Secret-Safe Design                   PASS
07.7.8-C Test Data Runtime                        PASS
Gateway router                                    PASS
```

### Runner

```bash
npm run test:f07-7-8-c
npm run check:07.7.8-c
```

Result:

```text
07.7.3 Runner foundation                          PASS
07.7.4 Claim/Lease/Retry                          PASS
07.7.5 Runtime Integration                        PASS
07.7.6 HTTP Executor                              PASS
07.7.6 FIX-1 Diagnostics                          PASS
07.7.6 FIX-2 Workers Fetch                        PASS
07.7.7 Assertions                                 PASS
07.7.8 Auth Runtime                               PASS
07.7.8-A Dynamic Form Auth                        PASS
07.7.8-C Test Data Runtime                        PASS
```

Specific 07.7.8-C checks:

```text
same run/scenario/path deterministic generation   PASS
FIXED materialization                              PASS
SECRET JIT materialization                        PASS
SECRET absent from safe logs/control summary      PASS
CPF/CNPJ shape                                     PASS
JSON list generation                               PASS
sensitive non-SECRET rejected in Runner            PASS
nested JSON_SCHEMA sensitive required rejected     PASS
optional JSON fields not silently fabricated       PASS
```

### Console

```bash
npm run test:f07-7-8-c
```

Result:

```text
scope types Project/Environment/Endpoint           PASS
Generated/Fixed/Secret controls                    PASS
Endpoint Test Data integration source test         PASS
```

The delivered Console artifact is a patch; full `next build` must run after applying it to the complete current Console repository.

### Migration

Fresh SQLite execution of all migrations:

```text
0001 -> 0013                                       PASS
PROJECT / ENVIRONMENT / ENDPOINT valid rows        PASS
scope CHECK rejects invalid PROJECT shape          PASS
per-scope active unique index                       PASS
attempt Test Data journal columns                   PASS
```

## Security validation

Expected and locally covered:

```text
$.password -> FIXED/GENERATED rejected
$.clientSecret -> FIXED/GENERATED rejected
access_token -> FIXED/GENERATED rejected
$.tokens -> allowed as normal domain selector
arbitrary generatorConfig payload -> stripped
generator schema default/example/const -> stripped
sensitive nested enum/default/example -> not persisted
decrypted SECRET -> Runner memory only
safe summaries -> counts only
```

## Production gate — PENDING

Do not mark Foundation 07.7.8-C complete until production/STG confirms all applicable items:

```text
[ ] migration 0013 applied remotely
[ ] Gateway deployed
[ ] Runner deployed with RUNNER_TEST_DATA_RUNTIME_ENABLED=true
[ ] Console patch built and deployed
[ ] FIXED path-param scenario changes NEEDS_DATA -> READY
[ ] read-only run uses correct Environment/scope precedence
[ ] HTTP execution completes
[ ] assertions complete
[ ] password/token-like FIXED rejected by API
[ ] SECRET API never returns plaintext
[ ] logs contain only Test Data counts/kinds/paths, never values
[ ] GENERATED deterministic smoke completed on a safe read-only endpoint, if available
```

If a safe read-only GENERATED network smoke is unavailable, keep that sub-gate pending. Do not enable global side-effect methods as a workaround.

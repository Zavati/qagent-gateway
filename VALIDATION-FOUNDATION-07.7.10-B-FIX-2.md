# VALIDATION — QAgent 07.7.10-B FIX-2

## Automated gates

Required:
- Registry full regression + Suite v2 tests;
- Gateway full regression + real SQLite mutation safety tests;
- Runner full regression + preflight ordering tests;
- Console previous regression + Mutation Governance source tests;
- migration baseline integrity;
- clean ZIP scan.

## Production validation

### A. Suite semantic intent

1. Deploy Registry.
2. Open Automation Center.
3. Prepare regression snapshot.
4. Confirm a new `suitev_*` if the prior Suite used policy v1.1.
5. Confirm `scenarioCount` equals semantic READY count, including mutations.

### B. Default deny / safe regression

1. Select STG.
2. Leave all Mutation Policies absent/DENY.
3. Run regression.
4. Expected:
   - safe GET/HEAD/OPTIONS execution units run normally;
   - mutation scenarios appear as policy-held;
   - no business mutation child Run is created;
   - Suite can still complete based on executable read-only units.

### C. Mutation policy governance

1. Select one safe STG mutation endpoint.
2. As owner/admin, configure `ALLOW` with `NO_AUTOMATIC_RETRY`.
3. Confirm a new immutable policy version exists.
4. Switch ALLOW → DENY and confirm another version is appended, not overwritten.

### D. Runner preflight while HTTP remains OFF

For a controlled STG mutation scenario only:
1. Set policy to ALLOW.
2. Trigger that mutation scenario.
3. Expected Runner order/logs:

```text
Runtime READY
run_mutation_preflight_summary decision=ALLOW
Test Data/Auth if required
RUNNER_HTTP_SIDE_EFFECT_METHOD_DISABLED
```

4. Confirm no business mutation request reached the target application.
5. Confirm `mutation_execution_journal` contains metadata only and state `PREPARED` (or policy-denied for DENY tests).

For a DENY scenario:

```text
Runtime READY
Mutation Preflight DENY
ACK_REJECTED
```

and Test Data/Auth/HTTP must not run.

### E. Journal safety

Validate no raw credentials/payload fields exist and `UNKNOWN_SIDE_EFFECT` cannot transition to `COMPLETED` automatically.

## FIX-2 production gate

FIX-2 is valid when Policy + Journal + Environment eligibility + Runner Preflight operate correctly **and no business POST/PUT/PATCH/DELETE is sent**.

Controlled HTTP mutations are explicitly deferred to 07.7.10-B FIX-3.

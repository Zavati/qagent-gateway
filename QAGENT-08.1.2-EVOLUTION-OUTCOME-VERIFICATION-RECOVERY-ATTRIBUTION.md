# QAgent 08.1.2 — Evolution Outcome Verification & Recovery Attribution

## Objective

Close the Test Evolution loop with durable, auditable evidence that the evolved Test Design actually recovered the failing scenario.

08.1.1 already proved the active loop:

```text
source execution fails
→ deterministic + AI diagnosis
→ safe proposal
→ AUTO_SAFE apply
→ immutable derived Test Design version
→ bounded rerun
```

08.1.2 adds the missing final state:

```text
bounded rerun result is ingested
→ identify the proposal that created the rerun
→ verify same scope / endpoint / scenario / environment / evolved version
→ classify verification outcome
→ persist recovery attribution
→ expose attribution on Proposal reads
```

This is not another Test Evolution pass. A bounded rerun **never starts a second automatic evolution chain**.

---

## Recovery outcomes

### `RECOVERED_BY_EVOLUTION`

Persisted only when all of the following are true:

- source Scenario was non-passing;
- rerun belongs to the evolved Test Design version;
- same endpoint;
- same environment;
- same scenario;
- rerun reached an HTTP response;
- rerun Scenario outcome is `PASSED`;
- rerun has zero failed assertions.

Reason code:

```text
EVOLVED_RERUN_PASSED
```

This is an operational recovery attribution: the bounded rerun created specifically for the derived version passed. It is intentionally stronger than simply seeing a later unrelated execution pass.

### `NOT_RECOVERED`

The evolved rerun reached the application but the scenario still failed assertions.

Reason code:

```text
EVOLVED_RERUN_FAILED_ASSERTIONS
```

No second automatic evolution is started because `maxEvolutionDepth = 1` remains enforced.

### `VERIFICATION_BLOCKED`

The rerun could not provide an evaluable application result, for example:

```text
TIMEOUT       → EVOLVED_RERUN_TIMEOUT
NETWORK_ERROR → EVOLVED_RERUN_NETWORK_ERROR
other         → EVOLVED_RERUN_NOT_VERIFIABLE
```

This is deliberately different from `NOT_RECOVERED`: infrastructure/runtime failure must not be interpreted as proof that the evolved Test Design was wrong.

---

## Durable attribution model

New D1 table in `qagent-test-evolution`:

```text
test_evolution_outcome_verifications
```

Migration:

```text
0007_evolution_outcome_verification.sql
```

The record links:

```text
Proposal
├─ original Result Set / Run / Scenario Result
├─ source failure status and failed assertion count
├─ evolved Test Design Version
└─ bounded rerun
   ├─ Run
   ├─ Result Set
   ├─ Scenario Result
   ├─ HTTP outcome/status
   ├─ assertion failure count
   └─ recovery outcome
```

One proposal can own only one bounded outcome verification. Reprocessing the same Result Set is idempotent; attempting to attach a different rerun to an already verified proposal fails closed.

---

## Contract

Proposal reads now include an additive field:

```json
{
  "outcomeVerification": {
    "contractVersion": "qagent.test-evolution-outcome-verification.v1",
    "verificationId": "teov_...",
    "proposalId": "tep_...",
    "outcome": "RECOVERED_BY_EVOLUTION",
    "reasonCode": "EVOLVED_RERUN_PASSED",
    "recoveryConfirmed": true,
    "source": {
      "resultSetId": "rset_...",
      "runId": "run_...",
      "scenarioResultId": "sres_...",
      "scenarioOutcome": "FAILED",
      "statusCode": 422,
      "assertionFailedCount": 1
    },
    "evolved": {
      "testDesignVersionId": "tdv_...",
      "testDesignVersion": 5
    },
    "rerun": {
      "runId": "run_...",
      "resultSetId": "rset_...",
      "scenarioResultId": "sres_...",
      "scenarioOutcome": "PASSED",
      "httpOutcome": "RESPONSE",
      "statusCode": 200,
      "assertionFailedCount": 0
    },
    "verifiedAt": "..."
  }
}
```

Audit event:

```text
EVOLUTION_OUTCOME_VERIFIED
```

---

## Automatic production path

`qagent-test-results` already publishes a `qagent.test-evolution-result-trigger.v1` message after immutable Result Set creation.

Before 08.1.2 the Gateway recognized:

```text
test-evolution-rerun:...
```

and only skipped the event to prevent recursion.

Now it does:

```text
Result Set from bounded rerun
→ Gateway loads Run metadata
→ validates Organization / Project scope
→ parses idempotencyKey
   test-evolution-rerun:<proposalId>:<testDesignVersionId>
→ calls Test Evolution /verify-outcome
→ Test Evolution validates provenance against Results + Proposal
→ persists recovery attribution
→ ACK
```

It still does **not** run Inspection or AI assessment on the rerun result.

---

## Manual/backfill verification

To validate an already completed bounded rerun, Gateway exposes:

```http
POST /v1/console/projects/:projectId/test-evolution/proposals/:proposalId/verify-outcome
```

Body:

```json
{
  "rerunRunId": "run_..."
}
```

The Console BFF first verifies that the Run belongs to the same tenant/project and that its idempotency key is linked to the Proposal:

```text
test-evolution-rerun:<proposalId>:...
```

It then asks Test Evolution to resolve the latest immutable Result Set for that Run and persist attribution.

This is why 08.1.2 adds a scoped internal Results read:

```http
GET /internal/v1/projects/:projectId/runs/:runId/latest-result-set
```

This endpoint is internal/service-boundary only; it is not a browser-facing Results API.

---

## Services changed

### `qagent-test-results`

- internal latest Result Set by Run read;
- no schema migration;
- no ingestion behavior change;
- existing Result Set immutability preserved.

### `qagent-test-evolution`

- migration `0007_evolution_outcome_verification.sql`;
- recovery classification;
- provenance validation;
- idempotent durable attribution;
- `EVOLUTION_OUTCOME_VERIFIED` event;
- Proposal GET now includes `outcomeVerification`.

### `qagent-gateway`

- bounded rerun Result triggers now perform verification instead of being discarded;
- no recursive evolution;
- public authenticated manual/backfill endpoint;
- tenant and rerun linkage validation before manual attribution.

Unchanged:

```text
qagent-runner
qagent-test-registry
qagent-catalog
qagent-console frontend
```

---

## Safety / fail-closed rules

Outcome verification is rejected when:

- Proposal is not `APPLIED`;
- evolved Test Design Version does not match rerun Result Set;
- endpoint differs;
- environment differs;
- scenario differs or is missing;
- source Run is reused as its own verification Run;
- Proposal already has a different verification;
- manual verification points to a Run not created by that Proposal's bounded rerun.

Runtime failures are persisted as `VERIFICATION_BLOCKED`, never as `NOT_RECOVERED` and never as application failure attribution.

No secrets, cookies, auth material, raw request bodies or raw response bodies are stored in the attribution table.

---

## Validation performed

### Test Evolution

```text
24 tests
24 PASS
0 FAIL
```

Includes:

- RECOVERED_BY_EVOLUTION classification;
- NOT_RECOVERED classification;
- runtime-blocked distinction;
- D1 migration sequence including 0007;
- immutable/idempotent attribution persistence;
- Proposal read enrichment;
- audit event persistence;
- full 08.1 / 08.1.1 regression suite.

### Test Results

```text
check:08.1.2 PASS
```

Includes all existing Results regressions plus latest Result Set by Run read.

### Gateway

```text
check:08.1.2 PASS
```

Includes:

- AI/BYOAI boundary;
- Test Evolution queue behavior;
- runtime snapshot reuse FIX-3;
- semantic guard regressions;
- secret-safe generation regressions;
- router regressions;
- 08.1.2 queue recovery attribution;
- manual BFF route.

---

## Deploy order

Because the new Test Evolution code reads the new D1 table on normal Proposal GETs, apply the migration before deploying that Worker.

```text
1. qagent-test-results deploy
2. qagent-test-evolution: apply migration 0007
3. qagent-test-evolution deploy
4. qagent-gateway deploy
```

Commands in Test Evolution:

```bash
npm ci
npm run db:migrations:apply
npm run deploy
```

Confirm migration:

```text
0007_evolution_outcome_verification.sql
```

No Gateway or Results DB migration is required.

---

## Production validation using the already successful 08.1.1 loop

Existing Proposal:

```text
tep_fd70be02af9a225bd279d651345267ee4bdf6fd8
```

Existing bounded rerun:

```text
run_19284b98-2a65-475f-9035-4c274f8234e9
```

The Run already proved:

```text
Test Design v5
Run PASSED
HTTP 2xx = 1
HTTP 4xx = 0
Assertions 2/2 PASS
```

After 08.1.2 deploy, backfill it with:

```bash
curl --location --request POST \
'https://api.apiqagent.com/v1/console/projects/prj_199dbca3-5619-4538-93d4-a73ce8829cf7/test-evolution/proposals/tep_fd70be02af9a225bd279d651345267ee4bdf6fd8/verify-outcome' \
--header 'Authorization: Bearer SEU_TOKEN' \
--header 'Content-Type: application/json' \
--data '{
  "rerunRunId": "run_19284b98-2a65-475f-9035-4c274f8234e9"
}'
```

Expected result:

```text
outcome = RECOVERED_BY_EVOLUTION
reasonCode = EVOLVED_RERUN_PASSED
recoveryConfirmed = true

source.statusCode = 422
source.scenarioOutcome = FAILED

evolved.testDesignVersion = 5

rerun.statusCode = 200
rerun.scenarioOutcome = PASSED
rerun.assertionFailedCount = 0
```

Then:

```http
GET /v1/console/projects/:projectId/test-evolution/proposals/:proposalId
```

must return the persisted `outcomeVerification` object.

---

## Architectural result

The closed loop becomes:

```text
Observe
→ Generate
→ Execute
→ Diagnose
→ Decide
→ Evolve
→ Version
→ Rerun
→ Verify
→ Attribute recovery
```

This attribution is the read model required by the next Quality Intelligence layer. It lets later aggregation distinguish:

```text
initial failures
recovered automatically
not recovered
verification blocked
application bug suspected
review required
```

without reinterpreting raw execution logs at dashboard time.

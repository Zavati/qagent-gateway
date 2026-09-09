# QAgent 08.1.4 — Continuous Learning Cycle

Status: **IMPLEMENTED / LOCAL VALIDATION PASS**

## 1. Objective

Close the Test Evolution loop at **Suite Run** level. Before 08.1.4, each Result Set was analyzed independently and correctly, but there was no durable root object capable of answering:

- how much of the regression finished;
- how many scenarios were analyzed by Evolution;
- what was classified;
- what was auto-applied;
- what was recovered by bounded rerun;
- what was repaired by a human;
- what still requires attention;
- whether autonomous learning for that regression has settled.

08.1.4 adds that durable projection without moving execution logic into Runner and without duplicating the Test Evolution engine.

```text
Immutable Suite Version
        ↓
Suite Run
        ↓
Continuous Learning Cycle
        ↓
Result Sets arrive incrementally
        ↓
Inspection / Classification / Policy
        ↓
Evolution / Human Repair
        ↓
Bounded Rerun
        ↓
Outcome Verification
        ↓
COMPLETED or WAITING_REVIEW
```

## 2. Ownership

**Gateway owns the Continuous Learning Cycle orchestration/projection** because Gateway already owns Suite Run orchestration, Test Evolution queue orchestration, human-guided repair coordination and bounded rerun creation.

Existing domain ownership remains unchanged:

- Runner: execution only;
- Results: immutable execution evidence;
- Test Evolution: inspection, proposals, assessment, policy and outcome verification;
- Test Registry: immutable Test Design versions;
- Gateway: orchestration and cycle projection;
- Console: visualization.

No new AI service was introduced.

## 3. New contract

```text
qagent.continuous-learning-cycle.v1
```

Lifecycle:

```text
COLLECTING
ANALYZING
VERIFYING
WAITING_REVIEW
COMPLETED
```

Semantics:

- `COLLECTING`: Suite Run is still executing. Completed Result Sets may already be under analysis.
- `ANALYZING`: Suite execution is terminal, but Result Set triggers and/or inspections are still pending.
- `VERIFYING`: bounded Evolution reruns or human-guided repair reruns are pending.
- `WAITING_REVIEW`: autonomous work is settled, but one or more scenarios still require human attention. This is a settled terminal state for polling.
- `COMPLETED`: execution, analysis and all bounded verifications settled without open attention items.

`WAITING_REVIEW` is intentionally not named `FAILED`. It describes the state of the **learning cycle**, not application quality.

## 4. Durable storage

Gateway migration:

```text
migrations/0019_foundation_08_1_4_continuous_learning_cycle.sql
```

New tables:

```text
continuous_learning_cycles
continuous_learning_scenarios
continuous_learning_events
```

The projection stores identifiers, status, counts, classification, policy outcome, risk metadata, version references and verification attribution.

It does **not** store:

- request body literals;
- Authorization values;
- Cookies;
- tokens;
- secrets;
- raw response bodies;
- human repair literal values.

## 5. One Cycle per Suite Run

A new Suite Run attempts to create its Learning Cycle **before initial Suite orchestration is published**.

Cycle identity is deterministic from `suiteRunId` and the DB has:

```text
UNIQUE (organization_id, project_id, suite_run_id)
```

This makes creation idempotent.

The learning projection is fault-isolated from test execution: an intelligence projection failure must not duplicate or corrupt Suite execution. Result triggers can lazily recreate the Cycle if needed.

Historical Suite Runs created before 08.1.4 are not silently backfilled into a fake complete cycle. The feature is prospective for Suite Runs tracked after deployment.

## 6. Result trigger enriched for learning

`qagent-test-results` still emits:

```text
qagent.test-evolution-result-trigger.v1
```

The message now adds a sanitized projection:

```json
{
  "testDesignVersionId": "tdv_...",
  "testDesignVersion": 7,
  "scenarioIds": ["test_001"],
  "scenarioSummaries": [
    {
      "scenarioId": "test_001",
      "scenarioResultId": "sres_...",
      "outcome": "FAILED",
      "httpOutcome": "RESPONSE",
      "statusCode": 422,
      "assertionFailedCount": 1
    }
  ]
}
```

08.1.4 deliberately emits summaries for non-response scenarios too (`NETWORK_ERROR`, timeout/not evaluated etc.). This is necessary so a bounded rerun can settle as `VERIFICATION_BLOCKED` rather than remaining indefinitely pending.

No raw request/evidence payload is placed on the queue.

## 7. Incremental learning during regression

The Cycle does **not** wait for the entire Suite Run to finish.

```text
child Run A finishes
→ Result Set A
→ Cycle receives scenarios A
→ Evolution analyzes A

child Run B is still running

child Run C finishes
→ Result Set C
→ Cycle receives scenarios C
→ Evolution analyzes C
```

Therefore execution and learning overlap naturally.

## 8. Scenario state projection

A source scenario is projected through effective states such as:

```text
RECEIVED
HEALTHY
ANALYZED_ELIGIBLE
REVIEW_REQUIRED
VERIFYING
RECOVERED_BY_EVOLUTION
NOT_RECOVERED
VERIFICATION_BLOCKED
HUMAN_VERIFYING
RECOVERED_BY_HUMAN_REPAIR
HUMAN_REPAIR_NOT_RECOVERED
HUMAN_VERIFICATION_BLOCKED
```

These are operational projection states. They do not replace Test Evolution classification taxonomy.

## 9. Classification and policy accounting

The Cycle aggregates existing Test Evolution decisions:

```text
EXPECTED_BEHAVIOR_LEARNED
EXPECTATION_DRIFT
TEST_DATA_DRIFT
APPLICATION_BUG_SUSPECTED
RUNTIME_FAILURE
INCONCLUSIVE
```

and:

```text
EVOLVE_TEST
KEEP_TEST
REVIEW_REQUIRED
```

It also persists:

- confidence;
- risk score/level;
- `autoAction`;
- proposal ID;
- evolved Test Design Version;
- bounded rerun Run ID.

The Cycle does not make a second AI or policy decision.

## 10. Automatic recovery attribution

For an Evolution rerun:

```text
idempotencyKey = test-evolution-rerun:<proposalId>:<tdv>
```

The queue handler detects the rerun and does **not** inspect it as a new source failure.

Instead:

```text
Result Set
→ verifyEvolutionOutcome(...)
→ RECOVERED_BY_EVOLUTION / NOT_RECOVERED / VERIFICATION_BLOCKED
→ Cycle scenario updated
```

This prevents recursive Evolution.

## 11. Human-guided repair integration

08.1.3-C FIX-3 is integrated into the same cycle.

When a human repair is created from a source scenario:

```text
HUMAN_REQUEST_REPAIR
→ new immutable Test Design Version
→ optional rerun
```

The Cycle records:

- repair ID;
- derived Test Design Version ID/version;
- human rerun Run ID.

Human reruns use:

```text
human-request-repair-rerun:<repairId>:<tdv>
```

The Test Evolution queue detects this key and **does not create another Evolution proposal**. It only attributes the result as:

```text
RECOVERED_BY_HUMAN_REPAIR
NOT_RECOVERED
VERIFICATION_BLOCKED
```

A human repair with no rerun remains `REVIEW_REQUIRED` until future validation.

## 12. Lost-trigger reconciliation

Results persistence is authoritative, while queue notification remains decoupled. To prevent a transient Results → Evolution queue publish failure from leaving a terminal Suite Run permanently in `ANALYZING`, Gateway now performs bounded reconciliation after the Suite Run becomes terminal.

When expected PASSED/FAILED child Result Sets are not represented in the Cycle:

```text
Suite terminal
+ missing tracked Result Set
        ↓
Gateway resolves untracked child Run IDs
        ↓
Results internal latest-result-set-by-run
        ↓
sanitized trigger rebuilt
        ↓
TEST_EVOLUTION_QUEUE
```

Reconciliation is:

- bounded to 12 missing Runs per refresh;
- only used after the Suite is terminal;
- idempotently journaled with `RECONCILE_TRIGGER:<resultSetId>` events;
- sanitized with the same minimal scenario projection;
- non-blocking for Console reads.

This is a recovery mechanism, not a second Evolution pipeline.

## 13. Public API

Suite Run read now includes compact cycle state:

```http
GET /v1/console/projects/:projectId/suite-runs/:suiteRunId
```

Additive field:

```json
{
  "learningCycle": {
    "contractVersion": "qagent.continuous-learning-cycle.v1",
    "learningCycleId": "lcycle_...",
    "suiteRunId": "srun_...",
    "status": "VERIFYING",
    "settled": false,
    "execution": {
      "totalExecutionUnits": 193,
      "completedExecutionUnits": 193,
      "passedUnits": 152,
      "failedUnits": 41,
      "expectedResultSetCount": 193,
      "resultSetCount": 193
    },
    "learning": {
      "scenarioCount": 238,
      "responseScenarioCount": 233,
      "initialPassedCount": 197,
      "initialFailedCount": 41,
      "analyzedCount": 238,
      "pendingAnalysisCount": 0,
      "eligibleCount": 27,
      "proposalCount": 27,
      "autoAppliedCount": 15,
      "attentionRequiredCount": 9
    },
    "verification": {
      "pendingCount": 3,
      "recoveredByEvolutionCount": 12,
      "notRecoveredCount": 0,
      "blockedCount": 0
    },
    "human": {
      "repairCount": 2,
      "recoveredCount": 1,
      "notRecoveredCount": 0,
      "verificationBlockedCount": 0
    }
  }
}
```

Numbers above are illustrative contract examples, not production measurements.

Dedicated detailed read:

```http
GET /v1/console/projects/:projectId/suite-runs/:suiteRunId/learning-cycle
```

Returns the summary plus bounded scenario items and recent lifecycle events.

## 14. Console UX

New component:

```text
Continuous Learning Cycle
```

The Regression Readiness view now shows, for the active Suite Run:

```text
Execution → Analysis → Evolution → Verification

Execution progress
Learning analysis progress

Initial failures
Auto-applied
Recovered
Requires attention

Classification chips
Verification pending
Human repair count
```

Console continues polling after Suite Run execution becomes terminal while the Learning Cycle remains:

```text
ANALYZING
VERIFYING
```

Polling stops at:

```text
WAITING_REVIEW
COMPLETED
```

The execution button displays `Finalizando aprendizagem...` while execution is terminal but the autonomous cycle has not settled.

The last Suite Run ID remains in local storage so a settled cycle can be restored after navigation/reload. Starting another regression replaces it.

## 15. Relationship with 08.1.3-A

The Cycle never mutates the currently executing Suite Version.

If Evolution or Human Repair creates a new Test Design Version during the regression:

```text
current Suite Version remains immutable
        ↓
08.1.3-A detects latest inventory drift
        ↓
Auto Suite becomes OUTDATED
        ↓
user materializes the next CURRENT snapshot
```

This preserves reproducibility.

## 16. Relationship with future 08.2 Quality Intelligence

08.1.4 intentionally creates the stable execution/learning ledger that 08.2 can consume.

Instead of 08.2 reconstructing hundreds of low-level events, it can start from:

```text
Suite Run
+ Continuous Learning Cycle
+ Recovery Attribution
+ Regression Snapshot provenance
```

The future Quality Decision engine still must make its own deterministic risk/release evaluation. The Learning Cycle does **not** decide GO/HOLD.

## 17. Services changed

### qagent-gateway

New/changed core files:

```text
migrations/0019_foundation_08_1_4_continuous_learning_cycle.sql
src/repositories/learningCycleRepository.js
src/repositories/suiteRunRepository.js
src/services/learningCycleService.js
src/services/resultsReadClient.js
src/services/suiteRunService.js
src/services/humanRequestRepairService.js
src/handlers/testEvolutionQueue.js
src/handlers/consoleLearningCycles.js
src/routing/gatewayRouter.js
src/index.js
```

### qagent-test-results

```text
src/index.js
```

Adds the sanitized full-scenario learning trigger projection and capability marker.

### qagent-console

```text
lib/learningCycles.ts
lib/suiteRuns.ts
components/automation/ContinuousLearningCycle.tsx
components/automation/RegressionReadiness.tsx
app/projects/automation/page.tsx
```

### Not changed

```text
qagent-test-evolution
qagent-test-registry
qagent-runner
qagent-catalog
qagent-normalizer
```

## 18. Local validation

### Gateway

```text
npm run check:08.1.4
PASS
```

Includes inherited 08.1 → 08.1.3-C FIX-3 checks, router tests, lifecycle test and real SQLite persistence test for migration 0019.

Additional Suite Orchestrator regression tests were run after integrating the Cycle into Suite Run creation/read:

```text
07.7.10-B
07.7.10-B FIX-1
07.7.10-B FIX-2
07.7.10-B FIX-3
07.7.10-B FIX-3.1
PASS
```

### Results

```text
npm run check:08.1.4
PASS
```

Includes Results SQL integration and 08.1.2 latest-result-set-by-run read.

### Console

```text
npm run check:08.1.4
PASS
```

All inherited Console source-regression checks through 08.1.3-C FIX-3 plus 08.1.4 pass.

Changed TS/TSX files also pass TypeScript `transpileModule` syntax diagnostics.

A full Next.js production build was **not** run because packaged repositories intentionally contain no `node_modules` and dependencies were not installed in this validation workspace.

## 19. Deploy order

### 1. Gateway migration

```bash
cd qagent-gateway
npm ci
npm run db:migrations:apply
```

Confirm:

```text
0019_foundation_08_1_4_continuous_learning_cycle.sql
```

### 2. Gateway

```bash
npm run deploy
```

Gateway can already consume the previous Results trigger shape, so this is backward compatible during rollout.

### 3. Test Results

```bash
cd qagent-test-results
npm ci
npm run deploy
```

This enables full sanitized scenario summaries, including non-response outcomes.

### 4. Console

Deploy the normal Console pipeline.

No Test Evolution, Registry or Runner redeploy is required for 08.1.4.

## 20. Production smoke

Use a **new Suite Run created after 08.1.4 deployment**.

### A. Start regression

```http
POST /v1/console/projects/:projectId/suite-runs
```

Immediately read it:

```http
GET /v1/console/projects/:projectId/suite-runs/:suiteRunId
```

Expected early state:

```text
learningCycle.status = COLLECTING
learningCycle.settled = false
```

### B. During regression

Repeated GETs should show:

```text
execution.completedExecutionUnits increasing
learning.scenarioCount increasing
learning.analyzedCount increasing
```

Analysis may advance while other child Runs are still running.

### C. Suite terminal but queue still draining

Expected:

```text
ANALYZING
```

if Result Sets/inspections remain pending.

### D. Auto evolution with rerun

Expected transition:

```text
ANALYZING
→ VERIFYING
```

and eventually one of:

```text
verification.recoveredByEvolutionCount +1
verification.notRecoveredCount +1
verification.blockedCount +1
```

### E. Human repair

For a `WAITING_REVIEW` item, use 08.1.3-C FIX-3 `Salvar e reexecutar`.

The same Cycle should transition:

```text
WAITING_REVIEW
→ VERIFYING
→ COMPLETED or WAITING_REVIEW
```

The human rerun must **not** create a recursive Evolution proposal.

### F. Final state

Expected terminal learning state:

```text
COMPLETED
```

or:

```text
WAITING_REVIEW
```

Then refresh Regression Readiness. If Test Designs evolved during the run, 08.1.3-A should expose the Auto Suite snapshot as `OUTDATED` until the next materialization.

## 21. Closure

With 08.1.4, the QAgent Test Evolution plane is no longer just a set of independent per-result operations.

It now has a durable regression-level lifecycle:

```text
EXECUTE
→ COLLECT
→ ANALYZE
→ CLASSIFY
→ EVOLVE / HOLD FOR REVIEW
→ RERUN
→ VERIFY
→ ATTRIBUTE RECOVERY
→ SETTLE
```

This is the intended foundation for the next domain: **08.2 Release Confidence / Quality Decision**.

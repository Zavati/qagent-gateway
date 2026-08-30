# QAgent 07.7.10-B FIX-3.1 — Handoff

## Baseline

Built directly from the 07.7.10-B FIX-3 artifacts.

## Problem observed in real STG validation

The Suite `srun_6376770b-ac99-4a2e-8ad8-92c01e4be5b7` created 6 execution units. Two read-only units completed. Four isolated POST children reached:

```text
Mutation Policy ALLOW
mex_* PREPARED
```

but failed before `DISPATCHING`. They retried and eventually entered `qagent-run-dlq`. Because there was no terminal recovery consumer, the Suite remained `RUNNING` at `2/6`.

A second observed Run produced:

```text
run_rejection_state_persist_failed
code=RUNNER_REJECTED_CONTRACT_INVALID
```

Source inspection showed the Runner and Gateway disagreed on valid rejection phases, and the Runner log hid the original failure when the persistence callback failed.

## FIX-3.1 resolution

- Runner rejection diagnostics preserve original error code/phase.
- Gateway rejection runtime contract and JSON Schema are aligned with all phases emitted by Runner.
- normal permanent rejection terminalizes `RUNNING` Runs, not only `CREATED/QUEUED`.
- Suite child/aggregate is reconciled after normal rejection.
- Gateway consumes `qagent-run-dlq` as Run Control fallback.
- PREPARED mutation in DLQ → FAILED_BEFORE_DISPATCH.
- DISPATCHING mutation in DLQ → UNKNOWN_SIDE_EFFECT.
- no new migration.
- Registry, Results and Console unchanged.

## Next action after deploy

1. Deploy Gateway with mutation kill switch still effectively OFF in Runner.
2. Observe whether retained DLQ messages terminalize the old Suite.
3. Deploy Runner FIX-3.1.
4. Confirm health Foundation `07.7.10-B-FIX-3.1`.
5. Enable mutation HTTP again only for a single STG retest.
6. Execute only `happy_path_001`.
7. If dispatch still fails, inspect `run_mutation_dispatch_failed` for exact code/phase.
8. Do not proceed to full POST/PUT/PATCH/DELETE validation until one POST reaches `DISPATCHING → RESPONSE_RECEIVED` safely.

## Next roadmap milestone after FIX-3.1 production validation

Return to **07.7.10-B FIX-3 — Controlled POST/PUT/PATCH/DELETE real STG validation**, then proceed to **07.7.10-C — Suite Results & Regression History**.

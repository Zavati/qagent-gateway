# QAgent Foundation 07.7.10-B FIX-1 — Suite Run INSERT Arity Correction

Status: FIX

## Problem

`POST /v1/console/projects/:projectId/suite-runs` failed in production with:

`D1_ERROR: 19 values for 18 columns: SQLITE_ERROR`

The `suite_runs` INSERT declared 18 columns but its VALUES clause contained the literal `CREATED` plus 18 placeholders, totaling 19 values. The bind list itself was correct with 17 parameters.

## Fix

Correct the VALUES clause in `src/repositories/suiteRunRepository.js` from:

`VALUES (?,?,?,?,?,?,?,?,?,'CREATED',?,?,?,?,?,?,?,?,?)`

to:

`VALUES (?,?,?,?,?,?,?,?,?,'CREATED',?,?,?,?,?,?,?,?)`

No schema or migration change is required.

## Regression guard

A real SQLite regression test now applies migration `0015_foundation_07_7_10_b_suite_run_orchestration.sql` and calls `createSuiteRunRoot()` through a D1-compatible shim. This catches SQL column/value arity errors that mocked repository tests cannot detect.

## Invariants

- Existing migrations remain immutable.
- Suite Run contract is unchanged.
- Queue/orchestrator configuration is unchanged.
- Multi-tenant scope is unchanged.
- Child Run idempotency/fan-out semantics are unchanged.

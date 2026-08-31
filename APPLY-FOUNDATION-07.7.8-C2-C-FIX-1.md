# QAgent Foundation 07.7.8-C2-C FIX-1 — Baseline Regression Guard Alignment

## Cause
The C2-C implementation intentionally advances:

- `qagent.test-data-planner.v1.1` -> `qagent.test-data-planner.v1.2`
- `qagent.catalog-context-builder.v1.7` -> `qagent.catalog-context-builder.v1.8`

The existing `07.7.9-C FIX-1` baseline regression test still pinned the old versions, so the GitHub `npm run test:all` gate failed before deployment.

## Change
Only the regression guard expectations were aligned with the intentional versions. No runtime behavior was weakened or reverted.

The focused `check:07.7.8-c2-c` gate was also strengthened to execute `test:f07-7-9-c-fix-1`, preventing this class of downstream baseline drift from escaping the feature gate again.

## Validation
- `node test/test-foundation-07-7-9-c-fix-1-baseline-regression.js` — PASS
- `npm run check:07.7.8-c2-c` — PASS
- `npm run test:all` — PASS through Foundation 07.7.10-A FIX-1

No migration is required.

# Validation — Foundation 07.7.10-A FIX-1 / qagent-gateway

Run:

```bash
npm run check:07.7.10-a-fix-1
```

Production API validation should confirm that:

- `/automation/test-inventory` exposes semantic READY plus execution eligibility totals;
- `policyBlockedReadyScenarioCount` and `policyBlockedReasonCounts` are preserved;
- Auto Suite materialization/latest use policy v1.1 metadata;
- compact responses do not expose the full Suite selection;
- tenant/project authorization remains enforced;
- previous Results, Test Data Runtime, Run Control and Test Registry bridges remain functional.

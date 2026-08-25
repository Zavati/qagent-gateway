# Foundation 07.7.10-B — Suite Run Contract + Durable Orchestration

Introduces durable `srun_*` lifecycle in Gateway, a dedicated `qagent-suite-run-orchestration` Queue, bounded server-side fan-out and deterministic child Run idempotency.

No Runner execution contract is replaced. Child executions continue through normal `run_*` creation and `qagent-run-requests`.

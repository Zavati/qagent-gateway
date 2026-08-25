# Foundation 07.7.10-A FIX-1 — Gateway Compact Suite/Inventory Bridge

Gateway keeps the Browser isolated from Test Registry while exposing the existing Automation BFF routes.

For Foundation 07.7.10-A FIX-1 it requests Registry `view=compact` for Project Test Inventory, Auto Suite materialization response and latest Auto Suite snapshot.

The bridge validates the new execution eligibility fields and preserves tenant/project authorization before forwarding.

No Gateway D1 migration is introduced.

The Console receives aggregate readiness/eligibility data and bounded endpoint rows, not the full pinned Suite selection. Full Suite selection remains inside Test Registry for the future Suite Orchestrator.

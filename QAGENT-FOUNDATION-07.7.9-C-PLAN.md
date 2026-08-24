# QAgent v2 — Foundation 07.7.9-C
## Results Retrieval + Automation Console

**Status:** IMPLEMENTATION PLAN / ARCHITECTURAL TARGET  
**Date:** 2026-08-24  
**Predecessor:** 07.7.9-B — Result Ingestion + Immutable Execution Persistence  
**Mission:** “Uma plataforma que descobre, projeta e executa testes automaticamente.”

---

## 1. Why this Foundation exists

07.7.9-B made execution results durable, but the product still exposes most execution value through operational logs. 07.7.9-C turns the Execution Results Plane into a user-facing product experience without collapsing service boundaries.

The objective is not merely to add a result table. The objective is to give the QA an immediate operational view of automated quality:

- what is running;
- what passed or failed;
- how many assertions passed;
- which endpoints are covered by execution;
- where attention is needed;
- what happened in the last execution of a specific endpoint.

The visual hierarchy is intentionally **metrics and charts first, detailed tables second**.

---

## 2. Product information architecture

The Project workspace evolves from:

```text
API Catalog | Configuração
```

to:

```text
API Catalog | Automação | Configuração
```

### API Catalog
Knowledge/discovery context:

- discovered services and endpoints;
- evidence;
- schemas;
- confidence/lifecycle/classification;
- endpoint-specific Test Design and Test Data context.

### Automação
Execution/quality context:

- execution overview;
- KPIs;
- result trends;
- operational attention;
- recent executions;
- execution detail.

Future capabilities belong here without redesigning the Project workspace:

```text
Automação
├── Overview / Executions   (07.7.9-C)
├── Suites                  (future)
├── Schedules               (future)
└── CI/CD                   (future)
```

### Endpoint Detail
The endpoint remains the contextual view. It should show:

- latest persisted Test Design;
- readiness summary;
- latest execution;
- recent execution signal/history;
- link to the global Automation area.

This is intentionally a **dual projection of the same source of truth**, not duplicate storage.

---

## 3. Frozen service boundaries

```text
Browser / qagent-console
        |
        v
qagent-gateway
  - console authentication
  - tenant/project authorization
  - BFF contracts
  - bounded orchestration only
        |
        +------------------------------+
        |                              |
        v                              v
qagent-test-results             qagent-test-registry
  RESULTS_DB                      TEST_REGISTRY_DB
  execution history              immutable Test Designs
```

Rules:

1. Browser **never** accesses `qagent-test-results` directly.
2. `qagent-gateway` does **not** persist detailed execution results.
3. `qagent-test-results` remains the source of truth for execution details.
4. `qagent-test-registry` remains the source of truth for immutable Test Design versions.
5. Results reference `tdv_*`; they do not duplicate the full Test Design specification.
6. Console unifies the UX while backend services remain separated by responsibility.

---

## 4. Security requirements

07.7.9-C must not weaken 07.7.9-B.

Never expose or persist through read APIs:

- Authorization values;
- Bearer tokens;
- cookies/session tokens;
- passwords;
- API keys;
- client secrets;
- refresh tokens;
- Secret Vault values;
- lease tokens;
- raw request body;
- raw response body;
- materialized path values that can contain FIXED/SECRET runtime data;
- query values.

Allowed execution metadata includes:

- canonical path template;
- method;
- status code/class;
- content type;
- duration;
- response byte count;
- truncation flag;
- query key names only;
- non-sensitive header names only;
- assertion type/outcome and safe diagnostic metadata.

All Results read routes remain internal to the Service Binding. The Gateway is the only browser-facing BFF.

---

## 5. 07.7.9-C delivery slices

### C1 — Results Read Contract

Internal Results Plane reads:

```text
GET /internal/v1/projects/:projectId/summary
GET /internal/v1/projects/:projectId/result-sets
GET /internal/v1/projects/:projectId/result-sets/:resultSetId
GET /internal/v1/projects/:projectId/endpoints/:endpointId/latest
```

All calls require the organization/project scope forwarded by the authorized Gateway boundary.

### C2 — Gateway Results Bridge

Browser-facing BFF:

```text
GET /v1/console/projects/:projectId/automation/summary
GET /v1/console/projects/:projectId/automation/results
GET /v1/console/projects/:projectId/automation/results/:resultSetId
GET /v1/console/projects/:projectId/catalog/endpoints/:endpointId/automation/latest
```

Gateway responsibilities:

- authenticate console session;
- authorize tenant/project;
- validate filters and IDs;
- call `RESULTS_SERVICE` through Service Binding;
- validate upstream scope;
- return bounded, safe result contracts.

### C3 — Project Automation Center

New route:

```text
/projects/automation?projectId=...
```

Top section:

- Execution Layer hero/header;
- environment filter;
- time window filter;
- refresh.

KPIs:

- executions;
- pass rate;
- failed/error count;
- assertions pass rate;
- average duration;
- executed endpoint coverage.

Visual blocks:

- execution outcome distribution;
- daily execution/pass-rate trend;
- assertion health;
- operational attention / endpoints requiring action.

Detailed section:

- recent execution table;
- outcome/environment/endpoint filters;
- links to execution detail.

### C4 — Execution Detail

Route:

```text
/projects/automation/result?projectId=...&resultSetId=rset_...
```

Shows:

- PASSED / FAILED / ERROR;
- run/attempt identity;
- environment;
- Test Design version reference;
- timing;
- scenario count;
- assertion count;
- safe HTTP metadata;
- assertion results;
- safe diagnostics.

No raw bodies or secrets.

### C5 — Endpoint Automation Snapshot

Endpoint Detail gains a contextual `AUTOMATION` section with:

```text
TEST DESIGN
- latest persisted version
- scenarios
- READY / REVIEW / NEEDS_* summary
- generated at

LAST EXECUTION
- outcome
- environment
- duration
- assertions passed/total
- executed at
- link to execution detail

RECENT SIGNAL
- recent result dots/counts when available
```

### C6 — Test Registry Console Retrieval Fix

Current Console behavior incorrectly treats Test Design as session-only.

On endpoint load:

```text
GET /v1/console/projects/:projectId/intelligence/endpoints/:endpointId/test-design
```

If persisted design exists, render it immediately. Generating again creates a new immutable version and updates the view.

Remove obsolete copy stating the result is temporary/session-only.

### C7 — TDD + Production Gate

Required gates:

1. Results service read contract tests.
2. Tenant/project isolation tests.
3. `RESULTS_SERVICE` Gateway bridge tests.
4. Console route/component contract tests.
5. Full Console build.
6. Regression of prior Results ingestion tests.
7. Clean packages: no `node_modules/.git/.env/.dev.vars/.wrangler/.next/.open-next/out`.
8. SHA-256 for deliverables.
9. Production validation using a real `rset_*` from 07.7.9-B.

---

## 6. Summary contract target

Conceptual response:

```json
{
  "windowDays": 30,
  "executionCount": 143,
  "passedCount": 138,
  "failedCount": 4,
  "errorCount": 1,
  "passRate": 96.5,
  "assertionCount": 1301,
  "assertionPassedCount": 1284,
  "assertionFailedCount": 12,
  "assertionNotEvaluatedCount": 5,
  "assertionPassRate": 98.7,
  "avgDurationMs": 524,
  "executedEndpointCount": 31,
  "latestExecutionAt": "...",
  "outcomes": {...},
  "trend": [...],
  "attention": [...]
}
```

Catalog endpoint count is intentionally not copied into Results DB. The Console can combine `executedEndpointCount` with the Catalog summary `endpointCount` to display execution coverage.

---

## 7. UX target

The desired user reaction is:

> “O QAgent descobriu minhas APIs, gerou os testes, executou automaticamente e agora está me mostrando a saúde real do sistema.”

The Automation page should feel operational and executive at first glance, but preserve drill-down to deterministic technical evidence.

Visual ordering:

```text
Project Header
  ↓
Automation Hero + Filters
  ↓
KPI Cards
  ↓
Charts / Trends / Attention
  ↓
Recent Executions Table
  ↓
Execution Detail
```

Endpoint ordering:

```text
Endpoint identity / catalog metrics
  ↓
Automation Snapshot
  ↓
Test Data Runtime
  ↓
Test Design / Evidence / Schemas / History
```

---

## 8. Explicit non-goals

07.7.9-C does **not** implement:

- Suites;
- schedules;
- CI/CD triggers;
- notifications;
- DERIVED test data;
- POST/PUT/PATCH/DELETE execution enablement;
- durable side-effect journal;
- raw response evidence storage;
- R2 artifacts;
- analytics warehouse.

The page is designed so those capabilities can be added later without restructuring the workspace.

---

## 9. Definition of done

07.7.9-C is complete when a QA can:

1. open a Project;
2. click **Automação**;
3. see metrics/charts from real persisted execution results;
4. see recent runs;
5. open a specific `rset_*` and inspect scenario/assertion results;
6. return to an API Catalog endpoint and immediately see its latest persisted Test Design and latest execution;
7. do all of the above without direct Browser access to the Results Plane and without exposing secrets or raw request/response bodies.

---

## 10. Next product direction after 07.7.9-C

Once this vertical slice is production validated, QAgent has a demonstrable end-to-end cycle:

```text
Observe
→ Normalize
→ Catalog
→ Design
→ Registry
→ Runtime
→ Auth/Test Data
→ Execute
→ Assert
→ Persist Results
→ Visualize
```

The next high-value domains can then be prioritized around **Suites / orchestration / schedules / CI/CD** and, separately, durable safe mutation execution.

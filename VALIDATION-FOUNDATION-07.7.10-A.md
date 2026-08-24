# Validation — Foundation 07.7.10-A / qagent-gateway

Validate:

```text
GET  /v1/console/projects/:projectId/automation/test-inventory
POST /v1/console/projects/:projectId/automation/suites/auto-ready/materialize
GET  /v1/console/projects/:projectId/automation/suites/auto-ready/latest
```

All routes must require the existing Console tenant/project authorization and proxy via the Test Registry Service Binding.

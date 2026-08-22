# Validation — Foundation 07.7.6-A

Validated locally against the Gateway 07.7.6 baseline.

## Positive coverage

- no configured API Services + one public HTTPS observed origin -> discovered runtime identity;
- deterministic `discovered-*` runtime service key;
- observed public GET becomes `READY` without manual API Service configuration;
- auth `NONE` remains executable without Auth Profile;
- explicit API Service configuration wins over discovery;
- Create Run without discovered-target confirmation is rejected;
- confirmed discovered Run freezes `DISCOVERED_OBSERVATION/HIGH` Runtime Snapshot;
- discovered target is materialized into immutable `runtimeSnapshot.apiServices`;
- confirmation flag participates in idempotency fingerprint.

## Negative coverage

- multiple observed origins -> `AMBIGUOUS` / no runtime key;
- localhost/private target -> not promoted;
- discovered runtime observed under a different Environment -> Run rejected;
- stale discovered identity/origin -> Run rejected.

## Regression

`npm run test:all` passed after the change, including 07.6.x, 07.7.2-A, Auth Signal Bridge, Queue, Claim/Lease, Runtime Integration and HTTP Executor control-plane tests.

## Migration

None.

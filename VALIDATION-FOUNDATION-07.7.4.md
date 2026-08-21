# Validation — Foundation 07.7.4

Validado localmente:

```text
Gateway test:all                         PASS
Gateway check:07.7.4                     PASS
Runner check:07.7.4                      PASS
Gateway migrations 0001 -> 0007          PASS
SQLite integrity_check                   ok
SQLite foreign_key_check                 0 rows
Atomic first claim                       PASS
Concurrent duplicate claim               changes=0
Expired lease recovery                   PASS
Old attempt -> ABANDONED                 PASS
New attempt number N+1                   PASS
Heartbeat contract                       PASS
Transient retry persistence              PASS
Cancellation check                       PASS
Durable RECEIVED dedupe                  PASS
Active lease duplicate delay             PASS
DLQ/retry Wrangler config                PASS
HTTP execution remains disabled          PASS
```

Atomic SQL smoke result:

```text
attempt 1 = ABANDONED / RUNNER_LEASE_EXPIRED
attempt 2 = CLAIMED
single current ACTIVE claim = attempt 2
foreign_key_check = []
```

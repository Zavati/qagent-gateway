Sign-and-send — scripts de teste

Este arquivo documenta o uso dos utilitários adicionados para assinar e enviar webhooks localmente.

Scripts
- `test/sign-and-send.sh` — Bash (Linux/macOS/Git Bash). Requisitos: `jq`, `openssl`, `curl`.
- `test/sign-and-send.ps1` — PowerShell. Requisitos: PowerShell 7+ (ou Windows PowerShell com suporte a Invoke-RestMethod).

Comportamento
- Injetam `eventId` e `occurredAt` se estiverem vazios no payload.
- Calculam HMAC-SHA256 sobre `<unix_ts>.<rawBody>` usando `WEBHOOK_SIGNING_SECRET`.
- Enviam POST para a URL de webhook e imprimem resposta JSON formatada.

Exemplos

Bash (usa `test/payload.example.json` por padrão):
```bash
WEBHOOK_SECRET=dev-webhook-secret CLIENT_KEY="$CLIENT_KEY" ./test/sign-and-send.sh
```

PowerShell:
```powershell
$env:WEBHOOK_SIGNING_SECRET = 'dev-webhook-secret'
$env:CLIENT_KEY = '$CLIENT_KEY'
.\test\sign-and-send.ps1
```

Parâmetros (bash): `./test/sign-and-send.sh [payload.json] [webhook_url] [webhook_secret]`

Parâmetros (ps1): `-PayloadFile <file> -Url <url> -Secret <secret> -ClientKey <key>` (todos opcionais)

param(
  [string]$PayloadFile = "test/payload.example.json",
  [string]$Url = "http://localhost:8787/v1/webhooks/payment",
  [string]$Secret = $env:WEBHOOK_SIGNING_SECRET,
  [string]$ClientKey = $env:CLIENT_KEY
)

if (-not (Test-Path $PayloadFile)) {
  Write-Error "Payload file not found: $PayloadFile"
  exit 2
}

$payloadText = Get-Content -Raw -Path $PayloadFile
try { $payloadObj = $payloadText | ConvertFrom-Json } catch {
  Write-Error "Invalid JSON in payload file"
  exit 2
}

if (-not $payloadObj.eventId) { $payloadObj.eventId = "evt_local_$(Get-Date -UFormat %s)" }
if (-not $payloadObj.occurredAt) { $payloadObj.occurredAt = (Get-Date).ToString("o") }

$payload = ($payloadObj | ConvertTo-Json -Compress)

if (-not $Secret) { $Secret = "dev-webhook-secret" }

$ts = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$toSign = "$ts.$payload"
$key = [System.Text.Encoding]::UTF8.GetBytes($Secret)
$hmac = New-Object System.Security.Cryptography.HMACSHA256($key)
$hash = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($toSign))
$sig = ($hash | ForEach-Object { $_.ToString('x2') }) -join ''
$hdr = "t=$ts,v1=$sig"

Write-Host "Sending to $Url"
Write-Host "Signature: $hdr"

$headers = @{ 'X-QAgent-Signature' = $hdr; 'Content-Type' = 'application/json' }
if ($ClientKey) { $headers['clientKey'] = $ClientKey }

Invoke-RestMethod -Uri $Url -Method Post -Body $payload -Headers $headers -ContentType 'application/json' | ConvertTo-Json -Depth 5

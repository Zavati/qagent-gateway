# Script de testes integrados end-to-end para QAgent Gateway (PowerShell)
# Valida fluxo completo: signup → license → payment webhook → state transition

param(
    [string]$BaseUrl = "http://localhost:8787",
    [string]$WebhookSecret = "dev-webhook-secret"
)

$ErrorActionPreference = "Stop"

# Configurações
$TestEmail = "teste-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())@example.com"
$Passed = 0
$Failed = 0

# Funções auxiliares
function Print-Header {
    param([string]$Message)
    Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Blue
    Write-Host "  $Message" -ForegroundColor Blue
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Blue
}

function Print-Test {
    param([string]$Number, [string]$Description)
    Write-Host "`n📝 Teste ${Number}: $Description" -ForegroundColor Yellow
}

function Print-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
    $script:Passed++
}

function Print-Error {
    param([string]$Message)
    Write-Host "[X] $Message" -ForegroundColor Red
    $script:Failed++
}

function Print-Info {
    param([string]$Message)
    Write-Host "   $Message"
}

# Gerar assinatura HMAC-SHA256
function Get-HmacSignature {
    param([string]$Payload, [string]$Secret)
    
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    $hmac.Key = [Text.Encoding]::UTF8.GetBytes($Secret)
    $hash = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($Payload))
    return [BitConverter]::ToString($hash).Replace("-", "").ToLower()
}

# Fazer requisição HTTP
function Invoke-ApiRequest {
    param(
        [string]$Method,
        [string]$Url,
        [hashtable]$Headers = @{},
        [string]$Body = $null
    )
    
    try {
        $params = @{
            Method = $Method
            Uri = $Url
            Headers = $Headers
            ContentType = "application/json"
        }
        
        if ($Body) {
            $params.Body = $Body
        }
        
        $response = Invoke-WebRequest @params -UseBasicParsing
        
        return @{
            StatusCode = $response.StatusCode
            Body = $response.Content | ConvertFrom-Json
        }
    }
    catch {
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            
            return @{
                StatusCode = $statusCode
                Body = $responseBody | ConvertFrom-Json
            }
        }
        throw
    }
}

# Inicialização
Print-Header "QAgent Gateway - Testes Integrados"
Write-Host "Base URL: " -NoNewline
Write-Host $BaseUrl -ForegroundColor Blue
Write-Host "Test Email: " -NoNewline
Write-Host $TestEmail -ForegroundColor Blue
Write-Host "Webhook Secret: " -NoNewline
Write-Host "$($WebhookSecret.Substring(0, 8))..." -ForegroundColor Blue

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 1: Health Check
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Print-Test "1" "Health Check"

$healthResponse = Invoke-ApiRequest -Method GET -Url "$BaseUrl/health"

if ($healthResponse.StatusCode -eq 200 -and $healthResponse.Body.ok -eq $true) {
    Print-Success "Health check passou"
    Print-Info ($healthResponse.Body | ConvertTo-Json -Compress)
}
else {
    Print-Error "Health check falhou"
    Print-Info ($healthResponse.Body | ConvertTo-Json -Compress)
    exit 1
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 2: Signup Trial
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Print-Test "2" "Signup Trial (POST /v1/signup-trial)"

$signupPayload = @{
    email = $TestEmail
    name = "Test User Integration"
    company = "Test Corp"
    source = "integration-test"
    acceptTerms = $true
    acceptPrivacy = $true
} | ConvertTo-Json

$signupResponse = Invoke-ApiRequest -Method POST -Url "$BaseUrl/v1/signup-trial" -Body $signupPayload

if ($signupResponse.StatusCode -eq 201) {
    Print-Success "Signup retornou 201 Created"
    
    $clientKey = $signupResponse.Body.credentials.clientKey
    $customerId = $signupResponse.Body.customer.customerId
    $licenseStatus = $signupResponse.Body.license.status
    $daysLeft = $signupResponse.Body.license.daysLeft
    
    Print-Info "Client Key: $clientKey"
    Print-Info "Customer ID: $customerId"
    Print-Info "License Status: $licenseStatus"
    Print-Info "Days Left: $daysLeft"
    
    if ($licenseStatus -eq "trial") {
        Print-Success "Licença criada com status 'trial'"
    }
    else {
        Print-Error "Licença deveria estar 'trial', mas está '$licenseStatus'"
    }
    
    if ($clientKey) {
        Print-Success "Client Key gerado corretamente"
    }
    else {
        Print-Error "Client Key não foi retornado"
        exit 1
    }
}
else {
    Print-Error "Signup falhou com código $($signupResponse.StatusCode)"
    Print-Info ($signupResponse.Body | ConvertTo-Json)
    exit 1
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 3: Verificar Licença (GET /v1/license)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Print-Test "3" "Verificar Licença (GET /v1/license)"

$licenseHeaders = @{
    "Authorization" = "Bearer $clientKey"
}

$licenseResponse = Invoke-ApiRequest -Method GET -Url "$BaseUrl/v1/license" -Headers $licenseHeaders

if ($licenseResponse.StatusCode -eq 200) {
    Print-Success "GET /v1/license retornou 200 OK"
    
    $credentialType = $licenseResponse.Body.credential.type
    $licenseStatus = $licenseResponse.Body.license.status
    $licensePlan = $licenseResponse.Body.license.plan
    $legacyAccepted = $licenseResponse.Body.migration.legacyAccepted
    
    Print-Info "Credential Type: $credentialType"
    Print-Info "License Status: $licenseStatus"
    Print-Info "Plan: $licensePlan"
    Print-Info "Legacy Accepted: $legacyAccepted"
    
    if ($credentialType -eq "client_key") {
        Print-Success "Tipo de credencial correto: client_key"
    }
    else {
        Print-Error "Tipo de credencial deveria ser 'client_key', mas é '$credentialType'"
    }
    
    if ($legacyAccepted -eq $false) {
        Print-Success "Não está usando token legado"
    }
}
else {
    Print-Error "GET /v1/license falhou com código $($licenseResponse.StatusCode)"
    Print-Info ($licenseResponse.Body | ConvertTo-Json)
    exit 1
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 4: Signup Duplicado (409 Conflict)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Print-Test "4" "Signup Duplicado - deve retornar 409 Conflict"

$duplicateResponse = Invoke-ApiRequest -Method POST -Url "$BaseUrl/v1/signup-trial" -Body $signupPayload

if ($duplicateResponse.StatusCode -eq 409) {
    Print-Success "Signup duplicado bloqueado corretamente (409)"
    Print-Info $duplicateResponse.Body.message
}
else {
    Print-Error "Esperado 409, mas recebeu $($duplicateResponse.StatusCode)"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 5: Webhook de Pagamento Aprovado
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Print-Test "5" "Webhook de Pagamento Aprovado"

$eventId = "evt_test_$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
$occurredAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")

$paymentPayloadObj = @{
    provider = "stripe"
    eventId = $eventId
    eventType = "payment.succeeded"
    customer = @{
        customerId = $customerId
    }
    reference = @{
        clientKey = $clientKey
        providerCustomerId = "cus_stripe_test123"
        providerSubscriptionId = "sub_stripe_test456"
    }
    billing = @{
        amount = 4900
        currency = "BRL"
        status = "paid"
        paidAt = $occurredAt
    }
    occurredAt = $occurredAt
}

$paymentPayload = $paymentPayloadObj | ConvertTo-Json -Depth 10
$paymentSignature = Get-HmacSignature -Payload $paymentPayload -Secret $WebhookSecret

$paymentHeaders = @{
    "X-QAgent-Signature" = $paymentSignature
}

$paymentResponse = Invoke-ApiRequest -Method POST -Url "$BaseUrl/v1/webhooks/payment" -Headers $paymentHeaders -Body $paymentPayload

if ($paymentResponse.StatusCode -eq 200) {
    Print-Success "Webhook de pagamento aceito (200)"
    
    $processed = $paymentResponse.Body.processed
    $idempotent = $paymentResponse.Body.idempotent
    $transitionUpdated = $paymentResponse.Body.transition.updated
    $transitionBlocked = $paymentResponse.Body.transition.blocked
    $finalStatus = $paymentResponse.Body.transition.finalStatus
    
    Print-Info "Processed: $processed"
    Print-Info "Idempotent: $idempotent"
    Print-Info "Transition Updated: $transitionUpdated"
    Print-Info "Transition Blocked: $transitionBlocked"
    Print-Info "Final Status: $finalStatus"
    
    if ($processed -eq $true) {
        Print-Success "Pagamento processado com sucesso"
    }
    else {
        Print-Error "Pagamento não foi processado"
    }
    
    if ($transitionUpdated -eq $true) {
        Print-Success "Licenca atualizada apos pagamento"
    }
    else {
        Print-Error "Licença não foi atualizada"
    }
    
    if ($finalStatus -eq "active") {
        Print-Success "Status final correto: active"
    }
    else {
        Print-Error "Status final deveria ser 'active', mas é '$finalStatus'"
    }
}
else {
    Print-Error "Webhook de pagamento falhou com código $($paymentResponse.StatusCode)"
    Print-Info ($paymentResponse.Body | ConvertTo-Json)
    exit 1
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 6: Idempotência do Webhook
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Print-Test "6" "Idempotência - reenviar mesmo webhook"

$idempotentResponse = Invoke-ApiRequest -Method POST -Url "$BaseUrl/v1/webhooks/payment" -Headers $paymentHeaders -Body $paymentPayload

if ($idempotentResponse.StatusCode -eq 200) {
    $idempotentFlag = $idempotentResponse.Body.idempotent
    $processedAgain = $idempotentResponse.Body.processed
    
    if ($idempotentFlag -eq $true -and $processedAgain -eq $false) {
        Print-Success "Idempotência funcionando corretamente"
        Print-Info "Webhook com mesmo eventId não foi reprocessado"
    }
    else {
        Print-Error "Idempotência falhou: idempotent=$idempotentFlag, processed=$processedAgain"
    }
}
else {
    Print-Error "Teste de idempotência falhou com código $($idempotentResponse.StatusCode)"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 7: Verificar Transição de Estado (trial → active)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Print-Test "7" "Verificar Transição de Estado (trial → active)"

$licenseAfterPayment = Invoke-ApiRequest -Method GET -Url "$BaseUrl/v1/license" -Headers $licenseHeaders

if ($licenseAfterPayment.StatusCode -eq 200) {
    $newStatus = $licenseAfterPayment.Body.license.status
    $newDays = $licenseAfterPayment.Body.license.daysLeft
    
    Print-Info "Novo Status: $newStatus"
    Print-Info "Novo Days Left: $newDays"
    
    if ($newStatus -eq "active") {
        Print-Success "Transição trial → active confirmada"
    }
    else {
        Print-Error "Status deveria ser 'active', mas é '$newStatus'"
    }
    
    if ($newDays -gt 100) {
        Print-Success "Days left aumentou corretamente: $newDays"
    }
    else {
        Print-Error "Days left nao aumentou como esperado: $newDays"
    }
}
else {
    Print-Error "GET /v1/license apos pagamento falhou"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 8: Assinatura Inválida (segurança)
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Print-Test "8" "Segurança - Assinatura Inválida"

$invalidHeaders = @{
    "X-QAgent-Signature" = "assinatura_falsa_12345"
}

$invalidPayload = @{
    provider = "test"
    eventId = "evt_invalid"
} | ConvertTo-Json

$invalidResponse = Invoke-ApiRequest -Method POST -Url "$BaseUrl/v1/webhooks/payment" -Headers $invalidHeaders -Body $invalidPayload

if ($invalidResponse.StatusCode -in @(401, 403)) {
    Print-Success "Assinatura inválida bloqueada corretamente ($($invalidResponse.StatusCode))"
    Print-Info $invalidResponse.Body.message
}
else {
    Print-Error "Esperado 401/403, mas recebeu $($invalidResponse.StatusCode)"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 9: Token Ausente
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Print-Test "9" "Segurança - Token Ausente"

$noTokenResponse = Invoke-ApiRequest -Method GET -Url "$BaseUrl/v1/license"

if ($noTokenResponse.StatusCode -eq 401) {
    Print-Success "Token ausente bloqueado corretamente (401)"
    Print-Info $noTokenResponse.Body.message
}
else {
    Print-Error "Esperado 401, mas recebeu $($noTokenResponse.StatusCode)"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TESTE 10: Token Inválido
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Print-Test "10" "Segurança - Token Inválido (muito curto)"

$invalidTokenHeaders = @{
    "Authorization" = "Bearer short"
}

$invalidTokenResponse = Invoke-ApiRequest -Method GET -Url "$BaseUrl/v1/license" -Headers $invalidTokenHeaders

if ($invalidTokenResponse.StatusCode -eq 403) {
    Print-Success "Token inválido bloqueado corretamente (403)"
    Print-Info $invalidTokenResponse.Body.message
}
else {
    Print-Error "Esperado 403, mas recebeu $($invalidTokenResponse.StatusCode)"
}

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# RELATORIO FINAL
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Print-Header "Relatorio Final"

$total = $Passed + $Failed
$successRate = [math]::Round(($Passed / $total) * 100, 1)

Write-Host ""
Write-Host "Total de testes: " -NoNewline
Write-Host $total -ForegroundColor Blue
Write-Host "Passou: " -NoNewline
Write-Host $Passed -ForegroundColor Green
Write-Host "Falhou: " -NoNewline
Write-Host $Failed -ForegroundColor Red
Write-Host "Taxa de sucesso: " -NoNewline
Write-Host "$successRate%" -ForegroundColor Green
Write-Host ""

if ($Failed -eq 0) {
    Write-Host "🎉 Todos os testes passaram!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Recursos criados neste teste:"
    Write-Host "  - Email: $TestEmail"
    Write-Host "  - Client Key: $clientKey"
    Write-Host "  - Customer ID: $customerId"
    Write-Host "  - Event ID: $eventId"
    Write-Host ""
    exit 0
}
else {
    Write-Host "[X] Alguns testes falharam. Revise os erros acima." -ForegroundColor Red
    exit 1
}

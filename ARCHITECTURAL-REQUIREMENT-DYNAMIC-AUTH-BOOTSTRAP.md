# Architectural Requirement — Dynamic Auth Bootstrap

## Regra principal

O QAgent deve suportar autenticação mesmo quando não existe token estático previamente disponível.

O usuário pode fornecer apenas credentials de longa duração apropriadas ao Environment (por exemplo usuário/senha de automação ou client credentials). O token de sessão deve ser obtido JIT e existir somente em memória no Runner.

## Fontes de target

Dynamic Auth possui duas fontes de target:

```text
EXPLICIT_API_SERVICE
SCENARIO_RUNTIME
```

### EXPLICIT_API_SERVICE

Usado quando o endpoint de identidade está em outra API/origin explicitamente configurada.

### SCENARIO_RUNTIME

Usado no onboarding zero-config quando o login está no mesmo origin do endpoint testado. O target é derivado do Execution Plan e congelado no Runtime Snapshot.

Nunca re-resolver origin mutável depois da criação do Run.

## Ambiguidade

Se um Auth Profile `runtime_origin` for usado por cenários com mais de um API Service/origin, falhar fechado.

Não selecionar um origin arbitrariamente.

## Secret boundary

```text
Gateway Secret Vault
→ decrypt JIT
→ internal HMAC + active lease
→ Runner memory
→ auth request
→ access token memory
→ test request
→ discard
```

É proibido copiar credentials/tokens para:

- Test Design;
- Test Registry;
- Queue;
- Runtime Snapshot;
- Execution Plan;
- Gateway Run summaries;
- logs;
- Results Plane.

## Form login

`application/x-www-form-urlencoded` deve ser construído deterministicamente, com percent-encoding correto. Username/password vêm do Secret Vault; campos estáticos vêm apenas de config pública secret-safe.

O QAgent não deve persistir um OAuth Password token retornado. Cada attempt pode realizar no máximo um exchange por Auth Profile e reutilizar o token apenas dentro daquele attempt.

## Segurança de rede

Auth endpoint deve obedecer ao mesmo Egress/SSRF Guard do HTTP Executor:

- HTTPS por default;
- sem URL credentials;
- sem private/local/metadata hosts;
- origin congelada;
- redirect bloqueado;
- timeout e limites bounded.

## Fail closed

- login 4xx: Auth ERROR permanente;
- login 5xx/network/timeout: retryable antes de test request;
- token ausente: Auth ERROR permanente;
- body encoding/config inválida: Auth ERROR permanente;
- origin ambígua: Run creation bloqueada.

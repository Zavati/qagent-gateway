# 07.7.8-A FIX-1.2 — Cookie Session Confirmation

Gateway adds the optional public configuration `session.requireRotation` for `login_http_json + cookie_session`.

- Default is `false` for backward compatibility.
- `requireRotation=true` requires an explicit `session.cookieName`.
- No secrets are added to public configuration.
- No database migration is required.

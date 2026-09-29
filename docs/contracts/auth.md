# Auth — TOTP-based authentication

Existing login response fields (whatever they are today) must keep working; fields below
are additions. If the existing shape conflicts with this contract, dev1.impl edits the
contract file and tells orch1.lead the same turn.

Policy: TOTP required for all users (RFC 6238, SHA-1, 6 digits, 30 s step). Accepted window
= +/-1 step, configurable via env `LEX_TOTP_WINDOW` (default 1). Enforcement toggle env
`LEX_REQUIRE_TOTP` (default `1`).

| Endpoint | Auth | Request | Success response | Errors |
|---|---|---|---|---|
| `POST /api/auth/login` | none | `{username, password}` | `{status, access_token?, token_type?, role?, mfa_token?, enroll_token?}` where `status` is `"ok"` (only if TOTP not required), `"mfa_required"` (enrolled -> `mfa_token`), or `"enrollment_required"` (not enrolled -> `enroll_token`) | 401 `{detail:"invalid_credentials"}`; 429 `{detail:"locked", retry_after_s:int}` |
| `POST /api/auth/totp/enroll` | `Bearer <enroll_token>` | none | `{otpauth_uri, qr_png_base64, backup_codes:[10 strings]}` (shown once) | 401 |
| `POST /api/auth/totp/confirm` | `Bearer <enroll_token>` | `{code}` | `{status:"ok", access_token, token_type:"bearer", role}` | 401 `{detail:"invalid_code"}` |
| `POST /api/auth/mfa/verify` | none | `{mfa_token, code?, backup_code?}` | `{status:"ok", access_token, token_type:"bearer", role}` | 401 `{detail:"invalid_code"|"expired_mfa_token"}`; 429 locked |

Token scopes: `mfa_token` = JWT, 5 min, scope `mfa` (useless for any other endpoint).
`enroll_token` = JWT, 10 min, scope `enroll` (valid only for enroll/confirm).

Rules:
- A TOTP time-step can be used once per user (replay rejected).
- 5 consecutive failures (password or code) -> 5-minute lockout per username.
- Backup codes are single-use and stored hashed. The TOTP secret is stored server-side and
  never returned after enrollment.
- JWT secret comes only from env `LEX_JWT_SECRET`; if unset, generate once and persist to
  `data/.jwt_secret` (mode 0600, git-ignored). The old hardcoded default
  (`lex-sovereign-workbench-secret-key-change-in-prod`) must not exist anywhere in the repo.
- Never log secrets, codes, or tokens.
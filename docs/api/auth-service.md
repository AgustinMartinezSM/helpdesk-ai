# auth-service API

Base URL (local): `http://localhost:3003`. Interactive documentation: Swagger UI at `/docs` (disabled in production). Only the api-gateway is meant to call this service in the target architecture; direct calls are for local development.

All error responses use the standard Nest shape `{ statusCode, error, message }`. Domain failures deliberately reuse one message per class — login never reveals whether an email exists, and every refresh-token problem reads the same.

## Endpoints

### POST /auth/register

Creates an account. Body: `{ "email": string, "password": string (12–128 chars) }`.

- `201` → `{ id, email, roles }` (roles default to `["user"]`)
- `400` validation failure (bad email, short password, unknown fields)
- `409` email already registered
- `429` throttled (5/min per IP)

### POST /auth/login

Exchanges credentials for a session. Body: `{ "email", "password" }`.

- `200` → session (below)
- `401` invalid credentials (identical for unknown email and wrong password)
- `429` throttled (5/min per IP)

Session shape:

```json
{
  "accessToken": "<jwt>",
  "expiresInSeconds": 900,
  "refreshToken": "<id>.<secret>",
  "refreshTokenId": "<uuid>",
  "user": { "id": "<uuid>", "email": "...", "roles": ["user"] }
}
```

The refresh token is shown exactly once; store it securely. The access token carries `sub`, `email`, `roles`, `iss` and expiry, plus three tenant claims: `org`, the active organization id; `perms`, the permission keys resolved for that user in that organization; and `mv`, the membership version, which lets a reader notice a stale tenant snapshot.

`perms` is empty in every token today — role templates are still plain strings, and the rows mapping a template to permission keys arrive with the permission evaluator in a later phase. Until then an empty set means a call site that starts checking permissions denies, which is the safe direction. The three claims are omitted entirely, not set to `null`, when no membership resolves: when the user belongs to no organization, and when organizations-service was unreachable while the token was minted. `roles` stays alongside `perms` as a compatibility claim until every call site reads `perms`. No service reads the tenant claims yet.

### POST /auth/refresh

Rotates the refresh token. Body: `{ "refreshToken" }`.

- `200` → a fresh session; the presented token is revoked and linked to its replacement
- `401` invalid/expired token — or a **reused** (already-rotated) token, which additionally revokes every session of the user
- `429` throttled (20/min per IP)

### POST /auth/logout

Revokes the presented refresh token. Body: `{ "refreshToken" }`.

- `204` always (idempotent: garbage, unknown and already-revoked tokens succeed silently)

### GET /auth/me

Requires `Authorization: Bearer <accessToken>`.

- `200` → `{ id, email, roles }` from the verified token claims
- `401` missing/invalid/expired token

### GET /health and GET /health/ready

Liveness and readiness. Readiness probes the `helpdesk_auth` database with a real query and answers `503` with `checks: [{ name: "database", status: "down" }]` when it is unreachable.

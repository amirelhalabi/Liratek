# REST contract — `/api/offline/*` and the global lock gate

Router: `backend/src/api/offline.ts`, mounted `app.use("/api/offline", offlineRoutes)` in `backend/src/server.ts`.
Envelope everywhere: `{ success: boolean, data?, error?, code? }`, HTTP 200 on business failure (rule 6) — including the
global lock gate — except device-auth failures (401), which carry the same envelope. Schemas: `packages/core/src/validators/offline.ts`.

## Device routes (header `X-LiraTek-Device-Key: ltd_<tenantId>_<keyId>_<secret>`, middleware `authenticateDevice`)

`authenticateDevice` parses the key, runs the rest of the request inside `runWithTenant(tenantId)`, loads the device by
`key_id`, compares `sha256(secret)` with `key_hash` in constant time (`crypto.timingSafeEqual`), refuses revoked devices,
and sets `req.device = { id, tenantId, keyId }`. Failure → 401 `{ success:false, code:"DEVICE_UNAUTHORIZED" }`.
Declared BEFORE any `authenticateJWT` in the router.

| Method + path | Body (schema) | Reply `data` | Notes |
| --- | --- | --- | --- |
| POST `/heartbeat` | `offlineHeartbeatSchema` `{ state: "standby"\|"offline"\|"sending" (blocked mode reports `standby` with `ready:false`), ready: boolean, pendingCount: int≥0, periodId?: uuid (required when state ≠ standby), periodStartedAt?: datetime, appVersion: string, schemaVersion: int }` | `{ serverTime, lock: {locked, reason, since}, lockAfterSeconds, serverSchemaVersion }` | `ensurePeriod` first (R8: `period_started_at = min(clamp(periodStartedAt ≤ now), COALESCE(tenant-wide MAX(last_heartbeat_at) before this message, paired_at))`, `period_opened_at = now`), then stamps `last_heartbeat_at` = server now. Every other authenticated device call except `/goodbye` also counts as a check-in (stamped after `ensurePeriod`). `ensurePeriod` runs only for state `offline`/`sending` and for `/replay`, and never reopens `last_closed_period_id` |
| POST `/goodbye` | `offlineGoodbyeSchema` `{ reason: "quit"\|"suspend"\|"shutdown" }` | `{}` | stamps `last_goodbye_at` |
| GET `/snapshot` | — | binary gzip (`application/gzip`) | headers `X-Snapshot-Schema-Version`, `X-Snapshot-Tenant-Id`, `X-Snapshot-Created-At`; cached ≤ 5 min per tenant |
| POST `/replay` | `offlineReplayBatchSchema` `{ periodId: uuid, periodStartedAt: datetime, ops: OfflineOp[1..50] }`; `OfflineOp = { opKey: uuid, operation: registry name, payload: unknown, actorUserId: int>0, occurredAt: datetime, clientDay: YYYY-MM-DD, clientTzOffsetMinutes: int (required) }` | `{ results: [{ opKey, status: "booked"\|"refused"\|"held", result?, error?, duplicate: boolean }] }` | `ensurePeriod` first; ops processed in array order, each op's dedupe + checks + booking + outcome in ONE transaction; `payload` validated per op with the registry's core schema and `offlineRules` (refused if invalid); `held` when `MAX(last_web_write_at)` over the tenant's device rows > `period_started_at`, or when an earlier op of the period for the same client was refused/held |
| POST `/period/complete` | `offlinePeriodCompleteSchema` `{ periodId: uuid }` | `{ lock: {locked:false} }` | checks in this order: (1) a DIFFERENT period is open → refused `PERIOD_HAS_UNDELIVERED` (the desktop keeps the work file and retries on the next Send); (2) `periodId` is the open period → closed; (3) `periodId` = `last_closed_period_id` → success again (idempotent, lost reply); (4) no period open and the id was never seen → success, recorded as `last_closed_period_id` |

## Pairing (public, `authLimiter`)

| Method + path | Body | Reply `data` |
| --- | --- | --- |
| POST `/pair` | `offlinePairSchema` `{ shop: string, username: string, password: string, deviceName: string(1..80) }` | `{ deviceKey, deviceId, tenantId, shopName, schemaVersion }` — the key is returned only here, once |

`shop` is the shop's slug (as in `<slug>.liratek.shop`). Optional `replaceBusy: true` (FR-035): replaces a device that has
an open period or is currently locked (silent) — the old row is revoked and its `last_web_write_at` stamped now, so that period's ops are held.
Refusals: generic `INVALID_CREDENTIALS` for unknown shop/user/password or inactive shop (as mobile login); `ADMIN_ONLY`
for staff; `DEVICE_BUSY` when the current device has an open period or is currently locked and `replaceBusy` is not set (O5).

## User routes (`authenticateJWT` at router level after the device/pair routes)

| Method + path | Roles | Body | Reply `data` |
| --- | --- | --- | --- |
| GET `/status` | admin, staff | — | `{ paired: boolean, lock: {locked, reason, since}, reviewCount: int, device?: { name, lastHeartbeatAt, lastState, pendingCount } }` |
| POST `/unlock` | admin | `{}` | `{ lock }` — sets `lock_released_at/by`, audit `{ action:"update", entity_type:"offline_lock", summary:"Unlocked web app — desktop not in use" }` |
| GET `/devices` | admin | — | `[{ id, name, pairedAt, pairedBy, lastHeartbeatAt, lastState, revokedAt }]` |
| POST `/devices/:id/revoke` | admin | `{ force?: boolean }` | `{}` — audit; refused with `DEVICE_BUSY` while a period is open or the device is currently locked, unless `force` (which also stamps `last_web_write_at`) |
| GET `/review` | admin | query `status?=held,refused` (default) or `status=booked` (Offline history) | `[{ id, opKey, operation, label, occurredAt, clientDay, actor, amountSummary, status, error, result, offlineRef }]` |
| POST `/review/apply-all` | admin | `{}` | `{ booked, refused }` — applies every held/refused op in recorded order (declared before `/review/:id/*`) |
| POST `/review/:id/apply` | admin | `{}` | `{ status, result?, error? }` — books once through the same dispatcher; if the instant is in the future, books at server now and notes it in `result_json` |
| POST `/review/:id/dismiss` | admin | `offlineReviewDismissSchema` `{ note?: string(0..200) }` | `{ status: "dismissed" }` |

Static paths are declared before `/:id` paths.

## Global gate `requireShopUnlocked` (`backend/src/middleware/requireShopUnlocked.ts`)

- Mounted `app.use(requireShopUnlocked)` right after `app.use(requireWritableSubscription)`.
- Only `POST|PUT|PATCH|DELETE`; tenant from `req.user` or `verifyJwt(bearer)`; no tenant → pass.
- Lookup and stamp run inside `runWithTenant(tenantId)` (tenant from the JWT) — the gate runs before any router's
  `authenticateJWT`, and repositories throw without a tenant context.
- Exempt (on `req.originalUrl`, query stripped): prefixes `/api/auth/`, `/api/mobile/auth/`; the device routes
  `/api/offline/pair`, `/heartbeat`, `/goodbye`, `/snapshot`, `/replay`, `/period/complete` (they authenticate with the
  device key; exempt even if a bearer token is also sent, so a stray header cannot block or stamp them); `/api/offline/unlock`,
  `/api/offline/devices/:id/revoke`, `/api/offline/review/:id/dismiss`; the named `READ_VIA_POST` list
  (`/api/audit/search`, `/api/reports/pdf`, `/api/product-units/list`, `/api/product-units/summary`,
  `/api/product-units/for-sale-items`, `/api/exchange-lots/preview`, `/api/vouchers/validate`, `/api/profits/unlock`,
  `/api/profits/lock`). `/api/offline/review/:id/apply` and `/review/apply-all` are gated. Known ungated exception:
  `GET /api/loto/checkpoints/scheduled` (creates a non-money checkpoint over GET). Device routes
  carry no user token, so the gate resolves no tenant and passes them.
- Not locked (and not exempt) → stamp `last_web_write_at = now` on the tenant's newest device row when the tenant has one
  (FR-009a), then `next()`.
- Locked → HTTP **200** (rule 6: `frontend/src/api/httpClient.ts` throws on any non-2xx, which would turn the message
  into a generic error toast) `{ success:false, code:"SHOP_LOCKED_OFFLINE", error:"Your shop's desktop is working offline. Changes
  are paused until it reconnects. An admin can unlock if the desktop isn't in use." }`.
- Lookup throws → the web-change stamp is still attempted separately (a tenant-scoped UPDATE that does not depend on the
  failed lookup), then `next()` and `logger.error` (O7). Stamp throws → `next()` and `logger.error`.
- Accepted while locked (refused, documented): `POST /api/reports/backup/verify`, staff invitation accept, password
  change, and the public token POSTs (`/api/password-reset/check`, `/api/user-invitations/check`, `/api/user-email/verify`,
  sign-in code verify) only when the browser also sends a bearer token of the locked shop — rare, retried after the lock
  lifts.

## Rate limiting

`verifiedIdentityKey` in `backend/src/middleware/rateLimit.ts`: a device key that passes the strict format regex (else no
DB read) and verifies (inside `runWithTenant(<key's tenant>)`, cached 60 s per key id) → identity `device:<tenantId>:<keyId>` (per-identity bucket). Unverified →
anonymous bucket unchanged.

# Research — LIRA-306 Offline desktop fallback

Each item: **Decision**, **Rationale**, **Alternatives considered**. Facts marked _verified_ were checked against source on
2026-10-11; anything not checked is marked _Assumption_. Owner-facing decisions are O-numbered in spec.md and
`docs/plans/OVERNIGHT_DECISIONS_2026-10-11.md` §4.

## R1 — Where the "book once" guarantee lives (O9)

- **Decision**: a new permanent table `offline_replay_ops`, unique `(tenant_id, op_key)`, written in the same transaction
  as the booking (pattern copied from `IdempotencyService.run`: find → book → store, inside `repo.atomically`). Refusals
  and held operations are stored too.
- **Rationale** (_verified_): `idempotency_keys` (v208) is swept after 24 h (`IDEMPOTENCY_RETENTION_MS`), stores only
  successful replies, and is scoped by `(tenant, user, route, key)`. An outage can last days, a desktop can be switched off
  for a weekend between a dropped reply and its retry, and a refused operation must be kept for the owner — all three
  break with `idempotency_keys`. `sync_queue`/`sync_errors` have no `tenant_id`, no `updated_at`, a row-copy shape keyed
  by `record_id` (contradicts D4), and `sync_errors` is read by the desktop diagnostics (`ActivityRepository`,
  `dbHandlers.ts`).
- **Alternatives**: extend `idempotency_keys` with a "never sweep" flag (mixes two lifetimes and the success-only rule in
  one table); reuse `sync_queue` (above).

## R2 — How replay reaches the services (E1/E2)

- **Decision**: one device-authenticated route `POST /api/offline/replay` → core `OfflineReplayService.replayBatch()` →
  per operation, a dispatcher in core keyed by the registry name calls exactly what the web route calls:
  `getSalesService().processSale(payload, actorId)`, `getExpenseService().addExpense(payload, actorId)`,
  `getDebtService().addRepayment({ ...payload, userId: actorId })`. Audit rows are written with the actor explicitly
  through the same audit writer `auditRest` uses — NOT through `auditRest` itself, which returns early when `req.user`
  is absent (_verified_ `backend/src/middleware/audit.ts:39-41`), as it always is on a device request.
- **Rationale** (_verified_): the three web routes are thin (`backend/src/api/sales.ts` `/process`,
  `backend/src/api/expenses.ts` `POST /`, `backend/src/api/debts.ts` `/repayments`): validate with a core schema, call one
  service with the JWT user, audit. Calling the service from core keeps business logic out of the transport (rule 13/19).
  Re-sending each op to the existing route instead would require device auth to impersonate a JWT user inside
  `authenticateJWT` (security-sensitive) and the desktop to know every REST path/body translation.
- **Alternatives**: replay through existing routes with a device-key branch in `authenticateJWT` (rejected: widens the
  most sensitive middleware); replay rows (rejected by D4).
- **Owner flag (O23)**: the actor coming from the operation is a narrow exception to rule 19c, taken on the owner's
  behalf and flagged for confirmation.

## R3 — What exactly is recorded (rule 22/23)

- **Decision**: the outbox stores the payload after it has been parsed by the **core** schema named in the registry
  (`saleProcessSchema`, `createExpenseSchema`, `addRepaymentSchema`), not the desktop's own validator output. If the core
  parse fails, the offline write is refused (nothing written, nothing recorded).
- **Rationale** (_verified_): `SaleProcessSchema` and `DebtRepaymentSchema` in `electron-app/schemas/index.ts` are re-exports
  of the core schemas, but `AddExpenseSchema` is a hand-written literal mirror of `createExpenseSchema`. Recording the
  core-parsed value guarantees the server's own validation will accept the same keys (no silent Zod stripping between the
  two). A unit test pins: for a fixture, `registry[op].schema.parse(x)` on the desktop equals what the route's schema
  yields.
- **Alternatives**: record the raw IPC args (rejected: drift between desktop mirror and core schema would surface only at
  replay, on money).

## R4 — Atomicity of local write + outbox (O10)

- **Decision**: offline writes go to `offline-work.db`, a copy of the newest verified mirror made when offline mode
  starts; the outbox table lives in that same file. `recordOffline()` runs
  `db.transaction(() => { const r = fn(); if (r.success) outbox.append(...) else throw ROLLBACK })` so the booking and its
  operation commit together or not at all (better-sqlite3 nests the service's own transaction as a savepoint).
- **Rationale**: a separate outbox file cannot share a transaction (SQLite attached-DB transactions are not atomic across
  files in WAL mode); a crash between two files would leave a local sale with no operation → the server never hears of
  money that changed hands. Keeping the mirror itself untouched means a future incremental feed (S1) never meets local
  writes.
- **Alternatives**: outbox in the mirror (rejected: the mirror is replaced on refresh); capture in the renderer adapter
  (rejected: a renderer crash after the IPC commit loses the operation).

## R5 — Fail-closed local write guard (FR-025, FR-011)

- **Decision**: in paired mode the desktop sets `PRAGMA query_only = ON` on its single connection BEFORE
  `registerHandlers()` runs (so boot-time writers inside it — Loto monthly-fee check, session cleanup — are covered).
  `withWritable(db, fn)` turns it off only for the **synchronous** duration of `fn` and throws if `fn` returns a Promise
  (an `await` inside would leave the guard off while other handlers run). Named `withWritable` users, and only these:
  1. `recordOffline` (booking + outbox row + the operation's audit, one transaction);
  2. the sender's outbox bookkeeping (`markResult`, `markAttemptFailed`) — without it every mark fails under the guard and
     the send never finishes (analyze C7);
  3. offline sign-in/sign-out bookkeeping: in paired modes `auth:login` / `auth:restore-session` / `auth:logout` first do
     their read-only, async part (password check), then do every DB write (session row, last login, audit, and session restore's `touchActivity`) in
     ONE synchronous `withWritable` block. Session cleanup at boot skips its DB part under the guard (in-memory purge
     still runs). If `AuthService` does not already separate the two, the task splits it (a
     read-only credential check + a synchronous session writer) without changing standalone behaviour.
  Every other write fails at the SQLite level and paired-mode handlers map "attempt to write a readonly database" to
  "Not available while offline" / "use the web app".
- **Rationale**: 415 `ipcMain.handle` registrations, no central wrapper (_verified_); classifying each by hand is
  error-prone and a missed write in a copy that is later discarded is silent data loss. `query_only` makes default-deny
  automatic (_verified_ with Python `sqlite3`: inserts and temp-table creation are refused; the flag can be toggled inside
  an open transaction; COMMIT works).
- **Alternatives**: wrap `ipcMain.handle` with a channel allowlist (rejected: a wrongly listed write is lost silently);
  open the file `readonly: true` (rejected: needs a second connection for the recorded writes).
- **Reads that write**: some read paths may write lazily (`INSERT OR IGNORE` seeding in a few repositories — _Likely_,
  unverified per channel). A task sweeps every read channel the POS, Expenses and Debts pages call with the guard on and
  fixes or explicitly allows each offender.
- **Other writers outside SQL**: the hourly backup (copies the open file, writes `last_backup_at`), the auto-updater
  (installing a version with a new migration mid-offline) and `db-path-prev.txt` rollback are switched off in paired
  modes by the boot decision (R10).

## R6 — The lock rule, the web-change mark, and rule 27 (O6, O7, O19, O22)

- **Decision**: pure `computeShopLock(device, nowMs, staleMs)` in `packages/core/src/offline/lockState.ts`:
  - no active device → `{ locked:false }`;
  - a silent device whose last check-in reported state `standby` with `ready:false` never locks (offline/sending always
    lock, whatever `ready` says) (it cannot work offline, so pausing the web
    would leave the shop with no till — analyze M13);
  - `since` = `last_state ∈ {offline, sending}` ? `period_opened_at` (server receipt time of the period's first
    message — so an Unlock made during the outage does not also lift the later offline/sending lock, analyze M1) :
    `(last_heartbeat_at ?? paired_at)` when `nowMs − (last_heartbeat_at ?? paired_at) > staleMs` and no
    `last_goodbye_at ≥ last_heartbeat_at`; a goodbye never lifts an offline/sending lock;
  - locked iff `since` exists and `lock_released_at` is null or `< since`.
  Both the gate's lookup/stamp and the limiter's key verification run inside `runWithTenant(tenantId)` — tenant from
  the JWT for the gate, from the key for the limiter — because they execute before any router's `authenticateJWT`, and
  `BaseRepository`/per-tenant `getDatabase()` throw without a tenant context (_verified_ `tenantContext.ts:197-220`;
  backend jest hides it by fixing tenant 1 in `jest.setup.ts`, so the tests use another tenant — analyze H1).
  The global gate `requireShopUnlocked` (mounted right after `requireWritableSubscription`, tenant from `req.user` or
  `verifyJwt(bearer)` — the trap documented there) handles non-GET requests that carry a user token:
  - locked → HTTP 200 `{ success:false, code:"SHOP_LOCKED_OFFLINE", error }` (rule 6; _verified_: `httpClient.ts`
    throws on any non-2xx, which would turn the message into a generic toast);
  - not locked → stamp `last_web_write_at = now` on the tenant's newest device row (only when the tenant has any device
    row, active or revoked — the same single-row read the lock needed), then `next()`;
  - exempt (pass, no stamp): `/api/auth/*`, `/api/mobile/auth/*`, `/api/offline/unlock`,
    the device routes `/api/offline/pair`, `/heartbeat`, `/goodbye`, `/snapshot`, `/replay`, `/period/complete` (exempt even
    when a bearer is also sent), `/api/offline/devices/:id/revoke` and `/api/offline/review/:id/dismiss` (they book nothing; a forced revoke stamps
    inside the service — analyze M2), and the named reads-via-POST list `READ_VIA_POST` (_verified_ 2026-10-11:
    `/api/audit/search`, `/api/reports/pdf`, `/api/product-units/list`, `/api/product-units/summary`,
    `/api/product-units/for-sale-items`, `/api/exchange-lots/preview`, `/api/vouchers/validate`, `/api/profits/unlock`,
    `/api/profits/lock`). A guard test fails on any POST route whose path ends in a read-like word (`search`, `list`,
    `summary`, `preview`, `validate`, `pdf`, `lock`, `unlock`, `for-…`) that is in neither `READ_VIA_POST` nor an explicit
    `READ_LIKE_BUT_WRITES` list.
    `/api/offline/review/:id/apply` and `/review/apply-all` are NOT exempt (applying offline work is a write).
  - known exception (documented, not gated): `GET /api/loto/checkpoints/scheduled` creates a checkpoint over GET
    (`loto.ts:473-477`); a Loto checkpoint moves no money and is not an offline operation (analyze M3).
  - lookup error → `next()`, `logger.error` (O7); the web-change stamp is attempted in its own try/catch even then (if
    the database is down it may be lost — the one case where a colliding offline period could be booked).
- **Rationale**: modelled on the subscription gate, inverted (it blocks trading writes). `now − last_heartbeat_at`
  compares two **server** instants (check-ins are stamped by the server on receipt), never a calendar day, so rule 27's
  hazard does not arise. The web-change mark is what makes the review rule (R8) exact. Fail-open matches the
  subscription gate; a failed stamp only risks booking an op that should have been held — a stale-view risk, never a
  double booking or a loss, because replay is operation-based.
- **Alternatives**: lock only when the desktop reports offline work (rejected: during an outage it cannot report);
  fail-closed (rejected: a DB hiccup would stop every paired shop from selling).
- **Risk (named)**: a power cut at closing locks the owner's after-hours phone sales (LIRA-289) until an admin taps
  Unlock. Accepted per D2; undo = raise `OFFLINE_LOCK_STALE_MS` or revoke the device.
- **Risk (named, Windows shutdown — analyze H4)**: on Windows, `before-quit` is not emitted on system shutdown/logout and
  `powerMonitor 'shutdown'` is Linux/macOS only (_verified_ `node_modules/electron/electron.d.ts`). The goodbye is
  therefore sent from the hidden window's `session-end` event (win32; `query-session-end` is not in Electron 31's
  types, _verified_ `electron.d.ts:2206-2211`) with a 2 s time limit, plus
  `before-quit` and `powerMonitor 'suspend'`. _Assumption (unverified)_: Windows gives that request enough time; if not,
  every evening shutdown locks the web 90 s later until an admin unlocks — verified in the owner drill (Phase 8).
- **Cost (accepted)**: a shop that was ever paired pays one extra single-row UPDATE per web write.

## R7 — Device credential and pairing (O4, O5)

- **Decision**: `POST /api/offline/pair` takes `{ shop, username, password, deviceName }` (verified by calling
  `MobileAuthService.loginWithShop` — shop in the body, generic `INVALID_CREDENTIALS`, `ADMIN_ONLY` for staff — and
  immediately revoking the session it creates, so pairing leaves no web session behind; `authLimiter`), creates `offline_devices` row, returns once
  `deviceKey = "ltd_<tenantId>_<keyId>_<secret>"` (keyId 12 hex, secret 32 random bytes base64url). The server stores
  `sha256(secret)`; the tenant id in the key routes the lookup to the right tenant DB in per-tenant mode (it is not a
  secret). Desktop keeps it encrypted with Electron `safeStorage` in `pairing.json`. One active device per tenant
  (partial unique index); a new pairing revokes the old one unless the old one has an open period (refused).
- **Rationale** (_verified_): the licence key (`tenant_subscriptions.license_key`) is a read-only status credential issued
  by the super admin and sent to `/api/subscription/by-key`; promoting it to a write credential (replay) widens it. A
  per-device key is revocable by the shop admin without super-admin involvement. sha256 suffices for a 256-bit random
  secret (no dictionary to attack).
- **Alternatives**: licence key (above); a long-lived user JWT on the desktop (rejected: tied to one user, expires,
  revoked by password change).

## R8 — Offline period and the review rule (O8, FR-017) — rewritten after analyze C1/C3/C4/C13

- **Decision**: the desktop opens a period id (UUID) and records `periodStartedAt` (its own clock) when offline mode
  starts, and stamps both on every operation and on its check-ins. The server's `ensurePeriod(device, periodId,
  reportedStartIso, nowIso)` runs on the first `offline`/`sending` heartbeat or replay of a new period id — never for a period id already completed
  (`last_closed_period_id`; such ops are held) — (every authenticated device call except `/goodbye` also counts as a
  check-in, stamped AFTER `ensurePeriod` reads the previous value) and sets
  `period_started_at = min(clamp(reportedStartIso, ≤ nowIso), COALESCE(MAX(last_heartbeat_at) over ALL the tenant's device
  rows, revoked included, as it was before this message, paired_at))` and `period_opened_at = nowIso`. Taking the tenant-wide latest
  check-in (not just this row's) keeps the server-clock bound after a re-pair, when the new row has never checked in
  (analyze H2); clamping stops a fast desktop clock from moving the start into the future (M13). Each op is stored `held` when `MAX(last_web_write_at)` over ALL the tenant's device
  rows (revoked included) is later than its period's `period_started_at`. `POST /api/offline/period/complete` closes the
  period (`current_period_id = NULL`, `last_state = standby`), ending the lock.
- **Why this rule and not "admin unlocked after the period began"** (the first draft): in a real outage the desktop's
  first message of a period arrives only after reconnect, so a period start taken from that message is later than any
  unlock made during the outage — the check never fired (C1). The goodbye-then-boot-offline case (C3), the gap between the
  desktop's "Work offline" threshold and the server's lock delay (C4), and a period completed early by a desktop bug (C13)
  all reduce to the same question: *did any web write happen after this period began?* The mark answers it directly.
- **Forced replacement**: re-pairing or revoking a device that has an open period OR is currently locked (silent) is
  `DEVICE_BUSY` unless `replaceBusy`/`force`, which stamps `last_web_write_at = now` on the replaced row, so that period's
  ops are held (C10, H2). During a real outage the server never saw the period, so "currently locked" is what makes the
  re-pair count.
- **Dependent ops (analyze M10)**: within a period (across all its batches), once an op for a client is refused or held
  (dismissed items count too, since they were refused first), every later op of that
  period naming the same client is held with the reason "an earlier offline item for this customer needs review", so a
  repayment is never booked against a sale the owner may still dismiss.
- **Owner practicality**: the review list has Apply all (recorded order), because a whole period can be held.

## R9 — Mirror source v1: server-made single-shop snapshot (O3, O16)

- **Decision**: `GET /api/offline/snapshot` (device) returns a gzip of a single-shop SQLite file built by
  `buildTenantSnapshot()` in `packages/core/src/db/tenantSnapshot.ts`: `VACUUM INTO` a temp file from the tenant's
  connection; on that copy run `narrowToTenant(db, tenantId, { keepOwnSubscriptionRow: true, sourceDb })` — the WHOLE
  narrowing of `tenantSplit.ts` `buildTenantFile` (tenant-scoped deletes, `PLATFORM_ONLY_TABLES`, legacy impersonator
  rewrite, Litestream table drop, and the `discoverUnsafeAndUnscopedTables` hard-fail), extracted so split and snapshot
  share one implementation (rule 14), with one option: the split deletes every `tenant_subscriptions` row, the snapshot
  keeps the shop's own row; then empty `SNAPSHOT_STRIPPED_TABLES`; null `tenant_subscriptions.license_key`; reset
  `sqlite_sequence` to each table's own `MAX(id)` (the platform-wide counters would reveal every shop's lifetime row
  counts — `tenantSplitSqliteSequenceLeak.characterization.test.ts` says "revisit before the offline-desktop plan"; safe
  because copy ids never flow back, D4); `foreign_key_check` empty, `integrity_check = ok`, `VACUUM`. Cached per tenant
  for 5 minutes. Headers: `X-Snapshot-Schema-Version`, `X-Snapshot-Tenant-Id`, `X-Snapshot-Created-At`.
- **Rationale** (_verified_): `tenantSplit.ts` already narrows a full copy to one tenant with FK/integrity verification
  and is tested on real data; it works on today's shared file and on per-tenant files. Spikes S1/S3 need R2 credentials
  and production access (G5). Staleness loses no data (plan §5.2).
- **Alternatives**: incremental Litestream segments (deferred to US5); `db.backup()` (same result, more moving parts).
- **Assumption (unverified)**: building takes well under a second at today's size; task T056 measures it on a copy of a
  local DB and records the number.
- **Table guards** (two, both in the snapshot test): (1) every table whose name matches
  `/token|session|secret|code|key|identit|idempot|offline_/` is in `SNAPSHOT_STRIPPED_TABLES` or in `SNAPSHOT_KEPT_TABLES`
  with a reason (`customer_sessions`, `customer_session_transactions` kept as business data); (2) every table WITHOUT a
  `tenant_id` column is empty in the snapshot or listed in `SNAPSHOT_GLOBAL_TABLES_ALLOWED` with a reason (e.g.
  `schema_migrations`; `sync_queue` and `sync_errors` must come out empty), so a future platform table holding other
  shops' data cannot ride along unnoticed; (3) a column-name guard: every column matching `/hash|token|secret|_key$/`
  must belong to a stripped table or be listed with a reason (expect benign hits such as `module_key`, `item_key`,
  `idem_key`, `idempotency_key` in the kept list) (`users.password_hash` kept for offline sign-in);
  (4) `system_settings` rows whose key matches `/api_key|token|secret|password/` (e.g. `whatsapp_api_key`, a live Meta
  token — `WhatsAppService.ts:21`) are deleted from the copy (`SNAPSHOT_STRIPPED_SETTING_KEYS` + regex). Stripped tables
  include `user_invitations`, `email_verification_tokens` and `user_identities`; `session_cart_items` is kept (business
  data). Temp files are removed in `finally`, also when narrowing hard-fails (M12). The builder takes an injectable
  `Database` constructor so backend jest (which maps `better-sqlite3` to a mock) can pass the real one via the
  `require("better-sqlite3/lib/index.js")` + `__LIRATEK_TEST_DB__` pattern of `idempotency.api.test.ts` (M11).

## R10 — Desktop modes, boot steps and file switching (O10, O11, O18)

- **Decision**: `fallbackBoot.decideBoot(pairing, files, codeSchemaVersion)` (pure) returns `{ mode, dbFile, tenantId,
  ready, notReadyReason, steps }` with mode one of: `standalone` (no pairing → today's path, tenant 1, every step as
  today); `standby` (newest verified `mirror-*.db`, its own tenant id, guard on; `ready:false,
  notReadyReason:"version_mismatch"` when the copy's version ≠ the code's — offline mode then cannot start);
  `offline` (`offline-work.db` — refused to `standby` with `notReadyReason:"version_mismatch"` if the work file's
  version ≠ the code's, keeping the work file untouched); `blocked` (paired, no usable copy). `steps` lists, per mode,
  `{ runMigrations, seedPresets, licenseSync, hourlyBackup, autoUpdateDownload, dbPathRollback, applyDbKey,
  skipSetupWizard, enableGuard }`: standalone → as today; paired → migrations, presets, licence sync, backup, path
  rollback and the SQLCipher key (`db-key.txt` would break a plain copy — M6) off, the guard on, the setup wizard skipped
  (`setup:isRequired` answers false: a web shop's copy has no `setup_complete` row — _Likely_, based on
  `TenantRepository.seedSystemSettings`; analyze H5); `autoUpdateDownload` ON in `standby` and `blocked` (so paired
  desktops keep up with server migrations, O11 — H10) and OFF only in `offline`. The updater only checks on its own
  (`autoDownload=false`, `updaterHandlers.ts`) and its `updater:*` channels require a signed-in admin, which never
  exists on the standby screen, so in standby/blocked the main process turns on `autoDownload` only — `autoCheckForUpdates(mode)` must stop
  resetting it to false in those modes (_verified_ `updaterHandlers.ts:183-184` resets both flags before every check) —
  and re-checks every 4 hours (a standby PC can run for days), setting `autoInstallOnAppQuit = false` before EVERY check
  (electron-updater reads it when a download completes); `autoInstallOnAppQuit` stays FALSE in every paired mode,
  because electron-updater installs silently on ANY quit once a download is ready (_verified_
  `node_modules/electron-updater/out/BaseUpdater.js:68-90`) and "Work offline" is a relaunch: a surprise install there
  could leave the shop with a version-mismatched copy and no internet. Install happens only when someone presses
  "Restart to update" on the standby screen (pre-login `offline:install-update`, E3); in `offline` mode download and
  install are refused. The policy lives in `electron-app/offline/updatePolicy.ts` (no `import.meta`, takes the
  autoUpdater object as a parameter) because `updaterHandlers.ts` cannot be loaded by electron-app jest (its
  `import.meta.url` `__filename` shim; its two test files are quarantined in `jest.config.cjs`); `runMigrations` is true only for `blocked`'s empty in-memory schema.
  Readiness (`canStartOffline`) also requires the code's version to equal the last `serverSchemaVersion` from a
  check-in (M14). Backup/restore channels refuse in paired modes (they target the standalone file, O18 — M12).
  Known limitations: users who sign in only with Google (`has_password = 0`) can neither pair nor sign in offline
  (M15); the Profits password is a stripped secret, so Profits is unavailable offline (L8); a work file left by a
  version change waits, untouched, until the matching version is installed (M10) — and while such a file holds waiting
  rows, go-offline, pair, unpair and the copy refresh refuse, and the standby screen shows "Unsent offline work —
  install version X" (counted from the file on disk, not from the open database; analyze pass 7 H1). The open mirror
  is never pruned. `blocked` opens an in-memory database
  with migrations applied (no shop data, never the standalone file) so handlers have a schema while only the standby
  screen shows (M5). Mode changes write
  `pairing.json` and `app.relaunch()` with goodbye suppressed (the relaunch must not unlock the web).
- **Rationale** (_verified_): `main.ts` opens one connection at boot (`initializeDatabase`) and services pick it up;
  hot-swapping files under live singletons is riskier than a relaunch of a few seconds. Refreshes write new
  `mirror-<ts>.db` files (never the open one); the working copy is made from the newest verified one; newest 2 kept.
- **Version gate**: desktop newer than server → Zod on the server could silently strip new keys (rule 23); desktop older
  → the copy has columns the code does not know. Both are money risks; refusing is reversible.

## R11 — Rate limiting (O17)

- **Decision** (_verified_): `apiLimiter` gives anonymous traffic a default 100 req / 15 min per IP (`backend/.env.prod`
  sets 1000), and until LIRA-283 that IP is the shared proxy address. A check-in every 15 s is 60 per 15 min per shop, a
  real share of the shared bucket. `verifiedIdentityKey(req)` gains a branch: a header `X-LiraTek-Device-Key` that first
  passes the strict format regex (malformed keys are rejected before any DB read) and then verifies (key id → row inside
  `runWithTenant(<tenant id from the key>)`, constant-time hash compare; verified key ids cached for 60 s) yields identity `device:<tenantId>:<keyId>` in the
  per-identity bucket. An unverifiable key stays anonymous. Replay batches ≤ 50 ops.
- **Alternatives**: exempt `/api/offline/*` from limiting (rejected: open door for key guessing).

## R12 — Money checklist (FEATURE_GUIDE §13, rule 18)

Walked for "replay of an existing flow":
- transaction row fields, IN/OUT, payment legs, client propagation, CUSTOMER_ACCOUNT, supplier/partner ledger, profit
  stamping, session branch: **unchanged** — replay calls the same service with the same validated payload (rule 16 legs
  untouched; `client_id` travels inside the payload).
- void path (rule 20): a replayed sale/expense/repayment is an ordinary row; its existing reversal owner applies. A
  test refunds a replayed sale and checks drawer/stock/profit return to the pre-replay values.
- `is_auto` (rule 26): siblings are written by the existing flows; nothing new.
- time (_verified_): all three schemas accept `transaction_time`; `SalesRepository` uses it only when
  `status === "completed"` (offline sales are completed-only, FR-011); `ExpenseRepository` uses it for the row and its
  transaction, and the expense's **day** is the payload's own `expense_date` (recorded on the desktop — correct by
  construction); `DebtRepository` uses it. All three services reject a future `transaction_time` (`SalesService`,
  `ExpenseService`, `DebtService`). Replay therefore: ≤ 5 min in the future → `transaction_time` set to server now and
  `result_json.note = "booked at server time (desktop clock ahead by Ns)"`; further → refused to review (O14). Request day
  = op day via `runWithTenant` (rule 27). The "legs carry the backdated time" guess is **refuted** (_verified_
  `moneyPosting.ts:451-467` `COALESCE(createdAt, CURRENT_TIMESTAMP)`; none of the three flows passes `createdAt`): payment
  legs are dated at booking time, for replay exactly as for today's backdated web/desktop entries (LIRA-298). Decision
  O26: keep it — the parity test asserts the legs are identical between the direct and the replay arm (same amounts,
  methods, drawers), not their date. Dating legs from `transaction_time` is a follow-up money ticket (it would move
  closing "since last count", dashboard cash collected and Profits-by-method for existing backdated entries).
- Offline sales refuse `partnerId`/`partnerMode` (partner money is online-only, R14) and treat `client_name` as typed-new
  only when it is truthy and `client_id` is absent (matches `SalesRepository.ts:519`).
- Replay emits the same `sales:processed` websocket event the web route emits, so open web screens refresh.
- Parity proof (SC-001): book the same operations — 3 sales (one USD cash, one with an LBP leg, one on Customer Account),
  1 expense, 1 repayment — directly through the services and through `replayBatch` on two fresh databases and compare
  drawer balances, `debt_ledger` sums, stock and profit totals per currency.

## R13 — Offline receipt number (O15)

- **Decision**: `recordOffline` returns `{ ...result, offline_ref: "OFFLINE-" + opKey.slice(0,8) }`; `CheckoutModal` prints
  `RCP-${offline_ref}` when present (else today's `RCP-<id>`). The server's replay record keeps `op_key` and the result
  (`{ id }` of the new sale), and the review/history list shows `RCP-OFFLINE-xxxxxxxx → RCP-<server id>`.
- **Rationale** (_verified_): since LIRA-296 the one receipt number is `RCP-<sale id>`; the local id would not match the
  server id. No sale-table change needed.

## R14 — Things deliberately not in this release (O2, O20)

- local→server ID map (no offline-created rows are referenced offline — FR-030 enforces it by refusing a payload whose
  row-reference fields exceed the copy's max id per table, recorded at go-offline);
- offline customer/product creation, refunds, voids, sessions/baskets, closings, supplier/partner money, recharge,
  OMT/Whish services;
- the 24 `ORDER BY id DESC` / `MAX(id)` queries (_verified_ count 2026-10-11): with the lock, replayed rows are the newest
  rows except after an admin unlock (held for review anyway); audit filed as follow-up;
- local copy encryption (the standalone desktop DB is plain SQLite today — no regression);
- Google Drive (D3).

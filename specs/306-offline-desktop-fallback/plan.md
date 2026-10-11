# Implementation Plan: Offline desktop fallback — web-first with a desktop Plan B

**Branch**: `306-offline-desktop-fallback` (work on `main`, owner rule) | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/306-offline-desktop-fallback/spec.md`

## Summary

A web shop pairs one desktop as its backup till. The server gives the paired desktop a single-shop copy of the data every
5 minutes (built from the live file with the Phase D split's own narrowing logic, so it works before Phase D). The
desktop checks in every 15 s; a global write gate refuses every write from that shop's web and phone users while the
desktop is silent without a goodbye or reports offline work (D2), with an audited admin Unlock. In an outage the desktop
relaunches onto a **working copy** of the mirror, where only three operations (POS checkout of a new completed sale,
add expense, debt repayment) may write, each recorded in an **outbox in the same file and the same SQLite transaction**. On reconnect it
sends batches of ≤ 50 operations to a device-authenticated replay route; core's `OfflineReplayService` books each
through the same service the web route calls, as the recording user, with the operation's own instant, day and offset,
once per operation key (permanent `offline_replay_ops` record). The gate notes every web write it lets through; an
offline period during which any web write happened is held for owner review instead of booked. Refused or held
operations go to an admin review list on the web. One migration, v210, adds three tenant-scoped tables (`offline_devices`, `offline_replay_ops`,
`offline_outbox`).

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 20 (backend, Electron 31 main), React 19 (frontend)

**Primary Dependencies**: Express (backend), better-sqlite3, Zod (shared validators in `packages/core/src/validators/`),
Electron (`powerMonitor`, `Tray`, `app.setLoginItemSettings`, `safeStorage`, `app.relaunch`), TanStack Query (frontend)

**Storage**: SQLite. Server: tenant DB (shared file today, `/data/tenants/<id>.db` after Phase D). Desktop paired mode:
`<userData>/web-fallback/mirror-<ts>.db` (read-only copies, newest 2 kept), `<userData>/web-fallback/offline-work.db`
(working copy + outbox), `<userData>/web-fallback/finished/offline-work-<ts>.db` (last 3), pairing state
`<userData>/web-fallback/pairing.json` (device key encrypted with `safeStorage`). The standalone desktop DB
(`resolveDatabasePath()`) is never opened in paired mode.

**Testing**: core jest (`packages/core`, real schema via migrations on `:memory:`), backend jest (`backend/src/**/__tests__`,
supertest `*.api.test.ts`), electron-app jest (`electron-app/**/__tests__`), frontend jest + RTL, web e2e Playwright
(`frontend/tests/e2e-web/lira-web-055-*`, `lira-web-056-*`). Desktop e2e is not run on this Mac (G5); one CI-only
regression spec for the never-paired desktop.

**Target Platform**: Fly (Linux) backend, Vercel SPA, Windows desktop (Electron)

**Project Type**: Monorepo — desktop app + web service + shared core

**Performance Goals**: lock decision adds one indexed single-row read per write request of a shop (none for reads);
snapshot at most once per 5 min per shop; replay ≤ 50 ops per request.

**Constraints**: rule 19 (dual transport), rule 27 (no ambient server day on request paths), rule 29 (`browser.ts`
Node-free), rule 10 (migration in both files), rule 17 (failing-first), rule 20 (reversal owner — none new, see
Constitution Check), never run Electron on this Mac, never deploy / touch Fly / R2 / DNS (G5).

**Scale/Scope**: 2 live shops today; one paired desktop per shop; outage days of tens to a few hundred operations.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — still passing, with the three documented
exceptions (E1–E3) in Complexity Tracking.*

| Principle | Status | How |
| --- | --- | --- |
| I. One core, two transports (rule 19) | PASS with exception E1 | Replay books through the SAME core services the web routes call (`SalesService.processSale`, `ExpenseService.addExpense`, `DebtService.addRepayment`). Frontend uses `useApi()` only; desktop-only and web-only functions are adapter functions whose other branch returns a clear "not available here" envelope (no raw `window.api`, no inline gate). Device channels are desktop-only and management routes are web-only by nature — E1. |
| I. Payload once (rule 22) | PASS | The outbox stores the payload already validated by the shared core schema the IPC handler used; the replay route validates it again with the same schema object. No per-transport payload building. |
| I. Where code runs (rule 27) | PASS with note | Each replayed op runs inside `runWithTenant(tenantId, fn, { clientDay, clientTzOffsetMinutes })` from the op itself and passes its instant as `transaction_time`. The lock's "90 s silent" compares server-stamped check-in times with the server clock — both server-side instants, no calendar day involved (documented in research R6). |
| I. `browser.ts` Node-free (rule 29) | PASS | Only `offline/operations.ts`, `offline/lockState.ts` (pure) and `validators/offline.ts` (zod) are browser-reachable. Services, repositories using `crypto`, and `db/tenantSnapshot.ts` (fs) are exported from `index.ts` only. Guard: `browserEntryIsNodeFree.guard.test.ts`. |
| II. Layer boundaries (rule 13) | PASS | All SQL in `OfflineDeviceRepository`, `OfflineReplayRepository`, `OfflineOutboxRepository`; snapshot file work in `db/tenantSnapshot.ts`; services orchestrate; routes/handlers validate, authorize, call. |
| III. Contracts once (rules 14, 21, 23) | PASS | Schemas in `packages/core/src/validators/offline.ts`; adapter types `z.input<…>`; the recorder re-parses every recorded payload with the CORE schema named in the registry (`saleProcessSchema`, `createExpenseSchema`, `addRepaymentSchema`) — needed because `db:add-expense` validates with the hand-written desktop `AddExpenseSchema` (verified `dbHandlers.ts:114`); `sales:process` and `debt:add-repayment` already use the core objects, pinned by a `toBe` test. The lock predicate lives once in `offline/lockState.ts`. |
| III. Envelope (rule 6) | PASS | Every new route/channel returns `{ success, data?, error?, code? }`, HTTP 200 on business failure — the global lock gate too (the web HTTP client throws on non-2xx, verified in `httpClient.ts`), so pages show the lock message like any refusal. |
| IV. Money integrity (rules 16, 18, 20, 26) | PASS | No new money flow, transaction type, ledger row or sibling: replay calls existing flows, which keep their own legs, reversal owners and `is_auto` siblings. Proven by SC-001 parity test (replay vs. direct call nets equal per currency) and void-after-replay test. FEATURE_GUIDE §13 checklist walked in research R12. |
| V. Data and security | PASS with exception E3 | `?` placeholders; every new SQL names `tenant_id`; device routes authenticate a hashed key and resolve the tenant from it; user routes `authenticateJWT` → `requireRole`; replay actor checked active + role in the device's tenant (E2). v210 in both files with `down()`; all tables have `id`, `created_at`, `updated_at`. |
| VI. Testing | PASS | Every behaviour task is preceded by its failing test; web e2e 055/056 match rows by identity and assert deltas, and always revoke their device (shared DB). |
| VII. Code quality | PASS | strict TS, module loggers, named exports, `api` via ref in effects, stable `useApi` mocks. |

## Project Structure

### Documentation (this feature)

```text
specs/306-offline-desktop-fallback/
├── plan.md
├── research.md          # R1–R14
├── data-model.md        # v210 tables, desktop files, state machines
├── quickstart.md        # how to prove each slice locally
├── contracts/
│   ├── rest-offline.md  # /api/offline/* routes + global lock gate
│   └── ipc-offline.md   # offline:* channels, recorded channels, adapter functions
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/src/
├── offline/operations.ts            # NEW pure registry: the 3 offline operations (name, schema, roles, ipcChannel)
├── offline/lockState.ts             # NEW pure lock predicate (computeShopLock)
├── offline/index.ts                 # NEW barrel (browser-safe parts only)
├── validators/offline.ts            # NEW schemas: pair, heartbeat, goodbye, replay batch, review resolve
├── validators/index.ts              # re-export
├── repositories/OfflineDeviceRepository.ts   # NEW
├── repositories/OfflineReplayRepository.ts   # NEW
├── repositories/OfflineOutboxRepository.ts   # NEW (desktop side)
├── services/OfflineDeviceService.ts          # NEW pair / verify / heartbeat / goodbye / lock / unlock / revoke
├── services/OfflineReplayService.ts          # NEW batch / dedupe / dispatch / held / apply / dismiss / complete
├── services/OfflineOutboxService.ts          # NEW desktop record / pending / mark results
├── db/tenantSplit.ts                # REFACTOR: export narrowToTenant() used by both split and snapshot
├── db/tenantSnapshot.ts             # NEW buildTenantSnapshot() + SNAPSHOT_STRIPPED_TABLES
├── db/migrations/index.ts           # v210
├── config/env.ts                    # OFFLINE_LOCK_STALE_MS (default 90000)
├── constants/resetTables.ts         # classify the 3 new tables
├── index.ts / browser.ts            # exports (browser.ts: offline/operations, lockState, validators only)
electron-app/
├── create_db.sql                    # v210 tables
├── offline/pairingStore.ts          # NEW pairing.json + safeStorage
├── offline/fallbackBoot.ts          # NEW pure boot decision (which file, tenant id, mode)
├── offline/dbGuard.ts               # NEW query_only guard + withWritable()
├── offline/offlineRecorder.ts       # NEW recordOffline(): write + outbox in one transaction
├── offline/syncClient.ts            # NEW reachability probe, check-ins, goodbye, snapshot refresh, replay sender
├── offline/tray.ts                  # NEW tray + auto-start (paired mode only)
├── offline/updatePolicy.ts          # NEW per-mode updater policy (testable; no import.meta)
├── offline/bootSequence.ts          # NEW boot steps per mode (extracted from main.ts)
├── handlers/offlineHandlers.ts      # NEW offline:* IPC channels
├── handlers/salesHandlers.ts        # sales:process → recordOffline in offline mode
├── handlers/dbHandlers.ts           # db:add-expense → recordOffline
├── handlers/debtHandlers.ts         # debt:add-repayment → recordOffline
├── handlers/authHandlers.ts         # login/logout allowed to write locally (withWritable)
├── licenseSync.ts                   # skipped in paired mode
├── main.ts                          # boot selection, initFixedTenantContext(tenantId), goodbye hooks, tray
├── preload.ts                       # window.api.offline.*
backend/src/
├── middleware/deviceAuth.ts         # NEW authenticateDevice (X-LiraTek-Device-Key)
├── middleware/requireShopUnlocked.ts# NEW global write gate (D2)
├── middleware/rateLimit.ts          # verified device identity bucket
├── api/offline.ts                   # NEW /api/offline/* routes
├── server.ts                        # mount gate + router
frontend/src/
├── api/backendApi.ts                # dual-mode functions (see contracts/ipc-offline.md)
├── api/ElectronApiAdapter.ts        # expose
├── types/electron.d.ts              # window.api.offline types
├── shared/components/OfflineLockBanner.tsx         # NEW (web: lock banner + admin Unlock)
├── shared/components/layouts/MainLayout.tsx        # mount banner
├── features/settings/pages/Settings/DesktopBackupPanel.tsx  # NEW (web: paired device, revoke)
├── features/offline/pages/OfflineReview/index.tsx  # NEW (web: review list, Apply/Dismiss)
├── features/offline/components/StandbyScreen.tsx   # NEW (desktop paired standby + pairing form)
├── features/offline/components/OfflineModeBanner.tsx # NEW (desktop offline banner, Send)
├── features/sales/pages/POS/components/CheckoutModal.tsx # RCP-OFFLINE receipt number
├── app/App.tsx                      # route + standby gate
packages/ui/src/api/types.ts         # ApiAdapter types
frontend/tests/e2e-web/lira-web-055-offline-lock.spec.ts      # NEW
frontend/tests/e2e-web/lira-web-056-offline-replay.spec.ts    # NEW
frontend/tests/e2e-electron/lira-306-unpaired-desktop-unchanged.spec.ts  # NEW (CI only)
frontend/playwright.web.config.ts    # OFFLINE_LOCK_STALE_MS for the e2e backend
frontend/tests/e2e-web/global-setup.ts  # revoke leftover active devices
docs/OPERATIONS.md                   # runbook section
docs/release-notes/UNRELEASED.md     # release note
```

**Structure Decision**: the existing monorepo layout; one new core folder `packages/core/src/offline/` for the pure,
browser-safe parts, one new `electron-app/offline/` folder for desktop-only machinery. No new package.

## Phases (maps to tasks.md)

1. **Setup** — feature folder, env knob, e2e config.
2. **Foundational** — v210 (both files), reset classification, validators, operation registry, lock predicate, three
   repositories. Blocks everything.
3. **US1 (P1) web write lock** — device pairing, device auth, check-in/goodbye, global gate, status/unlock/devices routes,
   banner, Settings panel, web e2e 055. *Buildable + verifiable tonight.*
4. **US2 (P1) replay** — replay service + route, period complete, review list routes + page, parity tests, web e2e 056.
   *Buildable + verifiable tonight.*
5. **US3 (P2) mirror** — snapshot builder + route + cache; desktop pairing store, boot decision, read-only guard, refresh
   loop, standby screen. *Server half verifiable tonight; desktop half code + electron jest, desktop-visible behaviour
   unverified until CI/Windows.*
6. **US4 (P2) offline mode** — working copy, recorder, recorded channels, offline login, reconnect + send, receipt
   number, tray/goodbye hooks, CI-only desktop regression spec. *Code + electron jest; desktop behaviour unverified.*
7. **Polish** — OPERATIONS.md runbook, FEATURE_GUIDE note, release note, ticket, gates.
8. **US5 (P3) owner-run / blocked on infrastructure** — push/deploy, Phase D, first real pairing, Windows drill, S1/S3
   incremental mirror, desktop release discipline.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| **E1** — rule 19: `offline:*` IPC channels (pair, status, go-offline, send) have no REST mirror, and the web management routes (lock status/unlock, devices, review) have no IPC mirror | The device role exists only on a desktop (it owns the mirror, working copy and outbox); lock/unlock/review act on the server's tenant DB, which a desktop never holds | A REST mirror for device channels would have nothing to act on; an IPC mirror for review would act on a local copy that is discarded. Each such adapter function's other branch returns `{ success:false, error:"Available on the desktop app" / "Available on the web app" }`, so no component branches on transport. Precedent: the desktop-only licence panel. |
| **E3** — constitution V ("REST routes run `authenticateJWT` then `requireRole`; write IPC handlers run `requireRole`"): the device routes (`/heartbeat`, `/goodbye`, `/snapshot`, `/replay`, `/period/complete`) authenticate with the device key only, and the pre-login IPC channels `offline:status`, `offline:pair`, `offline:unpair`, `offline:go-offline`, `offline:install-update` run before anyone is signed in on the PC; in standby/blocked the updater downloads automatically | During an outage, and on the standby screen, no user session exists on either side; the device key is the shop admin's delegated credential (issued only through an admin sign-in, revocable) | A JWT on the desktop would expire, be tied to one person and die with a password change mid-outage. Narrowed: device routes act only inside the key's own tenant and only on device-scoped data or through E2's checked actor; `offline:pair`/`offline:unpair` verify admin credentials (server-side / read-only local check), except `offline:unpair` in `blocked` mode, where the PC holds no shop data; `offline:go-offline` is allowed only when `canStartOffline` (server unreachable past the lock delay, copy ready), and nothing can be recorded until a user signs in. Taken under the overnight delegation and **flagged for the owner to confirm** with O23. |
| **E2** — rule 19c: on the replay route the actor comes from the operation (the user who rang the sale offline), not from a JWT | During an outage no JWT can be obtained; the person who made the sale must be recorded as its actor | Recording the device or the pairing admin as actor would misattribute every offline sale (audit trail, "who took this payment"). Narrowed: the actor must exist in the device's own tenant, be active, and hold a role the operation allows; the device key itself is the authentication (plan §7.6). Taken on the owner's behalf under the overnight delegation (O23) and **flagged for the owner to confirm** before Phase 8. |

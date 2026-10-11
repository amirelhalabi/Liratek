# Implementation Plan: Offline desktop fallback — every PC keeps working, events merge back

**Branch**: `306-offline-desktop-fallback` (work on `main`, owner rule) | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/306-offline-desktop-fallback/spec.md` (owner decisions N1–N9)

## Architecture at a glance

### A. Components

```text
                         ┌───────────────────────── SERVER (Fly, one machine) ─────────────────────────┐
  Web app (Vercel) ─────▶│  existing REST routes ──▶ @liratek/core services ──▶ tenant DB (SQLite)     │
  Phone app ────────────▶│        ▲ (unchanged; never locked — N1)              ▲   ▲                   │
                         │        │                                             │   │                   │
                         │  /api/offline/review/*  (JWT, admin) ──▶ OfflineReviewService ─┘   │         │
                         │                                                                    │         │
                         │  /api/offline/* device routes (device key)                         │         │
                         │    pair · checkin · snapshot · events (upload) · events/status ·   │         │
                         │    manifest                                                        │         │
                         │        │                                                           │         │
                         │        ▼                                                           │         │
                         │  OfflineEventStore ──▶ OfflineMergeProcessor (per shop, rounds) ───┤         │
                         │   (offline_events)        │  k-way merge, skew-corrected            │         │
                         │                           ▼                                         │         │
                         │                  ReplayEngine (per event, ONE transaction that      │         │
                         │                   never yields to the event loop — no web write     │         │
                         │                   can run inside it)                                │         │
                         │                   1 rewrite ids (OfflineIdMap)                      │         │
                         │                   2 binding[channel] → SAME core service ───────────┘         │
                         │                     inside runWithTenant(day, tz, effectiveNow, rates)       │
                         │                   3 capture created rows (sqlite_sequence diff)              │
                         │                   4 DuplicateDetector (fingerprint in a savepoint)           │
                         │                   5 outcome + id map + review items                          │
                         │  SnapshotBuilder (copy of ONE shop, ≤ every 5 min, cached)                   │
                         └──────────────────────────────────────────────────────────────────────────────┘
                                     ▲ HTTPS, device key                   ▲ HTTPS, device key
             ┌───────────────────────┴──────────────┐      ┌───────────────┴──────────────────────┐
             │ PC 1 (Electron, PC number 1)         │      │ PC 2 (Electron, PC number 2)         │
             │  SyncClient: checkin 30 s, copy 5 min│      │  same                                 │
             │  mirror-*.db (copies, read-only)     │      │                                       │
             │  offline-work.db (working copy):     │      │  ids 2·10¹²+…                         │
             │    shop data, ids 1·10¹²+T·10⁹+n     │      │                                       │
             │    offline_outbox (events)           │      │                                       │
             │  OfflineRecorder wraps ipcMain.handle│      │                                       │
             │    allowed → write + event, 1 txn    │      │                                       │
             │    online-only → refused             │      │                                       │
             │  React UI (unchanged pages, IPC)     │      │                                       │
             └──────────────────────────────────────┘      └───────────────────────────────────────┘
   Never on the sync path: Google Drive (D3), the Windows share / db-path.txt UNC file (N3).
```

### B. Desktop state machine (per PC, independent of every other PC)

```text
               pair (admin signs in)                    unpair / revoke
  STANDALONE ───────────────────────▶ STANDBY ◀─────────────────────────────── (any paired mode)
  (never paired;                       │  online: checkin 30 s, new copy ≤5 min,
   today's app,                        │  window = status + "Open the web app" (system browser)
   unchanged)                          │  ready = copy present AND versions equal
                                       │
           server unreachable ≥ 30 s   │  "Work offline" (any user; sign-in follows)
           AND ready                   ▼
                                    OFFLINE ──────────── every action: write + event in ONE txn
                                       │  │              online-only channels refused
                                       │  │  server reachable → events upload by themselves
                                       │  │  (offline actions still allowed; banner nags)
                                       │  ▼
                                       │ "Back to the web app" (needs server reachable)
                                       ▼
                                   FINISHING ── no new actions; upload rest; send manifest (N5);
                                       │        working copy → finished/ (keep 3)
                                       └──────▶ STANDBY (download fresh copy)
  BLOCKED = paired but no usable copy (first boot, version mismatch): standby screen only, explains why.
```

### C. An outage with two PCs and web users

```text
 time   PC 1 (copy c1 @10:00)          PC 2 (copy c2 @10:02)         Web / phone (online)        Server
 10:05  ── shop internet and LAN die ──────────────────────────────────────────────────────────────────
 10:06  Work offline                    Work offline                  owner sells on phone ──▶  online sale S#880
 10:10  e1 new client Rami  (P1·cli)    e1 sale $40 CASH (P2·sales)                              (id < 10¹²)
 10:12  e2 sale on account to Rami      e2 OMT send ref OM-7731       web: same $40 sale typed  online sale S#881
 10:15  e3 OMT send ref OM-7731  ◀──── same transfer typed on both PCs (certain duplicate)
 10:20  e4 repay Rami, tick sale e2     e3 drawer count
 10:40  ── internet back for PC 1 only ───────────────────────────────────────────────────────────────
 10:40  uploads e1..e4  ───────────────────────────────────────────────────────────────▶ stored, acked
 10:41                                                                                   round (after 30 s pause):
                                                                                         P1.e1 → client 512
                                                                                         P1.e2 → sale 2001 (client 512)
                                                                                         P1.e3 → OMT booked (first)
                                                                                         P1.e4 → repay ticks 2001
 11:30  ── PC 2 reconnects ───────────────────────────────────────────────────────────────────────────
 11:30                                  uploads e1..e3 ───────────────────────────────▶ round:
                                                                                         P2.e1 $40 sale (10:10) ≈ S#881
                                                                                           (10:12), ±5 min → HELD
                                                                                         P2.e2 ref OM-7731 = P1.e3 →
                                                                                           SKIPPED + note (certain)
                                                                                         P2.e3 drawer count → HELD (N8)
 11:35  "Back to the web app" → manifest → standby                                      review list: 2 held, 1 note
 (S#881 is a likely duplicate only because it is within 5 minutes of P2.e1 — N7; at 10:20 it would simply be booked.)
```

### D. The event queue merge

```text
 PC 1 queue (seq): [1 @10:10] [2 @10:12] [3 @10:15] [4 @10:20]
 PC 2 queue (seq): [1 @10:11] [2 @10:13] [3 @10:09 ← PC 2 clock jumped back]
 rule: pick the HEAD with the smallest corrected time; never look past a head.
   heads (1@10:10, 1@10:11) → P1.1   heads (2@10:12, 1@10:11) → P2.1   heads (2@10:12, 2@10:13) → P1.2
   heads (3@10:15, 2@10:13) → P2.2   heads (3@10:15, 3@10:09) → P2.3   then P1.3, P1.4
 P2.3 is processed AFTER P2.2 although its time is earlier: a PC's own order always wins.
 A gap (PC 2 sent seq 1,3) stops PC 2 at seq 2 until it arrives; PC 1 continues.
 A business refusal does NOT stop the queue; only events that depend on it are held.
```

### E. Id rewriting example (PC number 1)

```text
 table index list (append-only, in code): clients=4, sales=7, transactions=12, debt_ledger=15 … (example values)
 working copy sqlite_sequence on go-offline: clients → 1·10¹² + 4·10⁹ + last_used(4) …
 PC 1 events:
   e1 clients:create {name:"Rami", phone:"70123456"}            created: clients[1 004 000 000 001]
   e2 sales:process  {client_id: 1 004 000 000 001, items:[{product_id: 33, …}], payments:[…LBP 1 250 000 000…]}
                                                                created: sales[1 007 000 000 001],
                                                                         transactions[1 012 000 000 001], debt_ledger[…]
   e4 debt:add-repayment {clientId: 1 004 000 000 001, targets:[{kind:"sale", id: 1 007 000 000 001}]}
 server:
   e1 → clients 512                     map: 1 004 000 000 001 → (clients, 512, e1)
   e2 rewrite client_id → 512; product_id 33 < 10¹² untouched; LBP amount is not an id position → untouched
      → sales 2001, transactions 9050 … map rows per table in creation order (counts must agree)
   e4 rewrite clientId → 512, targets[0].id → 2001 (decoded table = sales; the value says which table)
 An in-range id with no map entry (its event was held/refused) → e4 is HELD "waits on item e2".
```

### F. Duplicate handling

```text
 for each money event, inside the event transaction:
   SAVEPOINT s ─▶ book through the service ─▶ fingerprint(rows just created)
        │
        ├─ certain?  OMT/Whish reference equal, or recharge carrier+phone+amount within 10 min
        │            → ROLLBACK TO s; outcome SKIPPED; NO map rows yet; note (Mark reviewed / Book anyway);
        │              events depending on it wait until the note is resolved; a link maps the MAIN row only
        ├─ likely?   every N7 field equal within ±5 min (skew-corrected), user and seconds ignored
        │            → ROLLBACK TO s; outcome HELD; review item shows the matching row (Apply / Dismiss)
        └─ none      → RELEASE s; outcome BOOKED; stock < 0? note "stock count was off"
 compared against: rows with id > this copy's high-water mark (created during THIS PC's outage),
                   minus every server row this PC's booked/applied events created (from their stored results)
                   ⇒ online rows + other PCs' rows.
 same event id twice → stored outcome returned before any of this runs.
```

## Summary

Every paired PC keeps a copy of its shop (≤ 5 min old). Offline, one recorder wrapped around the desktop's channel
registration writes each allowed action to a working copy and records an event (channel, core-parsed payload, user,
instant, day/offset, PC sequence, event id, created rows, dependencies) in the same transaction; rows get ids from the
PC's range. On reconnect events upload automatically; the server stores them idempotently, merges all PCs' events per
shop by skew-corrected time while keeping each PC's order, rewrites offline ids through a per-shop id map, and books
each event through a per-channel binding to the same core service the web route calls, inside a tenant context carrying
the event's day, offset and "effective now". A savepoint-based duplicate detector, replay-only stock override and
per-category outcomes implement N6–N8; everything doubtful lands on a web review list. One migration (v210) adds the
tables. The web never locks.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 20 (backend, Electron 31 main), React 19 (frontend)

**Primary Dependencies**: Express, better-sqlite3, Zod (shared validators in `packages/core/src/validators/`), Electron
(`ipcMain`, `safeStorage`, `app.relaunch`, `shell.openExternal`, `powerMonitor`), TanStack Query

**Storage**: SQLite. Server: tenant DB (shared file today; per-tenant after Phase D). PC: `<userData>/offline/`
(`mirror-<ts>.db` ×2, `offline-work.db`, `finished/` ×3, `pairing.json` with the device key encrypted by `safeStorage`).
The standalone desktop DB (`resolveDatabasePath()`, incl. a `db-path.txt` UNC share) is never opened in paired modes.

**Testing**: core jest (real schema on `:memory:`), backend jest + supertest, electron-app jest, frontend jest + RTL, web
e2e Playwright `frontend/tests/e2e-web/lira-web-055-offline-replay.spec.ts`, `lira-web-056-offline-review.spec.ts`
(052–054 are taken; verified). Desktop e2e is never run on this Mac (G5).

**Target Platform**: Fly (Linux) backend, Vercel SPA, Windows desktop (Electron)

**Project Type**: Monorepo — desktop app + web service + shared core

**Performance Goals**: processing ≥ 20 events/s per shop on the Fly machine (sync SQLite, one transaction per event);
copy built ≤ once per 5 min per shop and shared by all its PCs; upload batches ≤ 100 events.

**Constraints**: rules 10, 13, 14, 16–30 (CLAUDE.md); never run Electron on this Mac; never deploy or touch Fly/R2/DNS
(G5); no web/phone behaviour change except the new pages (N1).

**Scale/Scope**: 2 live shops, 1–4 PCs per shop, outages of minutes to a day (tens to hundreds of events per PC).

## Constitution Check

*GATE: passes for everything except the parts that carry exceptions E1–E3 awaiting the owner's approval (Complexity
Tracking). Per the constitution's Governance section, no task that implements E1–E3 may start before gate **G0** (owner
approves O-new-7 / O-new-8 / E1) is recorded in this file. Gated: the device-key service and routes, the actor policy
(who may be credited for an event), the web-only review routes/page/PCs panel and the desktop-only `offline:*`
channels, the e2e helpers that drive them, and everything that calls them. Not gated: core library work that no
transport reaches yet — event store, merge, replay engine (the actor is a plain parameter, like a service's `userId`),
duplicates, review service, schema lifts, time/rate work, the snapshot builder. E4 is closed inside the task
that adds the binding (the missing REST route is added first), so it never ships open. Re-checked after Phase 1 design.*

| Principle | Status | How |
| --- | --- | --- |
| I. One core, two transports (rule 19) | PASS with E1 | Replay calls the SAME core service each web route calls, through `packages/core/src/offline/bindings/*.ts` (one binding per offline channel, pinned by a parity test against the route's service call). Review page via `useApi()`; device channels are desktop-only and review routes web-only by nature (E1). |
| I. Payload once (rule 22) | PASS | The event stores the payload the core schema parsed on the PC; the server parses it again with the same schema object. No per-transport payloads. |
| I. Where code runs (rule 27) | PASS | Each event runs in `runWithTenant(tenantId, fn, { clientDay, clientTzOffsetMinutes, effectiveNow })`, all from the event (client-supplied, schema-validated); server clock only as fallback. Clock skew is measured from server instants. |
| I. `browser.ts` Node-free (rule 29) | PASS | Browser-reachable: `offline/channelPolicy.ts` (pure table), `offline/idRange.ts` (pure math), `offline/reviewKinds.ts`, `validators/offline.ts`. Bindings, processor, snapshot builder, id capture: `index.ts` only. Guard: `browserEntryIsNodeFree.guard.test.ts`. |
| II. Layer boundaries (rule 13) | PASS | SQL in `OfflineDeviceRepository`, `OfflineEventRepository`, `OfflineIdMapRepository`, `OfflineReviewRepository`, `OfflineSnapshotRepository`, `RowCaptureRepository`, `DuplicateFingerprintRepository`; services orchestrate; bindings call services only. |
| III. Contracts once (rules 14, 21, 23, 24) | PASS once `pendingLift` is empty (guard T077) | 23 offline/checkpoint channels are lifted to core schemas (in US1 and Phase 6, before each channel's binding), each after a three-way key diff (schema / preload type / handler-forwarded fields). Policy table names the schema object; a `toBe` test pins IPC handler, REST route and binding to the same object. Id-position rules and the fingerprint are defined once. |
| III. Envelope (rule 6) | PASS | All new routes/channels return `{ success, data?, error?, code? }`, HTTP 200 on business failure. |
| IV. Money integrity (rules 11, 16, 18, 20, 26) | PASS | No new money flow, type, ledger or sibling: replay calls existing flows with their legs, client propagation, reversal owners and `is_auto` siblings. Replay-only switches (out-of-stock path, ticks dropped) choose between existing behaviours. SC-001 parity test per family; void-after-replay nets 0. §13 walked in research R12. |
| V. Data and security | PASS with E2, E3 | `?` placeholders; every new SQL names `tenant_id`; device routes authenticate a hashed key; review routes `authenticateJWT` → `requireRole(["admin"])`; v210 in both files with `down()`; all tables have `id`, `created_at`, `updated_at`. |
| VI. Testing | PASS | Failing-first test task before each behaviour task; web e2e 055/056 match by identity and assert deltas; payload names in tests come from the schemas. |
| VII. Code quality | PASS | strict TS, module loggers, named exports, `api` via ref, stable `useApi` mocks. |

## Project Structure

### Documentation (this feature)

```text
specs/306-offline-desktop-fallback/
├── plan.md               # this file (architecture first)
├── research.md           # R1–R16 decisions with rationale and alternatives
├── data-model.md         # v210 tables, id layout, PC files, state machines
├── quickstart.md         # how to prove each slice locally
├── contracts/
│   ├── rest-offline.md   # /api/offline/* device + review routes
│   ├── ipc-offline.md    # offline:* channels, recorder contract, adapter functions
│   └── channel-policy.md # 414 existing channels (183 write + 16 local listed, 215 reads counted); +8 offline:* in ipc-offline.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/core/src/
├── offline/channelPolicy.ts       # NEW pure: channel → class, label, family, argNames, idPositions, roles, pendingLift
├── offline/idRange.ts             # NEW pure: OFFLINE_ID_TABLES (append-only), encode/decode, isOfflineId
├── offline/idPositions.ts         # NEW pure: walk a payload's id positions (keys, pairs, nested, JSON strings)
├── offline/reviewKinds.ts         # NEW pure: review item kinds + plain labels
├── offline/bindings/*.ts          # NEW per family: channel → service call (index.ts only)
├── offline/ReplayEngine.ts        # NEW per-event transaction pipeline (index.ts only)
├── services/OfflineDeviceService.ts, OfflineEventService.ts, OfflineMergeProcessor.ts,
│   OfflineReviewService.ts, OfflineSnapshotService.ts, DuplicateDetector.ts   # NEW
├── repositories/Offline{Device,Event,IdMap,Review,Snapshot,Outbox}Repository.ts,
│   RowCaptureRepository.ts, DuplicateFingerprintRepository.ts                  # NEW
├── db/tenantContext.ts            # + effectiveNow, effectiveRates options; utils/requestNow.ts, utils/effectiveRate.ts (server-only)
├── db/tenantSplit.ts              # REFACTOR: export narrowToTenant() for snapshot reuse
├── db/tenantSnapshot.ts           # NEW buildTenantSnapshot()
├── db/migrations/index.ts         # v210
├── validators/offline.ts + lifted schemas (validators/session.ts, client.ts, transaction.ts, …)
├── repositories/* (time sweep)    # timestamps via requestNow() in offline families; id-order queries → time order
electron-app/
├── create_db.sql                  # v210
├── offline/pairingStore.ts, bootDecision.ts, workingCopy.ts (id-range seeding, resume), recorder.ts (ipcMain wrapper,
│   write queue), writeGuard.ts, syncClient.ts, manifest.ts, updatePolicy.ts   # NEW (outbox SQL in core repo)
├── handlers/offlineHandlers.ts    # NEW offline:* channels
├── handlers/*.ts                  # validatePayload with lifted core schemas (23 channels); session:close actor fix
├── main.ts                        # install recorder before register*Handlers(); boot by mode; tenant from copy
├── preload.ts, schemas/index.ts   # offline bindings; re-export lifted schemas
backend/src/
├── middleware/deviceAuth.ts       # NEW authenticateDevice
├── api/offline.ts                 # NEW device + review routes; server.ts mount; rateLimit device bucket
├── offline/processorTimer.ts      # NEW gathering pause + periodic sweep → OfflineMergeProcessor
frontend/src/
├── api/backendApi.ts, ElectronApiAdapter.ts; packages/ui/src/api/types.ts
├── features/offline/pages/OfflineReview/index.tsx              # NEW web review list
├── features/settings/pages/Settings/PairedPcsPanel.tsx          # NEW
├── features/offline/components/{StandbyScreen,OfflineBanner}.tsx # NEW (desktop)
├── features/sales/... receipt lookup accepts offline receipt numbers (via core alias)
frontend/tests/e2e-web/lira-web-055-offline-replay.spec.ts, lira-web-056-offline-review.spec.ts
docs/OPERATIONS.md, docs/FEATURE_GUIDE.md (offline note), docs/release-notes/UNRELEASED.md
```

**Structure Decision**: existing monorepo; one new core folder `packages/core/src/offline/` and one new
`electron-app/offline/` folder. No new package.

## Phases (maps to tasks.md)

1. **Setup** — env knobs, e2e config.
2. **Foundational** — v210 (both files), reset/snapshot classification, pure policy/id-range/id-position modules with
   their guards, `effectiveNow` context, validators. Blocks everything.
0. **Gate G0 (owner)** — approve O-new-7, O-new-8 and E1 (recorded below). Blocks exactly the `[G0]` tasks: device
   service + actor policy, device routes, review routes/page/PCs panel, desktop `offline:*` channels, sync/upload,
   offline banner wiring, and web e2e 055/056.
3. **US1 replay engine (P1)** — core: event store, merge processor, replay engine, id map, first bindings (sales,
   clients, debts, expenses, refunds/voids) — *buildable + verifiable tonight with core jest*; device pairing/auth +
   upload routes + web e2e 055 — *after G0*.
4. **US2 merge + duplicates (P1)** — skew correction, duplicate detector, stock/ticks/customer outcomes, checkpoint
   holds, dependants, remaining bindings family by family. *Buildable + verifiable tonight.*
5. **US3 review list (P1)** — review service — *buildable tonight*; review routes, page, PCs panel and web e2e 056 —
   *after G0* (E1).
6. **Contract and time prep (money, core jest)** — lift the 23 schemas (three-way diff each), `requestNow()` sweep per
   family, id-order queries. Parallel with 3–5 per family; a family's binding is done only after its prep.
7. **US4 copies (P2)** — snapshot builder + route (verifiable); PC refresh + standby (electron jest, unverified).
8. **US5 offline mode (P2)** — recorder, write guard, working copy + id seeding, outbox, sender, manifest, screens
   (electron jest; desktop behaviour unverified until CI/Windows).
9. **Polish** — OPERATIONS runbook, FEATURE_GUIDE note, release note, ticket, gates.
10. **US6 owner-run (P3)** — push/deploy, desktop release, pairing, two-PC drill, Phase D, Litestream feed.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| **E1** — rule 19: `offline:*` IPC channels have no REST twin; `/api/offline/review/*`, the review page and the PCs panel have no IPC twin (both halves gated by G0) | The device role exists only on a PC (copies, working copy, outbox); review acts on the server's tenant DB, which a PC never holds | A twin would have nothing to act on. Each adapter function's other branch returns `{ success:false, error:"Available on the desktop app" / "Available on the web app" }`, so no component branches on transport. |
| **E2** — rule 19c: on replay the actor comes from the event, not a JWT | During an outage no JWT exists; the person who rang the sale must be its actor | Crediting the pairing admin misattributes every offline action. Narrowed: actor must belong to the device's shop and hold a role the channel allows (FR-023). **Owner to confirm (O-new-7).** |
| **E3** — constitution V: device routes authenticate with the device key, not `authenticateJWT` | No user session during an outage or on the standby screen | A long-lived user JWT on the PC expires, is tied to one person and dies with a password change. Key issued only through admin sign-in, hashed, revocable, scoped to one shop. **Owner to confirm (O-new-8).** |
| **E4** (closed before ship) — `maintenance:update-metadata` has no REST route today | Offline allowed under N2 | The task that adds its binding first adds the REST route + adapter function (same service, shared schema), so the binding never exists without the web twin. No exception remains at ship. |

**Owner approvals (gate G0)** — **given 2026-10-11** (owner, live; recorded in
`docs/plans/OVERNIGHT_DECISIONS_2026-10-11.md` §4 "Owner answers, 2026-10-11"): **O-new-7 yes** (offline work credited to
the cashier who did it, checked active + allowed role), **O-new-8 yes** (per-PC admin-issued, revocable device key),
**E1 yes** (desktop-only `offline:*` channels, web-only review routes/page/PCs panel). Tasks marked `[G0]` may start.

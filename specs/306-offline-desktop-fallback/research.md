# Research — LIRA-306 Offline desktop fallback (events redesign)

Each item: **Decision**, **Rationale**, **Alternatives**, **Test strategy**. _Verified_ = checked against source on
2026-10-11 (file:line given); otherwise marked _Likely_ or _Assumption_. Owner decisions are N1–N9 (spec
Clarifications); agent decisions are O-new-N (`docs/plans/OVERNIGHT_DECISIONS_2026-10-11.md` §4). The 11 design problems
of the brief map to: P1→R1, P2→R3, P3→R7, P4→R5, P5→R9, P6→R6, P7→R10, P8→R12, P9→R13, P10→R14, P11→R16.

## R1 — Classifying every write channel; recording generically at the IPC layer (P1)

- **Decision**: one pure table `packages/core/src/offline/channelPolicy.ts` lists **every** desktop channel with a class:
  `offline` (71), `online_only` (105), `checkpoint` (7), `read` (215), `local` (16) — 414 total (_verified_:
  `electron-app/handlers/*.ts`, 45 files, no dynamic registration; full list `contracts/channel-policy.md`). Each
  `offline`/`checkpoint` entry also declares: family, plain label, roles (same as the handler's `requireRole`), the core
  schema export name, `argNames` (positional IPC args → a named payload, e.g. `transactions:void` →
  `{ transactionId }`), extra id positions (R3), and `pendingLift` membership. (Every channel replays with
  `effectiveNow`, R11 — there is no per-channel time flag.)
  Recording is ONE wrapper, `electron-app/offline/recorder.ts`, installed by `main.ts` around `ipcMain.handle`
  **before** the 45 `register*Handlers()` calls (_verified_ `main.ts:585-629`). In `standalone`/`standby` it passes
  through untouched. In `offline` mode it:
  1. looks up the channel; unclassified → refuse (fail closed); `online_only` → `{ success:false, code:"OFFLINE_NOT_AVAILABLE", error }`;
     `read`/`local` → pass through (reads run under the write guard, R14);
  2. `offline`/`checkpoint` → acquires the process-wide **write queue** (one write at a time), parses the named payload
     with the channel's core schema (refuses if it fails), refuses any offline-range id outside id positions (FR-014),
     runs `BEGIN IMMEDIATE`, reads `sqlite_sequence` (inside the transaction), opens the write guard, `await`s the
     original handler, then on `{ success:true }` captures created rows, resolves dependencies, takes the next
     sequence number as `max(outbox MAX(device_seq), pairing.json lastSeq, server maxSeq) + 1` (inside the
     transaction; a second outage on a fresh copy has an empty outbox and must continue, not restart), appends the outbox row and
     `COMMIT`s; on `{ success:false }` or a throw `ROLLBACK`s.
  3. while a write window is open, `read` AND `local` channels wait in the same queue, and main-process timers that write
     (backup, licence sync, loto scheduled checkpoint, session cleanup) are off in paired modes (boot decision) (so a read that quietly writes can never join
     an event's transaction, and the FR-036 change count around reads is measured without a writer running).
- **Why the queue + explicit BEGIN**: handlers are `async` (_verified_, e.g. `salesHandlers.ts`); better-sqlite3's
  `db.transaction()` refuses a function returning a Promise, and with one connection any IPC call running during an
  `await` would join the open transaction. Queuing writes and opening the transaction explicitly makes the window
  exclusive; services' own `db.transaction()` calls nest as savepoints (better-sqlite3 behaviour when already in a
  transaction — _Likely_, pinned by a test).
- **Rationale**: 183 write channels; editing each handler is error-prone and drifts. A wrapper keyed by a guarded table
  records every action without feature code. The class table is browser-safe so the review page can show labels.
  The 8 new `offline:*` channels are classified `local` (policy total 422: 71 offline, 105 online-only, 7 checkpoint,
  215 read, 24 local). Outbox SQL lives in a core repository (`OfflineOutboxRepository`, rule 13); the recorder
  orchestrates.
- **Pending lifts**: the policy carries a `pendingLift` list (the 23 channels without a core schema). Phase 2 guards
  accept a pending entry without a schema; the guard `bindings.complete.test.ts` requires the list to be empty.
- **Alternatives**: per-handler `recordOffline()` calls (rejected: 71+7 edits, easy to miss one); capture in the renderer
  adapter (rejected: a renderer crash after the IPC commit loses the event; N4 requires the same transaction).
- **Prerequisite (rule 23)**: 23 offline/checkpoint channels have no core schema (_verified_: 14 unvalidated, 9 desktop
  hand-written — `channels.md` §3). Each is lifted to `packages/core/src/validators/` after a three-way key diff (schema /
  preload type / handler-forwarded fields), then wired with `validatePayload` on IPC and `validateRequest` on REST.
  `session:close` stops taking its actor from the renderer (`closedBy`, _verified_ `sessionHandlers.ts:98-101`).
- **Test strategy**: guard `channelPolicy.complete.test.ts` (electron jest) collects every `ipcMain.handle` registration
  by loading the 45 register functions against a fake `ipcMain` and fails on any channel missing from the table or
  present in the table but not registered; `channelPolicy.schemaIdentity.test.ts` asserts the IPC handler's schema, the
  REST route's schema and the binding's schema are the same object (`toBe`); recorder unit tests: allowed → row + event
  in one transaction; handler `{success:false}` → nothing; throw mid-handler → nothing; online-only → refused, zero
  changes; unclassified → refused; two concurrent writes are serialized.

## R2 — Events: what is recorded, sequence, dependencies (N4)

- **Decision**: outbox row (working copy) = `event_id` (UUID v4), `device_seq` (per PC, gap-free, continues across
  outages from `pairing.json.lastSeq`), `channel`, `payload_json` (core-parsed named payload), `actor_user_id`,
  `occurred_at` (UTC ISO ms), `client_day`, `client_tz_offset_minutes`, `copy_id`, `app_version`, `schema_version`,
  `created_json` (`{ table: [ids…] }` from the `sqlite_sequence` diff), `depends_on_json` (event ids that created any
  offline-range id found in the payload's id positions, from local table `offline_outbox_created`).
- **Rationale**: "events reference other events" (N4) is satisfied by `depends_on`; the payload keeps the PC's ids so the
  server can rewrite them through the map (R3). `created_json` is what makes the id map and the N5 cross-check possible.
- **Alternatives**: rewrite PC ids to event-relative tokens on the PC (`$e1.sales[0]`) — rejected: changes the payload
  shape the core schema validates (numbers become strings) and needs per-position knowledge on the PC too.
- **Test strategy**: recorder test asserts every field present and the outbox row commits with the business rows; a
  dependency test (create client → sale to it) asserts `depends_on` = [client event].

## R3 — Offline ids and payload rewriting (P2, N4, D4)

- **Decision — layout (O-new-1)**: `offlineId = P × 10¹² + T × 10⁹ + n`, P = PC number (1…9006, never reused in a shop),
  T = index in `OFFLINE_ID_TABLES` (append-only list of every AUTOINCREMENT table; 81 today, _verified_), n = 1…999 999 999
  continuing per (PC, table). Max ≈ 9.006·10¹⁵ < 2⁵³. The eight new `offline_*` tables are in an explicit
  `OFFLINE_ID_EXCLUDED_TABLES` list (guarded) — they are never written by replayed business actions. Unique across tables, so a value alone says PC and table.
  Floor 10¹² because **1 000 000 000 LBP ≈ $11 200** (rate 89 500) is an ordinary sale amount; a 10⁹ floor would collide
  with amounts. Server ids must stay < 10¹² (startup assertion + guard; today's max ids are far below).
- **Decision — seeding**: on go-offline, `workingCopy.ts` sets `sqlite_sequence.seq = P·10¹² + T·10⁹ + lastUsed[T]` for
  every table in the list (insert missing rows), where `lastUsed[T]` = the highest of `pairing.json`'s counter, the
  finished working copies' `offline_outbox_created` maxima, and the server's maximum for (PC, table) returned at
  check-in. A working copy found at start-up is **resumed**, never re-seeded or overwritten (power cut, FR-008a); its
  own `sqlite_sequence` already continues. `schema_migrations` (no AUTOINCREMENT, _verified_) is
  never written offline. Composite-key tables (`drawer_balances`, `modules`, `currency_modules`, `currency_drawers`,
  `loto_settings`) have no surrogate id; their offline changes are effects of events, re-derived by replay.
- **Decision — rewriting = generic by id position + value range (not per-schema table declarations)**: the server walks
  only **id positions**: keys named `id`, `*_id`, `*Id`; declared polymorphic pairs (`targets[].{kind,id}`,
  `referenceTable`+`referenceId`, supplier `{kind,id}`); declared nested payloads (`cartItems[].formData` recursively,
  and JSON strings in declared keys such as `form_data`); and `argNames` positions for former positional args. A value in
  a position is rewritten iff `isOfflineId(v)` (a numeric string in an id position is parsed and treated the same, then
  written back as a string); the map is keyed by (tenant, offline id) — the table comes from the value.
  Values in other positions are never touched (amounts, phones, IMEIs — a 15-digit IMEI or 13-digit EAN barcode could
  fall in the numeric range, which is exactly why a blind value scan is rejected).
- **Rationale**: per-schema `{path, table}` declarations for ~80 channels are a second copy of the contract (rule 14)
  that nothing keeps in sync; the key-name convention already holds across the validators (_verified_ `idrefs.md` §A,
  ~50 id-bearing schemas), and encoding the table in the value removes the need to resolve polymorphic references.
- **Ids embedded in non-id fields**: (a) `item_key` is a catalog key, not a row id; `split_group` and cart `item_id` are
  client UUIDs (_verified_) — nothing to do. (b) Free text (notes) is never rewritten; an offline id typed into a note
  stays as typed (harmless). (c) Receipt numbers `RCP-<id>` are derived, not stored (_verified_
  `utils/receiptNumber.ts:13-19`) → alias lookup through the map (R13, O-new-10). (d) Any other string key found by the
  guard to carry ids must be declared in `EMBEDDED_ID_KEYS` or the channel is refused offline.
- **Guard**: `idPositions.guard.test.ts` walks every core schema named in the policy (Zod shape introspection) and fails
  on any key that looks like a reference (`/(^id$|_id$|Id$|^reference(Id|_id)$)/`) but is not an id position, any
  declared position missing from the schema, and any money-like key (`amount|price|cost|fee|total|rate`) matching the id
  convention.
- **PC side**: FR-014 — the recorder refuses an action whose payload carries an offline-range id outside id positions.
- **Map persistence**: `offline_id_map(tenant_id, offline_id UNIQUE per tenant, device_id, table_name, server_id,
  event_id)`; written in the event's transaction; never swept.
- **Alternatives**: same id start per table + per-schema table declarations (rejected above); UUID primary keys
  (rejected: schema-wide change, violates D4 spirit); negative ids (rejected: some code treats id ≤ 0 as "none").
- **Test strategy**: `idRange.test.ts` (encode/decode round trip, bounds, 2⁵³); `idPositions.test.ts` (rewrites nested
  formData and JSON strings, leaves an LBP amount of 1 004 000 000 001 untouched, rewrites `{kind:"sale", id}`); a full
  scenario test (create client → sale on account → repayment ticking it → refund) asserting server links.

## R4 — Capturing created rows and building the map (N4, N5)

- **Decision**: `RowCaptureRepository.snapshotSequences()` / `createdSince(before)` read `sqlite_sequence` before and
  after the action **inside the same transaction**, then select the ids that exist in `(before, after]` per table. Same
  code on PC and server. The map pairs PC ids and server ids per table in id order. Tables in `MAP_EXCLUDED_TABLES`
  (audit log, activity log, sign-in `sessions` — NOT the customer basket tables, which are mapped) are excluded — the IPC handler writes audit rows itself while the REST path audits in
  middleware (_verified_ `audit.ts:39-41`), so their counts legitimately differ. Count mismatch in another table →
  those rows unmapped + "came out differently online" note; later references to them hold (FR-019). When a replay-only
  rule changed row shapes (ticks dropped, customer linked) the counts can match while the rows mean different things,
  so only the event's main row (the binding's returned id) is mapped and the rest stay unmapped; a later reference to
  them is held "booked, but this part could not be linked". The out-of-stock path changes no row shape and maps fully
  when counts agree. Equal counts in a different order are otherwise not expected (sale items follow the payload,
  payments follow the legs) — _Likely_; contamination by a concurrent write is excluded by the no-yield invariant (R6)
  and the PC queue (R1).
- **Rationale**: no change to any service; deterministic for the same code + payload; exact per table.
- **Alternatives**: services returning all created ids (rejected: touches every service); triggers logging inserts
  (rejected: 81 triggers in both schemas, slows every write).
- **Test strategy**: capture test with a sale (sales, sale_items, transactions, payments rows); mismatch test (force an
  extra row server-side) → note + unmapped.

## R5 — Order: per-PC sequence vs cross-PC time; clock skew (P4)

- **Decision (O-new-14)**: the server stores events first (status `received`), then `OfflineMergeProcessor.runRound(tenant)`
  processes them: a k-way merge whose candidates are each PC's **next expected** sequence number; choose the candidate
  with the smallest corrected instant (ties: PC number, then seq). A missing sequence number stops that PC only. Rounds
  start after a gathering pause (`OFFLINE_MERGE_GATHER_MS`, default 30 000, 0 in tests) following an upload, and on a
  60-second sweep (restart-safe). One round per tenant at a time (in-process lock; one Fly machine, _verified_
  OPERATIONS single-machine rule). Late PCs are processed when they arrive, at their own original times — no waiting.
- **Clock skew (O-new-15)**: every check-in and upload carries the PC's clock; the server stores
  `skew_ms = serverReceipt − pcClock` (minus half the request time). Correction uses the upload-time skew; if the last
  pre-outage check-in skew differs by > 2 min, the note says the clock changed. Correct only when |skew| > 2 min.
  Clamp to ≤ receipt and ≥ copy built − 5 min (the one bound used everywhere). Recompute the day from the corrected
  instant + the event's offset. Every clamped event gets a `clock_corrected` note, and so does an event whose time is
  earlier than the previous event of the same PC (catches a clock reset by a power cut that network time later fixed,
  where the two skews agree).
- **Rationale**: per-PC order is exact (a PC's own sequence is ground truth); cross-PC order only matters for state
  (stock, balances, which duplicate is "first"), where corrected time is the best available evidence.
- **Alternatives**: process in arrival order (rejected: N4); wait for all PCs (rejected: a dead PC would block the shop);
  vector clocks (overkill: PCs never see each other's offline rows).
- **Test strategy**: merge unit tests with the plan §D queues (backward clock jump, gap, late PC); skew tests (fast,
  slow, changed mid-outage, clamp).

## R6 — Idempotency and atomicity (P6)

- **Decision**: `offline_events` UNIQUE(tenant_id, event_id) and UNIQUE(tenant_id, device_id, device_seq). Upload inserts
  `received` rows (`INSERT … ON CONFLICT DO NOTHING`, identical payload hash required else `EVENT_ID_REUSED` refusal) and
  acks. Processing one event = one transaction: rewrite → binding (service) → capture → duplicate check → outcome row
  update → id-map rows → review items → commit. A technical error (exception not classified as business) rolls back and
  leaves the event `received` with `attempts+1` and stops that PC's queue for this round; after 5 attempts it becomes
  `refused` with the error (review list). A business refusal (`{success:false}` or a `BusinessRuleError`/`DatabaseError`
  carrying a user message) is stored as `refused`. Status upload response and `GET /events/status` give per-event
  outcomes; the PC marks its outbox.
- **Isolation on the server (O-new-23, revised after analyze pass 2)**: invariant — an event's transaction **never
  yields to the event loop** between `BEGIN` and `COMMIT`. Node runs one piece of JavaScript at a time and
  better-sqlite3 is synchronous, so if no macrotask runs inside the window, no web/phone request can run inside it,
  join it, be captured as the event's rows, or be undone by `ROLLBACK TO dup`. Bindings may `await` only promises that
  resolve without I/O (today's async session services await synchronous work — _verified_ microtask-only by pass 2).
  **Prevention, not only detection (pass 3)**: while a replay transaction is open, `getDatabase()` refuses any statement
  whose async context does not carry the replay's token (`REPLAY_IN_PROGRESS`) — a web request that slips in gets a
  visible error and retries; it can never write inside the replay or be undone by its rollback. The `setImmediate`
  sentinel stays as a second line (the event rolls back as a technical failure if it fired), and a CI test runs every
  binding's fixture and asserts the sentinel never fires (bindings await microtasks only). A second connection was rejected: with one
  thread, a web write waiting on SQLite's busy lock would block the very thread that must commit.
- **Sequence conflict**: the same (PC, sequence) with a different event id is refused per event with `SEQ_CONFLICT`,
  shown on the PCs panel and stops that PC's queue (it means the PC lost its state). Recovery: an admin action on the PCs
  panel, "Renumber this PC's unsent work", tells the PC (on its next check-in) to renumber every unsent outbox event
  above the server's maximum sequence for it, keeping event ids; the upload then continues. Re-pairing alone does not
  fix it (same row, same cursor).
- **External side effects**: the websocket `data:invalidate` broadcast is emitted after each round commits (not per
  event). _Assumption (unverified)_: no offline-family service sends WhatsApp/SMS inside its write; task sweeps and
  suppresses via `isOfflineReplay()` if any does.
- **Rationale**: copies `IdempotencyService`'s find→book→store-in-one-transaction pattern (_verified_
  `IdempotencyService.ts`), but permanent and covering refusals; `idempotency_keys` is swept after 24 h and keyed by user
  and route (_verified_ `:27`, `:53-69`), so it cannot serve multi-day outages.
- **Test strategy**: resend tests (same batch twice; same event in a later batch days later); kill mid-batch (throw on
  event 3 of 5) → 1–2 booked, 3–5 retried; payload-changed reuse refused; atomicity (throw after service, before outcome
  write) → nothing booked.

## R7 — Outcomes when state changed online meanwhile (P3, N6, N7, N8)

| Category | Situation at replay | Outcome |
| --- | --- | --- |
| Sale / stock use / repair part / custom-service stock | not enough stock on the server | **Booked** via the existing out-of-stock path (replay passes `allowOutOfStock: true` whatever the shop setting; web unchanged) + note "stock count was off" per product (N6). (_verified_ setting `allow_out_of_stock_sales`, `SalesService.ts:102`; same option in Maintenance/CustomService) |
| Same serial unit (IMEI) sold twice | unit no longer in stock | duplicate path: likely duplicate if N7 fields match; else refused "unit already sold" → review (N6 note: one item cannot be sold twice) |
| Repayment with ticked items | an item is no longer open (_verified_ refusal `DebtRepository.ts:1368`) | **Booked** again without ticks (oldest-first, existing overpayment rules — extra becomes credit, _Likely_, `DebtRepository.ts:494`, pinned by a test) + note "ticked items were already paid" (O-new-3) |
| Repayment more than owed | accepted today (_verified_) | booked as today |
| Customer created offline | phone already exists (unique per shop, _verified_ `create_db.sql:471`) | map the offline customer to the existing one; note "customer already existed" (O-new-4) |
| Customer edit / notes / status edits (`*:update-metadata`, statuses) | row edited online meanwhile | applied in processing order; last processed wins (O-new-12) |
| Void / refund / undo refund | already reversed online (_verified_ messages `TransactionRepository.ts:5332, :5733, :5757, :2500`) | refused → review "already reversed online — check the drawer"; dependants held |
| Refund of an item | over the remaining quantity (_verified_ `SalesRepository.ts:2017`) | refused → review |
| Basket add / link | basket closed online (no check today, _verified_ `CustomerSessionRepository.ts:573, :283`) | booked as today |
| Basket checkout | basket closed online (_verified_ `SessionCheckoutService.ts:455`) | refused → review |
| Session start | an active session with the same customer name (_verified_ `:110-127`) | refused → review; dependants held |
| Checkpoint class | any | held (N8) — Apply books it at its own time; Dismiss drops it |
| Actor | switched off since | booked + note (O-new-7); unknown or role not allowed → refused (FR-023) |
| Anything else refused by a service | — | refused → review with the service's reason (FR-031) |

- **Rationale**: N6 forbids losing money only where the refusal is about a wrong count; other refusals encode a business
  fact a human must decide (the money may already be booked online). Replay-only switches select between behaviours
  that already exist, so rule 20 owners are unchanged.
- **Test strategy**: one failing-first test per row (core jest, real schema), each asserting ledgers per currency.

## R8 — Duplicate detection (N7)

- **Decision (O-new-18)**: one fingerprint definition, **computed from booked rows**, applied to both sides: inside the
  event transaction, `SAVEPOINT dup` → book → `DuplicateFingerprintRepository.fingerprint(createdTransactionIds)` →
  compare with `candidates(window)` → certain / likely / none → `ROLLBACK TO dup` or `RELEASE dup`. Fingerprint fields
  per N7 come from the unified `transactions` row (type, totals per currency, client id; phone when no client),
  payment lines (method, currency, amount) and the family table (sale items product/qty/price; financial service
  provider/direction/amount/fee/sender/receiver phone/reference; recharge carrier/phone/amount; expense
  category/description/amount; repayment client/amount/ticked items; exchange currencies/amounts/rate). Candidates =
  rows of the same family with id > the event's copy high-water mark for that table, excluding every server id this
  PC's booked events created (stored in their `result_json`, mapped or not), business time within ±5 min (certain recharge: 10 min) of the corrected instant.
- **Certain duplicates and their dependants**: a skipped certain duplicate writes no map rows yet; events that depend on
  it are held `waiting` until the note is resolved — Mark reviewed maps the event's MAIN row to the matching existing
  row only (an independently typed row may list items/legs in a different order, so child rows stay unmapped and later
  references to them are held) and releases them; Book anyway books the event, maps to the new rows and releases them. So a
  later void/refund is never booked against a row the owner may still decide was not the same.
- **Rationale**: building the fingerprint from the payload for the event and from rows for online data would be two
  definitions that drift (rule 14). Booking first in a savepoint costs one rollback per duplicate and guarantees both
  sides go through the same function. The copy high-water mark defines "created during this outage" exactly.
- **Alternatives**: a write journal hooked into every online write (rejected: touches every route/handler, new hot-path
  write); payload-only comparison (rejected: needs online payloads, which are not stored).
- **Test strategy**: table-driven tests per N7 rule (match, near-miss on each field, ±5 min boundary after skew
  correction, ignores user and seconds, compares against online rows and other PCs but not the same PC); web e2e 056
  covers held + skipped + Book anyway.

## R9 — Schema and app version mismatch (P5)

- **Decision**: events carry `schema_version` (MAX of `schema_migrations`) and `app_version`. Upload: PC schema newer
  than server → whole upload refused `VERSION_AHEAD` (Zod would silently strip unknown keys — rule 23); equal or older →
  accepted; each event carries its channel's schema shape descriptor (keys, types, optional, defaults). Compatible iff
  every event key exists unchanged on the server and every server-only key is optional without a default (Zod strips
  renamed keys and fills `.default()`s silently — rule 22/23); compatible → parsed by the current schema; incompatible
  or parse failure → refused "recorded by a different app version" with the full content shown for re-entry (Dismiss
  only, no Apply). Operations rule (OPERATIONS.md): no deploy that changes an offline channel's schema while the PCs
  panel shows waiting events. Guard: for every recorded schema,
  `parse(parse(x))` deep-equals `parse(x)` (the server parses an already-parsed payload). Go-offline requires copy schema = app schema = last server schema from check-in.
  Standby PCs download updates automatically and install only on a button press (old O11/O25 policy kept); never in
  offline/finishing mode. A working copy left by a version change waits untouched until the matching version runs.
- **Test strategy**: route tests for ahead/equal/older; parse-failure refusal; boot-decision unit tests.

## R10 — Authentication for uploads without a user session (P7) — owner to confirm

- **Decision (O-new-8, carries old O4/O25)**: per-PC device key `ltd_<tenantId>_<keyId>_<secret>` issued by
  `POST /api/offline/pair` after an admin signs in on the PC (shop + username + password, verified through
  `MobileAuthService.loginWithShop` and its session revoked immediately); server stores sha256(secret). Any number of PCs
  per shop; each gets the next PC number (never reused). **Re-pairing** a PC that presents its PC number (from
  `pairing.json`; or, for a revoked PC with no waiting events, chosen by the admin from the PCs list) issues a new key for
  the SAME device row — PC number, merge
  cursor and id range unchanged; the old key is revoked (FR-001a). Revoke from Settings. Device routes resolve the tenant from the
  key inside `runWithTenant`. Rate limit: verified key → own bucket `device:<tenant>:<keyId>` (old O17).
- **Actor (O-new-7, carries old O23)**: from the event; must belong to the tenant and hold one of the channel's roles
  (same roles as the IPC `requireRole`); switched off since → booked + note; else refused.
- **Pre-login PC channels** (pair, status, go-offline, back-to-web, install-update) run without a signed-in user, as in
  the superseded design; nothing can be recorded until a user signs in on the PC.
- **Test strategy**: key format/verify/revoke tests; cross-tenant key refused; actor checks; rate-limit bucket test.

## R11 — Original time: "effective now" (rule 27; brief P8 partly)

- **Decision (O-new-13)**: `runWithTenant` gains `effectiveNow` (ISO instant); new server-only `utils/requestNow.ts`
  `requestNow()` returns it, else `new Date()`. Repositories of offline families write business timestamps through
  `requestNow()` instead of `new Date()`, `CURRENT_TIMESTAMP` or `datetime('now')` (49 channels without any time field, _verified_
  `channels.md` §4D: refunds/voids, sessions, clients, stock moves, …), and money-posting lines receive it as `createdAt`
  (_verified_ `moneyPosting.ts` `COALESCE(createdAt, CURRENT_TIMESTAMP)`). A user-typed `transaction_time` still wins.
  Replay passes `effectiveNow = corrected instant` for **every** offline and checkpoint channel (the 29 channels whose
  `transaction_time` is optional are normally sent without it, so they need it too); the central writers
  (`TransactionRepository.createTransaction`'s `created_at` default and `moneyPosting`'s `createdAt`) take
  `requestNow()` first, then each family's own inserts. Desktop and web callers pass nothing → unchanged. Written format:
  ONE function (`requestNow()` returning the `YYYY-MM-DD HH:MM:SS` UTC text `CURRENT_TIMESTAMP` produces), so existing
  string date-range filters keep matching; event instants (`occurred_at`, `corrected_at`, stored ISO) are converted to
  that format before any comparison with business columns (duplicate window, closed-day check).
- **Rates (O-new-24)**: the event records the exchange rates in force on the PC (`rates_json`, read by the recorder from
  the working copy); replay sets them in the context (`effectiveRates`). `resolveStampedExchangeRate`
  (`repositories/moneyPosting.ts` ~:193) is pure and takes the server rate as a parameter, and rates are read in several
  places (`TransactionRepository.snapshotExchangeRate()`, raw SQL in `DebtRepository.ts` ~:279, `RateRepository`,
  `utils/lotMarketRate.ts`, `ExchangeRepository`, and above all `utils/exchangeRate.ts` `getUsdLbpSellRate()`, whose callers include
  `ExpenseRepository`, `HoldMoneyRepository`, `LotoCheckpointRepository`, `DebtRepository` and kept-change — pass 3),
  so the context read goes INSIDE `getUsdLbpSellRate()` and the other server-side readers (`snapshotExchangeRate()`,
  `DebtRepository` ~:279, `RateRepository` reads, `ExchangeRepository`) via one server-only `getEffectiveRate()`;
  `utils/lotMarketRate.ts` is pure and browser-reachable (`browser.ts`) and is NOT touched (rule 29). A guard over all of
  `packages/core/src` fails on any raw `exchange_rates` read outside these. The recorded rates object is strict (every
  field the readers use — sell, buy, market, direction — for every currency); a missing field refuses the event rather
  than mixing rates. A recorded rate differing from the server's **current** rate at
  processing adds a `rate_changed` note (rates keep no history). Fee tables and commissions use current server values (known limitation).
- **This re-decides old O26**: payment lines of replayed work carry the original time (they happened then); user
  backdating keeps today's behaviour (lines dated at entry). Rationale: a replayed sale is not a backdated entry — the
  cash entered the drawer at that time.
- **Guard**: `requestNow.guard.test.ts` scans the repositories named in the policy's families for `new Date(`,
  `CURRENT_TIMESTAMP`, `datetime('now')` on write statements, AND every `INSERT` into a table whose `created_at` (or other
  business-time column) has a SQL default but is not named in the insert (verified case: the void reversal row,
  `TransactionRepository.ts` ~:5388), with an explicit allow-list (e.g. `updated_at` columns).
- **Rule 29**: `requestNow.ts` imports `tenantContext.ts` (Node `async_hooks`) → `index.ts` only; browser-reachable
  defaults keep `new Date()`.
- **Test strategy**: per family, a failing-first test that replays an event at 23:50 day N on day N+1 and asserts every
  written timestamp (row, transaction, payment lines, profit) is on day N.

## R12 — Late events change past days; money checklist (P8, FEATURE_GUIDE §13)

- **Decision**: late events are booked on their own day, so past days' sales, profit, drawer movements and closings can
  change after the fact. A "closed day changed" note is added when a booked event's day already has a completed closing
  or checkpoint after its time (`daily_closings`, `loto_checkpoints`, carrier-line readings, _verified_ tables). The
  release note says so in plain words (FR-043).
- **§13 walk**: transaction row, IN/OUT, legs (rule 16), drawers, client propagation (the payload carries `client_id`;
  rewritten when offline), CUSTOMER_ACCOUNT, supplier/partner ledgers (online-only channels stay online), void path
  (existing owners; void-after-replay test), profits (service stamps), sessions (basket channels replayed through the
  same services), audit (replay writes audit with the actor through the audit writer, not `auditRest`, which skips when
  `req.user` is absent — _verified_ `audit.ts:41`), `is_auto` siblings (written by the existing flows). No new money flow.
- **Id-order queries (O-new-19, revised after analyze pass 1)**: `_clientBalanceBeforeRow` (`TransactionRepository.ts`
  ~:3381, id order deliberate — `created_at` is second-granular and ties within one checkout, and a typed
  `transaction_time` also feeds `created_at`) and the carrier-line movement queries (`CarrierLineMovementRepository.ts`
  ~:170, :193) **keep id order**: switching to business time would change today's online running balances for
  backdated entries. Replayed rows therefore appear in running balances in booking order — a documented limitation
  (release note). Tests pin today's online results. (`DebtRepository.ts` ~:1320 is not such a query: it picks a sale's
  SALE row with `ORDER BY t.id ASC LIMIT 1`.) The 65 "latest row" `ORDER BY id DESC` queries mean "most recently
  entered" and stay (audited in a task).
- **Test strategy**: SC-001 parity per family; id-order failing-first tests with a replayed earlier row; closed-day note
  test.

## R13 — Review list (P9) and receipts

- **Decision**: `offline_review_items` (one row per item; an event can have several). Kinds: `possible_duplicate`
  (held), `certain_duplicate` (note, Book anyway), `held_checkpoint`, `waiting` (dependant), `refused`,
  `stock_count_off`, `ticks_dropped`, `customer_linked`, `clock_corrected`, `closed_day_changed`, `came_out_differently`,
  `user_switched_off`, `pc_data_mismatch`, `rate_changed` (14 kinds). States `open → applied | dismissed | reviewed`. Actions: Apply (re-run the pipeline
  bypassing only the reason the item was held — a held duplicate skips the duplicate check, a held checkpoint skips
  the hold, a refused item re-runs every check; refused for a `waiting` item whose parent is still open; on success
  book + process waiting dependants), Dismiss,
  Mark reviewed (notes), Book anyway (certain duplicate). All admin-only, idempotent (state check inside the
  transaction).
- **Receipts (O-new-10)**: `RCP-<offline id>` resolves via the map to the server sale for reprint and warranty lookup.
- **Test strategy**: service tests per action and state transition; web e2e 056.

## R14 — Desktop modes and switching (P10)

- **Decision**: modes `standalone | standby | blocked | offline | finishing` (plan §B). Pure `bootDecision.ts` chooses
  the file and steps per mode (from the superseded design: migrations/backup/licence sync/db-path rollback/SQLCipher key
  off in paired modes; tenant id read from the copy instead of the hard-coded 1, _verified_ `main.ts:489`,
  `licenseSync.ts:46`). Mode changes relaunch the app (one connection, singletons — _verified_). Write guard
  (`PRAGMA query_only=ON`) in every paired mode, opened only inside the recorder's write window and the outbox/sign-in
  bookkeeping; reads that write are found by a sweep and by `total_changes()` around read channels (FR-036).
- **Resume and readiness**: at boot an existing `offline-work.db` is reopened in `offline` mode (never overwritten). From
  `finishing`, 30 s without the server returns to `offline` on the same working copy. `ready` also requires the newest
  copy to be built after every event of the last period left `received` on the server (else "waiting for a fresh
  copy"); a copy older than 24 h is usable with a warning.
- **Switching (O-new-22, O-new-17)**: "Work offline" enabled after 30 s unreachable with a ready copy; check-in every 30 s.
  On reconnect uploads stream automatically; offline actions stay allowed (no sale lost mid-way) with a banner; "Back to
  the web app" (server reachable) → finishing → standby. Partial reconnect: each PC is independent; the server
  processes whatever arrived; the PCs panel shows the others' last check-in and waiting counts.
- **Online-web mode (O-new-16)**: the PC never loads the web app inside the desktop window (with the preload exposed,
  `isElectron()` would route every call to the local copy); the standby screen opens the web app in the system browser.
- **Test strategy**: boot-decision and state-machine unit tests (electron jest); recorder/guard tests; desktop behaviour
  unverified until CI/Windows.

## R15 — The copy (snapshot) — reused from the superseded design

- **Decision**: `GET /api/offline/snapshot` → gzip of `buildTenantSnapshot()` (VACUUM INTO + shared `narrowToTenant()`
  extracted from `tenantSplit.ts` + strip secrets + per-table high-water marks recorded in `offline_snapshots` and in the
  copy's `offline_copy_meta`), cached 5 min per tenant and shared by all its PCs. `sqlite_sequence` is reset to each
  table's own MAX(id) in the copy (closes the documented leak, _verified_ characterization test). Table/column/setting
  guards from the superseded R9 kept (secrets stripped, password hashes kept).
- **Test strategy**: two-shop server test; guards; integrity check; size/time measurement recorded.

## R16 — What is owner-run or blocked on infrastructure (P11, G5)

- Push/deploy (`yarn api:deploy` verifier); a desktop release so paired PCs match the server's data version; pairing
  two real PCs at the test shop; the two-PC outage drill (timings for SC-008); CornerTech switch-on; hosting Phase D
  (not required — snapshot works on the shared file); Litestream-based incremental copy (spikes S1/S3, needs R2
  credentials). None is done by an agent.

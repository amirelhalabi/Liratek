---
description: "Task list for LIRA-306 offline desktop fallback (events redesign)"
---

# Tasks: Offline desktop fallback — every PC keeps working, events merge back

**Input**: `specs/306-offline-desktop-fallback/` — plan.md, spec.md, research.md (R1–R16), data-model.md,
contracts/ (rest-offline.md, ipc-offline.md, channel-policy.md), quickstart.md

**Tests**: required. CLAUDE.md rule 17 — every behaviour task is preceded by a separate test task that must be **run and
seen failing** on the unbuilt code before the implementation task starts; never re-break finished code to prove a test.
A test task that cannot fail first (it pins existing behaviour) says so: "pins today's behaviour — not a failing-first
guard". Money tests assert per-ledger, per-currency deltas (rule 15) and take payload field names from the schemas
(rule 24).

**Verification honesty (rule 28)**: a green run counts only after confirming suite/test counts and elapsed time.
Desktop tasks are proven with electron-app jest only; **desktop behaviour is unverified until CI / the owner's Windows
PC** (G5). Never launch Electron or run desktop e2e on this Mac.

**Gate G0 (owner)**: tasks marked **[G0]** implement constitution exceptions E1–E3 (device-key routes, actor from the
event, desktop-only channels) and must not start until the owner's approval of O-new-7, O-new-8 and E1 is recorded in
plan.md › Complexity Tracking (constitution Governance). Everything else proceeds.

**Migration number**: v210 at the time of writing (last entry v209, verified 2026-10-11) — re-check the last entry of
`packages/core/src/db/migrations/index.ts` before T005 and take the next free number everywhere below.

## Format: `[ID] [P?] [G0?] [Story] Description (FR/SC refs)`

---

## Phase 1: Setup

- [ ] T001 Add env knobs with defaults in `packages/core/src/config/env.ts`: `OFFLINE_MERGE_GATHER_MS` (30000), `OFFLINE_SNAPSHOT_TTL_MS` (300000), `OFFLINE_SKEW_CORRECT_MS` (120000), `OFFLINE_MAX_ATTEMPTS` (5); typed getters. (FR-017, FR-022)
- [ ] T002 [P] [G0] Set `OFFLINE_MERGE_GATHER_MS=0` and `OFFLINE_SNAPSHOT_TTL_MS=1000` for the e2e backend in `frontend/playwright.web.config.ts`; add revoke-all-devices for the e2e tenant to `frontend/tests/e2e-web/global-setup.ts` (shared DB hygiene, rule 15).
- [ ] T003 [P] [G0] Create e2e helper `frontend/tests/e2e-web/helpers/offlineDevice.ts`: pair a device through `POST /api/offline/pair`, build `OfflineEvent`s from core schema input types (`z.input<…>`, rule 24), upload, poll `/events/status` until nothing is `received`.

---

## Phase 2: Foundational (blocks every story)

- [ ] T004 Write failing migration test `packages/core/src/db/migrations/__tests__/v210.offlineEvents.test.ts`: tables `offline_devices`, `offline_snapshots`, `offline_events`, `offline_id_map`, `offline_review_items`, `offline_outbox`, `offline_outbox_created`, `offline_copy_meta` with every column, CHECK and UNIQUE of data-model.md (e.g. `offline_events.status` CHECK IN ('received','booked','skipped','held','refused','applied','dismissed'); `offline_review_items.kind` the 14 kinds incl. 'rate_changed'; UNIQUE(tenant_id, event_id); UNIQUE(tenant_id, device_id, device_seq); `offline_id_map` UNIQUE(tenant_id, offline_id); `offline_devices` UNIQUE(tenant_id, device_no) and UNIQUE(key_id); `schema_shape_json`, `rates_json` NOT NULL); `down()` drops all eight.
- [ ] T005 Implement migration v210 `offline_events_model` in `packages/core/src/db/migrations/index.ts` AND identical DDL in `electron-app/create_db.sql` (rule 10); run `yarn check:schema-equivalence`, `yarn check:tenant-scoping`.
- [ ] T006 [P] Classify the eight tables in `packages/core/src/constants/resetTables.ts` (`offline_devices`, `offline_snapshots`, `offline_events` kept on Reset Data; `offline_id_map`, `offline_review_items`, `offline_outbox`, `offline_outbox_created`, `offline_copy_meta` wiped); the existing reset guard test must pass.
- [ ] T007 [P] Write failing guard `packages/core/src/offline/__tests__/idRange.test.ts`: encode/decode round trip; bounds P 1–9006, T 0–999, n 1–999 999 999; max < 2⁵³; `isOfflineId(999_999_999_999) === false`; numeric strings accepted by `parseIdLike`; every AUTOINCREMENT table of `electron-app/create_db.sql` is in `OFFLINE_ID_TABLES` or `OFFLINE_ID_EXCLUDED_TABLES` (the eight `offline_*` tables); the list equals a committed snapshot except appended entries (append-only). (FR-012)
- [ ] T008 Implement `packages/core/src/offline/idRange.ts` (pure); export from `offline/index.ts`, `index.ts`, `browser.ts`.
- [ ] T009 [P] Write failing guard `electron-app/offline/__tests__/channelPolicy.complete.test.ts`: load all 45 `register*Handlers()` (and `offlineHandlers` once it exists) against a fake `ipcMain`; every registered channel is in `channelPolicy` exactly once and vice versa; counts offline 71 / online_only 105 / checkpoint 7 / read 215 / local 24 (422 incl. the 8 `offline:*`, listed ahead as `plannedChannels` until T122 and T136 register them). (FR-009, SC-006)
- [ ] T010 [P] Write failing test `packages/core/src/offline/__tests__/channelPolicy.test.ts`: every `offline`/`checkpoint` entry has family, label, roles, `coreSchema` name (or membership in `pendingLift` — exactly the 23 channels of channel-policy.md), `argNames` where the handler takes positional args (`transactions:void` → `["transactionId"]`, `session:cart:remove` → `["sessionId","itemId"]`).
- [ ] T011 [P] **HIGH guard (pass 3 D1)** Write failing test `packages/core/src/offline/__tests__/argEnvelope.test.ts`: `recordedSchema("session:update").parse({ sessionId: 1_004_000_000_001, ...body }).sessionId === 1_004_000_000_001` (same for `session:cart:add` → `sessionId` and `loto:checkpoint:update` → `id`); `collectIdPositions` for these three returns the positional key; for EVERY policy entry with `argNames`, every argName is a key of the recorded schema's Zod shape (Zod would otherwise strip it silently, rule 23).
- [ ] T012 Implement `packages/core/src/offline/channelPolicy.ts` (incl. `recordedSchema(channel)` = envelope of the `argNames` keys + the core body schema; IPC handler, binding and id-position walk all use it) (pure data, `classOf(channel)` → `"unclassified"` for unknown, `pendingLift`) and `packages/core/src/offline/reviewKinds.ts` (14 kinds with plain labels); export browser-safe.
- [ ] T013 [P] Write failing tests `packages/core/src/offline/__tests__/idPositions.test.ts`: rewrites `client_id`, `clientId`, `id`, `targets[].id` with `kind`, `referenceTable`+`referenceId`, nested `cartItems[].formData.*_id`, a JSON string in `form_data`, a numeric string id; leaves `amount_lbp: 1_004_000_000_001`, `phone`, `imei`, `barcode` untouched; `offlineIdsOutsidePositions` reports an offline id in a non-id key (FR-014, FR-019); and guard `idPositions.guard.test.ts` walking every core schema named in `channelPolicy` (skipping `pendingLift`) that fails on a reference-looking key that is not an id position, a declared position missing from its schema, or a money key matching the id convention.
- [ ] T014 Implement `packages/core/src/offline/idPositions.ts` (pure).
- [ ] T015 [P] Write failing tests `packages/core/src/db/__tests__/tenantContext.offline.test.ts` and `utils/__tests__/requestNow.test.ts`: `runWithTenant(t, fn, { effectiveNow, effectiveRates })` — `requestNow()` returns `effectiveNow` (else real now) in the `YYYY-MM-DD HH:MM:SS` UTC text format; `getEffectiveRate()` returns `effectiveRates` first, else the server rate; `requestNow.ts` is not reachable from `browser.ts` (extend `browserEntryIsNodeFree.guard.test.ts`). (FR-021, FR-021a)
- [ ] T016 [P] **HIGH guard (pass 3 D4)** Write failing test `packages/core/src/utils/__tests__/effectiveRate.readers.test.ts`: inside `runWithTenant(t, fn, { effectiveRates: <LBP sell 90000> })` with the server rate at 89 500 — `getUsdLbpSellRate()` returns 90 000, `TransactionRepository.snapshotExchangeRate()` returns 90 000, an LBP expense and a debt repayment conversion stamp 90 000; outside the context all return 89 500; `browserEntryIsNodeFree.guard.test.ts` still passes and `utils/lotMarketRate.ts` is unchanged (rule 29).
- [ ] T017 Implement the two options in `packages/core/src/db/tenantContext.ts`, server-only `packages/core/src/utils/requestNow.ts` and `packages/core/src/utils/effectiveRate.ts`; put the context read inside `utils/exchangeRate.ts` `getUsdLbpSellRate()` and route the other server-side readers through `getEffectiveRate()` — `TransactionRepository.snapshotExchangeRate()`, the raw read in `DebtRepository.ts` ~:279, `RateRepository` reads, `ExchangeRepository` (callers of the pure `resolveStampedExchangeRate`, `packages/core/src/repositories/moneyPosting.ts` ~:193, pass its result); do NOT touch the pure, browser-reachable `utils/lotMarketRate.ts`; export from `index.ts` only (rule 29).
- [ ] T018 [P] Write failing validator tests `packages/core/src/validators/__tests__/offline.test.ts` for `pairDeviceSchema` (optional `deviceNo`), `checkinSchema`, `offlineEventSchema` (uuid, seq ≥ 1, `clientDay` YYYY-MM-DD, offset −720…840, `schemaShape`, strict `rates` — every field sell/buy/market/direction for every currency, a missing field rejected — `created`, `dependsOn`), `uploadEventsSchema` (1–100), `manifestSchema` (`tables`, `readWrites`), review action schemas.
- [ ] T019 Implement `packages/core/src/validators/offline.ts`; re-export from `validators/index.ts`, `index.ts`, `browser.ts`, and `electron-app/schemas/index.ts` (zod-major cast).
- [ ] T020 [P] Write failing repository tests `packages/core/src/repositories/__tests__/Offline{Device,Event,IdMap,Review,Snapshot,Outbox}Repository.test.ts` (real schema, two tenants): every statement scoped by `tenant_id`; next `device_no` = max+1, never reusing revoked; re-key keeps `device_no` and `next_expected_seq`; event insert idempotent by `event_id` with payload-hash check and `SEQ_CONFLICT` on (device, seq) with another id; id-map unique per tenant; review transitions only from `open`; outbox `maxSeq()` read inside a transaction.
- [ ] T021 Implement `packages/core/src/repositories/OfflineDeviceRepository.ts`, `OfflineEventRepository.ts`, `OfflineIdMapRepository.ts`, `OfflineReviewRepository.ts`, `OfflineSnapshotRepository.ts`, `OfflineOutboxRepository.ts` (rule 13: all outbox SQL in core).
- [ ] T022 [P] Write failing test `packages/core/src/repositories/__tests__/RowCaptureRepository.test.ts`: `snapshotSequences()` / `createdSince(before)` inside one transaction return per-table new ids for a POS sale; rows inserted then deleted in the window are excluded; `MAP_EXCLUDED_TABLES` filtered. (FR-020)
- [ ] T023 Implement `packages/core/src/repositories/RowCaptureRepository.ts`; `MAP_EXCLUDED_TABLES` / `MANIFEST_KEY_TABLES` in `packages/core/src/offline/tables.ts` (guard: names exist in `create_db.sql`).
- [ ] T024 [P] Write failing test `packages/core/src/db/__tests__/offlineIdFloor.test.ts`: server-mode startup refuses when any `sqlite_sequence.seq` ≥ 10¹².
- [ ] T025 Implement that assertion in `packages/core/src/db/connection.ts` (server mode only).
- [ ] T026 [P] Write failing guard `packages/core/src/utils/__tests__/requestNow.guard.test.ts` over the family repositories named in `channelPolicy`: no `new Date(`, `CURRENT_TIMESTAMP`, `datetime('now')` on write statements, and no `INSERT` into a table whose `created_at` (or other business-time column) has a SQL default without naming that column — allow-list in the test (e.g. `updated_at`); and — over ALL of `packages/core/src` — no raw `exchange_rates` read outside `getUsdLbpSellRate()` / `getEffectiveRate()` / `RateRepository` admin methods. It fails today on many files; each family task below removes its files from the test's `pending` list, which must end empty. (FR-021)
- [ ] T027 [P] Write failing tests `packages/core/src/offline/__tests__/schemaShape.test.ts`: `describeShape(schema)` (keys, types, optional, defaults) is stable; `isCompatible(eventShape, serverShape)` is true only when every event key exists unchanged and every server-only key is optional without a default (added key with `.default()` → incompatible; renamed key → incompatible); for every recorded core schema `parse(parse(x))` deep-equals `parse(x)` on schema-derived fixtures. (FR-016)
- [ ] T028 Implement `packages/core/src/offline/schemaShape.ts` (pure).

**Checkpoint**: schema, pure modules, repositories, time/rate/connection context exist.

---

## Phase 3: User Story 1 — offline work lands once, on its own day, through the web's rules (P1) 🎯 MVP

**Goal / independent test**: spec US1. Core tasks buildable and verifiable tonight; `[G0]` tasks after the owner's yes.

- [ ] T029 [P] [G0] [US1] Write failing tests `packages/core/src/services/__tests__/OfflineDeviceService.test.ts` and `packages/core/src/offline/__tests__/actorPolicy.test.ts` (O-new-7: actor not in tenant / role not allowed → refused; switched off → booked + `user_switched_off`): pair (admin only, generic `INVALID_CREDENTIALS`, the session from `MobileAuthService.loginWithShop` revoked immediately); key format `ltd_<tenantId>_<keyId>_<secret>`, sha256 stored; several PCs with increasing `device_no`; re-pair with `deviceNo` re-keys the same row only with the PC's own identity or for a revoked PC with no waiting events (FR-001a); revoke; constant-time verify; checkin stores state/pending/versions/`last_skew_ms` (`last_online_skew_ms` when standby) and returns `maxSeq` + per-table `maxOfflineIds`. (FR-001, FR-001a, FR-004)
- [ ] T030 [G0] [US1] Implement `packages/core/src/services/OfflineDeviceService.ts` and `packages/core/src/offline/actorPolicy.ts` (plugged into `ReplayEngine`'s actor hook; until G0 the hook only checks the user exists in the tenant).
- [ ] T031 [P] [US1] Write failing tests `packages/core/src/services/__tests__/OfflineEventService.upload.test.ts`: stores `received`, acks; resend → one row; same id different payload → `EVENT_ID_REUSED`; same (PC, seq) different id → `SEQ_CONFLICT` (not stored); unknown / non-recordable channel → stored as `refused` and acked (sequence stays gap-free); PC schema newer → whole upload `VERSION_AHEAD`; older accepted. (FR-015, FR-016, FR-024)
- [ ] T032 [US1] Implement `packages/core/src/services/OfflineEventService.ts` (`upload`, `statusSince`).
- [ ] T033 [P] [US1] Write failing tests `packages/core/src/offline/__tests__/ReplayEngine.test.ts`: one event = one transaction (throw after the service call → nothing booked, `received`, attempts+1; 5 → `refused`); no-yield guard: a binding that awaits a macrotask (e.g. `setImmediate`) inside the window is rolled back as a technical failure and logged; business refusal stored with the service's message; ids rewritten before the binding; unmapped offline id → `held`/`waiting`; created rows mapped per table in order; per-table count mismatch → unmapped + `came_out_differently`; incompatible schema shape → refused "recorded by a different app version" with content kept, no Apply; parse failure → refused likewise; the actor passed in is used for the booking and the audit row (actor policy itself: T029, G0); context carries `clientDay`, offset, `effectiveNow`, `effectiveRates`. (FR-016, FR-018–FR-021a)
- [ ] T034 [P] [US1] **HIGH guard (pass 3 D2)** Write failing test `packages/core/src/offline/__tests__/replayIsolation.test.ts`: while a replay transaction is open, a statement issued from a different async context (`runWithTenant(t, () => someRepo.insert(...))` without the replay token) throws `REPLAY_IN_PROGRESS` — `expect(() => …).toThrow(/REPLAY_IN_PROGRESS/)`; after the replay commits or rolls back, the outside row count equals its value before the attempt (nothing joined, nothing silently undone); a binding that awaits `setImmediate` inside the window is rolled back as a technical failure.
- [ ] T035 [US1] Implement `packages/core/src/offline/ReplayEngine.ts` (incl. the `REPLAY_IN_PROGRESS` refusal in `getDatabase()` for statements outside the replay's async context, and the `setImmediate` sentinel) (plan §A steps 1–5; duplicate step a no-op hook until T064) and binding registry `packages/core/src/offline/bindings/index.ts` (`index.ts` export only).
- [ ] T036 [P] [US1] Write failing replay-time + rate tests `packages/core/src/offline/bindings/__tests__/coreWriters.replayTime.test.ts`: `sales:process`, `debt:add-repayment`, `db:add-expense` replayed at 23:50 day N on day N+1 without `transaction_time` → row, transaction, payment lines (`moneyPosting`) and profit on day N, asserted through the existing date-range queries (Transactions list / profit by day), not only `DATE()`; recorded rate used although the server rate changed, plus `rate_changed` note. (FR-021, FR-021a, SC-005)
- [ ] T037 [US1] Sweep the central writers: `TransactionRepository.createTransaction` (`created_at` = `transaction_time ?? requestNow()`, one function, SQLite text format), `moneyPosting` (`createdAt ?? requestNow`), `SalesRepository.processSale`, the `DebtRepository` repayment path, `ExpenseRepository.createExpense`; remove them from T026's `pending` list.
- [ ] T038 [P] [US1] Write failing parity test `packages/core/src/offline/bindings/__tests__/sales.binding.test.ts`: `sales:process` through `ReplayEngine` vs `getSalesService().processSale` (what `POST /api/sales/process` calls) on two fresh DBs → equal drawers, payments, stock, profit, debt per currency (cash USD, LBP leg, CUSTOMER_ACCOUNT); schema `toBe` the route's schema. (SC-001)
- [ ] T039 [US1] Implement binding `packages/core/src/offline/bindings/sales.ts` (`sales:process`).
- [ ] T040 [P] [US1] Write failing three-way key diff + schema tests `packages/core/src/validators/__tests__/offlineLift.us1.test.ts` for `clients:create`, `clients:update`, `transactions:void`, `transactions:refund`, `db:add-expense` (schema keys vs `electron-app/preload.ts` types vs handler-forwarded fields; the diff recorded in the file header). (rule 23)
- [ ] T041 [US1] Lift those five to core (`validators/client.ts`, `validators/transaction.ts`, `validators/expense.ts`); wire `validatePayload` in `electron-app/handlers/clientHandlers.ts`, `transactionHandlers.ts`, `dbHandlers.ts` and `validateRequest` in `backend/src/api/clients.ts`, `transactions.ts`, `expenses.ts`; remove them from `pendingLift`.
- [ ] T042 [P] [US1] Write failing replay-time tests `packages/core/src/offline/bindings/__tests__/clientsVoids.replayTime.test.ts`: client create, void (incl. the reversal row that relies on the `created_at` default, `TransactionRepository.ts` ~:5388) and refund replayed at 23:50 day N → every timestamp on day N.
- [ ] T043 [US1] Sweep `ClientRepository` and the void/refund paths of `TransactionRepository` to `requestNow()` / named `created_at`; remove from T026's `pending`.
- [ ] T044 [P] [US1] Write failing tests `packages/core/src/offline/bindings/__tests__/us1.bindings.test.ts` for bindings `clients:create`, `clients:update`, `transactions:void`, `transactions:refund`, `debt:add-repayment`, `db:add-expense`, incl. the scenario client created offline → sale on account to it → repayment ticking that sale → refund of an earlier online sale (all links on server rows, SC-003); void-after-replay nets 0 per currency (rule 20).
- [ ] T045 [US1] Implement bindings `bindings/clients.ts`, `bindings/transactions.ts`, `bindings/debts.ts` (repayment), `bindings/expenses.ts` (add-expense).
- [ ] T046 [P] [US1] Write failing tests `packages/core/src/services/__tests__/OfflineMergeProcessor.basic.test.ts`: one PC in `device_seq`; gap stops the PC until the missing seq arrives; resend after booking returns stored outcomes; one `data:invalidate` per round after commit; processing rate logged (plan: ≥ 20 events/s). (FR-017)
- [ ] T047 [US1] Implement `packages/core/src/services/OfflineMergeProcessor.ts` (single-PC path; runs on the shared connection under the no-yield invariant and the `REPLAY_IN_PROGRESS` guard) and `backend/src/offline/processorTimer.ts` (gathering pause after upload, 60 s sweep, one round per tenant at a time).
- [ ] T048 [P] [G0] [US1] Write failing backend tests `backend/src/api/__tests__/offlineDevice.api.test.ts` (tenant ≠ 1 — `jest.setup.ts` fixes tenant 1 and hides missing tenant context): `authenticateDevice` (malformed key → no DB read; revoked → `DEVICE_REVOKED`; cross-tenant key refused), `POST /pair` (incl. re-key), `POST /checkin`, `POST /events`, `GET /events/status`; envelope HTTP 200 on failure; rate-limit bucket `device:<tenant>:<keyId>` for verified keys only. (FR-003)
- [ ] T049 [G0] [US1] Implement `backend/src/middleware/deviceAuth.ts`, the device branch of `verifiedIdentityKey` in `backend/src/middleware/rateLimit.ts`, routes `/pair`, `/checkin`, `/events`, `/events/status` in `backend/src/api/offline.ts`; mount in `backend/src/server.ts`; start the processor timer.
- [ ] T050 [G0] [US1] Write web e2e (written after its implementation — an end-to-end proof, not a failing-first guard) `frontend/tests/e2e-web/lira-web-055-offline-replay.spec.ts`: pair via the API, upload the US1 scenario stamped yesterday 23:50 shop time, wait for outcomes, assert by identity (client name/phone, sale total, repayment amount) and deltas (drawer, client debt) that rows exist once on yesterday; re-upload → no change; a web sale during the run is never refused (SC-007); revoke the device. Run it; record counts and elapsed.

---

## Phase 4: User Story 2 — several PCs, time-order merge, duplicates, N6–N8 outcomes (P1) — buildable tonight

- [ ] T051 [P] [US2] Write failing scenario test `packages/core/src/offline/__tests__/twoPcOutage.test.ts` reproducing plan §C (PC 1, PC 2, online sales during the outage): expected outcome per event and review items exactly as the diagram; totals per currency equal the booked events only. Written first; passes only when T052–T066 are done.
- [ ] T052 [P] [US2] Write failing tests `packages/core/src/services/__tests__/OfflineMergeProcessor.multiPc.test.ts` with plan §D queues: earliest corrected head first; backward clock jump keeps PC 2's order; late PC processed later at its own times; ties by device_no then seq; `SEQ_CONFLICT` stops only that PC.
- [ ] T053 [US2] Extend `OfflineMergeProcessor.ts` with the k-way merge.
- [ ] T054 [P] [US2] Write failing tests `packages/core/src/offline/__tests__/skew.test.ts`: |skew| ≤ 2 min → no correction; fast/slow corrected; clamp to ≤ receipt and ≥ copy built − 5 min with a note on every clamp; skew changed vs last online check-in > 2 min → note text; an event earlier than the previous event of the same PC → note; day recomputed from corrected instant + offset. (FR-022)
- [ ] T055 [US2] Implement `packages/core/src/offline/skew.ts`; wire `corrected_at` into the processor and `effectiveNow`.
- [ ] T056 [P] [US2] Write failing tests `packages/core/src/repositories/__tests__/DuplicateFingerprintRepository.test.ts`: fingerprint from booked rows for sale, transfer, recharge, expense, repayment, exchange with exactly the N7 fields; one definition for both sides. (FR-025)
- [ ] T057 [P] [US2] Write failing table-driven tests `packages/core/src/services/__tests__/DuplicateDetector.test.ts`: certain (same non-empty OMT/Whish reference; recharge carrier+phone+amount within 10 min — 10:01 apart → not certain); likely (all N7 fields equal within ±5 min ignoring user and seconds; a near-miss on each field → booked); candidates = rows above the copy high-water mark minus this PC's replayed rows (online and other PCs included, same PC excluded); window after skew correction. (FR-025–FR-027, SC-004)
- [ ] T058 [P] [US2] Write failing tests `packages/core/src/offline/__tests__/duplicateDependants.test.ts`: dependants of a skipped certain duplicate stay `waiting`; Mark reviewed → map the main row to the existing row and release; Book anyway → book, map to new rows, release; dependants of a held likely duplicate wait until Apply/Dismiss. (FR-026, FR-034)
- [ ] T059 [P] [US2] **HIGH guard (pass 3 D3)** Write failing test `packages/core/src/offline/__tests__/duplicateLinkMainRowOnly.test.ts`: an offline sale (items A then B) held as a duplicate of an online sale entered as B then A; after Dismiss (and, separately, a certain-duplicate Mark reviewed) `offline_id_map` holds ONLY the `sales` row — `expect(mapRowsFor("sale_items")).toHaveLength(0)`; a later offline `sales:refund-item` naming the offline sale_item of A is `held` with "booked, but this part could not be linked" and moves no stock or drawer (`expect(stockDeltaA).toBe(0); expect(stockDeltaB).toBe(0)`).
- [ ] T060 [US2] Implement `packages/core/src/repositories/DuplicateFingerprintRepository.ts` and `packages/core/src/services/DuplicateDetector.ts`; plug into `ReplayEngine` with `SAVEPOINT dup` / `ROLLBACK TO` / `RELEASE`; certain → `skipped` + `certain_duplicate` (no map rows until resolved); likely → `held` + `possible_duplicate`.
- [ ] T061 [P] [US2] Write test pinning today's repayment behaviour `packages/core/src/repositories/__tests__/DebtRepository.overpayPin.test.ts`: an untargeted repayment above the open balance — record exactly what today's code does (credit or not). Pins today's behaviour — not a failing-first guard.
- [ ] T062 [P] [US2] Write failing tests `packages/core/src/offline/__tests__/outcomes.test.ts` (research R7): stock short → booked via the out-of-stock path whatever `allow_out_of_stock_sales` + `stock_count_off` per product, and a web sale with the setting off is still refused; repayment with a closed ticked item → rebooked without ticks + `ticks_dropped`; offline client with an existing phone → `linked_existing` + `customer_linked`; when a replay-only rule fired only the main row is mapped (FR-020); already voided/refunded → refused with reason; basket closed → checkout refused; checkpoint channel → `held_checkpoint`; dependants → `waiting`; booked event on a day with a later completed closing → `closed_day_changed`. (FR-028–FR-034)
- [ ] T063 [US2] Implement the outcome rules: `isOfflineReplay()` flag read by `SalesService`, `MaintenanceService`, `CustomServiceService`, `ExpenseService` (stock use) to pass `allowOutOfStock: true`; post-booking negative-stock check; ticks-dropped retry in `bindings/debts.ts`; `DUPLICATE_PHONE` → link in `bindings/clients.ts`; checkpoint and dependant holds and main-row-only mapping in `ReplayEngine`; closed-day check through a `ClosingRepository` query.
- [ ] T064 [US2] Wire the duplicate detector hook in `ReplayEngine` into the processor rounds (end-to-end with T051).
- [ ] T065 [P] [US2] Write failing test `packages/core/src/services/__tests__/OfflineEventService.manifest.test.ts`: rows present that every event explains → matched; a row present that no event created → `pc_data_mismatch` listing table and ids; rows created and later deleted offline → not a mismatch; read-write log entries listed. (FR-035, FR-036)
- [ ] T066 [US2] Implement manifest comparison in `OfflineEventService.ts`.
- [ ] T067 [G0] [US2] Write failing backend test and implement route `POST /api/offline/manifest` in `backend/src/api/offline.ts`.

---

## Phase 5: User Story 3 — review list on the web app (P1) — buildable tonight (e2e after G0)

- [ ] T068 [P] [US3] Write failing tests `packages/core/src/services/__tests__/OfflineReviewService.test.ts`: list grouped by kind with plain labels and matching row; Apply bypasses only the hold reason (held duplicate skips the duplicate check; held checkpoint skips the hold; refused re-runs every check) and then processes waiting dependants in order; Apply refused for a `waiting` item whose parent is open; Dismiss (nothing booked; duplicate dependants relinked where counts agree, else `waiting` "depends on a dismissed item"); Mark reviewed (notes); Book anyway (certain duplicates only); idempotent, who/when recorded; history with server row and offline receipt number. (FR-037)
- [ ] T069 [US3] Implement `packages/core/src/services/OfflineReviewService.ts`.
- [ ] T070 [P] [G0] [US3] Write failing backend tests `backend/src/api/__tests__/offlineReview.api.test.ts`: `authenticateJWT` → `requireRole(["admin"])`; staff refused; actor from JWT; envelope; static paths before `/:id`; `GET /devices`, `POST /devices/:id/revoke`. (FR-002, FR-038)
- [ ] T071 [G0] [US3] Implement review and devices routes in `backend/src/api/offline.ts` (JWT; no exception needed).
- [ ] T072 [P] [G0] [US3] Write failing frontend tests `frontend/src/features/offline/pages/OfflineReview/__tests__/OfflineReview.test.tsx` (stable `useApi` mock, rule 25): groups, labels, actions call the adapter with schema-derived payloads, confirm dialogs, staff sees "admins only".
- [ ] T073 [G0] [US3] Implement adapter functions in `frontend/src/api/backendApi.ts`, `frontend/src/api/ElectronApiAdapter.ts`, types in `packages/ui/src/api/types.ts` (`z.input<…>` from `@liratek/core`; desktop branch returns "Available on the web app"); page `frontend/src/features/offline/pages/OfflineReview/index.tsx`; route + admin nav in `frontend/src/app/App.tsx`.
- [ ] T074 [P] [G0] [US3] Write failing test `frontend/src/features/settings/pages/Settings/__tests__/PairedPcsPanel.test.tsx` (list name, number, last seen, state, waiting, version; revoke with confirm).
- [ ] T075 [G0] [US3] Implement `frontend/src/features/settings/pages/Settings/PairedPcsPanel.tsx` and mount it in Settings.
- [ ] T076 [G0] [US3] Write web e2e (end-to-end proof, not a failing-first guard) `frontend/tests/e2e-web/lira-web-056-offline-review.spec.ts`: two devices upload a likely duplicate of an online sale, a certain OMT duplicate, a drawer count and a short-stock sale; the admin page shows the four items; Apply the duplicate (booked once — identity + delta), Book anyway the certain one, Dismiss the drawer count, Mark reviewed the stock note; staff refused; revoke devices. Run it; record counts and elapsed. (SC-004)

---

## Phase 6: Remaining families — schema lifts, replay time, bindings (money; core jest) — buildable tonight

Per family: **(a)** failing tests — three-way key diff for each `pendingLift` channel (rule 23), replay-time test (23:50
day N → day N, no `transaction_time`), recorded exchange rate used for any conversion, parity vs the service the REST
route calls per currency, schema `toBe`;
**(b)** lift + wire `validatePayload` (IPC) and `validateRequest` (REST), remove from `pendingLift`; **(c)**
`requestNow()` sweep of the family's repositories, remove them from T026's `pending`; **(d)** bindings. Channel lists:
`contracts/channel-policy.md`.

- [ ] T077 Write guard `packages/core/src/offline/__tests__/bindings.complete.test.ts` FIRST (fails until the phase ends): every `offline`/`checkpoint` channel (71 + 7 = 78) has exactly one binding; running each binding's fixture never fires a `setImmediate` sentinel (microtask-only awaits, pass 3 D2); each binding's schema `toBe` the policy's; `pendingLift` is empty; T026's `pending` list is empty. (SC-006)
- [ ] T078 [P] Family **sales (rest)** (a) tests `bindings/__tests__/sales.rest.test.ts`: `sales:delete-draft` (lift), `sales:refund`, `sales:refund-item`, `sales:undo-item-refund`, `sales:update-metadata`.
- [ ] T079 Family sales (b)(c)(d): lift `sales:delete-draft`; sweep refund/undo paths of `SalesRepository`; bindings in `bindings/sales.ts`.
- [ ] T080 [P] Family **sessions/baskets** (a) tests `bindings/__tests__/sessions.test.ts`: `session:start/update/close/delete/linkTransaction/checkout`, `session:cart:add/remove/clear`, `transactions:void-checkout-group`, `transactions:void-session-basket`, `transactions:refund-session-basket`, `transactions:refund-session-basket-item`; nested `cartItems[].formData` rewriting; `session:close` actor from the session/event, never `closedBy`.
- [ ] T081 Family sessions (b)(c)(d) (first add a test pinning today's cart add/remove/clear results on both transports — pins today's behaviour): lift `session:close`, `session:delete`, `session:cart:remove`, `session:cart:clear`; move the `session:cart:add/remove/clear` direct `CustomerSessionRepository` calls (`sessionHandlers.ts` ~:255, `backend/src/api/sessions.ts` ~:308/327/342) behind a `CustomerSessionService` method on both transports (rule 13); fix the `session:close` actor and `session:start` `started_by` fallback in `electron-app/handlers/sessionHandlers.ts` and the REST route; sweep `CustomerSessionRepository`, basket checkout and reversal writers; bindings `bindings/sessions.ts`.
- [ ] T082 [P] Family **financial services** (a) tests: `omt:add-transaction` (lift hand-written `FinancialServiceSchema` → core `createFinancialServiceSchema`), `financial:update-metadata`, `financial:self-charge-telecom-item`, `wallet-exchange:create`.
- [ ] T083 Family financial (b)(c)(d) (first add a test pinning today's self-charge result — pins today's behaviour): wire the core schema in `electron-app/handlers/omtHandlers.ts`; move `financial:self-charge-telecom-item`'s direct repository call behind its service (rule 13); sweep; bindings `bindings/financial.ts`.
- [ ] T084 [P] Family **recharge + carrier lines** (a) tests: `recharge:process`, `recharge:top-up-from-client`, `recharge:update-metadata`, `carrier-lines:record-usage`, `carrier-lines:mark-owed-delivery-sent`.
- [ ] T085 Family recharge (b)(c)(d): sweep `RechargeRepository` and carrier-line movement writers; bindings `bindings/recharge.ts`.
- [ ] T086 [P] Family **debts (rest)** (a) tests: `debt:cash-out`, `debt:add-account-entry`, `debt:add-credit` (lift `DebtAddCreditSchema`), `debt:use-credit`, `debt:write-off`, `debts:update-metadata` (lift).
- [ ] T087 Family debts (b)(c)(d): lifts, wiring, sweep; bindings in `bindings/debts.ts`.
- [ ] T088 [P] Family **expenses (rest)** (a) tests: `expenses:add-stock-use`, `db:delete-expense` (lift), `expenses:update-metadata`.
- [ ] T089 Family expenses (b)(c)(d): bindings in `bindings/expenses.ts`.
- [ ] T090 [P] Family **exchange** (a) tests: `exchange:add-transaction`, `exchange:update-metadata` (recorded rate used).
- [ ] T091 Family exchange (b)(c)(d): bindings `bindings/exchange.ts`.
- [ ] T092 [P] Family **maintenance + warranty** (a) tests: `maintenance:save`, `maintenance:delete` (lift), `maintenance:update-metadata` (lift; REST twin test for the new route), `warranty:claim`, `warranty:void-claim`.
- [ ] T093 Family maintenance (b)(c)(d): FIRST add the missing REST route `POST /api/maintenance/update-metadata` in `backend/src/api/maintenance.ts` + adapter function (closes E4), then lifts, sweep, bindings `bindings/maintenance.ts`.
- [ ] T094 [P] Family **custom services** (a) tests: `custom-services:add` (lift `CustomServiceCreateSchema`), `custom-services:delete` (lift), `custom-services:update-metadata`, `custom-services:advance-fulfillment`, `custom-services:set-work-status`.
- [ ] T095 Family custom services (b)(c)(d): bindings `bindings/customServices.ts`.
- [ ] T096 [P] Family **loto** (a) tests: `loto:sell`, `loto:update` (lift), `loto:cash-prize:create`, `loto:update-metadata` (its monthly-fee side effect replays through the same service).
- [ ] T097 Family loto (b)(c)(d): bindings `bindings/loto.ts`.
- [ ] T098 [P] Family **stock** (a) tests: `inventory:adjust-stock`, `inventory:receive-stock` (supplier-debt attach through the same service), `product-units:register`, `product-units:delete`.
- [ ] T099 Family stock (b)(c)(d): sweep stock writers in `ProductRepository` and `ProductUnitRepository`; bindings `bindings/stock.ts`.
- [ ] T100 [P] Family **drawers, hold money, vouchers** (a) tests: `drawer-cashout:create`, `drawer-topup:create`, `drawer-topup:create-from-drawer`, `drawer-topup:transfer`, `hold-money:create`, `hold-money:collect`, `hold-money:void-pickup`, `voucher:cancel` (lift).
- [ ] T101 Family drawers (b)(c)(d): bindings `bindings/drawers.ts`.
- [ ] T102 [P] Family **checkpoints** (a) tests: `closing:create-checkpoint` (lift), `closing:update-daily-closing`, `loto:checkpoint:create`, `loto:checkpoint:update`, `loto:checkpoint:delete` (lift), `loto:checkpoint:create-scheduled` (lift), `carrier-lines:update-balance` — replay always holds; Apply recomputes expected amounts on the server at the event's time, shows the PC's and the server's figures, and books at the event's own time. (FR-032)
- [ ] T103 Family checkpoints (b)(c)(d): lifts, wiring; bindings `bindings/checkpoints.ts` used only by Apply.
- [ ] T104 [P] Write FIRST, at phase start next to T077 (fails until every family is done), the combined scenario test `packages/core/src/offline/__tests__/allFamilies.parity.test.ts`: one recorded outage with at least one event of every family replayed vs the same actions done online → equal drawers, ledgers, stock, profit per currency; resent twice → unchanged. (SC-001, SC-002)
- [ ] T105 [P] Write tests pinning today's online running balances `packages/core/src/repositories/__tests__/idOrderPin.test.ts` for `_clientBalanceBeforeRow` (`TransactionRepository.ts` ~:3381) and the carrier-line movement queries (`CarrierLineMovementRepository.ts` ~:170/:193), incl. backdated entries; plus a case documenting that a replayed earlier row appears where it was booked (O-new-19). Pins today's behaviour — not a failing-first guard. (FR-042)
- [ ] T106 Audit the remaining `ORDER BY id DESC` / `, id DESC` "latest row" queries; record in T105's file header which mean "most recently entered" (kept); open a follow-up ticket for any that mean "business latest" instead of changing it here.
- [ ] T107 [P] Write failing test `packages/core/src/repositories/__tests__/WarrantyRepository.offlineReceipt.test.ts`: `RCP-<offline sale id>` resolves through `offline_id_map` to the server sale (warranty search and reprint). (FR-040)
- [ ] T108 Implement the receipt alias in `packages/core/src/repositories/WarrantyRepository.ts` and the reprint lookup.
- [ ] T109 [P] Sweep offline-family services for outside-world side effects (WhatsApp/SMS) inside writes; for any found, write a failing test and suppress under `isOfflineReplay()`; record the result in spec Assumptions.
- [ ] T110 [P] Write electron jest parity test `electron-app/offline/__tests__/handlerBindingParity.test.ts` (table-driven over the 78 channels, fake `ipcMain`, services spied): the IPC handler and the core binding call the same service method with equal arguments for the same named payload, and any handler-side write outside the service (e.g. audit) is in `MAP_EXCLUDED_TABLES`. Written after the bindings it checks — not a failing-first guard for them; it guards future drift.

---

## Phase 7: User Story 4 — every PC keeps a fresh copy (P2) — server half tonight; desktop half unverified until CI/Windows

- [ ] T111 [P] [US4] Write test `packages/core/src/db/__tests__/tenantSplit.narrowToTenant.test.ts` pinning the split's output (pins today's behaviour) before the refactor.
- [ ] T112 [US4] Refactor `packages/core/src/db/tenantSplit.ts` to export `narrowToTenant(db, tenantId, opts)` used by the split (rule 14).
- [ ] T113 [P] [US4] Write failing tests `packages/core/src/db/__tests__/tenantSnapshot.test.ts` (two shops): only the shop's rows; stripped tables empty, `license_key` null, secret settings deleted, password hashes kept; table/column/setting guards; `sqlite_sequence` = own MAX(id); `offline_copy_meta` with copy id and `high_water_json`; `integrity_check = ok`; temp files removed on failure; build time printed. (FR-005)
- [ ] T114 [US4] Implement `packages/core/src/db/tenantSnapshot.ts` and `packages/core/src/services/OfflineSnapshotService.ts` (5-min cache per tenant shared by its PCs; records `offline_snapshots`).
- [ ] T115 [P] [G0] [US4] Write failing backend test for `GET /api/offline/snapshot` (gzip, headers, `VERSION_MISMATCH`).
- [ ] T116 [G0] [US4] Implement `GET /api/offline/snapshot` in `backend/src/api/offline.ts`.
- [ ] T117 [P] [US4] Write failing electron jest tests `electron-app/offline/__tests__/bootDecision.test.ts`: modes standalone/standby/blocked/offline/finishing; an existing working copy → `offline` (resume, never overwritten); tenant id from the copy; paired modes skip migrations/backup/licence sync/db-path rollback/SQLCipher key; never open the standalone file or a UNC path; version mismatch → not ready; ready requires a copy built after the last finished period. (FR-007, FR-008, FR-008a)
- [ ] T118 [US4] Implement `electron-app/offline/bootDecision.ts`, `electron-app/offline/pairingStore.ts` (safeStorage) and boot wiring in `electron-app/main.ts` (no hard-coded tenant 1 in paired modes; `licenseSync.ts` skipped).
- [ ] T119 [P] [G0] [US4] Write failing tests `electron-app/offline/__tests__/syncClient.test.ts`: checkin every 30 s with clock; copy refresh when due into `mirror-<ts>.db`, integrity verified, newest 2 kept, never the open one; `unreachableSeconds`; stores the server's `maxSeq`/`maxOfflineIds`. (FR-004, FR-006)
- [ ] T120 [G0] [US4] Implement `electron-app/offline/syncClient.ts` and `electron-app/offline/updatePolicy.ts` (standby: download automatically, install on button only; offline/finishing: none).
- [ ] T121 [P] [G0] [US4] Write failing tests for `electron-app/handlers/offlineHandlers.ts` (`offline:status`, `offline:pair` incl. re-key, `offline:unpair`, `offline:open-web-app`, `offline:install-update`) and `frontend/src/features/offline/components/__tests__/StandbyScreen.test.tsx` (incl. the list of this PC's offline items still held for review, so a held repayment is not collected twice — spec edge case).
- [ ] T122 [G0] [US4] Implement those channels + preload + `frontend/src/types/electron.d.ts` + adapter functions + `StandbyScreen.tsx`; remove them from T009's `plannedChannels`.

---

## Phase 8: User Story 5 — the cashier works offline, then back to the web (P2) — electron jest; desktop behaviour unverified

- [ ] T123 [P] [US5] Write failing tests `electron-app/offline/__tests__/workingCopy.test.ts`: go-offline copies the newest mirror, writes `offline_copy_meta.device_no`, seeds `sqlite_sequence` for every `OFFLINE_ID_TABLES` table from the max of `pairing.json`, finished copies and the server's maxima; a new sale gets `P·10¹²+T·10⁹+n` ids; resume keeps sequences; counters persisted on finish; a SECOND outage on a fresh copy continues ids and event sequence (no restart at 1). (FR-008a, FR-012)
- [ ] T124 [US5] Implement `electron-app/offline/workingCopy.ts`.
- [ ] T125 [P] [US5] Write failing tests `electron-app/offline/__tests__/recorder.test.ts` (fake `ipcMain`, real better-sqlite3 working copy): allowed → business rows + outbox row in one transaction with every FR-011 field (incl. `schemaShape`, `rates`); seq = max(outbox max, `pairing.json` lastSeq, server maxSeq) + 1 inside the transaction (second-outage case); `{success:false}` → nothing; a non-envelope result → rolled back AND an explicit `{ success:false }` returned; throw → nothing; online-only → `OFFLINE_NOT_AVAILABLE`, `total_changes()` unchanged; unclassified → refused; offline id (number or numeric string) outside positions → `OFFLINE_UNRECORDABLE`; concurrent writes serialized; a read or local channel issued during a write window waits; nested service `db.transaction()` works as a savepoint; `depends_on` resolved; standalone/standby untouched. (FR-009–FR-011, FR-014)
- [ ] T126 [US5] Implement `electron-app/offline/recorder.ts` (write queue incl. reads during a window), `electron-app/offline/writeGuard.ts`; install the recorder in `electron-app/main.ts` before `registerHandlers()`.
- [ ] T127 [P] [US5] Write failing tests `electron-app/offline/__tests__/readGuard.test.ts`: a read that writes is refused by the guard and logged for the manifest (FR-036); sweep POS, Debts, Sessions, Services, Recharge, Expenses, Maintenance, Loto page reads; list offenders in the test header.
- [ ] T128 [US5] Fix or explicitly allow each read offender found by T127.
- [ ] T129 [P] [US5] Write failing tests `electron-app/handlers/__tests__/authHandlers.offline.test.ts`: in paired modes `auth:login`, `auth:restore-session`, `auth:logout` do their local writes in one synchronous `withWritable` block; standalone unchanged.
- [ ] T130 [US5] Implement offline sign-in bookkeeping in `electron-app/handlers/authHandlers.ts`.
- [ ] T131 [P] [G0] [US5] Write failing tests `electron-app/offline/__tests__/sender.test.ts`: uploads waiting events in seq order in batches ≤ 100 whenever reachable; marks acked/done from `/events/status`; interrupted send resumes without duplicates; `VERSION_AHEAD` keeps events; revoked key → "re-pair this PC"; re-pair (same PC number) keeps events and sequence; `UNKNOWN_CHANNEL`/`NOT_RECORDABLE` acks advance the outbox; `SEQ_CONFLICT`/`EVENT_ID_REUSED` stop sending and show on screen; the server's "renumber unsent work" instruction renumbers every unsent event above the server's max sequence, keeping event ids, and sending resumes. (FR-015, FR-001a)
- [ ] T132 [G0] [US5] Implement the sender in `electron-app/offline/syncClient.ts`.
- [ ] T133 [P] [US5] Write failing tests `electron-app/offline/__tests__/manifest.test.ts`: per `MANIFEST_KEY_TABLES`, rows in the PC's range present in the working copy; an injected unrecorded row is reported; rows created then deleted offline are not; read-write log included. (FR-035)
- [ ] T134 [US5] Implement `electron-app/offline/manifest.ts`.
- [ ] T135 [P] [G0] [US5] Write failing tests for `offline:go-offline` (needs ≥ 30 s unreachable + ready), `offline:back-to-web` (needs reachable; finishing stops new actions, finishes upload, sends manifest, moves working copy to `finished/` keeping 3, relaunches to standby), finishing → offline after 30 s unreachable, `offline:send-now`. (FR-008, FR-039)
- [ ] T136 [G0] [US5] Implement those channels in `electron-app/handlers/offlineHandlers.ts`; remove them from T009's `plannedChannels`.
- [ ] T137 [P] [US5] Write failing tests for the offline stock advisory (O-new-2): offline-mode flag makes the PC pass `allowOutOfStock: true` (core test) and the POS shows "stock count says 0 — sale recorded" (frontend test). (FR-013)
- [ ] T138 [US5] Implement the offline stock advisory (core flag + POS warning).
- [ ] T139 [P] [G0] [US5] Write failing tests `frontend/src/features/offline/components/__tests__/OfflineBanner.test.tsx` (waiting count, "Internet is back — Back to the web app", online-only refusal message) and receipt `RCP-<offline id>`.
- [ ] T140 [G0] [US5] Implement `frontend/src/features/offline/components/OfflineBanner.tsx` and the offline receipt number.
- [ ] T141 [US5] Write CI-only desktop regression spec (pins today's behaviour — not a failing-first guard) `frontend/tests/e2e-electron/lira-306-unpaired-desktop-unchanged.spec.ts` (never-paired desktop boots and sells as today). Not run on this Mac. (SC-007)

---

## Phase 9: Polish & cross-cutting

- [ ] T142 [P] Add "Offline desktop fallback (LIRA-306)" to `docs/OPERATIONS.md`: what runs where, pairing/re-keying/revoking PCs, reading the review list, processor timer and env knobs, the release rule (a desktop release with every migration), the US6 runbook (deploy + verify, pair two PCs, two-PC drill with timings, CornerTech).
- [ ] T143 [P] Add an "Offline replay" item to `docs/FEATURE_GUIDE.md` §13 (classify the channel, keep id fields id-named, write timestamps through `requestNow()`, no write outside the service).
- [ ] T144 [P] Release note lines in `docs/release-notes/UNRELEASED.md` (rule 30, FR-043): desktop app — every PC can keep working when the internet is down and sends its work when it is back; web app — "Offline work to review" page and paired PCs in Settings; past days' sales, profit and closing totals can change when a PC sends late work; in a customer's running balance offline work appears where it was sent; receipt numbers printed offline still find the sale.
- [ ] T145 Update LIRA-306 in `current_sprint.md`: status, what was built, "What users will notice:", what remains unverified or blocked.
- [ ] T146 Run all gates and record counts + elapsed (rule 28): `yarn lint`, `yarn typecheck`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, core/backend/electron/frontend jest, `yarn build`, `node scripts/build-release-notes.cjs --check`, web e2e 055/056 (record "blocked on G0" if G0 is not given) and the full web suite (SC-007).

---

## Phase 10: User Story 6 — owner-run / blocked on infrastructure (P3) — NOT done by an agent (G5)

- [ ] T147 [US6] Owner: gate G0 — approve or reject O-new-7, O-new-8 and E1; record in plan.md Complexity Tracking. (Can and should happen first; listed here because only the owner can do it.)
- [ ] T148 [US6] Owner: push to `main` (deploys web + API, runs v210) and confirm the `yarn api:deploy` verifier.
- [ ] T149 [US6] Owner: publish a desktop release with the same data version.
- [ ] T150 [US6] Owner: pair two PCs at the test shop; confirm standby "ready" on both.
- [ ] T151 [US6] Owner: two-PC outage drill per `docs/OPERATIONS.md` (network off on both, sell on both and on the phone, plant one OMT duplicate and one drawer count, reconnect PC 1 then PC 2); record SC-008 timings; the review list shows exactly the planted items.
- [ ] T152 [US6] Owner (optional, later): hosting Phase D; Litestream-based incremental copy (spikes S1/S3, needs R2 credentials).

---

## Dependencies & execution order

- T147 (G0) can be answered at any time; it blocks only `[G0]` tasks.
- Phase 1 → Phase 2 (blocks all) → US1 core (T031–T047) → US2 (Phase 4) → US3 review service (T068–T069).
- Phase 6 families run in parallel with Phases 3–5 once Phase 2 and T035 exist; T077 is written first and closes the
  phase together with T104; each family's (a) precedes its (b)(c)(d).
- `[G0]` tasks: T002–T003, T029–T030, T048–T050, T067, T070–T076, T115–T116, T119–T122, T131–T132, T135–T136, T139–T140.
- US4 server half (T111–T114) needs Phase 2 only; desktop half needs T114 (+ G0 for sync).
- US5 needs Phase 2 and US4's boot work; sender and mode channels also need G0.
- Inside every phase: test task → its implementation → story e2e run.

## Parallel opportunities

- Phase 2: T007, T009, T010, T011, T013, T015, T016, T018, T020, T022, T024, T026, T027 together once T005 lands.
- Phase 6: the (a) tasks of different families in parallel.
- US3 frontend (T072–T075) in parallel with the review service/routes.
- US4 server (T111–T114) in parallel with Phase 6.

## Implementation strategy

1. **Tonight (no owner input needed)**: Phase 2, US1 core (engine, map, time, rates, first bindings), US2 (merge,
   duplicates, outcomes), US3 review service, Phase 6 families, US4 server half — all proven with core jest.
2. **After G0**: device service + actor policy, device routes, review routes/page/PCs panel, web e2e 055/056, snapshot
   route, desktop sync/sender/mode channels.
3. US4 desktop half and US5 as code + electron jest, marked unverified.
4. Phase 10 waits for the owner.

## Task count by phase

| Phase | Tasks | Buildable + verifiable on this Mac? |
| --- | --- | --- |
| 1 Setup | 3 (T001–T003) | yes |
| 2 Foundational | 25 (T004–T028) | yes |
| 3 US1 replay | 22 (T029–T050) | core yes; T029–T030, T048–T050 after G0 (then yes, web e2e 055) |
| 4 US2 merge/duplicates | 17 (T051–T067) | yes; T067 after G0 |
| 5 US3 review | 9 (T068–T076) | review service yes; routes, page, panel, web e2e 056 after G0 |
| 6 Families, time, id order | 34 (T077–T110) | yes (core jest; T110 electron jest) |
| 7 US4 copies | 12 (T111–T122) | server half yes (route after G0); desktop half electron jest only, unverified |
| 8 US5 offline mode | 19 (T123–T141) | electron jest only, unverified |
| 9 Polish | 5 (T142–T146) | yes |
| 10 US6 owner-run | 6 (T147–T152) | no (owner / infrastructure) |
| **Total** | **152** | |

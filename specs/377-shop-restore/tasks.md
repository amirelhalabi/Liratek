---
description: "Task list for LIRA-377 Shop restore"
---

# Tasks: Restore a shop (to an earlier time, or from a backup file)

**Input**: `specs/377-shop-restore/` — plan.md, spec.md, research.md (R1–R10), data-model.md, contracts/rest.md, contracts/offline-checkin.md, quickstart.md

**Tests**: required. CLAUDE.md rule 17: every guard test is written first and run red against the unfixed code before its fix. Run single test files only (never full frontend/backend suites); full core suite `--maxWorkers=2` before any push.

**Work on `main`** in `~/Desktop/docs/Liratek`. Ask the owner before any git write or deploy beyond the ones listed as approved.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 time restore · US2 file restore · US3 undo · US4 till PCs

---

## Phase 1: Setup (gates — do first, ship alone)

**Purpose**: prove the swap mechanism on Linux and start keeping 7 days of history. Both block nothing in code, but every later phase relies on them.

- [x] T001 Linux validation of research R3 on the Fly machine, against a COPY of the Test shop (tenant 5), never `/data/tenants/*.db` itself: in `/data/restore-lab/` write a scratch `litestream.yml` with a `file:///data/restore-lab/replica` replica for `lab.db`, run `litestream replicate -config …` in the background, open `lab.db` with better-sqlite3 from `/app/node_modules`, write rows, then copy a smaller candidate INTO `lab.db` with `candidate.backup('/data/restore-lab/lab.db')`; pass = no `ERROR` lines in litestream output, new txids appear after the copy, `litestream restore` of the replica equals the candidate, and a `-timestamp` restore to before the copy equals the pre-copy contents. Record the result (commands + output) in `specs/377-shop-restore/research.md` §R3 ("Proven on Linux …" or the failure), then delete `/data/restore-lab/`. If it fails: switch the plan to the `litestream unregister` + rename alternative before Phase 2 code.
- [x] T002 [P] Add the global retention block to `backend/litestream.yml` exactly as research R1: `snapshot:` / `interval: 24h` / `retention: 192h` (one global block; per-database blocks are rejected when they differ).
- [x] T003 Deploy T002 alone with `yarn api:deploy` (approved by the owner 2026-11-10; deployed 2026-11-10 ~15:00 UTC, verifier green, backup-check all ok), then `yarn api:backup-check` → all ok, and `yarn api:logs` shows no litestream config error.
- [x] T004 Document retention (192 h ≈ 7–8 days of history, from the deploy date onward) in `docs/OPERATIONS.md` backups section.
- [ ] T005 After ≥ 24 h (2026-11-11 or later): confirm on Fly with `litestream ltx` against `tenants/1.db` that history older than 24 h is kept; note the result in `specs/377-shop-restore/research.md` §R1.

**Checkpoint**: R3 proven (or plan switched) and history accumulating.

---

## Phase 2: Foundational (blocks every story)

- [x] T006 Migration v231 in `packages/core/src/db/migrations/index.ts` (take the version from the LAST entry there, not from this file): create platform-only `shop_restores` with columns per data-model §1 — `id INTEGER PRIMARY KEY`, `target_tenant_id INTEGER NOT NULL REFERENCES tenants(id)`, `kind TEXT NOT NULL CHECK (kind IN ('time','file','undo'))`, `status TEXT NOT NULL CHECK (status IN ('prepared','running','done','failed','expired'))`, `restored_to TEXT`, `client_tz_offset_min INTEGER`, `requested_by_user_id INTEGER` (no FK), `requested_by_name TEXT`, `candidate_path TEXT`, `before_copy_path TEXT NULL`, `preview_json TEXT`, `id_floor_json TEXT`, `error TEXT NULL`, `prepared_at`, `started_at`, `finished_at`, `created_at`, `updated_at`; index `(target_tenant_id, id DESC)`; partial unique index `(target_tenant_id) WHERE status IN ('prepared','running')`. Seeds nothing. Implement `down()`.
- [x] T007 Same migration v231: rebuild `offline_review_items` to add `'restore_removed'` to its `kind` CHECK (copy rows, keep FKs to `offline_events`/`offline_devices`, recreate indexes); `down()` deletes `restore_removed` rows and restores the old CHECK.
- [x] T008 Mirror T006–T007 in `electron-app/create_db.sql` (rule 10) and bump its recorded version.
- [x] T009 [P] Add `shop_restores` to `PLATFORM_ONLY_TABLES` in `packages/core/src/db/tenantSplit.ts`; run `packages/core/src/db/__tests__/migrationsPlatformFile.guard.test.ts` → still green.
- [x] T010 [P] Add `restore_removed` to `OFFLINE_REVIEW_KINDS`, `OFFLINE_REVIEW_KIND_LABELS` ("Points at something the restore removed") and `OFFLINE_HOLDING_KINDS` in `packages/core/src/offline/reviewKinds.ts`; add en/ar labels where the review kinds are translated in the frontend i18n.
- [x] T011 [P] Schemas in `packages/core/src/validators/restore.ts`: `prepareRestoreSchema` (discriminated on `kind`: `time` → `restoredTo` ISO UTC + `clientTzOffsetMin` int; `undo` → `restoreId` int + `clientTzOffsetMin`), `confirmRestoreSchema` (`restoreId`, `typedShopName` string), `cancelRestoreSchema` (`restoreId`); export the schemas and `z.input` types from BOTH `packages/core/src/index.ts` and `packages/core/src/browser.ts` (rules 21, 29).
- [x] T012 [P] Export from `packages/core/src/db/tenantSnapshot.ts` for reuse (rule 14, no copies): `SNAPSHOT_STRIPPED_TABLES`, the secret-setting key pattern, and the step-7 "every `tenant_id` equals X" verifier; existing backup tests (`ShopBackupService` / `tenantSnapshot` tests) stay green.
- [x] T013 [P] `ShopRestoresRepository` in `packages/core/src/repositories/ShopRestoresRepository.ts`: platform-file rows via `runWithoutTenant` — `createPrepared`, `markRunning`, `markDone`, `markFailed(error)`, `markExpired`, `getOpenForTenant`, `getById`, `latestDone(tenantId)`, `listBeforeCopies(tenantId, sinceIso)`. Repository test with an in-memory platform DB, including the partial unique index refusing a second open restore.
- [x] T014 Guard test first (rule 17) in `packages/core/src/db/__tests__/tenantDatabasePool.block.test.ts`: `get(id)` on a blocked shop throws `ShopRestoringError`, which is NOT `instanceof TenantContextError`; other shops still open; `unblock` reopens. Run red.
- [x] T015 Implement `block(id)` / `unblock(id)` / `isBlocked(id)` and `ShopRestoringError` in `packages/core/src/db/tenantDatabasePool.ts` (block → `evict(id)`; evict refuses mid-transaction → block fails cleanly); T014 green.
- [x] T016 (done: passes on existing `auth.ts`, not seen failing; the async `validateSession` turns the pool throw into the existing 503 branch) Guard test first in `backend/src/middleware/__tests__/auth.shopRestoring.test.ts`: a request for a blocked shop gets HTTP 503 "please retry" with the token kept (existing `auth.ts:356-380` path), a request for another shop gets 200. Run red if it does not already pass; if it passes unchanged, say so ("passes on existing code, no fix needed").
- [x] T017 `ShopRestoreRepository` in `packages/core/src/repositories/ShopRestoreRepository.ts` (opens a candidate file BY PATH, not via the pool) — candidate preparation per data-model §3, in this order: empty `SNAPSHOT_STRIPPED_TABLES`; THEN copy the offline set (`offline_devices`, `offline_events`, `offline_id_map`, `offline_review_items`, `offline_snapshots`, `offline_outbox*`) from the current file; copy secret `system_settings` keys from the current file; copy `user_identities` rows whose `user_id` exists in the candidate; overwrite the local `tenants` mirror row from the platform row; set each `sqlite_sequence` row to `MAX(current seq, candidate seq)` and return the candidate `MAX(id)` per table before raising (`id_floor_json`).
- [x] T018 Tests first for T017 in `packages/core/src/repositories/__tests__/ShopRestoreRepository.prepare.test.ts`: sessions/tokens emptied; offline set equals the CURRENT file's (pins the "carry after strip" risk); secrets from current; Google link kept only when its user exists; `tenants` mirror from platform; every sequence ≥ pre-restore value (a new insert after prepare never reuses an id that existed in the current file). Run red, then implement T017.
- [x] T019 Preview queries in `ShopRestoreRepository`: last sale in the candidate (`at`, amount, currency, client name) and what will be lost vs the current file — counts of sales, payments, expenses, day closings after the candidate's last row, totals per currency; `youAreMissing` when the requesting user id is absent. Test in `packages/core/src/repositories/__tests__/ShopRestoreRepository.preview.test.ts` with two seeded files.
- [x] T020 `ShopRestoreService` skeleton in `packages/core/src/services/ShopRestoreService.ts` with ports (pure types, no Node built-ins — rule 29): `RestoreSourcePort` (`fetchAt(tenantId, iso|null, outPath)`), `ShopFilePort` (`migrateCandidate(path)`, `swap(tenantId, candidatePath, beforeCopyPath)`), clock-free (instants come from the request, rule 27). Methods: `points`, `prepare`, `confirm`, `cancel`; in-process `Set<number>` lock with try/finally (R10). `prepare` refuses when an open restore exists (`RESTORE_RUNNING`); `confirm` checks same admin, within 15 min (`EXPIRED`, `NOT_YOURS`), typed name equals platform `tenants.name` exactly (`NAME_MISMATCH`).
- [x] T021 Service unit tests with mocked repos/ports in `packages/core/src/services/__tests__/ShopRestoreService.test.ts`: lock, NAME_MISMATCH, EXPIRED, NOT_YOURS, failure in swap → `markFailed` and the live shop untouched (FR-012).
- [x] T022 `backend/src/restore/shopFileSwap.ts` implementing `ShopFilePort.swap`: wait until `OfflineMergeProcessor.isRunning(id)` is false and block new merge rounds → `pool.block(id)` → `VACUUM INTO /data/restore-points/<tenant>/before-<UTC stamp>.sqlite` → `candidate.backup(livePath)` (never rename over the live file, R3) → integrity check of the live file → `pool.unblock(id)`; any throw → unblock with the live file unchanged (before-copy kept). A shop whose migration failed is remembered as poisoned until restart, and `unblock` does not clear that, so call the pool's `resetPoisoned(id)` after a successful copy. Work files only under `/data` with names not ending in `.db`.
- [x] T023 `ShopFilePort.migrateCandidate` in `backend/src/restore/shopFileSwap.ts`: run migrations on the candidate path BEFORE the swap (provisioner pattern; never migrate on pool open, R5). Measure on an 11 MB copy; if > 2 s, note it and move preparation to a worker thread (plan risk).
- [x] T024 Backend integration test `backend/src/restore/__tests__/shopFileSwap.test.ts` on temp dirs: swap replaces contents, same inode; failure mid-swap leaves the live file unchanged; concurrent `get()` for the shop throws `ShopRestoringError`, another shop unaffected.
- [x] T025 Router `backend/src/api/restore.ts` mounted at `/api/restore` in `backend/src/server.ts`: `authenticateJWT` → `requireRole(["admin"])` → `validateRequest(coreSchema)`; shop = JWT tenant, actor from `req.user`; IPC-identical envelope, HTTP 200 on failure; routes `GET /points`, `POST /prepare`, `POST /confirm`, `POST /cancel` per contracts/rest.md (static paths, no `/:id`).
- [x] T026 Route tests `backend/src/api/__tests__/restore.test.ts` (supertest): unauth 401, staff 403, admin ok, schema refusals, NAME_MISMATCH envelope.
- [x] T027 After a successful swap in `ShopRestoreService.confirm`: `markDone`; audit "Shop restored to <moment>" written AFTER the swap via the shop audit path (R10); `SigninDirectoryService.syncTenant(id)`; enqueue the owner email via `getEmailOutboxRepository().enqueue` inside `runWithoutTenant` to platform `tenants.contact_email` (+ the restoring admin if different) using a new template `backend/src/email/templates/shopRestored.ts` modelled on the email-change notice; email failure never fails the restore.
- [x] T028 Expiry sweep `backend/src/services/restorePointSweep.ts`: `prepared` older than 15 min → `expired` + delete candidate; before-copies older than 7 days deleted except the newest per shop; register it with the existing backend interval/scheduler.
- [x] T029 [P] Adapter: `getRestorePoints`, `prepareRestore`, `uploadRestoreFile`, `confirmRestore`, `cancelRestore` in `frontend/src/api/backendApi.ts` (desktop branch returns `{ success:false, error:"Available on the web app" }` like `downloadShopBackup`), exposed on `frontend/src/api/ElectronApiAdapter.ts`, typed in `packages/ui/src/api/types.ts` with `z.input<…>` from `@liratek/core` (rule 21).

**Checkpoint**: candidate preparation, swap and routes work under test; stories can start.

---

## Phase 3: User Story 1 — Restore to an earlier time (P1) 🎯 MVP

**Goal**: admin picks a moment in the last 7 days, sees the preview, types the name, shop is back.

**Independent test**: Test shop — sale A, wait, sale B, restore between them → A present, B gone, other shops unchanged, re-login required, audit row and email present.

- [x] T030 [P] [US1] `backend/src/restore/litestreamSource.ts` implementing `RestoreSourcePort.fetchAt`: child process `litestream restore -o <tmp> [-timestamp <RFC3339 UTC>] "s3://$LITESTREAM_BUCKET/tenants/<id>.db?endpoint=$LITESTREAM_ENDPOINT&region=auto"` with the `LITESTREAM_*` credentials as `AWS_*` env (as `backend/docker-entrypoint.sh`); omit `-timestamp` when the moment is after the shop's last write (clamp, R2); map `timestamp does not exist` → `OUT_OF_WINDOW`, `no matching backup files available` → `NO_BACKUP_AT_TIME`. Unit test with a fake spawn in `backend/src/restore/__tests__/litestreamSource.test.ts`.
- [x] T031 [US1] `ShopRestoreService.prepare` for `kind: "time"`: refuse `restoredTo` older than 7 days, in the future (vs the request's own instant, not the server clock), or before platform `tenants.created_at` (`BEFORE_SHOP_EXISTED`); fetch → migrate → prepare (T017) → preview (T019) → `createPrepared`; any failure deletes the candidate and returns `PREPARE_FAILED`. Tests in `ShopRestoreService.test.ts`.
- [x] T032 [US1] `ShopRestoreService.points`: `earliest` = max(now − 7 days, shop creation), `latest`, `beforeCopies`, `lastRestore` from `ShopRestoresRepository`.
- [x] T033 [P] [US1] `frontend/src/features/settings/pages/Settings/ShopRestorePanel.tsx` in the existing Backup tab: date-time picker limited to `points.earliest…latest` in shop local time (sent as UTC + `clientTzOffsetMin`), Prepare → preview card (restored moment, last sale in copy, lost counts + per-currency totals, `youAreMissing` warning), typed shop-name input that enables Restore only on an exact match, Cancel; after confirm show "Restored — please sign in again" and sign out. Uses `useApi()` only; `api` read through a ref if in a dependency list (rule 25).
- [x] T034 [P] [US1] Component test `frontend/src/features/settings/pages/Settings/__tests__/ShopRestorePanel.test.tsx`: Restore disabled until the name matches; preview renders the totals; staff do not see the panel; stable `useApi` mock reference.
- [x] T035 [US1] i18n en/ar strings for the panel in the frontend locale files.
- [ ] T036 [US1] Web e2e `frontend/tests/e2e-web/lira-web-095-shop-restore-time.spec.ts`: sale A, sale B, restore between them → A present, B absent, re-login required, audit row present; assert by identity, not row position (rule 15).

**Checkpoint**: US1 shippable alone.

---

## Phase 4: User Story 2 — Restore from a backup file (P1)

**Goal**: upload a file from Settings › Backup; refused if not this shop's; otherwise same preview and confirm.

**Independent test**: download a backup of the Test shop, make a sale, upload the file, confirm → the sale is gone.

- [x] T037 [US2] Tests first in `packages/core/src/services/__tests__/ShopRestoreService.file.test.ts` for the file checks (R9): not SQLite → `NOT_A_SHOP_FILE`; failed integrity → `FILE_DAMAGED`; one `tenants` row ≠ caller → `OTHER_SHOP` with `shopName`; any `tenant_id` ≠ caller → `MIXED_SHOPS`; max `schema_migrations` > server latest → `NEWER_VERSION`; after migration, any `sqlite_master` object absent from a fresh `create_db.sql` build (e.g. a planted trigger) → `UNEXPECTED_SCHEMA_OBJECT`; older version migrates and is accepted. Run red.
- [x] T038 [US2] Implement the file checks in `ShopRestoreService.prepareFile` + `ShopRestoreRepository` (reuse the exported verifier from T012); `restored_to` = the file's build time; T037 green.
- [x] T039 [US2] `POST /api/restore/file` in `backend/src/api/restore.ts`: `express.raw({ type: "application/octet-stream", limit: "64mb" })` on this route only, gunzip when `Content-Encoding: gzip`, stage to `/data/restore-work/<tenant>-<n>.upload`, query `clientTzOffsetMin`; route tests in `backend/src/api/__tests__/restore.test.ts` (64 MB limit, staff 403, other-shop envelope).
- [x] T040 [P] [US2] Upload control in `ShopRestorePanel.tsx`: file picker, gzip with `CompressionStream` when available, plain-message errors per code (`OTHER_SHOP` shows the shop name); component test case in `ShopRestorePanel.test.tsx`.
- [ ] T041 [US2] Web e2e `frontend/tests/e2e-web/lira-web-096-shop-restore-file.spec.ts`: download backup (lira-web-094 flow), sale C, upload → C absent; a canary-shop file refused; a damaged file refused; shop data unchanged after each refusal.

**Checkpoint**: US1 + US2 work independently.

---

## Phase 5: User Story 4 — Till PCs follow the restore (P1)

**Goal**: PCs refresh within a minute; offline sales sent after a restore are booked, except ones pointing at removed records, which are held — never booked to another record.

**Independent test**: offline harness — queue an event referencing a client created after the restore point, restore, create a new client, replay → held `restore_removed`, new client untouched.

- [x] T042 [US4] Guard test FIRST (rule 17, SC-003) in `packages/core/src/offline/__tests__/ReplayEngine.restoreRemoved.test.ts`: event references client X (created after the restore point, mapped id AND a plain server id case); restore; create client Y and assert Y's id ≠ X's id (sequence raise; checked 2026-11-10: every business table in production `1.db` is AUTOINCREMENT, only `_litestream_seq` is not); replay → item held with kind `restore_removed`, details `{ restoreId, restoredTo, removed:[{table,id,label}] }`, Y untouched, nothing booked. Run red and record the failure.
- [x] T043 [US4] Hold check in `packages/core/src/offline/ReplayEngine.ts` right after `rewriteIdPositions`: for every id position (mapped and plain), if the row is missing AND the latest `done` `shop_restores` row for the shop has `finished_at` > the event's recorded time → hold `restore_removed`; otherwise today's behaviour. T042 green; existing ReplayEngine tests stay green.
- [x] T044 [US4] Check-in `restore` field in `packages/core/src/services/OfflineDeviceService.ts`: `{ id, restoredTo, restoredAt, byName } | null` from the platform `shop_restores` (latest `done`); `verifyKey` and the event routes return `SHOP_RESTORING` (not `INVALID_DEVICE_KEY`) when the pool throws `ShopRestoringError`. Today `verifyKey` (~207-213) catches every throw as `INVALID_DEVICE_KEY` and `deviceAuth.ts:50-53` sends it on, so PCs would be told to re-pair: fix both places. Test in `packages/core/src/services/__tests__/OfflineDeviceService.restore.test.ts` (failing first for the `SHOP_RESTORING` mapping).
- [x] T045 [US4] PC side in `electron-app/offline/syncClient.ts` (+ `pairingStore.ts` for the stored `restore.id`): when the check-in `restore.id` differs from the stored one, discard the mirror copies (never the working copy of a PC currently offline), `refreshCopy()` immediately, show the banner "Shop restored to <restoredTo in shop time> by <byName>" until dismissed; never reset `lastSeq`, `serverMaxSeq`, `serverMaxOfflineIds`; `SHOP_RESTORING` = retry next tick, never "re-pair". Unit test in `electron-app/offline/__tests__/syncClient.restore.test.ts` (no Electron launch on the Mac).
- [x] T046 [US4] Banner component for the PC restore notice in the frontend offline status area (desktop renderer), with en/ar strings.
- [x] T047 [US4] Apply-with-replacement in `packages/core/src/services/OfflineReviewService.ts`: for `restore_removed` items whose every removed reference is a client, `apply(itemId, { replacementClientId | walkIn })` re-runs the stored payload with that reference replaced; otherwise Apply is refused and only Dismiss is offered. Tests in `packages/core/src/services/__tests__/OfflineReviewService.restoreRemoved.test.ts` (client replaced, walk-in, product reference refused).
- [x] T048 [US4] Review list UI in `frontend/src/features/offline/…/OfflineReview`: for `restore_removed`, show the removed record's label and details; client case → client picker + "Book as walk-in"; other cases → Dismiss only with the details visible for re-entry. Component test next to it.
- [x] T049 [US4] Money check for replay after a restore (rule 18, FEATURE_GUIDE §13): read §13 and confirm in a note in this file that the hold happens before booking and no new ledger row is written by the restore; no code if confirmed.
  - **Note (2026-11-10, checked against §13):** confirmed. The `restore_removed` check (`ReplayEngine.removedByRestore`, step 3b) runs after the id rewrite and before the actor check and the booking window: no transaction is opened, the binding never runs, so no transactions / payments / drawer / debt / supplier / partner / profit row can be written for a held event (T042 asserts the binding is never called and `sales` stays empty). The restore itself writes only the platform `shop_restores` row — no shop ledger row, so §13 items 2–10 have nothing to reverse (rule 20: no new side-effect row, no reversal owner needed). Apply with a replacement re-runs the SAME binding/service as any Apply (items 4–8 and the void path are the service's own); the replacement client's id AND the name/phone the PC showed are replaced together (item 6 / rule 31), walk-in drops them so `SalesRepository` cannot re-create the removed client, and a walk-in of an on-account sale is refused by the service ("Cannot create debt for anonymous client") — `OfflineReviewService.restoreRemoved.test.ts` proves both with the real `sales:process` binding.

**Checkpoint**: SC-003 proven by T042.

---

## Phase 6: User Story 3 — Undo a restore (P2)

**Goal**: the "before restore" copy is listed first and restoring it reproduces the earlier state exactly.

**Independent test**: restore the Test shop, then restore its before-copy → same row counts and last sale as before the first restore.

- [x] T050 [US3] `ShopRestoreService.prepare` for `kind: "undo"`: source = the before-copy file of `restoreId` (same shop only, within 7 days); then the same migrate → prepare → preview path as a file restore minus the upload checks that cannot fail for our own copy (still run integrity + shop checks). Tests in `ShopRestoreService.test.ts`.
- [x] T051 [US3] Panel: list `beforeCopies` first ("Before restore — <time in shop time> by <name>") with a Restore button that uses `kind: "undo"`; component test case.
- [ ] T052 [US3] Web e2e `frontend/tests/e2e-web/lira-web-097-shop-restore-undo.spec.ts`: restore, then restore the before-copy → row counts and last sale equal the pre-restore state (SC-004).

---

## Phase 7: Polish & cross-cutting

- [ ] T053 [P] `docs/OPERATIONS.md`: restore points, `/data/restore-work/`, `/data/restore-points/`, sweep, how to restore a shop by hand if the web flow fails.
- [ ] T054 [P] Release note in `docs/release-notes/UNRELEASED.md` (Settings / Web app heading) + What's new `### Restore your shop` card in `## ✨ Highlights` with a real landscape PNG at `frontend/public/whats-new/<next version>/shop-restore.png` taken by the e2e spec; "What users will notice:" line in the LIRA-377 ticket in `current_sprint.md`; run `node scripts/build-release-notes.cjs --check` (rule 30).
- [ ] T055 `yarn typecheck` and `yarn lint`; full core suite `--maxWorkers=2`; affected backend/frontend test files only.
- [ ] T056 Production check on the Test shop (tenant 5) after deploy, quickstart §4: backup-check ok → two sales 2 min apart → restore between them → backup-check within 5 min ok (SC-007) → restore the before-copy → second sale back → no `level=ERROR` litestream lines for `5.db`. Measure the block time on the 11 MB shop copy (SC-002 < 15 s).

---

## Dependencies & execution order

- **Phase 1** first: T001 gates T022 (swap design); T002→T003→T005 sequence; T004 any time.
- **Phase 2** after T001: T006→T007→T008; T009–T013 [P] after T006; T014→T015; T018→T017→T019; T020/T021 after T013+T017; T022–T024 after T015; T025–T028 after T020; T029 any time after T011.
- **US1** (Phase 3) after Phase 2 — MVP.
- **US2** after Phase 2; independent of US1 except sharing the panel file (do T040 after T033).
- **US4** after Phase 2 (needs `shop_restores` + swap); independent of US1/US2 UI.
- **US3** after US1 (reuses the panel and the before-copy written by every swap).
- **Polish** last.

## Parallel examples

- Phase 2 after T006: T009, T010, T011, T012, T013 together (different files).
- US1: T030 (backend source) alongside T033 + T034 (frontend panel).
- US4: T044 (core check-in) alongside T045 (PC side) once T042/T043 are done.

## Implementation strategy

1. Phase 1 now: T001 Linux check + T002/T003 retention deploy (history starts accumulating today).
2. Phase 2 + US1 → MVP: time restore on the web, verified on the Test shop.
3. US2 file restore, then US4 till PCs. The server-side hold (T042–T043) and `SHOP_RESTORING` (T044) must be merged before restore is exposed to any shop with paired PCs: until then T031 refused a restore for a shop with paired devices (guard removed 2026-11-10 once T042–T044 were built). The guard does NOT wait for T045 (PC side), because PCs keep old desktop builds for a while. Checked 2026-11-10: an old PC treats an unknown error code (`SHOP_RESTORING`) as a plain refusal and tries again on the next tick (`sender.ts` `stopWith`, `syncClient.ts` check-in), never as "re-pair". It ignores the new `restore` field and refreshes its copy on the normal 5-minute timer. So old PCs are safe, only slower to show the restored shop.
4. US3 undo, polish, release note, production check.

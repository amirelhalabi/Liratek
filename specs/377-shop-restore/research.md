# Research: Shop restore (LIRA-377)

Gathered 2026-11-10. Evidence tiers: **Proven** = run locally or in production;
**Read** = traced in source with file:line; **Likely** = inferred, test before relying.

## R1 — How far back can a shop be restored today, and how to get 7 days

- **Decision:** add one global block to `backend/litestream.yml`:
  ```yaml
  snapshot:
    interval: 24h
    retention: 192h
  ```
- **Rationale:**
  - Proven in R2 (2026-11-10): every prefix keeps ~24 h (the frozen `web/liratek` starts 2026-11-08 22:34 although it replicated since 2026-09-09). Litestream 0.5 defaults are `interval 24h / retention 24h`.
  - Read (litestream v0.5.17 `store.go:835`, `db.go:2952`): retention deletes snapshots older than `retention`, then prunes L1–L3 below the last deleted snapshot, so the restorable window moves between `retention − interval` and `retention`. 168 h could give only 6 days; 192 h guarantees ≥ 7.
  - Read (`cmd/litestream/main.go:356-389`): per-database `snapshot` values are lifted process-wide and conflicting values are a startup error, so ONE global block covers the `path:` (platform) and `dir:` (shops) entries.
  - Proven locally with 10 s / 25 s settings: pruning behaves as described.
- **Cost (Likely):** CornerTech wrote ~40 MB of LTX in 11 h today (R2 listing); with compaction, 8 days stays under ~1 GB per shop. Assumption (unverified, as of training): R2 storage ≈ $0.015/GB-month with 10 GB free per account.
- **Alternatives:** 168 h (can dip to 6 days); per-database blocks (rejected by Litestream when they differ).

## R2 — Point-in-time restore command

- **Decision:** `litestream restore -o <tmp> -timestamp <RFC3339 UTC> "s3://$LITESTREAM_BUCKET/tenants/<id>.db?endpoint=…&region=auto"`; omit `-timestamp` when the chosen moment is after the shop's last write.
- **Rationale (Proven locally, 0.5.17 darwin-arm64, `file://` replica):**
  - Restores every LTX file uploaded strictly before T (upload time, not commit time). Precision: within ~30 s once L0 files age out after 5 min (Likely, from source).
  - Before the window → `Error: timestamp does not exist`; inside the window but before the oldest kept snapshot → `Error: no matching backup files available`.
  - A time after the last write (idle shop, "now") also errors `timestamp does not exist` → the service clamps.
  - The preview is computed from the restored file, so the ~30 s granularity is shown truthfully ("last sale in this copy: 14:52").
- **Alternatives:** `-txid` (needs a txid↔time index the app does not have).

## R3 — Putting restored data into the live shop file

- **Decision:** never rename a file over the live `/data/tenants/<id>.db`. Close the shop's pooled connection, then copy the prepared candidate INTO the live file with SQLite's online backup API (better-sqlite3 `candidate.backup(livePath)`), then reopen.
- **Rationale:**
  - Proven locally: `os.replace` over a watched `1.db` (+ deleting -wal/-shm) logs `ERROR unregister database from store … open wal file: no such file` and replication then stops silently while the process lives (`store.go:368`, `directory_watcher.go:330`). Same family as the 2026-11-10 platform stall in production.
  - Proven locally: an in-place backup copy keeps the same inode and prefix (txid 8 → 9), handles shrinking (1,675 pages → 2), and `-integrity-check full` passes. Pre-restore history stays restorable from the same prefix.
  - Likely (not tested on Linux): no rename means inotify vs kqueue does not matter.
  - **Proven on Linux (Fly machine, 2026-11-10 14:55 UTC, task T001):** a copy of the Test shop (`5.db`) padded to 12.6 MB, replicated by a separate `litestream replicate` (0.5.17, `file://` replica, own config in `/data/restore-lab/`). A shrunk candidate was copied INTO the watched file with better-sqlite3 `candidate.backup(livePath)`: 6 ms, live file `integrity_check` ok, journal mode stays `wal`, no ERROR/WARN in Litestream output. The copy appeared as txid 3 and a write after it as txid 4 (replication kept going). `litestream restore` latest = candidate + post-copy row; `-timestamp` to 4 s before the copy = the pre-copy contents (padding included). Lab deleted afterwards.
  - Not covered by T001: the production process watches shops through a `dir:` entry (directory watcher), not a `path:` entry. The in-place copy creates and deletes no file, so the watcher should see nothing to react to. Likely, not proven; the production check (T056) confirms it with `yarn api:backup-check` after a real restore.
- **Alternatives:** `litestream unregister` over the control socket then rename (works locally, adds a second moving part); restart the whole process (stops every shop).

## R4 — The "before restore" copy

- **Decision:** a separate `VACUUM INTO /data/restore-points/<id>/before-<UTC stamp>.sqlite` taken inside the swap, kept 7 days, newest always kept. Restoring it uses the same path as a file restore minus the upload.
- **Rationale:** Litestream history ages out after 8 days, and compaction may merge the last pre-restore change with the restore itself (Likely, source), which would break SC-004's "exactly". `.sqlite` + a directory outside `/data/tenants` keeps it out of the shop lister (`^[1-9]\d*\.db$`) and Litestream's `*.db` pattern.
- **Alternatives:** relying on Litestream history only (rejected above).

## R5 — Swapping one shop without touching the others

- **Decision:** add a `blocked` set to `TenantDatabasePool`: `block(id)` → `evict(id)` → swap → `unblock(id)`. `get(id)` on a blocked id throws `ShopRestoringError` (NOT a `TenantContextError`).
- **Rationale (Read):**
  - `evict` (`tenantDatabasePool.ts:233-259`) checkpoints and closes, refuses mid-transaction; there is no paused state, the next `get()` reopens.
  - A `TenantContextError` routes to the PLATFORM file (`tenantDbResolver.ts:55`) — a restoring error must not extend it.
  - Any other throw during session validation is already HTTP 503 "please retry" with the token kept (`auth.ts:356-380`) — the few-seconds pause comes for free on the web.
  - Device routes turn any throw into `INVALID_DEVICE_KEY` → "re-pair" on the PC (`OfflineDeviceService.ts:206-216`, `sender.ts:167`) — needs its own `SHOP_RESTORING` code.
  - Offline replay awaits inside a manual transaction (`ReplayEngine.ts:262-290`): the restore waits for `OfflineMergeProcessor.isRunning(id)` to clear and blocks new rounds.
  - A migration failure on open poisons the shop until restart (`tenantDatabasePool.ts:121-134`) → migrate the candidate BEFORE the swap (provisioner pattern), never on open.
  - Work files live on `/data` (rename across filesystems fails, `fly.toml:41-43`) with names not ending in `.db`.

## R6 — Sessions, tokens and platform data after a restore

- **Decision:** before the swap, empty in the candidate the same tables Download backup strips (`SNAPSHOT_STRIPPED_TABLES`, `tenantSnapshot.ts:56-68`), except `user_identities` and secret settings (R8). After the swap run `SigninDirectoryService.syncTenant(id)` and overwrite the candidate's local `tenants` mirror row from the platform row (FR-003).
- **Rationale:** every request checks a `sessions` row in the shop file (`auth.ts:189-199`); a point-in-time copy brings back the sessions alive at T. There is no platform counter to bump (`auth.ts:73-76`). One list, reused (rule 14).

## R7 — Till PCs and offline replay

- **Decision:**
  1. **Carry the current offline state into the candidate as one set**: `offline_devices`, `offline_events`, `offline_id_map`, `offline_review_items`, `offline_snapshots`, `offline_outbox*`.
  2. **Raise every table's `sqlite_sequence` in the candidate to its pre-restore value** (`raiseSequenceFloor` precedent, provisioner). Ids are then never reissued, so "Rami's #503 becomes Hadi's" is impossible, not merely detected.
  3. **Hold check in ONE place**, `ReplayEngine.ts:228-246`, right after `rewriteIdPositions`: for every id position (mapped and plain — plain server ids pass through untouched, `idPositions.ts:117`), if the referenced row does not exist AND a restore happened after the event was recorded, hold with the new kind `restore_removed`.
  4. **Tell PCs** via a new `restore` field in the check-in response, read from the platform file (survives the swap): `{ id, restoredTo, restoredAt, byName } | null`. A PC whose stored id differs discards its copy, refreshes at once, shows the banner. PC counters (`lastSeq`, `serverMaxSeq`, `serverMaxOfflineIds`, `pairingStore.ts:41-44`) are never reset.
- **Rationale (Read):** rewinding `offline_devices` would freeze the merge for good (cursor `next_expected_seq` back at T, acked events never resent — `OfflineMergeProcessor.ts:167-187`), re-enable PCs unpaired after T, and a file restore would unpair every PC. The id map is server-side only (`OfflineIdMapRepository.ts`).
- **Spec fix:** FR-019 "discard its list of numbers" → the PC discards its copy; the server-side map is carried and checked (applied in spec.md).
- **"Apply after choosing a replacement":** new; `apply()` today replays the stored payload unchanged (`OfflineReviewService.ts:208-229`). v1 supports replacing a **client** reference (pick another client or walk-in); other removed references (product, supplier, …) offer Dismiss only, with the item's details shown so the cashier can re-enter it.

## R8 — What a restore carries over from the current file

- **Decision (owner, 2026-11-10):** carried from the CURRENT file into the candidate: the offline set (R7), secret integration settings (`system_settings` keys matching the backup's secret pattern), `user_identities` rows whose user exists in the candidate, and the platform-owned `tenants` mirror row. Never carried: sessions and one-time tokens (emptied).
- **Rationale:** a backup file deletes integration keys (`tenantSnapshot.ts:101`); without carry-over a file restore silently breaks WhatsApp/SMS/etc. integrations. Google links stripped from a backup file would unlink Google sign-in.

## R9 — Uploading a backup file

- **Decision:** `POST /api/restore/file` with `express.raw({ type: "application/octet-stream", limit: "64mb" })` on that route only, body optionally gzip (`Content-Encoding: gzip`, browser `CompressionStream`), through the normal `/api` (Vercel) path.
- **Rationale:** Proven 2026-11-10: 3, 5 and 12 MB POSTs to `https://test.liratek.shop/api/…` reached the Fly app (Express 404 page), no Vercel 413. Express JSON limit is 10 MB and there is no raw parser today (`server.ts:94-96`).
- **Untrusted file checks:** integrity check; exactly one `tenants` row equal to the caller's shop; every `tenant_id` column equals it (reuse the backup builder's step-7 verifier); max `schema_migrations` ≤ server latest; after migration, every `sqlite_master` object must exist in a fresh `create_db.sql` build (refuses planted triggers/views).
- **SQLCipher:** Proven 2026-11-10: production shop files are plain SQLite (`SQLite format 3` header on `/data/tenants/1.db`); the `DATABASE_KEY` secret exists but stock better-sqlite3 ignores it. A future keyed production would need a re-key step on import.

## R10 — Audit, email, one-at-a-time

- **Audit:** `auditRest` writes to the shop file (`audit.ts:39-51`) → write AFTER the swap; the durable record is a platform `shop_restores` row.
- **Email:** `getEmailOutboxRepository().enqueue(…)` inside `runWithoutTenant` (outbox is platform-only); template modelled on the email-change notice (`UserEmailService.ts:434-448`); address from the platform `tenants.contact_email`.
- **Lock:** in-process `Set<number>` with try/finally (one Fly machine), modelled on `OfflineMergeProcessor.ts:76-139`; the pool and merge processor honour it.

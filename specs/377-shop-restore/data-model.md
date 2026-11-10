# Data model: Shop restore (LIRA-377)

One new migration (next version after the last entry in `packages/core/src/db/migrations/index.ts`, v230 today → **v231**), mirrored in `electron-app/create_db.sql` (rule 10). All tables carry `id`, `created_at`, `updated_at` (rule 5).

## 1. `shop_restores` — PLATFORM-only

The durable record of every restore. Lives in the platform file because the shop file is the thing being replaced (an audit row written before the swap would be lost; the PC check-in needs a value that survives the swap).

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | also the restore **epoch** the PCs compare |
| `target_tenant_id` | INTEGER NOT NULL → `tenants.id` | named `target_tenant_id`, NOT `tenant_id`, so the split tool and the platform-split guard never count it as shop data (same as `signin_directory`) |
| `kind` | TEXT CHECK IN (`time`,`file`,`undo`) | `undo` = restoring a "before restore" copy |
| `status` | TEXT CHECK IN (`prepared`,`running`,`done`,`failed`,`expired`) | |
| `restored_to` | TEXT | UTC ISO instant the shop now reflects: chosen time, file's build time, or the before-restore copy's time |
| `client_tz_offset_min` | INTEGER | browser offset, for showing `restored_to` in shop time (rule 27) |
| `requested_by_user_id` | INTEGER | shop user id (no FK: shop users live in the shop file) |
| `requested_by_name` | TEXT | snapshot "as at restore time" (rule 31) |
| `candidate_path` | TEXT | `/data/restore-work/<id>-<restoreId>.candidate` while prepared |
| `before_copy_path` | TEXT NULL | `/data/restore-points/<tenant>/before-<stamp>.sqlite` once taken |
| `preview_json` | TEXT | the preview shown (FR-008): last sale in copy, counts and per-currency totals that will be lost |
| `id_floor_json` | TEXT | per table: candidate `MAX(id)` before sequences were raised — used by FR-021 diagnostics |
| `error` | TEXT NULL | plain message on `failed` |
| `prepared_at`, `started_at`, `finished_at` | TEXT | |
| `created_at`, `updated_at` | TEXT | |

Indexes: `(target_tenant_id, id DESC)`; partial unique `(target_tenant_id) WHERE status IN ('prepared','running')` — at most one open restore per shop (FR-011) in addition to the in-process lock.

Registered in `PLATFORM_ONLY_TABLES` (`packages/core/src/db/tenantSplit.ts`). The platform-file migration guard (`migrationsPlatformFile.guard.test.ts`) must stay green: v231 seeds nothing.

State transitions: `prepared → running → done | failed`; `prepared → expired` (not confirmed within 15 min, candidate deleted).

## 2. `offline_review_items.kind` — one new value

`restore_removed` — "Points at something the restore removed". Holding kind (Apply/Dismiss). Requires rebuilding `offline_review_items` in v231 (SQLite cannot alter a CHECK; FKs to `offline_events`/`offline_devices`), plus `OFFLINE_REVIEW_KINDS`, `OFFLINE_REVIEW_KIND_LABELS`, `OFFLINE_HOLDING_KINDS` in `packages/core/src/offline/reviewKinds.ts`.

Item `details_json` for this kind: `{ restoreId, restoredTo, removed: [{ table, id, label }] }` (label = the name the PC showed, from the event payload, so the owner knows "Rami").

## 3. No new shop-file tables

The shop file gains nothing. A restore changes WHICH rows are in it:

| Part of the candidate | Source |
|---|---|
| Business data | the chosen moment (Litestream) / the uploaded file / the before-restore copy |
| `sessions`, `idempotency_keys`, `user_invitations`, `password_reset_tokens`, `email_verification_tokens`, `sync_queue`, `sync_errors` | emptied (the backup's `SNAPSHOT_STRIPPED_TABLES`, minus the two carried rows below) |
| `offline_devices`, `offline_events`, `offline_id_map`, `offline_review_items`, `offline_snapshots`, `offline_outbox*` | copied from the CURRENT file as one set (R7) |
| secret `system_settings` keys (backup's secret pattern) | copied from the CURRENT file (R8, owner to confirm) |
| `user_identities` | current rows whose `user_id` exists in the candidate |
| `tenants` (local mirror, one row) | overwritten from the platform row (FR-003) |
| `tenant_subscriptions` | none (shop files hold none) |
| `sqlite_sequence` | per table `MAX(current seq, candidate seq)` — ids never reissued |

## 4. Files on the volume

| Path | What | Lifetime |
|---|---|---|
| `/data/restore-work/<tenant>-<restoreId>.candidate` | prepared candidate (+ upload staging `.upload`) | deleted on confirm, expiry (15 min) or failure |
| `/data/restore-points/<tenant>/before-<UTC stamp>.sqlite` | before-restore copy (`VACUUM INTO`) | 7 days; newest per shop always kept |

Neither ends in `.db` and neither is under `/data/tenants/`, so the shop lister and Litestream ignore them.

## 5. Validation rules (from the spec)

- Time restore: `restored_to` within the last 7 days, not in the future, not before the shop's `tenants.created_at` (FR-004, edge cases).
- File restore: FR-006 checks (integrity, one shop = caller's shop, every `tenant_id` = caller's, schema ≤ server, after migration no `sqlite_master` object outside a fresh `create_db.sql` build).
- Confirm: typed name equals the platform `tenants.name` exactly (FR-009), checked server-side; caller is the same admin who prepared, within 15 min.

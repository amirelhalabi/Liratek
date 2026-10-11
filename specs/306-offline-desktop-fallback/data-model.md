# Data model — LIRA-306 (events redesign)

One migration, **v210 `offline_events_model`** (last entry in `packages/core/src/db/migrations/index.ts` is v209,
verified 2026-10-11 — re-check before writing; take the next free number). Same DDL in `electron-app/create_db.sql`
(rule 10). Every table has `id INTEGER PRIMARY KEY AUTOINCREMENT`, `tenant_id INTEGER NOT NULL REFERENCES tenants(id)
ON DELETE CASCADE`, `created_at`, `updated_at` (TEXT, UTC ISO written by code). All tables exist in both schemas
(schema-equivalence); server-only tables stay empty on PCs and vice versa. None of the new tables is in
`OFFLINE_ID_TABLES`; they are listed in `OFFLINE_ID_EXCLUDED_TABLES`, which the id-range guard checks (they are never
written by replayed business actions on the server; the PC's outbox tables are local bookkeeping and excluded from the
manifest).

## Server-side tables

### offline_devices

| Column | Type | Rule |
| --- | --- | --- |
| device_no | INTEGER NOT NULL | PC number, 1–9006, `MAX(device_no)+1` per tenant at pairing; UNIQUE(tenant_id, device_no); never reused (revoked rows kept) |
| name | TEXT NOT NULL | 1–80 chars |
| key_id | TEXT NOT NULL UNIQUE | 12 lowercase hex |
| key_hash | TEXT NOT NULL | hex sha256 of the secret |
| paired_by | INTEGER NOT NULL | users.id |
| paired_at | TEXT NOT NULL | |
| revoked_at, revoked_by | TEXT NULL, INTEGER NULL | non-null = inactive |
| last_seen_at | TEXT NULL | server receipt time of last check-in/upload |
| last_state | TEXT NULL | CHECK IN ('standby','blocked','offline','finishing') |
| last_pending_count | INTEGER NOT NULL DEFAULT 0 | ≥ 0 |
| last_app_version, last_schema_version | TEXT NULL, INTEGER NULL | |
| last_skew_ms | INTEGER NULL | server receipt − PC clock, last check-in |
| last_online_skew_ms | INTEGER NULL | skew of the last check-in while state = standby (pre-outage reference) |
| next_expected_seq | INTEGER NOT NULL DEFAULT 1 | merge cursor |

### offline_snapshots

| Column | Type | Rule |
| --- | --- | --- |
| copy_id | TEXT NOT NULL UNIQUE | UUID, also written into the copy (`offline_copy_meta`) |
| device_id | INTEGER NULL FK offline_devices | first device served (copies are shared per tenant within 5 min) |
| schema_version | INTEGER NOT NULL | |
| built_at | TEXT NOT NULL | |
| high_water_json | TEXT NOT NULL | `{ table: maxId }` for every table in `OFFLINE_ID_TABLES` |

Kept 30 days after the last event that references the copy (swept by the processor timer).

### offline_events

| Column | Type | Rule |
| --- | --- | --- |
| device_id | INTEGER NOT NULL FK | |
| event_id | TEXT NOT NULL | UUID v4; UNIQUE(tenant_id, event_id) |
| device_seq | INTEGER NOT NULL | ≥ 1; UNIQUE(tenant_id, device_id, device_seq) |
| channel | TEXT NOT NULL | `offline`/`checkpoint` class in `channelPolicy`, or stored `refused` (unknown / non-recordable) |
| payload_json | TEXT NOT NULL | named payload as recorded |
| payload_hash | TEXT NOT NULL | sha256 of payload_json + channel + actor + occurred_at (reuse check) |
| actor_user_id | INTEGER NOT NULL | |
| occurred_at | TEXT NOT NULL | PC instant (UTC ISO) |
| corrected_at | TEXT NULL | after skew correction (R5) |
| client_day | TEXT NOT NULL | `YYYY-MM-DD` |
| client_tz_offset_minutes | INTEGER NOT NULL | −720…840 |
| copy_id | TEXT NOT NULL | FK by value to offline_snapshots.copy_id |
| app_version | TEXT NOT NULL | |
| schema_version | INTEGER NOT NULL | |
| schema_shape_json | TEXT NOT NULL | the channel's core schema shape: keys, types, optional, defaults (R9) |
| rates_json | TEXT NOT NULL | exchange rates in force on the PC at the action (R11, O-new-24) |
| created_json | TEXT NOT NULL | `{ table: [offlineIds] }` |
| depends_on_json | TEXT NOT NULL | `[eventId]` |
| status | TEXT NOT NULL | CHECK IN ('received','booked','skipped','held','refused','applied','dismissed') |
| attempts | INTEGER NOT NULL DEFAULT 0 | technical retries (max 5) |
| result_json | TEXT NULL | binding result envelope + created server ids |
| error | TEXT NULL | refusal / hold reason (plain words) |
| processed_at | TEXT NULL | |
| resolved_by, resolved_at | INTEGER NULL, TEXT NULL | review actions |

Indexes: (tenant_id, status); (tenant_id, device_id, device_seq). Never swept (audit trail).

**Status transitions**:

| From | Trigger | To |
| --- | --- | --- |
| (upload) | content unacceptable (unknown / non-recordable channel) | `refused` (stored so the sequence stays gap-free) |
| `received` | processed | `booked` \| `skipped` (certain dup) \| `held` (likely dup, checkpoint, waiting) \| `refused` |
| `received` | technical error | `received`, `attempts+1`; at 5 → `refused` |
| `held` / `refused` | Apply succeeds | `applied` |
| `held` / `refused` | Apply refused again by the service | unchanged status, new `error`, review item stays `open` |
| `held` / `refused` | Apply on a refused item finds a likely duplicate | `held` (`possible_duplicate`) |
| `held` / `refused` | Dismiss | `dismissed` |
| `skipped` | Mark reviewed | stays `skipped` (rows linked to the matching rows; review item `reviewed`) |
| `skipped` | Book anyway | `applied` |
| version refusal | Apply | not offered |

`booked`, `applied`, `dismissed` are final.

### offline_id_map

| Column | Type | Rule |
| --- | --- | --- |
| offline_id | INTEGER NOT NULL | ≥ 10¹²; UNIQUE(tenant_id, offline_id) |
| device_id | INTEGER NOT NULL FK | must equal `decode(offline_id).pc` device |
| table_name | TEXT NOT NULL | must equal `OFFLINE_ID_TABLES[decode(offline_id).table]` |
| server_id | INTEGER NOT NULL | < 10¹² |
| event_id | TEXT NOT NULL | creating event |
| link_kind | TEXT NOT NULL | CHECK IN ('created','linked_existing') — `linked_existing` for O-new-4 customers and duplicate links |

Never swept (receipt aliases, FR-040).

### offline_review_items

| Column | Type | Rule |
| --- | --- | --- |
| event_row_id | INTEGER NULL FK offline_events(id) | null only for `pc_data_mismatch` |
| device_id | INTEGER NOT NULL FK | |
| kind | TEXT NOT NULL | CHECK IN ('possible_duplicate','certain_duplicate','held_checkpoint','waiting','refused','stock_count_off','ticks_dropped','customer_linked','clock_corrected','closed_day_changed','came_out_differently','user_switched_off','pc_data_mismatch','rate_changed') |
| state | TEXT NOT NULL DEFAULT 'open' | CHECK IN ('open','applied','dismissed','reviewed') |
| details_json | TEXT NOT NULL | e.g. matching row ids, products, day, table counts |
| resolved_by, resolved_at | INTEGER NULL, TEXT NULL | |

Index (tenant_id, state, kind).

## PC-side tables (inside the working copy; exist on the server too, unused there)

### offline_outbox

Same columns as `offline_events` minus server-only ones (`corrected_at`, `processed_at`, `resolved_*`), plus
`delivery` CHECK IN ('waiting','acked','done') and `server_status` (copy of the server outcome), `attempts`,
`last_error`. Order of `device_seq` = recording order; the next `device_seq` is `MAX(device_seq)+1` read inside the
write transaction, raised to `pairing.json.lastSeq` and the server's `maxSeq` from check-in when those are higher
(next = max of the three + 1). SQL in core
`OfflineOutboxRepository` (rule 13).

### offline_outbox_created

| Column | Type | Rule |
| --- | --- | --- |
| offline_id | INTEGER NOT NULL UNIQUE | |
| table_name | TEXT NOT NULL | |
| event_id | TEXT NOT NULL | used to compute `depends_on` |

### offline_copy_meta

One row: `copy_id`, `built_at`, `schema_version`, `high_water_json`, `device_no` (set at go-offline), `opened_at`.

## Id layout (O-new-1)

`offlineId = P × 10¹² + T × 10⁹ + n`; P = device_no (1…9006), T = index into `OFFLINE_ID_TABLES` (0…999, append-only;
guard: every AUTOINCREMENT table of `create_db.sql` is listed, no entry removed or reordered), n = 1…999 999 999.
`isOfflineId(v) = Number.isSafeInteger(v) && v ≥ 10¹²`. Server ids < 10¹² (startup assertion over `sqlite_sequence`).
Seeding at go-offline: `seq(T) = P·10¹² + T·10⁹ + lastUsed[P][T]`, `lastUsed` = max of `pairing.json`, finished
copies, and the server's per-(PC, table) maximum from check-in. An existing working copy is resumed, never re-seeded.

## Classification lists

- `packages/core/src/constants/resetTables.ts`: `offline_devices`, `offline_snapshots`, `offline_events` excluded from
  Settings › Reset Data (a reset must not unpair PCs or erase the audit of what was replayed); `offline_id_map` and
  `offline_review_items` are wiped with the business rows (server ids they point at no longer exist and may be
  reused); `offline_outbox`, `offline_outbox_created`, `offline_copy_meta` wiped.
- `SNAPSHOT_STRIPPED_TABLES`: all `offline_*` tables, `idempotency_keys`, sessions/tokens/codes/invitations/identities
  (superseded design's guards kept); `tenant_subscriptions.license_key` nulled; secret `system_settings` keys deleted.
- `MAP_EXCLUDED_TABLES` (row capture comparison): audit/activity/session tables (named list, guard-tested).
- `MANIFEST_KEY_TABLES` (N5): every `OFFLINE_ID_TABLES` entry minus `MAP_EXCLUDED_TABLES`.

## PC files

```
<userData>/offline/
├── pairing.json        { tenantId, shopSlug, serverUrl, deviceNo, deviceKeyEncrypted, mode, lastSeq,
│                         lastUsedIds{T:n}, copyId?, lastSnapshotAt?, schemaVersion? }
├── mirror-<ts>.db      newest 2 verified copies; never written
├── offline-work.db     working copy + outbox; exists from go-offline until finishing completes
└── finished/offline-work-<ts>.db   newest 3 kept
```

## State machines

- PC modes: plan §B (`standalone`, `standby`, `blocked`, `offline`, `finishing`); `finishing → offline` after 30 s
  unreachable; boot with an existing working copy → `offline`.
- Event status: above. Review item: `open → applied | dismissed | reviewed` (final).

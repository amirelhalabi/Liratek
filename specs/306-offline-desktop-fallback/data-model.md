# Data model — LIRA-306

One migration, **v210 `offline_desktop_fallback`** (the last entry in `packages/core/src/db/migrations/index.ts` is v209,
verified 2026-10-11 — re-check before writing). Same DDL in `electron-app/create_db.sql` (rule 10). All three tables are
tenant-scoped (`tenant_id NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`), so `splitTenantDatabase` moves them into
shop files automatically and `yarn check:tenant-scoping` applies. All timestamps are UTC ISO-8601 text written by the
code (never `CURRENT_TIMESTAMP` defaults for the business times), matching `idempotency_keys`.

## offline_devices (server side; exists on desktops too, unused there)

| Column | Type | Rule |
| --- | --- | --- |
| id | INTEGER PK AUTOINCREMENT | |
| tenant_id | INTEGER NOT NULL FK tenants | |
| name | TEXT NOT NULL | 1–80 chars, from the pairing form |
| key_id | TEXT NOT NULL | 12 lowercase hex, unique (`idx_offline_devices_key_id` UNIQUE) |
| key_hash | TEXT NOT NULL | hex sha256 of the secret part; the secret is never stored |
| paired_by | INTEGER NOT NULL | users.id of the admin who paired |
| paired_at | TEXT NOT NULL | |
| revoked_at | TEXT NULL | non-null = inactive |
| revoked_by | INTEGER NULL | |
| last_heartbeat_at | TEXT NULL | server time on receipt of the last check-in |
| last_state | TEXT NULL | CHECK `last_state IN ('standby','offline','sending')` |
| last_pending_count | INTEGER NOT NULL DEFAULT 0 | ≥ 0 |
| last_goodbye_at | TEXT NULL | server time on receipt of a goodbye (a goodbye is never counted as a check-in) |
| last_ready | INTEGER NOT NULL DEFAULT 1 | readiness reported in the last check-in; a silent device whose last report was 0 does not lock (M13) |
| last_closed_period_id | TEXT NULL | the last completed period id; a message for it never reopens a period (its ops are held) |
| current_period_id | TEXT NULL | UUID of the open offline period, null when none |
| period_started_at | TEXT NULL | `min(desktop-reported start clamped to ≤ receipt time, COALESCE(tenant-wide latest check-in before the period's first message, paired_at))` (R8) |
| period_opened_at | TEXT NULL | server receipt time of the period's first message; the offline/sending lock's `since` (R6) |
| last_web_write_at | TEXT NULL | server time of the last web/phone write the gate let through for this tenant, or of a forced replacement/revoke during an open period (FR-009a); the review rule reads `MAX()` over all the tenant's rows |
| lock_released_at | TEXT NULL | server time of the last admin Unlock |
| lock_released_by | INTEGER NULL | users.id |
| created_at, updated_at | TEXT NOT NULL | |

Indexes: `idx_offline_devices_key_id` UNIQUE(key_id); `idx_offline_devices_one_active` UNIQUE(tenant_id) WHERE
`revoked_at IS NULL` (O5).

## offline_replay_ops (server side)

| Column | Type | Rule |
| --- | --- | --- |
| id | INTEGER PK AUTOINCREMENT | |
| tenant_id | INTEGER NOT NULL FK tenants | |
| device_id | INTEGER NOT NULL FK offline_devices(id) | |
| op_key | TEXT NOT NULL | UUID v4 (`/^[0-9a-f-]{36}$/`), generated on the desktop |
| operation | TEXT NOT NULL | one of the registry names: `sales.process`, `expenses.create`, `debts.addRepayment` |
| payload_json | TEXT NOT NULL | the core-schema-parsed payload (R3) |
| actor_user_id | INTEGER NOT NULL | the user who recorded it offline |
| occurred_at | TEXT NOT NULL | UTC ISO instant on the desktop |
| client_day | TEXT NOT NULL | `YYYY-MM-DD` (browser-safe `clientDayInputSchema`, `validators/common.ts`) |
| client_tz_offset_minutes | INTEGER NOT NULL | minutes to add to UTC (Beirut = 180) |
| period_id | TEXT NOT NULL | UUID |
| status | TEXT NOT NULL | CHECK `status IN ('booked','refused','held','dismissed')` |
| result_json | TEXT NULL | the service's success envelope for `booked` (e.g. `{ success:true, id }`) |
| error | TEXT NULL | reason for `refused` / `held` |
| resolved_by | INTEGER NULL | admin who applied or dismissed from the review list |
| resolved_at | TEXT NULL | |
| created_at, updated_at | TEXT NOT NULL | |

Indexes: `idx_offline_replay_ops_key` UNIQUE(tenant_id, op_key); `idx_offline_replay_ops_status`(tenant_id, status).
Never swept (audit trail of offline work).

**Status transitions**: new → `booked` | `refused` | `held`. From the review list: `refused`/`held` → `booked` (Apply
succeeded) or stays with a new `error` (Apply refused again); `refused`/`held` → `dismissed` (Dismiss). `booked` and
`dismissed` are final.

## offline_outbox (desktop side, inside `offline-work.db`; exists on the server too, unused there)

| Column | Type | Rule |
| --- | --- | --- |
| id | INTEGER PK AUTOINCREMENT | local order of recording = replay order |
| tenant_id | INTEGER NOT NULL FK tenants | the copy's own tenant id |
| op_key | TEXT NOT NULL UNIQUE | UUID v4 |
| operation | TEXT NOT NULL | registry name |
| payload_json | TEXT NOT NULL | core-schema-parsed payload |
| actor_user_id | INTEGER NOT NULL | |
| occurred_at | TEXT NOT NULL | |
| client_day | TEXT NOT NULL | |
| client_tz_offset_minutes | INTEGER NOT NULL | |
| period_id | TEXT NOT NULL | |
| status | TEXT NOT NULL DEFAULT 'waiting' | CHECK `status IN ('waiting','booked','refused','held')` |
| attempts | INTEGER NOT NULL DEFAULT 0 | |
| last_error | TEXT NULL | transport error of the last attempt |
| server_result_json | TEXT NULL | per-op result returned by the server |
| created_at, updated_at | TEXT NOT NULL | |

"Delivered" = status ≠ `waiting`. The working copy may be retired only when no row is `waiting`.

## Reset / split / snapshot classification

- `packages/core/src/constants/resetTables.ts`: `offline_devices` and `offline_replay_ops` are **excluded from the
  Settings › Reset Data wipe** (a reset must not unpair the desktop or erase the audit of what was replayed);
  `offline_outbox` is wiped (local transient). The existing reset guard test enforces classification.
- `SNAPSHOT_STRIPPED_TABLES` includes `offline_devices`, `offline_replay_ops`, `offline_outbox`, `idempotency_keys`,
  `user_invitations`, `email_verification_tokens`, `user_identities`, every session/token/code table;
  `tenant_subscriptions.license_key` is nulled (row kept so entitlements match the web); secret `system_settings` keys
  are deleted; `sqlite_sequence` reset (R9).

## Registry (pure data, `packages/core/src/offline/operations.ts`)

```ts
type OfflineOperationName = "sales.process" | "expenses.create" | "debts.addRepayment";
// plus: offlineRules(payload) => string | null   (null = allowed; else the refusal reason)
interface OfflineOperationDef {
  name: OfflineOperationName;
  ipcChannel: "sales:process" | "db:add-expense" | "debt:add-repayment";
  schema: ZodTypeAny;              // saleProcessSchema | createExpenseSchema | addRepaymentSchema (core)
  roles: readonly ("admin" | "staff")[]; // ["admin","staff"] for all three (verified on both transports)
  timeField: "transaction_time";   // the payload key that carries the original instant
  refFields: readonly { path: string; table: string }[]; // row references that must pre-exist in the copy
  label: string;                   // plain words for the review list ("POS sale", "Expense", "Debt repayment")
  clientField: string | null;      // "client_id" | null | "clientId" — for the same-client dependent hold
  notRefs: readonly { path: string; reason: string }[];
  offlineRules(payload: unknown): string | null;
}
// refFields entries: { path, table } | { path, tableBy: { field, map } }
```

Extra per-operation offline rules (`offlineRules`, checked by the desktop recorder before anything is written and again
by the replay service):
- `sales.process`: `status === "completed"`; no `id` (no edit of an existing sale/draft); no `partnerId`/`partnerMode`
  (partner money is online-only); if `client_name` is truthy, `client_id` must be present too (a typed-new customer
  would be created inside `processSale` — refused offline, O2).
- `expenses.create`, `debts.addRepayment`: none beyond the schema.

`refFields` (row references that must already exist in the copy), declared explicitly and checked by T011 against each
schema's real keys (read `packages/core/src/validators/sale.ts`, `debt.ts`, `expense.ts` — names below are the expected
ones, confirm each): sales — `client_id`→`clients`, `items[].product_id`→`products`, `items[].product_unit_id`→
`product_units` (`partnerId` is refused by `offlineRules`, not referenced; `id` is refused); repayment — `clientId`→
`clients`, `targets[].id` with `tableBy: { field: "kind", map: { sale: "sales", charge: "debt_ledger", member:
"customer_session_transactions" } }` (_verified_ `DebtRepository.ts:1407-1414`), `userId` in `notRefs` (replay
replaces it with the actor); expense — no id keys (_verified_). A refField is `{ path, table }` or `{ path, tableBy }`. FR-030: at go-offline the desktop records `MAX(id)` per referenced table; a payload
whose reference exceeds it is refused offline.

## Desktop files (paired mode)

```
<userData>/web-fallback/
├── pairing.json             { tenantId, shopName, shopSlug, serverUrl, deviceKeyEncrypted (safeStorage, base64), keyUsable,
│                              mode: "standby" | "offline", periodId?, periodStartedAt?, baseMaxIds?, lastSnapshotAt?, schemaVersion?, lockAfterSeconds? }
├── mirror-<ts>.db           verified copies; newest 2 kept (never the open one); never written
├── offline-work.db          working copy + offline_outbox; exists only between go-offline and full delivery
└── finished/offline-work-<ts>.db   last 3 retired working copies
```

## Desktop state machine

```
standalone ──pair──▶ standby ──(unreachable > lockAfterSeconds+30 s, versions equal, "Work offline")──▶ offline
   ▲                    ▲  │                                                                  │
   └──────unpair────────┘  └──(refresh every 5 min: new mirror file)                           │
                        ▲                                                                      │
                        └──(Send: every op delivered → period/complete → relaunch)─────────────┘
offline: new ops refused once the server has been reachable ≥60 s (O12)
```

## Server lock state (derived, never stored as a flag)

`computeShopLock(device, nowMs, staleMs)` → `{ locked, reason: "silent" | "offline" | "sending" | null, since }` per
research R6. Inputs: `revoked_at`, `paired_at`, `last_heartbeat_at`, `last_goodbye_at`, `last_state`, `last_ready`,
`period_opened_at` (the offline/sending lock's `since`), `lock_released_at`. (`period_started_at` feeds the review rule,
not the lock.)

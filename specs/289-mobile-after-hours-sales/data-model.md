# Data model — LIRA-289

The feature adds **two** tables and **one** query. No column is added to `transactions`, `payments`, `debt_ledger` or `expenses`, because there is no business-day concept (research R1).

## New: `idempotency_keys` (tenant DB, migration v202)

| Column | Type | Rule |
| --- | --- | --- |
| `id` | INTEGER PK | |
| `tenant_id` | INTEGER NOT NULL | tenant-scoped (`check:tenant-scoping`) |
| `user_id` | INTEGER NOT NULL | the JWT actor |
| `idem_key` | TEXT NOT NULL | client UUID from the `Idempotency-Key` header, 8–128 chars `[A-Za-z0-9-]` |
| `route` | TEXT NOT NULL | e.g. `POST /api/services/transactions` |
| `status` | TEXT NOT NULL | `pending` → `done` |
| `response_json` | TEXT | the envelope returned the first time; NULL while `pending` |
| `created_at`, `updated_at` | TEXT | rule 5 |

- Unique on `(tenant_id, user_id, route, idem_key)`.
- Rows older than 24 h are deleted by the hourly `authCleanupSweep`.

**One transaction, no pending state**:

- The claim INSERT, the money write and the stored response run in **one** SQLite transaction. better-sqlite3 is synchronous and nests through savepoints.
- A concurrent duplicate hits the unique index and replays the committed response, or retries once.
- A crash rolls everything back, so a retry runs cleanly. There is no stuck `pending` row.
- Only **successful** responses are stored. A `{success:false}` business refusal (for example, low wallet balance) rolls back the claim, so a retry after the owner tops up runs fresh.
- The `status` column is therefore dropped, unless tasks find the write cannot share the transaction. In that case `pending` rows older than 2 minutes are treated as abandoned.

Both `packages/core/src/db/migrations/index.ts` and `electron-app/create_db.sql` get this table, with `down()` (rule 10). Desktop never writes to it.

## New: `mobile_google_nonces` (platform DB)

| Column | Type | Rule |
| --- | --- | --- |
| `id` | INTEGER PK | |
| `nonce_hash` | TEXT UNIQUE NOT NULL | sha256 of the nonce; the raw nonce is never stored |
| `expires_at` | TEXT NOT NULL | issued + 10 min |
| `used_at` | TEXT | set on consumption; single use |
| `created_at`, `updated_at` | TEXT | |

- This is a platform-level table, like `signin_codes` (v199): the nonce is issued before any tenant is known.
- It is swept hourly.
- If the chosen Google path turns out to be code + PKCE (research R6 fallback), this table is not needed. Tasks decide after the Verify step.

## Reused, unchanged

- `sessions`: phone sessions use `device_type = 'mobile'` and `device_info` = the device name sent by the app. They are listed in Settings → Signed-in Devices and revocable there (spec edge case "phone is lost").
- `signin_directory` (v200): Google `sub` → (tenant, user). The role is read from `users` for each match.
- `drawer_balances`, `payments`, `transactions`, `debt_ledger`: written only by the existing `FinancialService` / `DebtService` paths.

## New query: transactions since the last count

`ClosingRepository.getTransactionsSinceLastCount(drawerNames: string[])`:

- For each drawer, take the last `checked_at` from `getLastCheckpointPerDrawer()` (`ClosingRepository.ts:1184`).
- Return the distinct transactions that have a `payments` leg on that drawer with `julianday(created_at) > julianday(checked_at)`. Compare normalised, because two timestamp shapes are stored (research R2).
- Exclude the CHECKPOINT transaction and its adjustment legs (`CHECKPOINT_ADJUSTMENT_METHOD`).
- **Verify** that a WHISH_APP sale on customer account writes a `payments` row on `Whish_App`, and does not only update `drawer_balances`. If it doesn't, extend the predicate. Exclude `is_auto` rows from the default list (rule 26 helpers); include them only when explicitly asked.
- A drawer never counted uses no lower bound, and the result is capped (most recent 200).
- Fields per row: `id`, `type`, `provider`, `service_type`, `client_id`, `client_name`, `amount`, `currency`, `payment methods`, `created_at`, `drawer_name`.
- Exposed as:
  - `GET /api/closing/since-last-count?drawers=Whish_App,OMT_App,…` (admin), wired through `ClosingService`. The service holds no SQL (rule 13).
  - An IPC mirror for the desktop count screen (rule 19).

## Day bucketing (no schema change)

Every query that groups or filters by day uses `reportingTimeFragments` (`localDayExpr`, `dateRange`, `isToday`) driven by the request's client offset: `TransactionRepository` list filters, `getDailySummary`, `getCashFlowByDate`, and the Transactions page's client-side filter. Research R2 lists the call sites.

## Validation rules (from the spec)

- Payment method for phone sales is one of `CUSTOMER_ACCOUNT | WHISH | OMT | BINANCE` (FR-003). The phone UI enforces this. The server schema already accepts these, and the shared schema is not narrowed, because the web uses other methods.
- `clientId` is required when `paidByMethod = CUSTOMER_ACCOUNT` (already a schema refine, `financial.ts:321-331`).
- The device day is sent in `X-Client-Day`. A device day more than 1 day away from the server's UTC day is refused (FR-011). It is checked only on write requests from `mobile` sessions, so web and desktop behaviour does not change. The auth middleware already reads the header and knows the session's `device_type`.

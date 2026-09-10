# Database Reset (Settings › Reset Data) — Implementation Plan

**Status:** in progress (2026-09-09)
**Ticket:** LIRA-165 (Reset Database from Settings)

## Goal

An admin-only "Reset Data" action in Settings that clears all operational data
(transactions, payments, drawers movements, ledgers, catalogs, contacts) while
KEEPING the configuration captured by the first setup-wizard pages, so the shop
restarts from a clean slate without re-running the wizard.

Owner decisions (2026-09-09, answered in-session):

| Wizard page                    | Keep? |
| ------------------------------ | ----- |
| 1 Account (admin user, shop)   | KEEP  |
| 2 Base System (OMT/Whish)      | KEEP  |
| 3 Modules + payment methods    | KEEP  |
| 4 Currencies                   | KEEP  |
| 5 Users (extra staff)          | KEEP  |
| 6 Drawers (opening amounts)    | WIPE  |
| 7 Done extras (WhatsApp, lines)| WIPE  |
| Catalogs (products, recharge…) | WIPE  |
| Contacts (clients/suppliers/partners) | WIPE |
| Settings-page config           | KEEP  |
| Drawer balances                | Zero + re-prompt on next login |

### Deviations from the literal answers (deliberate, with reasons)

1. **`currency_drawers` is KEPT** even though wizard page 6 ("Drawers") is not
   kept. Page 6's only durable output is the opening AMOUNTS, which the balance
   decision already covers (zeroed). The currency-per-drawer MAP is edited from
   Settings › Currencies & Rates (`CurrencyManager.tsx` → `setDrawerCurrencies`),
   so it is "Settings page config" (KEEP). It is also required for the chosen
   behaviour to work at all: `InitialDrawerAmountsModal` iterates the configured
   drawer/currency pairs, so wiping the map would render an empty prompt.
2. **`whatsapp_phone` / `whatsapp_api_key` are KEPT.** They are `system_settings`
   rows edited from Settings › Integrations, i.e. "Settings page config". (They
   do not exist in the current live DB, so the practical impact is nil.)
3. **`audit_log` is WIPED**, then the reset itself is written as the first new
   entry. A reset is a fresh start; keeping the old trail contradicts that, and
   the reset stays auditable.
4. **`sync_queue` / `sync_errors` are EXCLUDED entirely.** They are the only
   wipe-candidates with no `tenant_id` (documented in `BaseRepository` as
   "control-plane/global tables"), so they cannot be tenant-scoped safely on the
   multi-tenant web server. Nothing currently writes them (single reference, in
   a comment). Leaving them alone is safe; wiping them globally is not.
5. **A file backup is taken before the wipe on desktop**, and the reset aborts
   if the backup fails. Destructive + irreversible ⇒ a safety net is warranted.
   REST/web skips it (Litestream continuous replication covers the server DB).

## Semantics: "reset" = fresh-install baseline + kept setup answers

The target state is what a brand-new install has after migrations, plus the
config above. Two consequences that drive the design:

- Tables whose reference rows are seeded by **`create_db.sql`** must be
  re-seeded after deletion, not left empty (`product_categories`,
  `service_presets`). Migrations never re-run, so a plain DELETE would leave a
  state no fresh install ever has.
- `mobile_service_items` (411 rows) needs **no** re-seed: the frontend catalog
  seed re-runs automatically on the next login when the table is empty
  (`MobileServiceItemsContext.load()` → `count() === 0` → `seed(parseCatalogToSeedData())`).
  `item_costs` and `voucher_images` key off catalog `item_key`s and are wiped
  with it so no stale override attaches to a reseeded row.

## Table classification — exhaustive, 72 tables

Source of truth: `electron-app/create_db.sql` (verified a strict superset of the
live DB; `tenant_subscriptions` is the only extra, `'time'` was a regex
false-positive from a comment). Every table lands in exactly ONE bucket, and a
guard test fails the build when a new table is added without a decision.

**KEEP — untouched (13):** `currencies`, `currency_drawers`, `currency_modules`,
`exchange_rates`, `loto_settings`, `modules`, `payment_methods`,
`schema_migrations`, `service_providers`, `system_settings`, `tenants`,
`tenant_subscriptions`, `users`

**EXCLUDED — global, not tenant-scopable (2):** `sync_queue`, `sync_errors`

**ZERO — keep rows, set balance to 0 (1):** `drawer_balances`

**WIPE + RESEED create_db.sql defaults (2):** `product_categories`,
`service_presets`

**WIPE PARTIAL (1):** `suppliers` — delete only ad-hoc suppliers:
`WHERE is_system = 0 AND module_key IS NULL AND provider IS NULL AND tenant_id = ?`.
Do NOT key on `is_system` alone: the seeded `Whish` row has `is_system = 0` but
`module_key = 'omt_whish'`, and deleting it breaks the omt_whish module.

**WIPE — full delete, tenant-scoped (53):** `audit_log`,
`carrier_line_movements`, `carrier_lines`, `clients`, `custom_services`,
`customer_session_transactions`, `customer_sessions`, `daily_closing_amounts`,
`daily_closing_carrier_lines`, `daily_closings`, `debt_ledger`,
`drawer_cashouts`, `drawer_topups`, `drawer_transfers`,
`exchange_lot_settlements`, `exchange_lots`, `exchange_position_adjustments`,
`exchange_transactions`, `expenses`, `financial_services`, `hold_money`,
`item_costs`, `loto_cash_prizes`, `loto_checkpoints`, `loto_monthly_fees`,
`loto_settlements`, `loto_tickets`, `maintenance`, `maintenance_parts`,
`maintenance_status_history`, `mobile_service_items`, `partner_ledger`,
`partners`, `payments`, `product_stock_batches`, `product_suppliers`,
`product_units`, `products`, `recharges`, `sale_items`, `sales`,
`session_cart_items`, `sessions`, `settlement_commission_allocations`,
`stock_adjustments`, `stock_batch_consumptions`, `supplier_ledger`,
`supplier_purchases`, `supplier_settlements`, `transactions`, `voucher_images`,
`vouchers`, `wallet_exchanges`

### The correctness risk this classification exists to kill

A PARTIAL wipe is worse than no wipe: delete `transactions` but forget
`supplier_ledger` and the app shows a supplier owing money with no transactions
behind it — indistinguishable from corruption. Completeness across every ledger
is the highest-cost error here, which is why the list is exhaustive and
guard-tested rather than hand-maintained.

## Mechanics

- ONE `db.transaction(...)`. Runtime enforces `PRAGMA foreign_keys = ON`
  (`electron-app/main.ts`), so set **`PRAGMA defer_foreign_keys = ON` inside the
  transaction** and drop all ordering concerns; checks run once at COMMIT and it
  auto-resets. Do not toggle `foreign_keys` (illegal inside a transaction).
- Every statement carries `WHERE tenant_id = ?`. A reset must never cross
  tenants on the web server.
- Row counts per table are collected from `changes` and returned, so the UI can
  report exactly what was removed.
- `drawer_balances`: `UPDATE ... SET balance = 0` (do not delete). Zeroing is
  what re-arms the prompt — `ClosingRepository.hasInitialBalancesSet()` is
  `COUNT(*) FROM drawer_balances WHERE balance != 0`, so the Dashboard alert
  "Starting drawer amounts not set" + `InitialDrawerAmountsModal` appear again
  with no extra work.

## Layers

### Phase 1 — core (`packages/core`)

- `src/constants/resetTables.ts` — the six buckets as named readonly arrays plus
  `SUPPLIER_KEEP_PREDICATE` and `DATABASE_RESET_CONFIRMATION_PHRASE`. Single
  source of truth (rule 14).
- `src/repositories/DatabaseResetRepository.ts` — the ONLY SQL. Extends
  `BaseRepository`. `previewCounts()` and `resetTenantData()`.
- `src/services/DatabaseResetService.ts` — orchestration only, no SQL (rule 13).
  Repo injected via constructor (DIP).
- `src/validators/databaseReset.ts` — Zod schema, `{ confirmation: string }`.
- Export from BOTH `src/index.ts` and `src/browser.ts` (the phrase constant is
  imported by the renderer; core has two entry points).
- Tests: classification guard (parses `create_db.sql`, every table classified
  once), wipe-completeness (seed one row in every wipe table, reset, assert 0),
  tenant isolation (tenant 2 untouched), keep-set untouched, suppliers partial,
  reseed restores defaults, balances zeroed.

### Phase 2 — electron

`handlers/databaseResetHandlers.ts` (`database:reset`, `database:reset-preview`),
`requireRole("admin")` + `validatePayload`, backup before wipe (abort on
failure), audit entry after commit. Register in `main.ts`; preload binding;
`frontend/src/types/electron.d.ts`; re-export schema in `schemas/index.ts`.

### Phase 3 — backend REST

`backend/src/api/databaseReset.ts`: `POST /api/database/reset`,
`GET /api/database/reset/preview`, `authenticateJWT` → `requireRole("admin")`,
`validateRequest(coreSchema)`, IPC-identical envelope, mounted in `server.ts`.

### Phase 4 — frontend

`backendApi.ts` (`ipcOrHttp`) → `ElectronApiAdapter` → `packages/ui` `ApiAdapter`
type. New Settings tab `reset` labeled "Reset Data" (last), panel
`ResetDataPanel.tsx` + `ResetDataModal.tsx` requiring the confirmation phrase
typed exactly, showing the live preview counts and the keep list. On success:
summary, then full reload.

### Phase 5 — e2e

**The reset must NOT actually run inside the shared suite.** `test:e2e` shares
one accumulating DB across specs in order (rule 15); a real reset mid-suite
destroys every later spec. Specs therefore assert the GUARD, not the wipe:
non-admin cannot reach it, wrong phrase is rejected server-side, preview counts
are non-zero and match. The wipe itself is covered by core jest on a temp DB.

## No migration required

No schema change. `create_db.sql` untouched.

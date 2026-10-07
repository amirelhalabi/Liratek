/**
 * Database Reset — table classification (LIRA-165, DATABASE_RESET_PLAN.md).
 *
 * Single source of truth (rule 14) for which tables in
 * `electron-app/create_db.sql` survive an admin-triggered "Reset Data"
 * action, which are zeroed, and which are wiped outright.
 * `DatabaseResetRepository` reads ONLY these arrays — it never hardcodes a
 * table name — and `resetTables.guard.test.ts` fails the build the moment a
 * new `CREATE TABLE` lands in `create_db.sql` without a bucket decision here.
 * Leaving a ledger table out of the wipe set produces data that LOOKS
 * corrupt after a reset (e.g. a supplier owing money with no transactions
 * behind it) — see DATABASE_RESET_PLAN.md "The correctness risk this
 * classification exists to kill".
 *
 * The rule (owner decision 2026-10-07): a reset KEEPS the shop's SETUP and
 * wipes only OPERATIONAL data. Setup = anything the shop configured once and
 * would have to re-type (accounts, modules, currencies, drawers, categories,
 * the product catalog, the Mobile Services items, presets, partners,
 * suppliers, carrier lines). Operational = anything a sale, payment,
 * movement or closing wrote (transactions, payments, every ledger, debts,
 * clients, stock and stock history, closings, customer sessions, audit log).
 * Where a setup row carries a money/stock state, the ROW is kept and only
 * that state resets — either by zeroing a column (ZERO) or, for balances
 * derived from a ledger, simply because the ledger is wiped.
 *
 * The four buckets:
 *
 * - RESET_KEEP_TABLES: untouched. Setup-wizard + Settings-page config,
 *   control-plane rows, accounts and sign-ins, plus (2026-10-07) the shop's
 *   own catalog setup:
 *     · `product_categories`, `service_presets` — kept as the shop has them
 *       (they used to be wiped and re-seeded to the fresh-install defaults,
 *       which deleted every category/preset the shop had added or renamed).
 *     · `mobile_service_items` — every item, including ones the shop added
 *       (it used to be wiped and re-seeded from the built-in catalog on next
 *       login, losing the shop's own items and prices). `item_costs` and
 *       `voucher_images` key off those items' `item_key`s and are per-item
 *       cost / picture settings, so they travel with them.
 *     · `partners`, `suppliers` (ALL of them — system, module-owned and
 *       hand-added), `product_suppliers` (the normalised supplier-name
 *       picklist the inventory form uses: name / sort order / active flag /
 *       optional link to a supplier, no money or event columns — setup, not
 *       history). Neither `suppliers` nor `partners` stores a balance
 *       column: a balance is the SUM of `supplier_ledger` / `partner_ledger`
 *       rows, which are operational and wiped, so every balance reads 0.
 * - RESET_EXCLUDED_TABLES: `sync_queue` / `sync_errors` were the first
 *   wipe-candidates with NO `tenant_id` column — they are documented in
 *   `BaseRepository` as control-plane/global tables, so a tenant-scoped
 *   `DELETE ... WHERE tenant_id = ?` cannot target them safely on the
 *   multi-tenant web server (there is no tenant column to scope on, and
 *   deleting unscoped would wipe every tenant's queue at once). Nothing
 *   currently writes them in production, so leaving them alone is safe.
 *   `email_outbox` / `signup_invitations` (LIRA-267, v195) joined for the
 *   same reason: platform-level sign-up invitations and their emails, owned
 *   by no shop, so one shop's "Reset Data" must never touch them.
 *   `sso_handoff_tokens` (v196) joined for the same reason: a platform-level
 *   www -> shop sign-in hand-off with no `tenant_id` column.
 * - RESET_ZERO_TABLES: rows are KEPT and specific "balance-like" columns
 *   are set to 0, never deleted. `drawer_balances.balance` is the original
 *   member — zeroing (not deleting) is load-bearing:
 *   `ClosingRepository.hasInitialBalancesSet()` is `COUNT(*) FROM
 *   drawer_balances WHERE balance != 0`, so zeroing re-arms the Dashboard
 *   "Starting drawer amounts not set" prompt on next login.
 *   `carrier_lines.credits`/`.days_owed` (LIRA-254, owner decision
 *   2026-10-02) joined it: the phone number IS shop setup, like a currency —
 *   only its *balance* should reset, matching the zeroed drawers (LIRA-252's
 *   drawer = Σ active line credits invariant). `validity_expires_at` is
 *   deliberately NOT zeroed/cleared: it is the SIM's real-world expiry date,
 *   not a derived balance. `products.stock_quantity` (2026-10-07) joined for
 *   the same reason: the product (name, barcode, category, prices, minimum
 *   stock) is catalog setup; the quantity on hand is stock, which a reset
 *   wipes. Its stock batches, IMEI units, consumptions and adjustments are
 *   in WIPE, so quantity 0 + no batches is consistent — and a product with
 *   no batches is already a supported state (`StockBatchRepository.consume`
 *   prices uncovered units at `cost_price_usd`).
 * - RESET_WIPE_TABLES: every other tenant-owned operational table —
 *   transactions, payments, drawer movements, every ledger, debts, clients,
 *   stock and stock history, closings, customer sessions, audit log —
 *   deleted outright, tenant-scoped. History rows whose PARENT is kept
 *   (`carrier_line_movements` under `carrier_lines`, `supplier_ledger` under
 *   `suppliers`, `partner_ledger` under `partners`, `product_stock_batches`
 *   under `products`, ...) raise no FK problem: each carries its own
 *   `tenant_id` and is deleted by it directly, never via cascade-from-
 *   parent, and `defer_foreign_keys` removes any ordering concern. No KEPT
 *   table references a WIPED one (checked against create_db.sql's FK list;
 *   `DatabaseResetRepository.test.ts` runs `PRAGMA foreign_key_check` after
 *   a full-fixture reset to prove it).
 */

// =============================================================================
// Confirmation phrase — the UI check is not a guard; the service re-validates
// this server-side before touching the repository (defence in depth).
// =============================================================================

export const DATABASE_RESET_CONFIRMATION_PHRASE = "RESET ALL DATA";

// =============================================================================
// Table buckets — each sorted alphabetically so future diffs stay readable.
// =============================================================================

/**
 * KEEP — untouched. Setup-wizard + Settings-page config, control plane,
 * the accounts themselves, and the shop's catalog setup (categories, Mobile
 * Services items + their cost/picture settings, presets, partners,
 * suppliers, the product-supplier picklist) — see the header comment.
 *
 * `sessions` is the LOGIN session table (not customer sessions): every web
 * request validates its JWT against a row here and the desktop app
 * re-validates its stored token against it on every launch/reload. It was
 * once in WIPE, which signed out the admin who pressed "Reset everything"
 * (every later request 401'd, so the success message never showed) and
 * every other device of the shop (production, 2026-10-07). Owner intent:
 * a reset keeps every user AND their sign-ins. The four v196 tables travel with `users`
 * (KEEP): a user's Google link, pending invites to the shop, and open
 * password-reset / email-verification links are account state, not shop
 * operations, and a "Reset Data" that silently unlinked Google or killed a
 * just-sent invite would be a surprise with nothing to gain.
 */
export const RESET_KEEP_TABLES: readonly string[] = [
  "currencies",
  "currency_drawers",
  "currency_modules",
  "email_verification_tokens",
  "exchange_rates",
  "item_costs",
  "loto_settings",
  "mobile_service_items",
  "modules",
  "partners",
  "password_reset_tokens",
  "payment_methods",
  "product_categories",
  "product_suppliers",
  "schema_migrations",
  "service_presets",
  "service_providers",
  "sessions",
  "suppliers",
  "system_settings",
  "tenant_subscriptions",
  "tenants",
  "user_identities",
  "user_invitations",
  "users",
  "voucher_images",
];

/**
 * EXCLUDED — global, not tenant-scopable (5). No `tenant_id` column exists
 * on any of these tables (see `BaseRepository`'s "control-plane/global tables"
 * doc comment), so they are left alone entirely rather than risk an
 * unscoped cross-tenant DELETE.
 */
export const RESET_EXCLUDED_TABLES: readonly string[] = [
  "email_outbox",
  "signup_invitations",
  "sso_handoff_tokens",
  "sync_errors",
  "sync_queue",
];

/**
 * ZERO — rows kept, named columns reset to 0. Each entry names
 * exactly which columns to zero; every other column on the row (identity,
 * config, the SIM's own `validity_expires_at`) survives untouched. Defined
 * ONCE here (rule 14) — `DatabaseResetRepository` builds its `UPDATE ...
 * SET` clause from `columns` rather than hardcoding a column name per table.
 */
export interface ResetZeroColumnsSpec {
  readonly table: string;
  readonly columns: readonly string[];
}

export const RESET_ZERO_TABLES: readonly ResetZeroColumnsSpec[] = [
  { table: "drawer_balances", columns: ["balance"] },
  // LIRA-254: phone/carrier/label/is_primary/is_active/validity_expires_at
  // are shop setup and survive; only the sold balance resets, matching the
  // zeroed drawers (LIRA-252 drawer = Σ active line credits).
  { table: "carrier_lines", columns: ["credits", "days_owed"] },
  // 2026-10-07: the product is catalog setup and survives; only the
  // quantity on hand resets (its batches / IMEI units / stock history are
  // in WIPE, so 0 matches them).
  { table: "products", columns: ["stock_quantity"] },
];

/** Table names only, derived (rule 14) — for call sites that only need
 *  "is this table in the ZERO bucket", not which columns it zeroes
 *  (the guard test's bucket-membership/union/disjoint checks). */
export const RESET_ZERO_TABLE_NAMES: readonly string[] = RESET_ZERO_TABLES.map(
  (z) => z.table,
);

/** WIPE — full delete, tenant-scoped. LOGIN sessions (`sessions`) are
 *  deliberately NOT here — see `RESET_KEEP_TABLES`. The three CUSTOMER
 *  session tables (`customer_sessions`, `customer_session_transactions`,
 *  `session_cart_items`) are operational data and stay in this list. */
export const RESET_WIPE_TABLES: readonly string[] = [
  "audit_log",
  "carrier_line_movements",
  "carrier_line_owed_deliveries",
  "clients",
  "custom_services",
  "customer_session_transactions",
  "customer_sessions",
  "daily_closing_amounts",
  "daily_closing_carrier_lines",
  "daily_closings",
  "debt_ledger",
  "drawer_cashouts",
  "drawer_topups",
  "drawer_transfers",
  "exchange_lot_settlements",
  "exchange_lots",
  "exchange_position_adjustments",
  "exchange_transactions",
  "expenses",
  "financial_services",
  "hold_money",
  "hold_money_pickups",
  "loto_cash_prizes",
  "loto_checkpoints",
  "loto_monthly_fees",
  "loto_settlements",
  "loto_tickets",
  "maintenance",
  "maintenance_parts",
  "maintenance_status_history",
  "partner_ledger",
  "payments",
  "product_stock_batches",
  "product_units",
  "recharges",
  "sale_items",
  "sales",
  "session_cart_items",
  "settlement_commission_allocations",
  "stock_adjustments",
  "stock_batch_consumptions",
  "supplier_ledger",
  "supplier_purchases",
  "supplier_settlements",
  "transactions",
  "vouchers",
  "wallet_exchanges",
];

/**
 * Union of all four buckets — DERIVED, never retyped, so it can never drift
 * from the individual arrays above. Used by the guard test to assert every
 * `CREATE TABLE` in `create_db.sql` lands in exactly one bucket.
 */
export const RESET_ALL_CLASSIFIED_TABLES: readonly string[] = [
  ...RESET_KEEP_TABLES,
  ...RESET_EXCLUDED_TABLES,
  ...RESET_ZERO_TABLE_NAMES,
  ...RESET_WIPE_TABLES,
].sort();

// =============================================================================
// Result / preview shapes shared by the repository and service.
// =============================================================================

export interface DatabaseResetPreview {
  counts: Record<string, number>;
  totalRows: number;
}

export interface DatabaseResetResult {
  deletedRows: Record<string, number>;
  totalDeleted: number;
  backupPath?: string;
}

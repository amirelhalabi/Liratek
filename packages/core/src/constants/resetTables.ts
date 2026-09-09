/**
 * Database Reset — table classification (LIRA-165, DATABASE_RESET_PLAN.md).
 *
 * Single source of truth (rule 14) for which of the 72 tables in
 * `electron-app/create_db.sql` survive an admin-triggered "Reset Data"
 * action, which are zeroed, which are wiped-and-reseeded, and which are
 * wiped outright. `DatabaseResetRepository` reads ONLY these arrays — it
 * never hardcodes a table name — and `resetTables.guard.test.ts` fails the
 * build the moment a new `CREATE TABLE` lands in `create_db.sql` without a
 * bucket decision here. Leaving a ledger table out of the wipe set produces
 * data that LOOKS corrupt after a reset (e.g. a supplier owing money with no
 * transactions behind it) — see DATABASE_RESET_PLAN.md "The correctness risk
 * this classification exists to kill".
 *
 * The six buckets:
 *
 * - RESET_KEEP_TABLES (13): untouched. Configuration captured by the setup
 *   wizard's Account/Base-System/Modules/Currencies/Users pages, plus
 *   Settings-page config (`system_settings`, `currency_drawers`) and
 *   control-plane rows (`tenants`, `tenant_subscriptions`,
 *   `schema_migrations`). The shop should never have to re-run the wizard.
 * - RESET_EXCLUDED_TABLES (2): `sync_queue` / `sync_errors` are the only
 *   wipe-candidates with NO `tenant_id` column — they are documented in
 *   `BaseRepository` as control-plane/global tables, so a tenant-scoped
 *   `DELETE ... WHERE tenant_id = ?` cannot target them safely on the
 *   multi-tenant web server (there is no tenant column to scope on, and
 *   deleting unscoped would wipe every tenant's queue at once). Nothing
 *   currently writes them in production, so leaving them alone is safe.
 * - RESET_ZERO_TABLES (1): `drawer_balances` rows are KEPT and the balance
 *   column is set to 0, never deleted. Zeroing (not deleting) is
 *   load-bearing: `ClosingRepository.hasInitialBalancesSet()` is
 *   `COUNT(*) FROM drawer_balances WHERE balance != 0`, so zeroing re-arms
 *   the Dashboard "Starting drawer amounts not set" prompt on next login.
 * - RESET_RESEED_TABLES (2): wiped, then re-populated with the exact rows
 *   `create_db.sql` seeds on a fresh install (`PRODUCT_CATEGORY_DEFAULTS`,
 *   `SERVICE_PRESET_DEFAULTS` below). Migrations never re-run against an
 *   existing database, so a plain DELETE would leave a state no fresh
 *   install ever has.
 * - RESET_PARTIAL_TABLES (1): `suppliers` — only ad-hoc (non-system,
 *   non-module) suppliers are deleted. See `SUPPLIER_KEEP_PREDICATE` below
 *   for why `is_system` alone is the wrong gate.
 * - RESET_WIPE_TABLES (53): every other tenant-owned operational table —
 *   transactions, payments, drawer movements, ledgers, catalogs, contacts —
 *   deleted outright, tenant-scoped.
 *
 * `mobile_service_items` needs no re-seed even though it is in WIPE: the
 * frontend catalog seed re-runs automatically on next login when the table
 * is empty (`MobileServiceItemsContext.load()`). `item_costs` and
 * `voucher_images` key off catalog `item_key`s and are wiped alongside it so
 * no stale override attaches to a reseeded row.
 */

// =============================================================================
// Confirmation phrase — the UI check is not a guard; the service re-validates
// this server-side before touching the repository (defence in depth).
// =============================================================================

export const DATABASE_RESET_CONFIRMATION_PHRASE = "RESET ALL DATA";

// =============================================================================
// Table buckets — each sorted alphabetically so future diffs stay readable.
// =============================================================================

/** KEEP — untouched (13). Setup-wizard + Settings-page config, control plane. */
export const RESET_KEEP_TABLES: readonly string[] = [
  "currencies",
  "currency_drawers",
  "currency_modules",
  "exchange_rates",
  "loto_settings",
  "modules",
  "payment_methods",
  "schema_migrations",
  "service_providers",
  "system_settings",
  "tenant_subscriptions",
  "tenants",
  "users",
];

/**
 * EXCLUDED — global, not tenant-scopable (2). No `tenant_id` column exists
 * on either table (see `BaseRepository`'s "control-plane/global tables"
 * doc comment), so they are left alone entirely rather than risk an
 * unscoped cross-tenant DELETE.
 */
export const RESET_EXCLUDED_TABLES: readonly string[] = [
  "sync_errors",
  "sync_queue",
];

/** ZERO — rows kept, `balance` set to 0 (1). Re-arms the opening-amounts prompt. */
export const RESET_ZERO_TABLES: readonly string[] = ["drawer_balances"];

/** WIPE + RESEED create_db.sql defaults (2). */
export const RESET_RESEED_TABLES: readonly string[] = [
  "product_categories",
  "service_presets",
];

/** WIPE PARTIAL (1) — see `SUPPLIER_KEEP_PREDICATE`. */
export const RESET_PARTIAL_TABLES: readonly string[] = ["suppliers"];

/** WIPE — full delete, tenant-scoped (53). */
export const RESET_WIPE_TABLES: readonly string[] = [
  "audit_log",
  "carrier_line_movements",
  "carrier_lines",
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
  "item_costs",
  "loto_cash_prizes",
  "loto_checkpoints",
  "loto_monthly_fees",
  "loto_settlements",
  "loto_tickets",
  "maintenance",
  "maintenance_parts",
  "maintenance_status_history",
  "mobile_service_items",
  "partner_ledger",
  "partners",
  "payments",
  "product_stock_batches",
  "product_suppliers",
  "product_units",
  "products",
  "recharges",
  "sale_items",
  "sales",
  "session_cart_items",
  "sessions",
  "settlement_commission_allocations",
  "stock_adjustments",
  "stock_batch_consumptions",
  "supplier_ledger",
  "supplier_purchases",
  "supplier_settlements",
  "transactions",
  "voucher_images",
  "vouchers",
  "wallet_exchanges",
];

/**
 * Union of all six buckets — DERIVED, never retyped, so it can never drift
 * from the individual arrays above. Used by the guard test to assert every
 * `CREATE TABLE` in `create_db.sql` lands in exactly one bucket.
 */
export const RESET_ALL_CLASSIFIED_TABLES: readonly string[] = [
  ...RESET_KEEP_TABLES,
  ...RESET_EXCLUDED_TABLES,
  ...RESET_ZERO_TABLES,
  ...RESET_RESEED_TABLES,
  ...RESET_PARTIAL_TABLES,
  ...RESET_WIPE_TABLES,
].sort();

// =============================================================================
// Suppliers partial-wipe predicate (rule 14 — defined ONCE, reused wherever
// the ad-hoc-supplier gate is needed).
// =============================================================================

/**
 * SQL predicate selecting suppliers a reset must KEEP: anything a module or
 * the system seed owns, however it flagged `is_system`.
 *
 * Do NOT key on `is_system` alone: the seeded `Whish` row
 * (`electron-app/create_db.sql`'s supplier seed) has `is_system = 0` but
 * `module_key = 'omt_whish'` — a delete gated on `is_system = 0` alone would
 * still match Whish and remove it, breaking the omt_whish module (Whish
 * becomes an unresolvable supplier reference for every future Whish
 * transaction). Matching any ONE of the three columns being module/system-owned
 * is enough to protect the row.
 *
 * The partial wipe deletes the negation, `NOT (SUPPLIER_KEEP_PREDICATE)`,
 * which by De Morgan's is exactly `is_system = 0 AND module_key IS NULL AND
 * provider IS NULL` — the ad-hoc suppliers a shop added by hand. Callers
 * append `AND tenant_id = ?` themselves — this fragment intentionally
 * carries no tenant predicate so it composes into both a `SELECT COUNT(*)`
 * preview query and a `DELETE` statement.
 */
export const SUPPLIER_KEEP_PREDICATE =
  "(is_system = 1 OR module_key IS NOT NULL OR provider IS NOT NULL)";

// =============================================================================
// Re-seed payloads — copied EXACTLY from the `INSERT OR IGNORE` seed
// statements in `electron-app/create_db.sql` (verified against the file,
// not re-derived). `tenant_id` and timestamp columns are supplied by the
// repository at insert time, not stored here.
// =============================================================================

export interface ProductCategoryDefault {
  readonly name: string;
  readonly sort_order: number;
  readonly tracks_imei_units: 0 | 1;
}

/**
 * `create_db.sql` §"Product Categories" seed. `tracks_imei_units = 1` only
 * for "Phones" (LIRA-143 v157 decision #9 — per-unit IMEI tracking).
 */
export const PRODUCT_CATEGORY_DEFAULTS: readonly ProductCategoryDefault[] = [
  { name: "Accessories", sort_order: 0, tracks_imei_units: 0 },
  { name: "Phones", sort_order: 1, tracks_imei_units: 1 },
  { name: "Chargers", sort_order: 2, tracks_imei_units: 0 },
  { name: "Audio", sort_order: 3, tracks_imei_units: 0 },
  { name: "Parts", sort_order: 4, tracks_imei_units: 0 },
  { name: "Services", sort_order: 5, tracks_imei_units: 0 },
];

export interface ServicePresetDefault {
  readonly name: string;
  readonly category: string;
  readonly cost_usd: number;
  readonly price_usd: number;
  readonly sort_order: number;
}

/** `create_db.sql` §"Default service presets" seed (4 `digital_account` rows). */
export const SERVICE_PRESET_DEFAULTS: readonly ServicePresetDefault[] = [
  {
    name: "Netflix Premium 1 Month",
    category: "digital_account",
    cost_usd: 7,
    price_usd: 9,
    sort_order: 0,
  },
  {
    name: "Netflix Standard 1 Month",
    category: "digital_account",
    cost_usd: 5,
    price_usd: 7,
    sort_order: 1,
  },
  {
    name: "Spotify Premium 1 Month",
    category: "digital_account",
    cost_usd: 3,
    price_usd: 5,
    sort_order: 2,
  },
  {
    name: "Shahid VIP 1 Month",
    category: "digital_account",
    cost_usd: 4,
    price_usd: 6,
    sort_order: 3,
  },
];

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

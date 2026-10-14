/**
 * Offline id layout (LIRA-306, O-new-1, FR-012) — PURE, browser-safe.
 *
 *   offlineId = P × 10¹² + T × 10⁹ + n
 *
 * P = the PC number (1…9006, never reused in a shop), T = the table's index
 * in {@link OFFLINE_ID_TABLES} (0…999), n = 1…999 999 999, continuing per
 * (PC, table). A value alone therefore says which PC and which table it
 * belongs to. Server ids always stay below 10¹² (startup assertion,
 * `assertServerIdsBelowOfflineRange`).
 *
 * The floor is 10¹² and not 10⁹ because 1 000 000 000 LBP (≈ $11 200) is an
 * ordinary sale amount: a lower floor would collide with amounts.
 */

export const OFFLINE_ID_FLOOR = 1_000_000_000_000;
const TABLE_STRIDE = 1_000_000_000;
export const OFFLINE_PC_MIN = 1;
export const OFFLINE_PC_MAX = 9006;
export const OFFLINE_TABLE_INDEX_MAX = 999;
export const OFFLINE_N_MAX = 999_999_999;

/**
 * Every AUTOINCREMENT table of `electron-app/create_db.sql`, in a FIXED order.
 * APPEND-ONLY: a table's position is baked into every offline id ever issued.
 * Guarded by `offline/__tests__/idRange.test.ts` (every AUTOINCREMENT table
 * listed here or in {@link OFFLINE_ID_EXCLUDED_TABLES}; prefix equals the
 * committed snapshot).
 */
export const OFFLINE_ID_TABLES: readonly string[] = [
  "tenants",
  "tenant_subscriptions",
  "email_outbox",
  "signup_invitations",
  "system_settings",
  "users",
  "user_invitations",
  "password_reset_tokens",
  "email_verification_tokens",
  "user_identities",
  "sso_handoff_tokens",
  "signin_codes",
  "signin_directory",
  "sessions",
  "transactions",
  "currencies",
  "exchange_rates",
  "clients",
  "suppliers",
  "products",
  "product_categories",
  "product_suppliers",
  "product_units",
  "sales",
  "sale_items",
  "debt_ledger",
  "customer_sessions",
  "customer_session_transactions",
  "session_cart_items",
  "supplier_ledger",
  "supplier_settlements",
  "settlement_commission_allocations",
  "supplier_purchases",
  "maintenance",
  "maintenance_parts",
  "maintenance_status_history",
  "expenses",
  "recharges",
  "exchange_transactions",
  "exchange_lots",
  "exchange_lot_settlements",
  "exchange_position_adjustments",
  "financial_services",
  "partners",
  "partner_ledger",
  "custom_services",
  "service_presets",
  "item_costs",
  "voucher_images",
  "mobile_service_items",
  "carrier_lines",
  "carrier_line_movements",
  "carrier_line_owed_deliveries",
  "payments",
  "drawer_topups",
  "drawer_cashouts",
  "wallet_exchanges",
  "drawer_transfers",
  "daily_closings",
  "daily_closing_amounts",
  "daily_closing_carrier_lines",
  "sync_queue",
  "sync_errors",
  "product_stock_batches",
  "stock_batch_consumptions",
  "payment_methods",
  "service_providers",
  "vouchers",
  "loto_tickets",
  "loto_monthly_fees",
  "loto_checkpoints",
  "loto_cash_prizes",
  "loto_settlements",
  "audit_log",
  "hold_money",
  "hold_money_pickups",
  "stock_adjustments",
  "warranty_claims",
  "defective_items",
  "supplier_returns",
  "idempotency_keys",
  // LIRA-309 v211 — appended (positions are baked into offline ids).
  "resale_lines",
  "resale_line_recharges",
  // LIRA-312 v214 — appended (positions are baked into offline ids).
  "wrong_number_cards",
];

/** The offline feature's own bookkeeping tables — never written by a
 *  replayed business action, so they get no offline id range. */
export const OFFLINE_ID_EXCLUDED_TABLES: readonly string[] = [
  "offline_devices",
  "offline_snapshots",
  "offline_events",
  "offline_id_map",
  "offline_review_items",
  "offline_outbox",
  "offline_outbox_created",
  "offline_copy_meta",
];

export interface DecodedOfflineId {
  pc: number;
  tableIndex: number;
  /** null when the index is past the end of this build's list (a newer app). */
  table: string | null;
  n: number;
}

function assertIntIn(name: string, v: number, min: number, max: number): void {
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new RangeError(`${name} must be an integer in ${min}…${max} (got ${v})`);
  }
}

export function encodeOfflineId(pc: number, tableIndex: number, n: number): number {
  assertIntIn("PC number", pc, OFFLINE_PC_MIN, OFFLINE_PC_MAX);
  assertIntIn("table index", tableIndex, 0, OFFLINE_TABLE_INDEX_MAX);
  assertIntIn("n", n, 1, OFFLINE_N_MAX);
  return pc * OFFLINE_ID_FLOOR + tableIndex * TABLE_STRIDE + n;
}

/** True for a safe integer ≥ 10¹² — the whole test of "this is a PC id". */
export function isOfflineId(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= OFFLINE_ID_FLOOR;
}

export function decodeOfflineId(v: unknown): DecodedOfflineId | null {
  if (!isOfflineId(v)) return null;
  const pc = Math.floor(v / OFFLINE_ID_FLOOR);
  const rest = v - pc * OFFLINE_ID_FLOOR;
  const tableIndex = Math.floor(rest / TABLE_STRIDE);
  const n = rest - tableIndex * TABLE_STRIDE;
  return { pc, tableIndex, table: OFFLINE_ID_TABLES[tableIndex] ?? null, n };
}

export function offlineTableIndex(table: string): number {
  const i = OFFLINE_ID_TABLES.indexOf(table);
  if (i < 0) throw new RangeError(`table "${table}" has no offline id range`);
  return i;
}

/**
 * The value of an id position as a number: an integer, or a string of
 * digits (a number written as text in an id position counts as an id,
 * FR-014/FR-019). Anything else → null.
 */
export function parseIdLike(v: unknown): number | null {
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : null;
  if (typeof v === "string") {
    const t = v.trim();
    if (!/^\d{1,16}$/.test(t)) return null;
    const n = Number(t);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/**
 * LIRA-306 T007 — the offline id layout (O-new-1, FR-012):
 * `offlineId = P × 10¹² + T × 10⁹ + n`.
 *
 * Also the append-only guard on `OFFLINE_ID_TABLES`: every AUTOINCREMENT
 * table of `electron-app/create_db.sql` must be listed there or in
 * `OFFLINE_ID_EXCLUDED_TABLES`, and the list must start with the snapshot
 * below — entries may only be APPENDED (a table's index is baked into every
 * offline id a PC has ever issued, so reordering or removing one would make
 * the server read old ids as the wrong table).
 */
import fs from "node:fs";
import path from "node:path";
import {
  OFFLINE_ID_FLOOR,
  OFFLINE_ID_TABLES,
  OFFLINE_ID_EXCLUDED_TABLES,
  encodeOfflineId,
  decodeOfflineId,
  isOfflineId,
  parseIdLike,
  offlineTableIndex,
} from "../idRange";

/** Committed 2026-10-11 (81 tables). Append new tables to the END of
 *  OFFLINE_ID_TABLES and to this snapshot in the same change. */
const SNAPSHOT_2026_10_11 = [
  "tenants", "tenant_subscriptions", "email_outbox", "signup_invitations", "system_settings", "users",
  "user_invitations", "password_reset_tokens", "email_verification_tokens", "user_identities",
  "sso_handoff_tokens", "signin_codes", "signin_directory", "sessions", "transactions", "currencies",
  "exchange_rates", "clients", "suppliers", "products", "product_categories", "product_suppliers",
  "product_units", "sales", "sale_items", "debt_ledger", "customer_sessions", "customer_session_transactions",
  "session_cart_items", "supplier_ledger", "supplier_settlements", "settlement_commission_allocations",
  "supplier_purchases", "maintenance", "maintenance_parts", "maintenance_status_history", "expenses",
  "recharges", "exchange_transactions", "exchange_lots", "exchange_lot_settlements",
  "exchange_position_adjustments", "financial_services", "partners", "partner_ledger", "custom_services",
  "service_presets", "item_costs", "voucher_images", "mobile_service_items", "carrier_lines",
  "carrier_line_movements", "carrier_line_owed_deliveries", "payments", "drawer_topups", "drawer_cashouts",
  "wallet_exchanges", "drawer_transfers", "daily_closings", "daily_closing_amounts",
  "daily_closing_carrier_lines", "sync_queue", "sync_errors", "product_stock_batches",
  "stock_batch_consumptions", "payment_methods", "service_providers", "vouchers", "loto_tickets",
  "loto_monthly_fees", "loto_checkpoints", "loto_cash_prizes", "loto_settlements", "audit_log", "hold_money",
  "hold_money_pickups", "stock_adjustments", "warranty_claims", "defective_items", "supplier_returns",
  "idempotency_keys",
];

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

function autoincrementTables(): string[] {
  const out: string[] = [];
  const re = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CREATE_DB_SQL)) !== null) {
    if (/AUTOINCREMENT/.test(m[2])) out.push(m[1]);
  }
  return out;
}

describe("offline id layout", () => {
  it("round-trips encode/decode and names the table", () => {
    const id = encodeOfflineId(1, offlineTableIndex("clients"), 1);
    expect(id).toBe(1_000_000_000_000 + offlineTableIndex("clients") * 1_000_000_000 + 1);
    expect(decodeOfflineId(id)).toEqual({
      pc: 1,
      tableIndex: offlineTableIndex("clients"),
      table: "clients",
      n: 1,
    });
    const big = encodeOfflineId(9006, 999, 999_999_999);
    expect(decodeOfflineId(big)).toEqual({ pc: 9006, tableIndex: 999, table: null, n: 999_999_999 });
  });

  it("enforces P 1–9006, T 0–999, n 1–999 999 999", () => {
    expect(() => encodeOfflineId(0, 0, 1)).toThrow();
    expect(() => encodeOfflineId(9007, 0, 1)).toThrow();
    expect(() => encodeOfflineId(1, -1, 1)).toThrow();
    expect(() => encodeOfflineId(1, 1000, 1)).toThrow();
    expect(() => encodeOfflineId(1, 0, 0)).toThrow();
    expect(() => encodeOfflineId(1, 0, 1_000_000_000)).toThrow();
    expect(() => encodeOfflineId(1.5, 0, 1)).toThrow();
  });

  it("the largest id stays below 2^53", () => {
    const max = encodeOfflineId(9006, 999, 999_999_999);
    expect(Number.isSafeInteger(max)).toBe(true);
    expect(max).toBeLessThan(2 ** 53);
  });

  it("isOfflineId: ≥ 10^12 safe integers only", () => {
    expect(OFFLINE_ID_FLOOR).toBe(1_000_000_000_000);
    expect(isOfflineId(999_999_999_999)).toBe(false);
    expect(isOfflineId(1_000_000_000_000)).toBe(true);
    expect(isOfflineId(1_004_000_000_001)).toBe(true);
    expect(isOfflineId(2 ** 53)).toBe(false);
    expect(isOfflineId("1004000000001")).toBe(false);
    expect(isOfflineId(1_004_000_000_001.5)).toBe(false);
    expect(decodeOfflineId(42)).toBeNull();
  });

  it("parseIdLike accepts numbers and numeric strings in an id position", () => {
    expect(parseIdLike(12)).toBe(12);
    expect(parseIdLike("1004000000001")).toBe(1_004_000_000_001);
    expect(parseIdLike(" 77 ")).toBe(77);
    expect(parseIdLike("70-123456")).toBeNull();
    expect(parseIdLike("")).toBeNull();
    expect(parseIdLike(null)).toBeNull();
    expect(parseIdLike(1.5)).toBeNull();
    expect(parseIdLike("1e13")).toBeNull();
  });

  it("every AUTOINCREMENT table of create_db.sql is classified exactly once", () => {
    const listed = new Set([...OFFLINE_ID_TABLES, ...OFFLINE_ID_EXCLUDED_TABLES]);
    const auto = autoincrementTables();
    expect(auto.filter((t) => !listed.has(t))).toEqual([]);
    expect([...listed].filter((t) => !auto.includes(t))).toEqual([]);
    expect(OFFLINE_ID_TABLES.filter((t) => OFFLINE_ID_EXCLUDED_TABLES.includes(t))).toEqual([]);
    expect(new Set(OFFLINE_ID_TABLES).size).toBe(OFFLINE_ID_TABLES.length);
  });

  it("the excluded list is exactly the eight offline_* tables", () => {
    expect([...OFFLINE_ID_EXCLUDED_TABLES].sort()).toEqual(
      [
        "offline_copy_meta", "offline_devices", "offline_events", "offline_id_map", "offline_outbox",
        "offline_outbox_created", "offline_review_items", "offline_snapshots",
      ],
    );
  });

  it("is append-only against the committed snapshot", () => {
    expect(OFFLINE_ID_TABLES.slice(0, SNAPSHOT_2026_10_11.length)).toEqual(SNAPSHOT_2026_10_11);
    expect(OFFLINE_ID_TABLES.length).toBeLessThanOrEqual(1000);
  });
});

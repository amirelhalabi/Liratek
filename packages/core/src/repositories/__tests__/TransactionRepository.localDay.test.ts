/**
 * LIRA-289 T038 — after-midnight sales land on the SHOP's local date.
 *
 * A sale at 00:30 Beirut is 21:30 UTC the previous day. `created_at` is UTC
 * in one of two shapes: ISO `…T21:30:00.000Z` when the caller passed
 * transaction_time, SQLite's `YYYY-MM-DD 21:30:00` otherwise. The daily
 * summary and the cash-by-date report grouped by the UTC prefix, so both rows
 * showed on the previous day while Profits and Dashboard (which shift by the
 * browser's offset) showed them on the right one.
 *
 * Written FIRST and run against the old UTC-prefix queries (rule 17).
 */
import type Database from "better-sqlite3";
import { installWarrantyTestDb, uninstallWarrantyTestDb } from "../testHelpers/warrantyDb";
import { resetTenantContext, runWithTenant } from "../../db/tenantContext";
import { getTransactionRepository, resetTransactionRepository } from "../TransactionRepository";

let db: Database.Database;
const BEIRUT = 180; // minutes east of UTC (the browser sends -getTimezoneOffset())

function addSale(id: number, createdAt: string, usd: number) {
  db.prepare(
    `INSERT INTO transactions (id, tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, created_at)
     VALUES (?, 1, 'SALE', 'ACTIVE', 'sales', ?, 1, ?, 0, ?)`,
  ).run(id, id, usd, createdAt);
  db.prepare(
    `INSERT INTO payments (tenant_id, transaction_id, method, drawer_name, currency_code, amount, created_at)
     VALUES (1, ?, 'CASH', 'General', 'USD', ?, ?)`,
  ).run(id, usd, createdAt);
}

beforeAll(() => {
  db = installWarrantyTestDb();
  // 00:30 Beirut on Oct 10 = 21:30 UTC on Oct 9, in both stored shapes.
  addSale(9001, "2026-10-09T21:30:00.000Z", 10);
  addSale(9002, "2026-10-09 21:30:00", 5);
  // A control at 20:00 UTC Oct 9 = 23:00 Beirut Oct 9: stays on Oct 9.
  addSale(9003, "2026-10-09 20:00:00", 1);
});

afterAll(() => {
  resetTenantContext();
  uninstallWarrantyTestDb(db);
});

beforeEach(() => resetTransactionRepository());

const inBeirut = <T>(fn: () => T) => runWithTenant(1, fn, { clientTzOffsetMinutes: BEIRUT });

describe("day bucketing uses the shop's local date", () => {
  it("getDailySummary puts both after-midnight shapes on the Beirut date", () => {
    const oct10 = inBeirut(() => getTransactionRepository().getDailySummary("2026-10-10"));
    const oct9 = inBeirut(() => getTransactionRepository().getDailySummary("2026-10-09"));
    expect(oct10.total_usd).toBe(15);
    expect(oct9.total_usd).toBe(1);
  });

  it("getCashFlowByDate puts both after-midnight shapes on the Beirut date", () => {
    const rows = inBeirut(() => getTransactionRepository().getCashFlowByDate("2026-10-09", "2026-10-10"));
    const usd = (date: string) => rows.find((r) => r.date === date && r.currency_code === "USD")?.total_in ?? 0;
    expect(usd("2026-10-10")).toBe(15);
    expect(usd("2026-10-09")).toBe(1);
  });
});

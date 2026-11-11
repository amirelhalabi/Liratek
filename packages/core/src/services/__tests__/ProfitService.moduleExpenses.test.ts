/**
 * LIRA-385 (owner decision 2026-11-11, "Per-module columns + Other row") —
 * the Profits page's By Module tab shows each module's expenses next to its
 * profit, plus a final "Other expenses (not linked to a module)" row.
 *
 * INVARIANT: Σ(module expenses) + Other = the Overview's `summary.expenses`,
 * per currency — same `activeExpense()` gate, same `expense_date` range.
 * Otherwise the new column and the existing "gross − expenses = net" row
 * under the table disagree.
 *
 * Attribution is ONLY through the expense's own `source_ref_table` /
 * `source_ref_id` link. Everything else (manual expenses, Line usage, Drawer
 * shortage, a voucher discount, an OMT credit not accepted, a dangling
 * link) lands in Other.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { ProfitRepository } from "../../repositories/ProfitRepository";
import { ProfitService } from "../ProfitService";
import { OTHER_EXPENSES_MODULE_KEY } from "../../constants/profitModuleDetailSupport";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const FROM = "2026-11-01";
const TO = "2026-11-30";
const IN_RANGE = "2026-11-05 12:00:00";
let db: Database.Database;
let profits: ProfitService;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(
    fs.readFileSync(
      path.join(REPO_ROOT, "electron-app/create_db.sql"),
      "utf-8",
    ),
  );
  initDatabase(db);
  runMigrations(db);
  initFixedTenantContext(1);
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username) VALUES (1, 'owner')`,
  ).run();
  profits = new ProfitService(new ProfitRepository());
});
afterEach(() => {
  resetTenantContext();
  db.close();
});

function insertRecharge(carrier: string): number {
  const id = Number(
    db
      .prepare(
        `INSERT INTO recharges (tenant_id, carrier, recharge_type, amount, cost, price, currency_code, created_at)
         VALUES (1, ?, 'CREDIT_TRANSFER', 10, 8, 10, 'USD', ?)`,
      )
      .run(carrier, IN_RANGE).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, summary, created_at)
     VALUES (1, 'RECHARGE', 'ACTIVE', 'recharges', ?, 1, 10, 2, ?, ?)`,
  ).run(id, `${carrier} credit transfer $10`, IN_RANGE);
  return id;
}

function insertExpense(e: {
  category: string;
  usd?: number;
  lbp?: number;
  table?: string | null;
  refId?: number | null;
  date?: string;
  status?: string;
  refunded?: number;
}): number {
  return Number(
    db
      .prepare(
        `INSERT INTO expenses (tenant_id, description, category, amount_usd, amount_lbp, expense_date, status, is_refunded, source_ref_table, source_ref_id)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `${e.category} expense`,
        e.category,
        e.usd ?? 0,
        e.lbp ?? 0,
        e.date ?? IN_RANGE,
        e.status ?? "active",
        e.refunded ?? 0,
        e.table ?? null,
        e.refId ?? null,
      ).lastInsertRowid,
  );
}

function seed() {
  const mtc = insertRecharge("MTC");
  // Linked to the MTC recharge → RECHARGE_MTC (USD + LBP).
  insertExpense({
    category: "SMS_Transfer_Fee",
    usd: 0.3,
    table: "recharges",
    refId: mtc,
  });
  insertExpense({
    category: "Change_Rounding",
    lbp: 30000,
    table: "recharges",
    refId: mtc,
  });
  // Reversed / deleted / out of range: counted nowhere.
  insertExpense({
    category: "SMS_Transfer_Fee",
    usd: 7,
    table: "recharges",
    refId: mtc,
    refunded: 1,
  });
  insertExpense({
    category: "SMS_Transfer_Fee",
    usd: 9,
    table: "recharges",
    refId: mtc,
    status: "deleted",
  });
  insertExpense({
    category: "Shop_Supply",
    usd: 11,
    date: "2026-10-15 12:00:00",
  });
  // A linked expense whose module has no profit row this period (an OMT
  // transfer not settled yet) → its own expense-only row, never lost.
  const fsId = Number(
    db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency, is_settled, created_at)
         VALUES (1, 'OMT', 'SEND', 100, 'USD', 0, ?)`,
      )
      .run(IN_RANGE).lastInsertRowid,
  );
  insertExpense({
    category: "Change_Rounding",
    usd: 0.5,
    table: "financial_services",
    refId: fsId,
  });
  // Hold Money has no transaction drill-down — expense-only row.
  insertExpense({
    category: "Change_Rounding",
    usd: 0.25,
    table: "hold_money_pickups",
    refId: 1,
  });
  // Not attributable → Other.
  insertExpense({ category: "Shop_Supply", usd: 5 });
  insertExpense({ category: "Line_Usage", usd: 1 });
  insertExpense({ category: "Bill", lbp: 450000 });
  insertExpense({
    category: "OMT_Credit_Removed",
    usd: 2,
    table: "supplier_ledger",
    refId: 1,
  });
  insertExpense({
    category: "Drawer_Shortage",
    usd: 3,
    table: "checkpoint_differences",
    refId: 1,
  });
  insertExpense({
    category: "Discount_Given",
    usd: 4,
    table: "vouchers",
    refId: 1,
  });
  // Dangling link (the recharge row does not exist) → Other.
  insertExpense({
    category: "SMS_Transfer_Fee",
    usd: 0.6,
    table: "recharges",
    refId: 9999,
  });
  return { mtc };
}

describe("LIRA-385 — By Module expenses", () => {
  it("Σ module expenses + Other = summary.expenses, per currency", () => {
    seed();
    const rows = profits.getByModule(FROM, TO);
    const summary = profits.getSummary(FROM, TO);
    const sumUsd = rows.reduce((s, r) => s + r.expenses_usd, 0);
    const sumLbp = rows.reduce((s, r) => s + r.expenses_lbp, 0);
    expect(sumUsd).toBeCloseTo(summary.expenses.total_usd, 6);
    expect(sumLbp).toBeCloseTo(summary.expenses.total_lbp, 6);
    // Sanity: the fixture is not vacuous.
    expect(summary.expenses.total_usd).toBeCloseTo(
      0.3 + 0.5 + 0.25 + 5 + 1 + 2 + 3 + 4 + 0.6,
      6,
    );
    expect(summary.expenses.total_lbp).toBe(480000);
  });

  it("attributes linked expenses to their module row", () => {
    seed();
    const rows = profits.getByModule(FROM, TO);
    const mtc = rows.find((r) => r.module === "RECHARGE_MTC")!;
    expect(mtc.expenses_usd).toBeCloseTo(0.3, 6);
    expect(mtc.expenses_lbp).toBe(30000);
    expect(mtc.profit_usd).toBe(2);
  });

  it("a linked expense whose module has no profit row gets an expense-only row", () => {
    seed();
    const rows = profits.getByModule(FROM, TO);
    const omt = rows.find((r) => r.module === "FINANCIAL_SERVICE_OMT")!;
    expect(omt).toBeDefined();
    expect(omt.expenses_usd).toBeCloseTo(0.5, 6);
    expect(omt.profit_usd).toBe(0);
    expect(omt.count).toBe(0);
    const hold = rows.find((r) => r.module === "HOLD_MONEY")!;
    expect(hold.expenses_usd).toBeCloseTo(0.25, 6);
    expect(hold.label).toBe("Hold Money");
  });

  it("unattributable expenses land in the Other row, pinned last", () => {
    seed();
    const rows = profits.getByModule(FROM, TO);
    const other = rows[rows.length - 1];
    expect(other.module).toBe(OTHER_EXPENSES_MODULE_KEY);
    expect(other.expenses_usd).toBeCloseTo(5 + 1 + 2 + 3 + 4 + 0.6, 6);
    expect(other.expenses_lbp).toBe(450000);
    expect(other.profit_usd).toBe(0);
    expect(other.revenue_usd).toBe(0);
    expect(other.count).toBe(0);
  });

  it("no Other row when every expense is attributed", () => {
    const mtc = insertRecharge("MTC");
    insertExpense({
      category: "SMS_Transfer_Fee",
      usd: 0.3,
      table: "recharges",
      refId: mtc,
    });
    const rows = profits.getByModule(FROM, TO);
    expect(
      rows.find((r) => r.module === OTHER_EXPENSES_MODULE_KEY),
    ).toBeUndefined();
  });

  it("module detail lists the module's expenses with the linked transaction's summary", () => {
    seed();
    const detail = profits.getModuleDetail("RECHARGE_MTC", FROM, TO);
    expect(detail.expenses).toHaveLength(2);
    const usd = detail.expenses.reduce((s, e) => s + e.amount_usd, 0);
    const lbp = detail.expenses.reduce((s, e) => s + e.amount_lbp, 0);
    expect(usd).toBeCloseTo(0.3, 6);
    expect(lbp).toBe(30000);
    expect(
      detail.expenses.every(
        (e) => e.linked_summary === "MTC credit transfer $10",
      ),
    ).toBe(true);
    expect(detail.expenses.map((e) => e.category).sort()).toEqual([
      "Change_Rounding",
      "SMS_Transfer_Fee",
    ]);
  });

  it("each list sums to its row's column (Other included)", () => {
    seed();
    const rows = profits.getByModule(FROM, TO);
    for (const row of rows.filter(
      (r) => r.expenses_usd !== 0 || r.expenses_lbp !== 0,
    )) {
      const detail = profits.getModuleDetail(row.module, FROM, TO);
      expect(detail.expenses.reduce((s, e) => s + e.amount_usd, 0)).toBeCloseTo(
        row.expenses_usd,
        6,
      );
      expect(detail.expenses.reduce((s, e) => s + e.amount_lbp, 0)).toBeCloseTo(
        row.expenses_lbp,
        6,
      );
    }
    const other = profits.getModuleDetail(OTHER_EXPENSES_MODULE_KEY, FROM, TO);
    expect(other.counted).toEqual([]);
    expect(other.expenses).toHaveLength(7);
  });

  it("a module with no transaction drill-down still serves its expense list; an unknown key still fails", () => {
    seed();
    expect(
      profits.getModuleDetail("HOLD_MONEY", FROM, TO).expenses,
    ).toHaveLength(1);
    expect(() => profits.getModuleDetail("NO_SUCH_MODULE", FROM, TO)).toThrow(
      /No transaction-level detail/,
    );
  });
});

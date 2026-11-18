/**
 * LIRA-396 — Profits page → By module → "Show transactions" (the drill-down).
 *
 * US1  A Katsh/iPick "Only Days" row reads price − cost = profit. The stored
 *      `financial_services.cost` stays GROSS (the Katsh drawer paid the whole
 *      card and the Suppliers views read it) — only the drill-down's cost
 *      column nets the returned credits out (spec D1, research.md §1).
 * US2  The Detail column reuses the module's own wording (the transaction
 *      summary) — never the raw enum, never a blank cell.
 * US3  KEPT_CHANGE / TOPUP_BUYBACK do not list $0 rows; Σ counted still
 *      equals the By Module row.
 *
 * Real schema (create_db.sql + every migration), real write paths.
 * Rule 17: each guard was run on the unfixed code first — the recorded
 * failures are in specs/396-profits-labels-cost/tasks.md ("Failing-first log").
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
import { FinancialServiceRepository } from "../../repositories/FinancialServiceRepository";
import { TransactionRepository } from "../../repositories/TransactionRepository";
import { LotoTicketRepository } from "../../repositories/LotoTicketRepository";
import { DebtRepository } from "../../repositories/DebtRepository";
import { RechargeRepository } from "../../repositories/RechargeRepository";
import { ProfitService } from "../ProfitService";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const FROM = "2000-01-01";
const TO = "2099-12-31";
let db: Database.Database;
let profits: ProfitService;
let fsRepo: FinancialServiceRepository;

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
  fsRepo = new FinancialServiceRepository();
});
afterEach(() => {
  resetTenantContext();
  db.close();
});

function drawer(name: string, currency: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ? AND tenant_id = 1`,
    )
    .get(name, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

function txnOfFs(fsId: number): { id: number; profit_lbp: number } {
  return db
    .prepare(
      `SELECT id, profit_lbp FROM transactions WHERE source_table = 'financial_services' AND source_id = ? AND type = 'FINANCIAL_SERVICE'`,
    )
    .get(fsId) as { id: number; profit_lbp: number };
}

/** A Katsh MTC card sold for its days: the customer pays the Only Days
 *  price, the shop's line gets the credits back (KatshForm's payload). */
function sellOnlyDays(opts: {
  price: number;
  grossCost: number;
  creditsPerUnit: number;
  units: number;
}): number {
  const res = fsRepo.createTransaction({
    provider: "Katsh",
    serviceType: "SEND",
    amount: opts.price,
    currency: "LBP",
    commission: 0,
    cost: opts.grossCost,
    price: opts.price,
    paidByMethod: "CASH",
    note: `mtc: 7.58 (Prepaid)${opts.units > 1 ? ` x${opts.units}` : ""} [Only Days]`,
    telecomCreditReturns: Array.from({ length: opts.units }, () => ({
      itemCategory: "mtc",
      returnedCreditsUsd: opts.creditsPerUnit,
    })),
  });
  return res.id;
}

describe("US1 — an Only Days row reads price − cost = profit", () => {
  it("the drill-down's cost is the net cost; price − cost equals the stamped profit (qty 2)", () => {
    const id = sellOnlyDays({
      price: 600_000,
      grossCost: 1_530_014,
      creditsPerUnit: 6,
      units: 2,
    });
    const { profit_lbp } = txnOfFs(id);
    // R = 85,000 (v148 re-anchor): 12 credits back = 1,020,000 LBP.
    expect(profit_lbp).toBeCloseTo(600_000 - 1_530_014 + 12 * 85_000, 2);

    const detail = profits.getModuleDetail("FINANCIAL_SERVICE_Katsh", FROM, TO);
    const row = [...detail.counted, ...detail.not_counted].find(
      (r) => r.id === id && r.source === "financial_service_transfer",
    );
    expect(row).toBeDefined();
    expect(row!.amount_lbp).toBe(600_000);
    expect(row!.amount_lbp - row!.cost_lbp).toBeCloseTo(row!.profit_lbp, 2);
    expect(row!.cost_lbp).toBeCloseTo(1_530_014 - 12 * 85_000, 2);
  });

  it("By Module and the Overview sum the same net cost the drill-down shows (396 hand-off, rule 14)", () => {
    // One Only Days line + one normal line: the module row's cost must be the
    // sum of its drill-down rows, not the gross card cost.
    sellOnlyDays({
      price: 600_000,
      grossCost: 1_530_014,
      creditsPerUnit: 6,
      units: 2,
    });
    fsRepo.createTransaction({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 900_000,
      currency: "LBP",
      commission: 0,
      cost: 765_007,
      price: 900_000,
      paidByMethod: "CASH",
      note: "mtc: 7.58 (Prepaid)",
    });
    const expectedCost = 1_530_014 - 12 * 85_000 + 765_007;

    const detail = profits.getModuleDetail("FINANCIAL_SERVICE_Katsh", FROM, TO);
    const drilldownCost = [...detail.counted, ...detail.not_counted].reduce(
      (sum, r) => sum + r.cost_lbp,
      0,
    );
    expect(drilldownCost).toBeCloseTo(expectedCost, 2);

    const moduleRow = profits
      .getByModule(FROM, TO)
      .find((m) => m.module === "FINANCIAL_SERVICE_Katsh");
    expect(moduleRow).toBeDefined();
    expect(moduleRow!.cost_lbp).toBeCloseTo(expectedCost, 2);

    const byCurrency = new ProfitRepository()
      .getMobileServicesByCurrency(`${FROM} 00:00:00`, `${TO} 23:59:59`)
      .find((c) => c.currency === "LBP");
    expect(byCurrency).toBeDefined();
    expect(byCurrency!.cost).toBeCloseTo(expectedCost, 2);
  });

  it("a normal catalog line (no credits back) keeps its stored cost", () => {
    const res = fsRepo.createTransaction({
      provider: "Katsh",
      serviceType: "SEND",
      amount: 900_000,
      currency: "LBP",
      commission: 0,
      cost: 765_007,
      price: 900_000,
      paidByMethod: "CASH",
      note: "mtc: 7.58 (Prepaid)",
    });
    const detail = profits.getModuleDetail("FINANCIAL_SERVICE_Katsh", FROM, TO);
    const row = detail.counted.find((r) => r.id === res.id);
    expect(row).toBeDefined();
    expect(row!.cost_lbp).toBe(765_007);
    expect(row!.profit_lbp).toBe(900_000 - 765_007);
  });

  it("the Suppliers history still shows the GROSS cost the Katsh drawer paid (stored cost untouched)", () => {
    const id = sellOnlyDays({
      price: 300_000,
      grossCost: 765_007,
      creditsPerUnit: 6,
      units: 1,
    });
    const stored = db
      .prepare(`SELECT cost FROM financial_services WHERE id = ?`)
      .get(id) as { cost: number };
    expect(stored.cost).toBe(765_007);
    const history = fsRepo.getAllByProvider("Katsh");
    const row = history.find((r) => r.id === id);
    expect(row).toBeDefined();
    expect(row!.amount).toBe(765_007);
  });

  // Rule 20 — not proven failing-first: no write path changed in this
  // ticket; this is a regression guard that create + refund of an Only Days
  // line nets to 0 on every ledger it touches.
  it("create + refund nets to 0 per currency on the Katsh drawer, the MTC credit drawer, the carrier line and profit", () => {
    db.prepare(
      `INSERT INTO carrier_lines (tenant_id, carrier, phone_number, label, is_primary, credits, validity_expires_at)
       VALUES (1, 'mtc', '03000000', 'Shop MTC', 1, 0, '2099-01-01')`,
    ).run();
    const before = {
      katsh: drawer("Katsh", "LBP"),
      mtc: drawer("MTC", "USD"),
      cash: drawer("General", "LBP"),
    };
    const id = sellOnlyDays({
      price: 300_000,
      grossCost: 765_007,
      creditsPerUnit: 6,
      units: 1,
    });
    const txn = txnOfFs(id);
    // Prove each ledger really moved on create, so "back to before" after
    // the refund means something (rule 28a).
    const cashDrawer = (
      db
        .prepare(
          `SELECT drawer_name FROM payments WHERE transaction_id = ? AND method = 'CASH' AND amount > 0 LIMIT 1`,
        )
        .get(txn.id) as { drawer_name: string }
    ).drawer_name;
    const cashBefore = cashDrawer === "General" ? before.cash : 0;
    expect(drawer(cashDrawer, "LBP")).toBeCloseTo(cashBefore + 300_000, 2);
    expect(drawer("Katsh", "LBP")).toBeCloseTo(before.katsh - 765_007, 2);
    expect(drawer("MTC", "USD")).toBeCloseTo(before.mtc + 6, 4);
    expect(
      (
        db
          .prepare(
            `SELECT credits FROM carrier_lines WHERE tenant_id = 1 AND carrier = 'mtc'`,
          )
          .get() as { credits: number }
      ).credits,
    ).toBeCloseTo(6, 4);

    new TransactionRepository().refundTransaction(txn.id, 1);

    expect(drawer("Katsh", "LBP")).toBeCloseTo(before.katsh, 2);
    expect(drawer("MTC", "USD")).toBeCloseTo(before.mtc, 4);
    expect(drawer(cashDrawer, "LBP")).toBeCloseTo(cashBefore, 2);
    // The movement is reversed in place (is_reversed = 1) and the line's
    // balance restored — CarrierLineService.reverseMovement.
    const line = db
      .prepare(
        `SELECT credits FROM carrier_lines WHERE tenant_id = 1 AND carrier = 'mtc'`,
      )
      .get() as { credits: number };
    expect(line.credits).toBeCloseTo(0, 4);
    const liveMovements = db
      .prepare(
        `SELECT COALESCE(SUM(credits_delta), 0) AS n, COUNT(*) AS c FROM carrier_line_movements WHERE tenant_id = 1 AND is_reversed = 0`,
      )
      .get() as { n: number; c: number };
    expect(liveMovements.n).toBeCloseTo(0, 4);
    const profitNet = db
      .prepare(
        `SELECT COALESCE(SUM(profit_lbp), 0) AS lbp, COALESCE(SUM(profit_usd), 0) AS usd FROM transactions WHERE tenant_id = 1 AND (id = ? OR reverses_id = ?)`,
      )
      .get(txn.id, txn.id) as { lbp: number; usd: number };
    expect(profitNet.lbp).toBeCloseTo(0, 2);
    expect(profitNet.usd).toBeCloseTo(0, 4);
  });
});

function summaryOf(txnId: number): string {
  return (
    db.prepare(`SELECT summary FROM transactions WHERE id = ?`).get(txnId) as {
      summary: string;
    }
  ).summary;
}

/** A legacy-shaped row (Cornertech #70 / #103 style) on the real schema:
 *  the module row plus its unified transaction carrying a summary. */
function insertLegacy(
  table: "maintenance" | "custom_services",
  blankLabel: string,
  summary: string | null,
): number {
  const id =
    table === "maintenance"
      ? Number(
          db
            .prepare(
              `INSERT INTO maintenance (tenant_id, client_name, device_name, final_amount_usd, cost_usd, status, created_at)
               VALUES (1, 'Rami', ?, 50, 20, 'Delivered_Paid', '2026-11-10 10:00:00')`,
            )
            .run(blankLabel).lastInsertRowid,
        )
      : Number(
          db
            .prepare(
              `INSERT INTO custom_services (tenant_id, description, price_usd, cost_usd, status, client_name, created_at)
               VALUES (1, ?, 30, 10, 'completed', 'Rami', '2026-11-10 10:00:00')`,
            )
            .run(blankLabel).lastInsertRowid,
        );
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, profit_usd, summary, created_at)
     VALUES (1, ?, 'ACTIVE', ?, ?, 1, ?, ?, ?, '2026-11-10 10:00:00')`,
  ).run(
    table === "maintenance" ? "MAINTENANCE" : "CUSTOM_SERVICE",
    table,
    id,
    table === "maintenance" ? 50 : 30,
    table === "maintenance" ? 30 : 20,
    summary,
  );
  return id;
}

describe("US2 — the Detail column uses the module's own wording", () => {
  it("a financial-service row reads its transaction summary, not the SEND enum", () => {
    const id = sellOnlyDays({
      price: 300_000,
      grossCost: 765_007,
      creditsPerUnit: 6,
      units: 1,
    });
    const txn = txnOfFs(id);
    const summary = summaryOf(txn.id);
    expect(summary).toBeTruthy();
    const detail = profits.getModuleDetail("FINANCIAL_SERVICE_Katsh", FROM, TO);
    const row = detail.counted.find((r) => r.id === id);
    expect(row!.detail).toBe(summary);
    expect(row!.detail).not.toBe("SEND");
  });

  it("a legacy financial-service row with no summary falls back to the enum", () => {
    const id = sellOnlyDays({
      price: 300_000,
      grossCost: 765_007,
      creditsPerUnit: 6,
      units: 1,
    });
    db.prepare(`UPDATE transactions SET summary = NULL WHERE id = ?`).run(
      txnOfFs(id).id,
    );
    const detail = profits.getModuleDetail("FINANCIAL_SERVICE_Katsh", FROM, TO);
    expect(detail.counted.find((r) => r.id === id)!.detail).toBe("SEND");
  });

  it("a loto ticket with no ticket number reads its transaction summary, not 'Loto ticket'", () => {
    const ticket = new LotoTicketRepository(db).createTicket({
      sale_amount: 100_000,
      commission_amount: 15_000,
      sale_date: "2026-11-10",
      payment_method: "CASH",
      currency: "LBP",
      userId: 1,
    });
    const txn = db
      .prepare(
        `SELECT id, summary FROM transactions WHERE type = 'LOTO' AND source_id = ?`,
      )
      .get(ticket.id) as { id: number; summary: string };
    expect(txn.summary).toBeTruthy();
    const detail = profits.getModuleDetail("LOTO", FROM, TO);
    const row = [...detail.counted, ...detail.not_counted].find(
      (r) => r.id === ticket.id,
    );
    expect(row).toBeDefined();
    expect(row!.detail).toBe(txn.summary);
  });

  it("a repair job with a blank device name reads its summary, else 'Repair job #id' — never blank", () => {
    const withSummary = insertLegacy(
      "maintenance",
      "",
      "Repair: screen cracked",
    );
    const bare = insertLegacy("maintenance", "  ", null);
    const detail = profits.getModuleDetail("MAINTENANCE", FROM, TO);
    const rows = [...detail.counted, ...detail.not_counted];
    expect(rows.find((r) => r.id === withSummary)!.detail).toBe(
      "Repair: screen cracked",
    );
    expect(rows.find((r) => r.id === bare)!.detail).toBe(`Repair job #${bare}`);
  });

  it("a custom service with a blank description reads its summary, else 'Custom service #id' — never blank", () => {
    const withSummary = insertLegacy("custom_services", "", "Phone unlock");
    const bare = insertLegacy("custom_services", "", null);
    const detail = profits.getModuleDetail("CUSTOM_SERVICE", FROM, TO);
    const rows = [...detail.counted, ...detail.not_counted];
    expect(rows.find((r) => r.id === withSummary)!.detail).toBe("Phone unlock");
    expect(rows.find((r) => r.id === bare)!.detail).toBe(
      `Custom service #${bare}`,
    );
  });
});

describe("US3 — no $0 rows in KEPT_CHANGE / TOPUP_BUYBACK", () => {
  beforeEach(() => {
    db.prepare(
      `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (7, 1, 'Jane Client', '70123456')`,
    ).run();
    // The top-up pays the client out of General.
    db.prepare(
      `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'USD', 1000)
       ON CONFLICT DO UPDATE SET balance = 1000`,
    ).run();
  });

  function moduleRow(key: string) {
    return profits
      .getByModule("2000-01-01", "2099-12-31")
      .find((m) => m.module === key);
  }

  it("KEPT_CHANGE: a repayment with no kept change is not listed; the kept one is, and Σ counted equals the module row", () => {
    const debt = new DebtRepository();
    debt.addRepayment({
      client_id: 7,
      amount_usd: 20,
      amount_lbp: 0,
      created_by: 1,
    });
    debt.addRepayment({
      client_id: 7,
      amount_usd: 100,
      amount_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 105 }],
      kept_change_usd: 5,
      tender_exchange_rate: 89_500,
    });
    const detail = profits.getModuleDetail("KEPT_CHANGE", FROM, TO);
    const all = [...detail.counted, ...detail.not_counted];
    expect(
      all.filter((r) => r.profit_usd === 0 && r.profit_lbp === 0),
    ).toHaveLength(0);
    expect(detail.counted).toHaveLength(1);
    expect(detail.counted_total_profit_usd).toBeCloseTo(5, 6);
    expect(moduleRow("KEPT_CHANGE")!.profit_usd).toBeCloseTo(
      detail.counted_total_profit_usd,
      6,
    );
  });

  it("TOPUP_BUYBACK: a $0 client top-up is not listed; a paid one shows the client's name and Σ counted equals the module row", () => {
    const recharge = new RechargeRepository();
    recharge.topUpFromClient({
      amount: 50,
      fee: 0,
      currency: "USD",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 50 }],
      clientId: 7,
      userId: 1,
    });
    recharge.topUpFromClient({
      amount: 100,
      fee: 5,
      currency: "USD",
      payments: [{ method: "CASH", currencyCode: "USD", amount: 95 }],
      clientId: 7,
      userId: 1,
    });
    const detail = profits.getModuleDetail("TOPUP_BUYBACK", FROM, TO);
    const all = [...detail.counted, ...detail.not_counted];
    expect(all).toHaveLength(1);
    expect(all[0].profit_usd).toBeCloseTo(5, 6);
    expect(all[0].counterpart).toBe("Jane Client");
    expect(moduleRow("TOPUP_BUYBACK")!.profit_usd).toBeCloseTo(
      detail.counted_total_profit_usd,
      6,
    );
  });
});

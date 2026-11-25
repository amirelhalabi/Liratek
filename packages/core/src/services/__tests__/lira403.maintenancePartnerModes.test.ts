/**
 * LIRA-403 — the partner switch on repair jobs (owner decisions 2026-11-24,
 * `specs/403-maintenance-partner-modes/spec.md`). Same meaning as Custom
 * Services' [ Customer | For Partner | Via Partner ]:
 *   - For Partner: no counter payment, the partner owes the full price
 *     (`FOR_MAINTENANCE` DEBIT per currency), no drawer moves, profit counts
 *     as the partner settles.
 *   - Via Partner: the customer pays as usual, the shop owes the partner the
 *     labour cost (`THROUGH_MAINTENANCE` CREDIT).
 * Refund / void of either nets partner ledger, drawers and profit to 0 per
 * currency (rule 20) through the generic `_reversePartnerLedger`.
 *
 * Real writers on the REAL `electron-app/create_db.sql` schema. Every payload
 * goes through `saveMaintenanceJobSchema.parse` first, exactly as both
 * transports do, so a key the schema does not know is stripped here too
 * (rule 23) and this guard fails on an assertion, never on a compile error.
 */
import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { MaintenanceRepository } from "../../repositories/MaintenanceRepository.js";
import {
  MaintenanceService,
  type SaveJobParams,
} from "../MaintenanceService.js";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../../repositories/TransactionRepository.js";
import { resetStockBatchRepository } from "../../repositories/StockBatchRepository.js";
import {
  getPartnerRepository,
  resetPartnerRepository,
} from "../../repositories/PartnerRepository.js";
import { ProfitRepository } from "../../repositories/ProfitRepository.js";
import { ProfitService } from "../ProfitService.js";
import { ClosingRepository } from "../../repositories/ClosingRepository.js";
import { ClosingService } from "../ClosingService.js";
import { runWithTenant } from "../../db/tenantContext.js";
import { saveMaintenanceJobSchema } from "../../validators/maintenance.js";

const SCHEMA = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "electron-app",
    "create_db.sql",
  ),
  "utf-8",
);

let db: Database.Database;
let partnerId = 0;
let productId = 0;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(SCHEMA);
  db.pragma("foreign_keys = OFF");
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  resetTransactionRepository();
  resetStockBatchRepository();
  resetPartnerRepository();
  partnerId = Number(
    db
      .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, 'Tech Sami')`)
      .run().lastInsertRowid,
  );
  productId = Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, 'Screen', 'Part', 20, 30, 10)`,
      )
      .run().lastInsertRowid,
  );
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  resetTransactionRepository();
  resetStockBatchRepository();
  resetPartnerRepository();
  db?.close();
});

const t1 = <T>(fn: () => T): T => runWithTenant(1, fn);
const svc = () => new MaintenanceService(new MaintenanceRepository());
const r2 = (x: number | null | undefined) => Math.round((x ?? 0) * 100) / 100;

/** Through the schema, like both transports (rule 23). */
function save(
  payload: Record<string, unknown>,
  extra: Partial<SaveJobParams> = {},
) {
  const parsed = saveMaintenanceJobSchema.parse(payload);
  return t1(() => svc().saveJob({ ...(parsed as SaveJobParams), ...extra }, 1));
}

function ledger(jobId: number) {
  return db
    .prepare(
      `SELECT transaction_type, direction, amount, currency, partner_id
         FROM partner_ledger
        WHERE reference_table = 'maintenance' AND reference_id = ?
        ORDER BY id`,
    )
    .all(jobId) as {
    transaction_type: string;
    direction: "DEBIT" | "CREDIT";
    amount: number;
    currency: string;
    partner_id: number;
  }[];
}

/** Partner position per currency: + = partner owes the shop. */
function partnerNet(cur: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN direction='DEBIT' THEN amount ELSE -amount END),0) AS n
         FROM partner_ledger WHERE partner_id = ? AND currency = ?`,
    )
    .get(partnerId, cur) as { n: number };
  return r2(row.n);
}

function drawer(name: string, cur: string): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name=? AND currency_code=? AND tenant_id=1`,
    )
    .get(name, cur) as { balance: number } | undefined;
  return r2(row?.balance);
}

function jobTxn(jobId: number) {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_name
         FROM transactions
        WHERE source_table='maintenance' AND source_id=? AND type='MAINTENANCE' AND reverses_id IS NULL
        ORDER BY id DESC LIMIT 1`,
    )
    .get(jobId) as
    | {
        id: number;
        amount_usd: number;
        amount_lbp: number;
        profit_usd: number;
        profit_lbp: number;
        client_name: string | null;
      }
    | undefined;
}

/** Net stamped profit over every row of the job (charge + reversals). */
function netProfit(jobId: number) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd),0) AS u, COALESCE(SUM(profit_lbp),0) AS l
         FROM transactions WHERE source_table='maintenance' AND source_id=?
           AND status <> 'VOIDED'`,
    )
    .get(jobId) as { u: number; l: number };
  return { usd: r2(row.u), lbp: r2(row.l) };
}

const RANGE: [string, string] = ["2000-01-01 00:00:00", "2999-12-31 23:59:59"];

const base = {
  device_name: "iPhone 12",
  issue_description: "Screen",
  client_name: "Rami",
  client_phone: "",
  currency: "USD",
  cost_usd: 40,
  price_usd: 100,
  final_amount_usd: 100,
  exchange_rate: 89500,
};

const cash100 = [{ method: "CASH", currency_code: "USD", amount: 100 }];

describe("LIRA-403 For Partner", () => {
  it("books a FOR_MAINTENANCE DEBIT for the full price and moves no drawer", () => {
    const res = save({
      ...base,
      status: "Delivered_Paid",
      partner_mode: "FOR",
      partner_id: partnerId,
    });
    expect(res).toEqual({ success: true, id: expect.any(Number) });
    const jobId = res.id!;

    expect(ledger(jobId)).toEqual([
      {
        transaction_type: "FOR_MAINTENANCE",
        direction: "DEBIT",
        amount: 100,
        currency: "USD",
        partner_id: partnerId,
      },
    ]);
    const txn = jobTxn(jobId)!;
    expect(txn).toBeDefined();
    expect(txn.amount_usd).toBe(100);
    expect(txn.profit_usd).toBe(60);
    expect(txn.client_name).toBe("Tech Sami [partner]");
    expect(drawer("General", "USD")).toBe(0);
    expect(
      db
        .prepare(`SELECT COUNT(*) AS n FROM payments WHERE transaction_id = ?`)
        .get(txn.id),
    ).toEqual({ n: 0 });
    // The job remembers its partner.
    const job = db
      .prepare(`SELECT partner_mode, partner_id FROM maintenance WHERE id = ?`)
      .get(jobId);
    expect(job).toEqual({ partner_mode: "FOR", partner_id: partnerId });
  });

  it("an LBP job with parts books one DEBIT per currency (labour LBP + parts USD)", () => {
    const res = save({
      device_name: "Galaxy",
      client_name: "Rami",
      client_phone: "",
      currency: "LBP",
      cost_lbp: 500_000,
      price_lbp: 2_000_000,
      final_amount_lbp: 2_000_000,
      price_usd: 0.01, // schema: price_usd is required positive on every job
      exchange_rate: 89500,
      status: "Delivered_Paid",
      parts: [{ product_id: productId, quantity: 1 }],
      partner_mode: "FOR",
      partner_id: partnerId,
    });
    expect(res.success).toBe(true);
    const rows = ledger(res.id!);
    expect(
      rows.map((r) => [r.transaction_type, r.direction, r.currency, r.amount]),
    ).toEqual([
      ["FOR_MAINTENANCE", "DEBIT", "LBP", 2_000_000],
      ["FOR_MAINTENANCE", "DEBIT", "USD", 30],
    ]);
    const txn = jobTxn(res.id!)!;
    expect(txn.amount_lbp).toBe(2_000_000);
    expect(txn.amount_usd).toBe(30);
  });

  it("a job received for a partner then delivered bills once; resaving the paid job does not bill again", () => {
    const created = save({
      ...base,
      status: "Received",
      partner_mode: "FOR",
      partner_id: partnerId,
    });
    const id = created.id!;
    expect(ledger(id)).toEqual([]);
    // Status step: no partner keys sent — the stored mode stays.
    expect(save({ ...base, id, status: "Ready" }).success).toBe(true);
    expect(save({ ...base, id, status: "Delivered_Paid" }).success).toBe(true);
    expect(ledger(id)).toHaveLength(1);
    // Notes edit of the delivered job.
    expect(
      save({ ...base, id, status: "Delivered_Paid", note: "picked up" })
        .success,
    ).toBe(true);
    expect(ledger(id)).toHaveLength(1);
  });

  it("refuses payment legs, an extra, a missing partner, and a session basket", () => {
    expect(() =>
      saveMaintenanceJobSchema.parse({
        ...base,
        status: "Delivered_Paid",
        partner_mode: "FOR",
        partner_id: partnerId,
        payments: cash100,
      }),
    ).toThrow();
    expect(() =>
      saveMaintenanceJobSchema.parse({
        ...base,
        status: "Delivered_Paid",
        partner_mode: "FOR",
      }),
    ).toThrow();
    expect(() =>
      saveMaintenanceJobSchema.parse({
        ...base,
        status: "Delivered_Paid",
        partner_mode: "VIA",
        partner_id: partnerId,
        payments: [{ method: "CASH", currency_code: "USD", amount: 110 }],
        extra_usd: 10,
      }),
    ).toThrow();
    // Server side, whatever the caller (the session basket skips the schema).
    const basket = t1(() =>
      svc().saveJob(
        {
          ...base,
          status: "Delivered_Paid",
          partner_mode: "FOR",
          partner_id: partnerId,
          deferPayment: true,
        } as SaveJobParams,
        1,
      ),
    );
    expect(basket.success).toBe(false);
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM partner_ledger`).get(),
    ).toEqual({ n: 0 });
  });

  it("refund nets partner ledger, drawers and profit to 0 per currency", () => {
    const res = save({
      ...base,
      status: "Delivered_Paid",
      partner_mode: "FOR",
      partner_id: partnerId,
    });
    const txn = jobTxn(res.id!)!;
    t1(() => getTransactionRepository().refundTransaction(txn.id, 1));
    expect(partnerNet("USD")).toBe(0);
    expect(partnerNet("LBP")).toBe(0);
    expect(drawer("General", "USD")).toBe(0);
    expect(netProfit(res.id!)).toEqual({ usd: 0, lbp: 0 });
  });

  it("void nets partner ledger, drawers and profit to 0 per currency", () => {
    const res = save({
      ...base,
      status: "Delivered_Paid",
      partner_mode: "FOR",
      partner_id: partnerId,
    });
    const txn = jobTxn(res.id!)!;
    t1(() => getTransactionRepository().voidTransaction(txn.id, 1));
    expect(partnerNet("USD")).toBe(0);
    expect(drawer("General", "USD")).toBe(0);
    expect(netProfit(res.id!)).toEqual({ usd: 0, lbp: 0 });
  });

  it("Profits count a For job only as the partner settles", () => {
    save({
      ...base,
      status: "Delivered_Paid",
      partner_mode: "FOR",
      partner_id: partnerId,
    });
    const before = t1(() =>
      new ProfitRepository().getMaintenanceTotals(...RANGE),
    );
    expect(r2(before.profit_usd)).toBe(0);
    expect(r2(before.revenue_usd)).toBe(0);
    const detailBefore = t1(() =>
      new ProfitRepository().getMaintenanceDetail(...RANGE),
    );
    expect(detailBefore[0]).toMatchObject({
      has_partner_obligation: 1,
      partner_coverage_ratio: 0,
    });

    t1(() => {
      const repo = getPartnerRepository();
      const entry = repo.addLedgerEntry({
        partner_id: partnerId,
        transaction_type: "SETTLEMENT",
        amount: 50,
        currency: "USD",
        direction: "CREDIT",
        user_id: 1,
        settlement_method: "CASH",
      });
      repo.recordSettlementMoneyMovement(entry, 1);
    });
    const half = t1(() =>
      new ProfitRepository().getMaintenanceTotals(...RANGE),
    );
    expect(r2(half.profit_usd)).toBe(30);
    expect(r2(half.revenue_usd)).toBe(50);
  });
});

describe("LIRA-403 lock and settled refund", () => {
  it("a charged job keeps its partner switch until refunded", () => {
    const res = save({
      ...base,
      status: "Delivered_Paid",
      partner_mode: "FOR",
      partner_id: partnerId,
    });
    const id = res.id!;
    const changed = save({
      ...base,
      id,
      status: "Delivered_Paid",
      partner_mode: null,
    });
    expect(changed.success).toBe(false);
    expect(changed.error).toMatch(/partner of a paid repair/);
    const txn = jobTxn(id)!;
    t1(() => getTransactionRepository().refundTransaction(txn.id, 1));
    expect(
      save({ ...base, id, status: "Delivered_Paid", partner_mode: null })
        .success,
    ).toBe(true);
  });

  it("refunding a For job the partner half settled leaves the partner's account at what was paid back", () => {
    const res = save({
      ...base,
      status: "Delivered_Paid",
      partner_mode: "FOR",
      partner_id: partnerId,
    });
    t1(() => {
      const repo = getPartnerRepository();
      const entry = repo.addLedgerEntry({
        partner_id: partnerId,
        transaction_type: "SETTLEMENT",
        amount: 50,
        currency: "USD",
        direction: "CREDIT",
        user_id: 1,
        settlement_method: "CASH",
      });
      repo.recordSettlementMoneyMovement(entry, 1);
    });
    const txn = jobTxn(res.id!)!;
    t1(() => getTransactionRepository().refundTransaction(txn.id, 1));
    // The job's own rows net to 0; the $50 the partner paid is now credit.
    const jobNet = ledger(res.id!).reduce(
      (a, r) => a + (r.direction === "DEBIT" ? r.amount : -r.amount),
      0,
    );
    expect(r2(jobNet)).toBe(0);
    expect(partnerNet("USD")).toBe(-50);
    expect(netProfit(res.id!)).toEqual({ usd: 0, lbp: 0 });
    const totals = t1(() =>
      new ProfitRepository().getMaintenanceTotals(...RANGE),
    );
    expect(r2(totals.profit_usd)).toBe(0);
  });
});

/**
 * Every Profits surface must agree on a For job (owners repeat these): By
 * Module, the summary, By Date, By Cashier, By Client, the closing snapshot
 * and the pending (deferred) list — 0 before the partner pays, half after a
 * half settlement.
 */
describe("LIRA-403 For Partner — every Profits surface agrees", () => {
  const profits = () => new ProfitService(new ProfitRepository());
  const today = () =>
    (db.prepare(`SELECT date('now','localtime') AS d`).get() as { d: string })
      .d;
  function surfaces(day: string) {
    return t1(() => {
      const p = profits();
      const mod = p
        .getByModule(day, day)
        .find((m) => m.module === "MAINTENANCE");
      const summary = p.getSummary(day, day);
      const byDate = p
        .getByDate(day, day)
        .reduce((a, d) => a + d.profit_usd, 0);
      const byUser = p
        .getByUser(day, day)
        .reduce((a, u) => a + (u.profit_usd ?? 0), 0);
      const byClient = p
        .getByClient(day, day)
        .reduce((a, c) => a + (c.profit_usd ?? 0), 0);
      const snap = new ClosingService(
        new ClosingRepository(),
        p,
      ).getDailyStatsSnapshot({ day }, { includeProfit: true });
      return {
        module: r2(mod?.profit_usd),
        summary: r2(summary.totals.gross_profit_usd),
        byDate: r2(byDate),
        byUser: r2(byUser),
        byClient: r2(byClient),
        closing: r2(snap.totalProfitUSD),
      };
    });
  }

  it("0 everywhere before the partner pays, 30 everywhere after half is settled", () => {
    const day = today();
    save({
      ...base,
      status: "Delivered_Paid",
      partner_mode: "FOR",
      partner_id: partnerId,
    });
    const all0 = {
      module: 0,
      summary: 0,
      byDate: 0,
      byUser: 0,
      byClient: 0,
      closing: 0,
    };
    expect(surfaces(day)).toEqual(all0);
    const pending = t1(() => profits().getPendingProfit(day, day));
    expect(r2(pending.deferred.partner_profit_usd)).toBe(60);

    t1(() => {
      const repo = getPartnerRepository();
      const entry = repo.addLedgerEntry({
        partner_id: partnerId,
        transaction_type: "SETTLEMENT",
        amount: 50,
        currency: "USD",
        direction: "CREDIT",
        user_id: 1,
        settlement_method: "CASH",
      });
      repo.recordSettlementMoneyMovement(entry, 1);
    });
    const half = {
      module: 30,
      summary: 30,
      byDate: 30,
      byUser: 30,
      byClient: 30,
      closing: 30,
    };
    expect(surfaces(day)).toEqual(half);
  });
});

describe("LIRA-403 Via Partner", () => {
  it("the customer pays as usual and the shop owes the partner the labour cost", () => {
    const res = save({
      ...base,
      status: "Delivered_Paid",
      payments: cash100,
      partner_mode: "VIA",
      partner_id: partnerId,
    });
    expect(res.success).toBe(true);
    expect(ledger(res.id!)).toEqual([
      {
        transaction_type: "THROUGH_MAINTENANCE",
        direction: "CREDIT",
        amount: 40,
        currency: "USD",
        partner_id: partnerId,
      },
    ]);
    expect(drawer("General", "USD")).toBe(100);
    const txn = jobTxn(res.id!)!;
    expect(txn.profit_usd).toBe(60);
    expect(txn.client_name).toBe("Rami");
    // Counted at once (the partner owes the shop nothing).
    const totals = t1(() =>
      new ProfitRepository().getMaintenanceTotals(...RANGE),
    );
    expect(r2(totals.profit_usd)).toBe(60);
  });

  it("parts are the shop's own stock: the partner is owed the labour cost only", () => {
    const res = save({
      ...base,
      status: "Delivered_Paid",
      payments: [{ method: "CASH", currency_code: "USD", amount: 130 }],
      final_amount_usd: 100,
      parts: [{ product_id: productId, quantity: 1 }],
      partner_mode: "VIA",
      partner_id: partnerId,
    });
    expect(res.success).toBe(true);
    expect(
      ledger(res.id!).map((r) => [r.direction, r.currency, r.amount]),
    ).toEqual([["CREDIT", "USD", 40]]);
  });

  it("refund nets partner ledger, drawers and profit to 0 per currency", () => {
    const res = save({
      ...base,
      status: "Delivered_Paid",
      payments: cash100,
      partner_mode: "VIA",
      partner_id: partnerId,
    });
    const txn = jobTxn(res.id!)!;
    t1(() => getTransactionRepository().refundTransaction(txn.id, 1));
    expect(partnerNet("USD")).toBe(0);
    expect(drawer("General", "USD")).toBe(0);
    expect(netProfit(res.id!)).toEqual({ usd: 0, lbp: 0 });
  });

  it("in a session basket the CREDIT is still booked (the basket owns the money)", () => {
    const parsed = saveMaintenanceJobSchema.parse({
      ...base,
      status: "Delivered_Paid",
      partner_mode: "VIA",
      partner_id: partnerId,
    });
    const res = t1(() =>
      svc().saveJob({ ...(parsed as SaveJobParams), deferPayment: true }, 1),
    );
    expect(res.success).toBe(true);
    expect(
      ledger(res.id!).map((r) => [r.transaction_type, r.direction, r.amount]),
    ).toEqual([["THROUGH_MAINTENANCE", "CREDIT", 40]]);
  });
});

/** Rule 28d — every mode through the same real path. */
describe("LIRA-403 variant walk (customer / For / Via)", () => {
  const variants = [
    {
      mode: undefined,
      payments: cash100,
      ledger: [] as [string, string, number][],
      drawerUsd: 100,
    },
    {
      mode: "FOR",
      payments: undefined,
      ledger: [["FOR_MAINTENANCE", "DEBIT", 100]] as [string, string, number][],
      drawerUsd: 0,
    },
    {
      mode: "VIA",
      payments: cash100,
      ledger: [["THROUGH_MAINTENANCE", "CREDIT", 40]] as [
        string,
        string,
        number,
      ][],
      drawerUsd: 100,
    },
  ];
  it.each(variants)(
    "mode $mode: accepted, books what it should, and refund nets 0",
    (v) => {
      const res = save({
        ...base,
        status: "Delivered_Paid",
        ...(v.payments ? { payments: v.payments } : {}),
        ...(v.mode ? { partner_mode: v.mode, partner_id: partnerId } : {}),
      });
      expect(res.success).toBe(true);
      expect(
        ledger(res.id!).map((r) => [r.transaction_type, r.direction, r.amount]),
      ).toEqual(v.ledger);
      expect(drawer("General", "USD")).toBe(v.drawerUsd);
      const txn = jobTxn(res.id!)!;
      expect(txn.amount_usd).toBe(100);
      expect(txn.profit_usd).toBe(60);
      t1(() => getTransactionRepository().refundTransaction(txn.id, 1));
      expect(partnerNet("USD")).toBe(0);
      expect(drawer("General", "USD")).toBe(0);
      expect(netProfit(res.id!)).toEqual({ usd: 0, lbp: 0 });
    },
  );
});

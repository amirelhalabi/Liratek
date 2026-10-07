/**
 * LIRA-272 — owner decision 2026-10-07: a refund of ANY module may keep a
 * small leftover as profit (refund $20.12, hand back $20 → $0.12 profit),
 * same rules as the SALE / DEBT_REPAYMENT refund kept change.
 *
 * The Profits page drops a refunded FINANCIAL_SERVICE / RECHARGE /
 * CUSTOM_SERVICE / MAINTENANCE / LOTO original entirely (its source row's
 * `is_refunded = 1`) and never reads the REFUND row on Overview / By Module /
 * By Date — so kept change stamped on that REFUND row was invisible. This
 * file proves, per module, that the kept part surfaces exactly once on every
 * Profits view and on the day close, that the cash drawer moves by
 * −(refund − kept) and nothing else changes, and that a refund WITHOUT kept
 * change leaves every view exactly as before.
 *
 * Method: two worlds per module, each a fresh real-schema DB (create_db.sql
 * + migrations, real writers): the same original refunded exactly vs.
 * refunded with kept change. Every surface's kept-world figure minus its
 * exact-world figure must equal the kept amount, per currency; every ledger
 * delta must be identical except the cash drawer, which differs by +kept.
 *
 * Rule 17: written BEFORE the fix. Failure text recorded in the change
 * report.
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
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  FinancialServiceRepository,
  resetFinancialServiceRepository,
} from "../FinancialServiceRepository";
import { RechargeRepository, resetRechargeRepository } from "../RechargeRepository";
import {
  CustomServiceRepository,
  resetCustomServiceRepository,
} from "../CustomServiceRepository";
import { MaintenanceRepository } from "../MaintenanceRepository";
import { MaintenanceService } from "../../services/MaintenanceService";
import { LotoService } from "../../services/LotoService";
import {
  getLotoTicketRepository,
  resetLotoTicketRepository,
} from "../LotoTicketRepository";
import { getLotoSettingsRepository } from "../LotoSettingsRepository";
import { getLotoMonthlyFeeRepository } from "../LotoMonthlyFeeRepository";
import { getLotoCheckpointRepository } from "../LotoCheckpointRepository";
import { getLotoCashPrizeRepository } from "../LotoCashPrizeRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetRateRepository } from "../RateRepository";
import { resetCarrierLineRepository } from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";
import { resetDebtService } from "../../services/DebtService";
import { ProfitRepository, resetProfitRepository } from "../ProfitRepository";
import { ProfitService } from "../../services/ProfitService";
import { ClosingService } from "../../services/ClosingService";
import { ClosingRepository } from "../ClosingRepository";
import {
  createCustomServiceSchema,
  type CreateCustomServiceInput,
} from "../../validators/customService";
import {
  REFUND_KEPT_CHANGE_TYPES,
  refundKeptChangeSchema,
  sessionItemRefundSchema,
} from "../../validators/transaction";
import {
  getCustomerSessionRepository,
  resetCustomerSessionRepository,
} from "../CustomerSessionRepository";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository";
import {
  SessionPaymentService,
  resetSessionPaymentService,
} from "../../services/SessionPaymentService";
import {
  ledgerDeltas,
  snapshotLedgers,
  type LedgerSnapshot,
} from "../testHelpers/postingAssert";

const CREATE_DB_SQL_PATH = path.join(
  __dirname,
  "../../../../../electron-app/create_db.sql",
);
const USER_ID = 1;
const RATE = 89500;

let db: Database.Database;

function resetAll(): void {
  resetTransactionRepository();
  resetFinancialServiceRepository();
  resetRechargeRepository();
  resetCustomServiceRepository();
  resetLotoTicketRepository();
  resetPartnerRepository();
  resetStockBatchRepository();
  resetDebtRepository();
  resetSupplierRepository();
  resetPaymentMethodRepository();
  resetSettingsRepository();
  resetRateRepository();
  resetCarrierLineRepository();
  resetCarrierLineMovementRepository();
  resetCarrierLineService();
  resetDebtService();
  resetProfitRepository();
  resetCustomerSessionRepository();
  resetSessionPaymentRepository();
  resetSessionPaymentService();
}

/** A fresh real-schema DB, installed as the live test DB. */
function freshWorld(): void {
  if (db) {
    resetTenantContext();
    resetAll();
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
  }
  resetAll();
  db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  db.pragma("foreign_keys = OFF");
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  // Stock the drawers so no negative-balance guard trips on a refund.
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["MTC", "USD", 1000],
    ["Alfa", "USD", 1000],
    ["OMT_System", "USD", 5000],
    ["General", "USD", 5000],
    ["General", "LBP", 500_000_000],
  ] as const) {
    seed.run(d, c, b);
  }
}

afterEach(() => {
  if (db) {
    resetTenantContext();
    resetAll();
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    db.close();
    db = undefined as unknown as Database.Database;
  }
});

function today(): string {
  return (
    db.prepare(`SELECT date('now','localtime') AS d`).get() as { d: string }
  ).d;
}

function shiftDay(day: string, days: number): string {
  return (
    db.prepare(`SELECT date(?, ? || ' days') AS d`).get(day, String(days)) as {
      d: string;
    }
  ).d;
}

function lastTxnId(type: string): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE type = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(type) as { id: number }
  ).id;
}

function txnRow(id: number) {
  return db
    .prepare(
      `SELECT type, profit_usd, profit_lbp FROM transactions WHERE id = ?`,
    )
    .get(id) as { type: string; profit_usd: number; profit_lbp: number };
}

// ─── module fixtures ────────────────────────────────────────────────────────

type Currency = "USD" | "LBP";

interface ModuleCase {
  name: string;
  type: string;
  /** What the customer paid, the refund owed back in full. */
  owed: number;
  currency: Currency;
  /** The leftover the shop keeps (under $1 / 100,000 LBP). */
  kept: number;
  /** The drawer the cash refund comes out of (OMT cash lives in OMT's own
   *  drawer). */
  cashDrawer: string;
  /** Creates the original and returns its transactions.id. */
  create: () => number;
}

function createOmtSend(): number {
  new FinancialServiceRepository().createTransaction({
    provider: "OMT",
    serviceType: "SEND",
    amount: 100,
    currency: "USD",
    commission: 1,
    omtFee: 5,
    payments: [{ method: "CASH", currencyCode: "USD", amount: 105 }],
  } as Parameters<FinancialServiceRepository["createTransaction"]>[0]);
  return lastTxnId("FINANCIAL_SERVICE");
}

function createMtcRecharge(extra: Record<string, unknown> = {}): number {
  const res = new RechargeRepository().processRecharge({
    provider: "MTC",
    type: "CREDIT_TRANSFER",
    amount: 3,
    cost: 255_000,
    price: 300_000,
    currency: "LBP",
    phoneNumber: "03999001",
    payments: [{ method: "CASH", currencyCode: "LBP", amount: 300_000 }],
    userId: USER_ID,
    ...extra,
  } as Parameters<RechargeRepository["processRecharge"]>[0]);
  if (!res.success) throw new Error(`processRecharge failed: ${res.error}`);
  return lastTxnId("RECHARGE");
}

function createCustomService(extra: Record<string, unknown> = {}): number {
  const parsed = createCustomServiceSchema.parse({
    description: "Screen protector install",
    cost_usd: 3,
    price_usd: 20.12,
    paid_by: "CASH",
    payments: [{ method: "CASH", currency_code: "USD", amount: 20.12 }],
    ...extra,
  }) as CreateCustomServiceInput;
  const res = new CustomServiceRepository().createService(parsed, USER_ID);
  if (!res.success) throw new Error(`createService failed: ${res.error}`);
  return lastTxnId("CUSTOM_SERVICE");
}

function createMaintenanceJob(): number {
  const res = new MaintenanceService(new MaintenanceRepository()).saveJob(
    {
      device_name: "Phone",
      issue_description: "screen",
      currency: "USD",
      cost_usd: 10,
      price_usd: 50.5,
      final_amount_usd: 50.5,
      exchange_rate: RATE,
      status: "Delivered_Paid",
      payments: [{ method: "CASH", currency_code: "USD", amount: 50.5 }],
    } as Parameters<MaintenanceService["saveJob"]>[0],
    USER_ID,
  );
  if (!res.success) throw new Error(`saveJob failed: ${res.error}`);
  return lastTxnId("MAINTENANCE");
}

function createLotoTicket(): number {
  new LotoService(
    getLotoTicketRepository(),
    getLotoSettingsRepository(),
    getLotoMonthlyFeeRepository(),
    getLotoCheckpointRepository(),
    getLotoCashPrizeRepository(),
  ).sellTicket({
    sale_amount: 500_000,
    userId: USER_ID,
    payments: [{ method: "CASH", currencyCode: "LBP", amount: 500_000 }],
  });
  return lastTxnId("LOTO");
}

const MODULES: ModuleCase[] = [
  {
    name: "OMT SEND (financial service)",
    type: "FINANCIAL_SERVICE",
    owed: 105,
    currency: "USD",
    kept: 0.5,
    cashDrawer: "OMT_System",
    create: createOmtSend,
  },
  {
    name: "MTC recharge (LBP)",
    type: "RECHARGE",
    owed: 300_000,
    currency: "LBP",
    kept: 50_000,
    cashDrawer: "General",
    create: () => createMtcRecharge(),
  },
  {
    name: "custom service",
    type: "CUSTOM_SERVICE",
    owed: 20.12,
    currency: "USD",
    kept: 0.12,
    cashDrawer: "General",
    create: () => createCustomService(),
  },
  {
    name: "maintenance job",
    type: "MAINTENANCE",
    owed: 50.5,
    currency: "USD",
    kept: 0.5,
    cashDrawer: "General",
    create: createMaintenanceJob,
  },
  {
    name: "loto ticket (LBP)",
    type: "LOTO",
    owed: 500_000,
    currency: "LBP",
    kept: 50_000,
    cashDrawer: "General",
    create: createLotoTicket,
  },
];

// ─── every Profits surface, per currency ───────────────────────────────────

interface Surfaces {
  overview_usd: number;
  overview_lbp: number;
  kept_card_usd: number;
  kept_card_lbp: number;
  by_module_usd: number;
  by_module_lbp: number;
  kept_row_usd: number;
  kept_row_lbp: number;
  kept_detail_usd: number;
  kept_detail_lbp: number;
  by_date_usd: number;
  by_date_lbp: number;
  by_cashier_usd: number;
  by_cashier_lbp: number;
  by_client_usd: number;
  by_client_lbp: number;
  day_close_usd: number;
  day_close_lbp: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function surfaces(from: string, to: string, closeDay: string): Surfaces {
  const svc = new ProfitService(new ProfitRepository());
  const summary = svc.getSummary(from, to);
  const byModule = svc.getByModule(from, to);
  const keptRow = byModule.find((m) => m.module === "KEPT_CHANGE");
  const keptDetail = svc.getModuleDetail("KEPT_CHANGE", from, to);
  const byDate = svc.getByDate(from, to);
  const byUser = svc.getByUser(from, to);
  const byClient = svc.getByClient(from, to, 1000);
  const close = new ClosingService(
    new ClosingRepository(),
    new ProfitService(new ProfitRepository()),
  ).getDailyStatsSnapshot({ day: closeDay }, { includeProfit: true });
  const sum = <T>(rows: T[], f: (r: T) => number) =>
    rows.reduce((s, r) => s + (f(r) ?? 0), 0);
  return {
    overview_usd: r2(summary.totals.gross_profit_usd),
    overview_lbp: r2(summary.totals.gross_profit_lbp),
    kept_card_usd: r2(summary.kept_change.usd),
    kept_card_lbp: r2(summary.kept_change.lbp),
    by_module_usd: r2(sum(byModule, (m) => m.profit_usd)),
    by_module_lbp: r2(sum(byModule, (m) => m.profit_lbp)),
    kept_row_usd: r2(keptRow?.profit_usd ?? 0),
    kept_row_lbp: r2(keptRow?.profit_lbp ?? 0),
    kept_detail_usd: r2(keptDetail?.counted_total_profit_usd ?? 0),
    kept_detail_lbp: r2(keptDetail?.counted_total_profit_lbp ?? 0),
    by_date_usd: r2(sum(byDate, (d) => d.profit_usd)),
    by_date_lbp: r2(sum(byDate, (d) => d.profit_lbp)),
    by_cashier_usd: r2(sum(byUser, (u) => u.profit_usd)),
    by_cashier_lbp: r2(sum(byUser, (u) => u.profit_lbp)),
    by_client_usd: r2(sum(byClient, (c) => c.profit_usd)),
    by_client_lbp: r2(sum(byClient, (c) => c.profit_lbp)),
    day_close_usd: r2(close.totalProfitUSD ?? 0),
    day_close_lbp: r2(close.totalProfitLBP ?? 0),
  };
}

function minus(a: Surfaces, b: Surfaces): Surfaces {
  const out = {} as Surfaces;
  for (const k of Object.keys(a) as (keyof Surfaces)[]) {
    out[k] = r2(a[k] - b[k]);
  }
  return out;
}

/** Every surface that must move by the kept amount, in that currency. */
function expectedKeptDelta(kept: number, currency: Currency): Surfaces {
  const usd = currency === "USD" ? kept : 0;
  const lbp = currency === "LBP" ? kept : 0;
  return {
    overview_usd: usd,
    overview_lbp: lbp,
    kept_card_usd: usd,
    kept_card_lbp: lbp,
    by_module_usd: usd,
    by_module_lbp: lbp,
    kept_row_usd: usd,
    kept_row_lbp: lbp,
    kept_detail_usd: usd,
    kept_detail_lbp: lbp,
    by_date_usd: usd,
    by_date_lbp: lbp,
    by_cashier_usd: usd,
    by_cashier_lbp: lbp,
    by_client_usd: usd,
    by_client_lbp: lbp,
    day_close_usd: usd,
    day_close_lbp: lbp,
  };
}

interface WorldResult {
  surfaces: Surfaces;
  before: LedgerSnapshot;
  after: LedgerSnapshot;
  origProfit: { usd: number; lbp: number };
  refund: { type: string; profit_usd: number; profit_lbp: number };
}

/** One fresh world: create the original, refund it (exactly, or keeping
 *  `kept`), read every surface over today's window. */
function runWorld(m: ModuleCase, keep: boolean): WorldResult {
  freshWorld();
  const id = m.create();
  const orig = txnRow(id);
  const before = snapshotLedgers(db);
  // Field names from the shared schema (rule 24).
  const keptChange = keep
    ? refundKeptChangeSchema.parse(
        m.currency === "USD"
          ? { kept_change_usd: m.kept }
          : { kept_change_lbp: m.kept },
      )
    : undefined;
  const refundId = getTransactionRepository().refundTransaction(id, USER_ID, {
    refundLegs: [
      {
        method: "CASH",
        currencyCode: m.currency,
        amount: keep ? m.owed - m.kept : m.owed,
      },
    ],
    ...(keptChange
      ? {
          keptChange: {
            usd: keptChange.kept_change_usd ?? 0,
            lbp: keptChange.kept_change_lbp ?? 0,
          },
        }
      : {}),
  });
  const after = snapshotLedgers(db);
  const day = today();
  return {
    surfaces: surfaces(shiftDay(day, -1), shiftDay(day, 1), day),
    before,
    after,
    origProfit: { usd: orig.profit_usd, lbp: orig.profit_lbp },
    refund: txnRow(refundId),
  };
}

describe("LIRA-272 — refund kept change on every module reaches every Profits view", () => {
  it("the shared refund kept-change list covers every module", () => {
    for (const m of MODULES) {
      expect(REFUND_KEPT_CHANGE_TYPES).toContain(m.type);
    }
  });

  describe.each(MODULES)("$name", (m) => {
    it("the Transactions page's refund popup sees ONE currency, money the customer paid in (so it can offer kept change)", () => {
      // TransactionsViewer hands `getRecent(...).payments` to the refund
      // popup, which offers kept change only for a single-currency refund
      // whose net is money IN (refundLegOverride.refundCanKeepChange). A
      // module whose row also listed an internal stock/commission leg in a
      // second currency would never be offered it.
      freshWorld();
      const id = m.create();
      const row = getTransactionRepository()
        .getRecent(20)
        .find((t) => t.id === id);
      expect(row).toBeDefined();
      const net: Record<string, number> = {};
      for (const leg of (row as { payments?: { currency_code: string; signed_amount: number }[] }).payments ?? []) {
        net[leg.currency_code] = (net[leg.currency_code] ?? 0) + leg.signed_amount;
      }
      const live = Object.entries(net)
        .filter(([c, a]) => Math.abs(a) > (c === "LBP" ? 1 : 0.01))
        .map(([c, a]) => [c, r2(a)]);
      expect(live).toEqual([[m.currency, m.owed]]);
    });

    it("kept change shows once on Overview, By Module, By Date, By Cashier/Client and the day close; the drawer pays out refund − kept; nothing else moves", () => {
      const exact = runWorld(m, false);
      const kept = runWorld(m, true);

      // The REFUND row carries −original + kept (owner decision).
      const usdKept = m.currency === "USD" ? m.kept : 0;
      const lbpKept = m.currency === "LBP" ? m.kept : 0;
      expect(kept.refund.type).toBe("REFUND");
      expect(r2(kept.refund.profit_usd)).toBe(
        r2(-kept.origProfit.usd + usdKept),
      );
      expect(r2(kept.refund.profit_lbp)).toBe(
        r2(-kept.origProfit.lbp + lbpKept),
      );

      // Every Profits surface: kept world − exact world === kept, once.
      expect(minus(kept.surfaces, exact.surfaces)).toEqual(
        expectedKeptDelta(m.kept, m.currency),
      );

      // Ledgers: identical deltas except the cash drawer, which pays out
      // exactly `kept` less (drawer −(refund − kept)).
      const dExact = ledgerDeltas(exact.before, exact.after);
      const dKept = ledgerDeltas(kept.before, kept.after);
      const cashKey = `${m.cashDrawer}|${m.currency}`;
      expect(r2(dExact.drawers[cashKey] ?? 0)).toBe(r2(-m.owed));
      expect(r2(dKept.drawers[cashKey] ?? 0)).toBe(r2(-(m.owed - m.kept)));
      const { [cashKey]: _a, ...restExact } = dExact.drawers;
      const { [cashKey]: _b, ...restKept } = dKept.drawers;
      expect(restKept).toEqual(restExact);
      expect(dKept.supplier).toEqual(dExact.supplier);
      expect(dKept.partner).toEqual(dExact.partner);
      expect(dKept.debt).toEqual(dExact.debt);
    });
  });

  it("dated by the REFUND's own day (owner decision 2026-10-07) — a refund today of an older OMT transfer lands today, not on the transfer's day", () => {
    // Rewritten for the 2026-10-07 owner decision: this test used to pin the
    // OLD rule (kept change on the refunded original's day). The kept part
    // now lands on the refund's day on every view, so the day close matches
    // the drawer; the full Mon/Wed/range matrix per module lives in
    // ProfitRepository.refundKeptChangeRefundDay.test.ts.
    freshWorld();
    const id = createOmtSend();
    const day = today();
    const past = shiftDay(day, -5);
    // Backdate the original (setup only): its transaction and source row.
    db.prepare(
      `UPDATE transactions SET created_at = ? || ' 12:00:00' WHERE id = ?`,
    ).run(past, id);
    db.prepare(
      `UPDATE financial_services SET created_at = ? || ' 12:00:00'
       WHERE id = (SELECT source_id FROM transactions WHERE id = ?)`,
    ).run(past, id);
    getTransactionRepository().refundTransaction(id, USER_ID, {
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 104.5 }],
      keptChange: { usd: 0.5 },
    });
    const pastWindow = surfaces(shiftDay(past, -1), shiftDay(past, 1), past);
    const todayWindow = surfaces(shiftDay(day, -1), shiftDay(day, 1), day);
    expect([
      pastWindow.overview_usd,
      pastWindow.by_module_usd,
      pastWindow.by_date_usd,
      pastWindow.by_cashier_usd,
      pastWindow.day_close_usd,
    ]).toEqual([0, 0, 0, 0, 0]);
    expect([
      todayWindow.overview_usd,
      todayWindow.by_module_usd,
      todayWindow.by_date_usd,
      todayWindow.by_cashier_usd,
      todayWindow.day_close_usd,
    ]).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
  });
});

describe("LIRA-272 — refusals on a module refund write nothing", () => {
  function refundCount(): number {
    return (
      db
        .prepare(`SELECT COUNT(*) AS n FROM transactions WHERE type = 'REFUND'`)
        .get() as { n: number }
    ).n;
  }

  it("tampered: an OMT SEND refund claiming $0.60 kept when only $0.50 is short is refused", () => {
    freshWorld();
    const id = createOmtSend();
    const before = snapshotLedgers(db);
    expect(() =>
      getTransactionRepository().refundTransaction(id, USER_ID, {
        refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 104.5 }],
        keptChange: { usd: 0.6, lbp: 0 },
      }),
    ).toThrow();
    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
    expect(refundCount()).toBe(0);
  });

  it("FOR-partner: a loto ticket sold for a partner cannot keep change on its refund", () => {
    // A FOR-partner ticket takes no counter payment (the full amount goes on
    // the partner's tab), so there is no cash to keep from — refused, and
    // resolveKeptChange's own FOR-partner refusal stays behind it.
    freshWorld();
    const partnerId = Number(
      db
        .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, 'Partner')`)
        .run().lastInsertRowid,
    );
    new LotoService(
      getLotoTicketRepository(),
      getLotoSettingsRepository(),
      getLotoMonthlyFeeRepository(),
      getLotoCheckpointRepository(),
      getLotoCashPrizeRepository(),
    ).sellTicket({
      sale_amount: 500_000,
      userId: USER_ID,
      partnerId,
      partnerMode: "FOR",
    });
    const id = lastTxnId("LOTO");
    const before = snapshotLedgers(db);
    expect(() =>
      getTransactionRepository().refundTransaction(id, USER_ID, {
        refundLegs: [{ method: "CASH", currencyCode: "LBP", amount: 450_000 }],
        keptChange: { usd: 0, lbp: 50_000 },
      }),
    ).toThrow(/Refund/);
    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
    expect(refundCount()).toBe(0);
  });
});

describe("LIRA-272 — session basket item refund of a recharge member", () => {
  function sessionRecharge(): { sessionId: number; txnId: number } {
    const sessionId = getCustomerSessionRepository().createSession({
      customer_name: "Walk-in",
      started_by: "admin",
    });
    const rechargeTxnId = createMtcRecharge({
      deferPayment: true,
      payments: [],
    });
    const rechargeId = (
      db
        .prepare(`SELECT source_id FROM transactions WHERE id = ?`)
        .get(rechargeTxnId) as { source_id: number }
    ).source_id;
    getCustomerSessionRepository().linkTransaction(
      sessionId,
      "recharge",
      rechargeId,
      0,
      300_000,
      0,
      0,
      rechargeTxnId,
    );
    new SessionPaymentService().recordBasketPayment(sessionId, {
      legs: [{ method: "CASH", currencyCode: "LBP", amount: 300_000 }],
      exchangeRate: RATE,
      userId: USER_ID,
    });
    return { sessionId, txnId: rechargeTxnId };
  }

  function refundItem(keep: boolean) {
    freshWorld();
    const { sessionId, txnId } = sessionRecharge();
    const before = snapshotLedgers(db);
    // Field names from the shared schema (rule 24).
    const payload = sessionItemRefundSchema.parse({
      sessionId,
      transactionId: txnId,
      refundLegs: [
        {
          method: "CASH",
          currencyCode: "LBP",
          amount: keep ? 250_000 : 300_000,
        },
      ],
      ...(keep ? { kept_change_lbp: 50_000 } : {}),
    });
    const res = getTransactionRepository().refundSessionBasketItem({
      ...payload,
      userId: USER_ID,
    });
    const after = snapshotLedgers(db);
    const day = today();
    return {
      refundId: res.refundTransactionId,
      d: ledgerDeltas(before, after),
      s: surfaces(shiftDay(day, -1), shiftDay(day, 1), day),
    };
  }

  it("keeps 50,000 LBP of a 300,000 LBP item refund as profit on every view; drawer −250,000; no undo exists for it", () => {
    const exact = refundItem(false);
    const kept = refundItem(true);
    expect(minus(kept.s, exact.s)).toEqual(expectedKeptDelta(50_000, "LBP"));
    expect(r2(kept.d.drawers["General|LBP"] ?? 0)).toBe(-250_000);
    expect(r2(exact.d.drawers["General|LBP"] ?? 0)).toBe(-300_000);
    const { "General|LBP": _a, ...restExact } = exact.d.drawers;
    const { "General|LBP": _b, ...restKept } = kept.d.drawers;
    expect(restKept).toEqual(restExact);
    expect(kept.d.supplier).toEqual(exact.d.supplier);
    expect(kept.d.debt).toEqual(exact.d.debt);
    // A non-sale session item refund has no undo (both REFUND_UNDO writers
    // are sale-only), so no reversal can leave the kept profit behind.
    expect(() =>
      getTransactionRepository().undoSessionBasketItemRefund({
        refundTransactionId: kept.refundId,
        userId: USER_ID,
      }),
    ).toThrow(/undo refund does not yet support|non-sale basket item/);
  });
});

describe("LIRA-272 regression — a refund WITHOUT kept change leaves every module's Profits exactly as before", () => {
  it("each module refunded exactly (incl. originals that kept change at sale time) reads 0 on every view", () => {
    freshWorld();
    const ids = [
      createOmtSend(),
      createMtcRecharge(),
      // A recharge that kept change when it was sold (customer paid
      // 350,000 for 300,000) — its refund must not surface that old kept.
      createMtcRecharge({
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 350_000 }],
        kept_change_lbp: 50_000,
      }),
      createCustomService(),
      // A custom service that kept $1 at sale time.
      createCustomService({
        price_usd: 5,
        payments: [{ method: "CASH", currency_code: "USD", amount: 6 }],
        kept_change_usd: 1,
      }),
      createMaintenanceJob(),
      createLotoTicket(),
    ];
    for (const id of ids) {
      getTransactionRepository().refundTransaction(id, USER_ID);
    }
    const day = today();
    const s = surfaces(shiftDay(day, -1), shiftDay(day, 1), day);
    expect(s).toEqual(expectedKeptDelta(0, "USD"));
  });
});

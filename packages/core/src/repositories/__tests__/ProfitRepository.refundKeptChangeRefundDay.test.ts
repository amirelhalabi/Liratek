/**
 * Owner decision 2026-10-07 — refund kept change is profit of the REFUND's
 * day, not the refunded original's day. A transfer made Monday and refunded
 * Wednesday, handing back $104.88 of $105, shows its $0.12 on Wednesday
 * (Overview for Wednesday, By Module's Kept Change row, By Date Wednesday,
 * By Cashier / By Client for Wednesday, and Wednesday's day close), so the
 * day close matches the drawer. Only the kept part moves: the original's
 * own reversal stays dated where it is today (a refunded module original
 * drops out of its own day; a sale nets SALE + REFUND on the sale's day).
 *
 * Method: two worlds per case, each a fresh real-schema DB (create_db.sql +
 * migrations, real writers): the same original refunded exactly vs. with
 * kept change. The original is backdated to "Monday" (today − 2) before the
 * refund, which runs "Wednesday" (today). For every surface:
 *   - Monday-only window: kept − exact = 0 (the original's day is unchanged
 *     by the kept amount),
 *   - Wednesday-only window: kept − exact = kept,
 *   - Monday→Wednesday window: kept − exact = kept (the range total is the
 *     same as before the change — this part passed before the fix too).
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
  SalesRepository,
  resetSalesRepository,
  type SaleRequest,
} from "../SalesRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  FinancialServiceRepository,
  resetFinancialServiceRepository,
} from "../FinancialServiceRepository";
import {
  RechargeRepository,
  resetRechargeRepository,
} from "../RechargeRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { resetStockBatchRepository } from "../StockBatchRepository";
import { resetProductUnitRepository } from "../ProductUnitRepository";
import { getDebtRepository, resetDebtRepository } from "../DebtRepository";
import { resetVoucherRepository } from "../VoucherRepository";
import {
  getCustomerSessionRepository,
  resetCustomerSessionRepository,
} from "../CustomerSessionRepository";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetRateRepository } from "../RateRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { resetCarrierLineRepository } from "../CarrierLineRepository";
import { resetCarrierLineMovementRepository } from "../CarrierLineMovementRepository";
import { resetCarrierLineService } from "../../services/CarrierLineService";
import { ProfitRepository, resetProfitRepository } from "../ProfitRepository";
import { resetDebtService } from "../../services/DebtService";
import {
  SessionPaymentService,
  resetSessionPaymentService,
} from "../../services/SessionPaymentService";
import { ProfitService } from "../../services/ProfitService";
import { ClosingService } from "../../services/ClosingService";
import { ClosingRepository } from "../ClosingRepository";
import {
  refundKeptChangeSchema,
  sessionItemRefundSchema,
} from "../../validators/transaction";
import { saleRefundItemSchema } from "../../validators/sale";

const CREATE_DB_SQL_PATH = path.join(
  __dirname,
  "../../../../../electron-app/create_db.sql",
);
const USER_ID = 1;
const RATE = 89500;

let db: Database.Database;
let seq = 0;
/** Who performs the refund in a CASES world (the original is always sold by
 *  USER_ID). Reset to USER_ID by closeWorld. */
let refundUserId = USER_ID;

function resetAll(): void {
  resetSalesRepository();
  resetTransactionRepository();
  resetFinancialServiceRepository();
  resetRechargeRepository();
  resetPartnerRepository();
  resetStockBatchRepository();
  resetProductUnitRepository();
  resetDebtRepository();
  resetVoucherRepository();
  resetCustomerSessionRepository();
  resetSessionPaymentRepository();
  resetPaymentMethodRepository();
  resetClientRepository();
  resetSettingsRepository();
  resetRateRepository();
  resetSupplierRepository();
  resetCarrierLineRepository();
  resetCarrierLineMovementRepository();
  resetCarrierLineService();
  resetProfitRepository();
  resetDebtService();
  resetSessionPaymentService();
}

function closeWorld(): void {
  refundUserId = USER_ID;
  if (!db) return;
  resetTenantContext();
  resetAll();
  delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
  db = undefined as unknown as Database.Database;
}

function freshWorld(): void {
  closeWorld();
  resetAll();
  db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  db.pragma("foreign_keys = OFF");
  (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(1);
  const seed = db.prepare(
    `INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, ?, ?, ?)`,
  );
  for (const [d, c, b] of [
    ["MTC", "USD", 1000],
    ["OMT_System", "USD", 5000],
    ["General", "USD", 5000],
    ["General", "LBP", 500_000_000],
  ] as const) {
    seed.run(d, c, b);
  }
}

afterEach(closeWorld);

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

/** Setup only: move a transaction (and its source module row, and every
 *  sibling transaction of a sale) to noon on `day`. */
function backdate(txnId: number, day: string): void {
  const at = `${day} 12:00:00`;
  const row = db
    .prepare(`SELECT source_table, source_id FROM transactions WHERE id = ?`)
    .get(txnId) as { source_table: string | null; source_id: number | null };
  db.prepare(`UPDATE transactions SET created_at = ? WHERE id = ?`).run(
    at,
    txnId,
  );
  const table = row.source_table;
  if (table && ["sales", "financial_services", "recharges"].includes(table)) {
    db.prepare(`UPDATE ${table} SET created_at = ? WHERE id = ?`).run(
      at,
      row.source_id,
    );
  }
  if (table === "sales") {
    db.prepare(
      `UPDATE transactions SET created_at = ?
       WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
    ).run(at, row.source_id);
  }
}

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
  sale_row_usd: number;
  sale_detail_usd: number;
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

/** Every surface over [from, to]; the day close is read for `to` only when
 *  the window is a single day (the close is a one-day report). */
function surfaces(from: string, to: string): Surfaces {
  const svc = new ProfitService(new ProfitRepository());
  const summary = svc.getSummary(from, to);
  const byModule = svc.getByModule(from, to);
  const keptRow = byModule.find((m) => m.module === "KEPT_CHANGE");
  const saleRow = byModule.find((m) => m.module === "SALE");
  const keptDetail = svc.getModuleDetail("KEPT_CHANGE", from, to);
  const saleDetail = svc.getModuleDetail("SALE", from, to);
  const byDate = svc.getByDate(from, to);
  const byUser = svc.getByUser(from, to);
  const byClient = svc.getByClient(from, to, 1000);
  const close =
    from === to
      ? new ClosingService(
          new ClosingRepository(),
          new ProfitService(new ProfitRepository()),
        ).getDailyStatsSnapshot({ day: to }, { includeProfit: true })
      : null;
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
    sale_row_usd: r2(saleRow?.profit_usd ?? 0),
    sale_detail_usd: r2(saleDetail?.counted_total_profit_usd ?? 0),
    by_date_usd: r2(sum(byDate, (d) => d.profit_usd)),
    by_date_lbp: r2(sum(byDate, (d) => d.profit_lbp)),
    by_cashier_usd: r2(sum(byUser, (u) => u.profit_usd)),
    by_cashier_lbp: r2(sum(byUser, (u) => u.profit_lbp)),
    by_client_usd: r2(sum(byClient, (c) => c.profit_usd)),
    by_client_lbp: r2(sum(byClient, (c) => c.profit_lbp)),
    day_close_usd: r2(close?.totalProfitUSD ?? 0),
    day_close_lbp: r2(close?.totalProfitLBP ?? 0),
  };
}

function minus(a: Surfaces, b: Surfaces): Surfaces {
  const out = {} as Surfaces;
  for (const k of Object.keys(a) as (keyof Surfaces)[]) {
    out[k] = r2(a[k] - b[k]);
  }
  return out;
}

type Currency = "USD" | "LBP";

/** What kept change adds to each surface, per currency. Kept change is a
 *  profit-only line: it lives on the Kept Change card / By Module row, never
 *  inside the Sales row. `withClose` = a one-day window (the day close is
 *  read). `keptCard` = whether this kind shows on the Kept Change card
 *  (debt-repayment kept change has its own Overview line, not the card). */
function keptDelta(
  kept: number,
  currency: Currency,
  opts: { withClose: boolean; keptCard?: boolean },
): Surfaces {
  const usd = currency === "USD" ? kept : 0;
  const lbp = currency === "LBP" ? kept : 0;
  const card = opts.keptCard ?? true;
  return {
    overview_usd: usd,
    overview_lbp: lbp,
    kept_card_usd: card ? usd : 0,
    kept_card_lbp: card ? lbp : 0,
    by_module_usd: usd,
    by_module_lbp: lbp,
    kept_row_usd: usd,
    kept_row_lbp: lbp,
    kept_detail_usd: usd,
    kept_detail_lbp: lbp,
    sale_row_usd: 0,
    sale_detail_usd: 0,
    by_date_usd: usd,
    by_date_lbp: lbp,
    by_cashier_usd: usd,
    by_cashier_lbp: lbp,
    by_client_usd: usd,
    by_client_lbp: lbp,
    day_close_usd: opts.withClose ? usd : 0,
    day_close_lbp: opts.withClose ? lbp : 0,
  };
}

const ZERO = keptDelta(0, "USD", { withClose: true });

// ─── fixtures ──────────────────────────────────────────────────────────────

function addProduct(price: number, cost: number): number {
  seq += 1;
  return Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Product', ?, ?, 10)`,
      )
      .run(`Product ${seq}`, cost, price).lastInsertRowid,
  );
}

function saleRequest(
  items: { product_id: number; price: number }[],
  extra: Partial<SaleRequest>,
): SaleRequest {
  const total = items.reduce((s, i) => s + i.price, 0);
  return {
    client_id: null,
    items: items.map((i) => ({ ...i, quantity: 1 })),
    total_amount: total,
    discount: 0,
    final_amount: total,
    payment_usd: 0,
    payment_lbp: 0,
    exchange_rate: RATE,
    status: "completed",
    ...extra,
  };
}

/** A two-line $20.12 + $5 cash sale; returns the sale, its SALE txn and the
 *  $20.12 line. */
function cashSale(): { saleId: number; txnId: number; itemA: number } {
  const a = addProduct(20.12, 10);
  const b = addProduct(5, 2);
  const r = new SalesRepository().processSale(
    saleRequest(
      [
        { product_id: a, price: 20.12 },
        { product_id: b, price: 5 },
      ],
      { payments: [{ method: "CASH", currency_code: "USD", amount: 25.12 }] },
    ),
    USER_ID,
  );
  if (!r.success) throw new Error(`processSale failed: ${r.error}`);
  const saleId = r.id!;
  const txnId = (
    db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ? AND type = 'SALE'`,
      )
      .get(saleId) as { id: number }
  ).id;
  const itemA = (
    db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ? AND product_id = ?`)
      .get(saleId, a) as { id: number }
  ).id;
  return { saleId, txnId, itemA };
}

function keptPayload(kept: number, currency: Currency) {
  // Field names from the shared schema (rule 24).
  const k = refundKeptChangeSchema.parse(
    currency === "USD" ? { kept_change_usd: kept } : { kept_change_lbp: kept },
  );
  return { usd: k.kept_change_usd ?? 0, lbp: k.kept_change_lbp ?? 0 };
}

function itemRefund(saleId: number, saleItemId: number, keep: boolean): number {
  const p = saleRefundItemSchema.parse({
    saleId,
    saleItemId,
    refundQuantity: 1,
    refundLegs: [
      { method: "CASH", currencyCode: "USD", amount: keep ? 20 : 20.12 },
    ],
    ...(keep ? { keptChange: { kept_change_usd: 0.12 } } : {}),
  });
  return new SalesRepository().refundSaleItem({
    saleId: p.saleId,
    saleItemId: p.saleItemId,
    refundQuantity: p.refundQuantity,
    refundLegs: p.refundLegs,
    keptChange: p.keptChange
      ? { usd: p.keptChange.kept_change_usd, lbp: p.keptChange.kept_change_lbp }
      : undefined,
    userId: refundUserId,
  });
}

/** A session basket holding one member; returns what the item refund needs. */
function sessionMember(kind: "sale" | "recharge"): {
  sessionId: number;
  txnId: number;
  saleItemId?: number;
} {
  const sessionId = getCustomerSessionRepository().createSession({
    customer_name: "Walk-in",
    started_by: "admin",
  });
  if (kind === "sale") {
    const productId = addProduct(20.12, 10);
    const r = new SalesRepository().processSale(
      saleRequest([{ product_id: productId, price: 20.12 }], {
        deferPayment: true,
      }),
      USER_ID,
    );
    if (!r.success) throw new Error(`processSale failed: ${r.error}`);
    const txnId = lastTxnId("SALE");
    getCustomerSessionRepository().linkTransaction(
      sessionId,
      "sale",
      r.id!,
      20.12,
      0,
      0,
      0,
      txnId,
    );
    new SessionPaymentService().recordBasketPayment(sessionId, {
      legs: [{ method: "CASH", currencyCode: "USD", amount: 20.12 }],
      exchangeRate: RATE,
      userId: USER_ID,
    });
    const saleItemId = (
      db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(r.id!) as {
        id: number;
      }
    ).id;
    return { sessionId, txnId, saleItemId };
  }
  const res = new RechargeRepository().processRecharge({
    provider: "MTC",
    type: "CREDIT_TRANSFER",
    amount: 3,
    cost: 255_000,
    price: 300_000,
    currency: "LBP",
    phoneNumber: "03999001",
    payments: [],
    deferPayment: true,
    userId: USER_ID,
  } as Parameters<RechargeRepository["processRecharge"]>[0]);
  if (!res.success) throw new Error(`processRecharge failed: ${res.error}`);
  const txnId = lastTxnId("RECHARGE");
  const rechargeId = (
    db
      .prepare(`SELECT source_id FROM transactions WHERE id = ?`)
      .get(txnId) as {
      source_id: number;
    }
  ).source_id;
  getCustomerSessionRepository().linkTransaction(
    sessionId,
    "recharge",
    rechargeId,
    0,
    300_000,
    0,
    0,
    txnId,
  );
  new SessionPaymentService().recordBasketPayment(sessionId, {
    legs: [{ method: "CASH", currencyCode: "LBP", amount: 300_000 }],
    exchangeRate: RATE,
    userId: USER_ID,
  });
  return { sessionId, txnId };
}

interface Case {
  name: string;
  currency: Currency;
  kept: number;
  /** Creates the original and returns its transactions.id plus a refund
   *  callback (exact or keeping `kept`) returning the REFUND row's id. */
  setup: () => { origTxnId: number; refund: (keep: boolean) => number };
}

const CASES: Case[] = [
  {
    name: "OMT transfer (whole refund, Transactions page)",
    currency: "USD",
    kept: 0.12,
    setup: () => {
      new FinancialServiceRepository().createTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 1,
        omtFee: 5,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 105 }],
      } as Parameters<FinancialServiceRepository["createTransaction"]>[0]);
      const id = lastTxnId("FINANCIAL_SERVICE");
      return {
        origTxnId: id,
        refund: (keep) =>
          getTransactionRepository().refundTransaction(id, refundUserId, {
            refundLegs: [
              {
                method: "CASH",
                currencyCode: "USD",
                amount: keep ? 104.88 : 105,
              },
            ],
            ...(keep ? { keptChange: keptPayload(0.12, "USD") } : {}),
          }),
      };
    },
  },
  {
    name: "SALE (whole refund, Transactions page)",
    currency: "USD",
    kept: 0.12,
    setup: () => {
      const { txnId } = cashSale();
      return {
        origTxnId: txnId,
        refund: (keep) =>
          getTransactionRepository().refundTransaction(txnId, refundUserId, {
            refundLegs: [
              {
                method: "CASH",
                currencyCode: "USD",
                amount: keep ? 25 : 25.12,
              },
            ],
            ...(keep ? { keptChange: keptPayload(0.12, "USD") } : {}),
          }),
      };
    },
  },
  {
    name: "SALE item refund (POS)",
    currency: "USD",
    kept: 0.12,
    setup: () => {
      const { saleId, txnId, itemA } = cashSale();
      return {
        origTxnId: txnId,
        refund: (keep) => itemRefund(saleId, itemA, keep),
      };
    },
  },
  {
    name: "session item refund — sale member",
    currency: "USD",
    kept: 0.12,
    setup: () => {
      const { sessionId, txnId, saleItemId } = sessionMember("sale");
      return {
        origTxnId: txnId,
        refund: (keep) => {
          const payload = sessionItemRefundSchema.parse({
            sessionId,
            transactionId: txnId,
            saleItemId,
            quantity: 1,
            refundLegs: [
              {
                method: "CASH",
                currencyCode: "USD",
                amount: keep ? 20 : 20.12,
              },
            ],
            ...(keep ? { kept_change_usd: 0.12 } : {}),
          });
          return getTransactionRepository().refundSessionBasketItem({
            ...payload,
            userId: refundUserId,
          }).refundTransactionId;
        },
      };
    },
  },
  {
    name: "session item refund — recharge member (LBP)",
    currency: "LBP",
    kept: 50_000,
    setup: () => {
      const { sessionId, txnId } = sessionMember("recharge");
      return {
        origTxnId: txnId,
        refund: (keep) => {
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
          return getTransactionRepository().refundSessionBasketItem({
            ...payload,
            userId: refundUserId,
          }).refundTransactionId;
        },
      };
    },
  },
];

interface Windows {
  mon: Surfaces;
  wed: Surfaces;
  range: Surfaces;
}

/** One world: original on Monday (today − 2), refund on Wednesday (today). */
function runWorld(
  c: Case,
  keep: boolean,
  refunder?: (db: Database.Database) => number,
): Windows {
  freshWorld();
  const { origTxnId, refund } = c.setup();
  const wed = today();
  const mon = shiftDay(wed, -2);
  backdate(origTxnId, mon);
  if (refunder) refundUserId = refunder(db);
  refund(keep);
  return {
    mon: surfaces(mon, mon),
    wed: surfaces(wed, wed),
    range: surfaces(mon, wed),
  };
}

describe("refund kept change lands on the REFUND's day (owner decision 2026-10-07)", () => {
  describe.each(CASES)("$name", (c) => {
    it("Monday original, Wednesday refund: Wednesday shows the kept amount, Monday is unchanged by it, the Mon–Wed total is the same as before", () => {
      const exact = runWorld(c, false);
      const kept = runWorld(c, true);
      expect(minus(kept.mon, exact.mon)).toEqual(ZERO);
      expect(minus(kept.wed, exact.wed)).toEqual(
        keptDelta(c.kept, c.currency, { withClose: true }),
      );
      expect(minus(kept.range, exact.range)).toEqual(
        keptDelta(c.kept, c.currency, { withClose: false }),
      );
    });
  });

  it("a sale item refund kept on Wednesday and undone on Thursday: Wednesday +0.12, Thursday −0.12, the sale's own day and the whole range unchanged", () => {
    function world(keep: boolean) {
      freshWorld();
      const { saleId, txnId, itemA } = cashSale();
      const thu = today();
      const wed = shiftDay(thu, -1);
      const mon = shiftDay(thu, -3);
      backdate(txnId, mon);
      const refundId = itemRefund(saleId, itemA, keep);
      db.prepare(`UPDATE transactions SET created_at = ? WHERE id = ?`).run(
        `${wed} 12:00:00`,
        refundId,
      );
      new SalesRepository().undoSaleItemRefund({
        refundTransactionId: refundId,
        userId: USER_ID,
      });
      return {
        mon: surfaces(mon, mon),
        wed: surfaces(wed, wed),
        thu: surfaces(thu, thu),
        range: surfaces(mon, thu),
      };
    }
    const exact = world(false);
    const kept = world(true);
    expect(minus(kept.mon, exact.mon)).toEqual(ZERO);
    expect(minus(kept.wed, exact.wed)).toEqual(
      keptDelta(0.12, "USD", { withClose: true }),
    );
    expect(minus(kept.thu, exact.thu)).toEqual(
      keptDelta(-0.12, "USD", { withClose: true }),
    );
    expect(minus(kept.range, exact.range)).toEqual(
      keptDelta(0, "USD", { withClose: false }),
    );
  });

  it("who it is credited to (owner decision 2026-10-07): a walk-in sale by cashier 1 refunded by cashier 2 credits the kept $0.12 to cashier 2 — who did the refund and kept the change — and to the walk-in's own name, on the refund's day", () => {
    // By Cashier follows the drawer: the refunder kept the change. By
    // Client stays with the original customer — the refund is still theirs.
    freshWorld();
    const cashier2 = Number(
      db
        .prepare(
          `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (1, 'cashier2', '', 'staff', 1)`,
        )
        .run().lastInsertRowid,
    );
    const a = addProduct(20.12, 10);
    const r = new SalesRepository().processSale(
      saleRequest([{ product_id: a, price: 20.12 }], {
        client_name: "Ali",
        payments: [{ method: "CASH", currency_code: "USD", amount: 20.12 }],
      }),
      USER_ID,
    );
    if (!r.success) throw new Error(`processSale failed: ${r.error}`);
    const saleTxnId = lastTxnId("SALE");
    const itemA = (
      db.prepare(`SELECT id FROM sale_items WHERE sale_id = ?`).get(r.id!) as {
        id: number;
      }
    ).id;
    const wed = today();
    const mon = shiftDay(wed, -2);
    backdate(saleTxnId, mon);
    const refundId = new SalesRepository().refundSaleItem({
      saleId: r.id!,
      saleItemId: itemA,
      refundQuantity: 1,
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
      keptChange: keptPayload(0.12, "USD"),
      userId: cashier2,
    });
    // The REFUND row itself names neither the seller nor the walk-in (no
    // reverses_id, no client_name, user = the refunder) — so the By Client
    // credit below can only come from resolving the refunded sale.
    expect(
      db
        .prepare(
          `SELECT user_id, client_name, reverses_id FROM transactions WHERE id = ?`,
        )
        .get(refundId),
    ).toEqual({ user_id: cashier2, client_name: null, reverses_id: null });
    const svc = new ProfitService(new ProfitRepository());
    const users = svc
      .getByUser(wed, wed)
      .filter((u) => r2(u.profit_usd) !== 0)
      .map((u) => [u.user_id, r2(u.profit_usd)]);
    expect(users).toEqual([[cashier2, 0.12]]);
    const clients = svc
      .getByClient(wed, wed, 1000)
      .filter((c) => r2(c.profit_usd) !== 0)
      .map((c) => [c.client_name, r2(c.profit_usd)]);
    expect(clients).toEqual([["Ali", 0.12]]);
    // Monday: the sale and its reversal net to 0 for cashier 1 and Ali.
    expect(svc.getByUser(mon, mon).every((u) => r2(u.profit_usd) === 0)).toBe(
      true,
    );
  });

  it("debt repayment refund (already dated by the refund's day): unchanged — Wednesday +0.12, Monday 0", () => {
    // Not a failing-first guard: the debt-repayment refund already dated its
    // kept change by the refund's own day before this change. It pins that
    // widening the refund kept-change reader does not count it twice.
    function world(keep: boolean): Windows {
      freshWorld();
      const clientId = Number(
        db
          .prepare(
            `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Debtor', '70123456')`,
          )
          .run().lastInsertRowid,
      );
      getDebtRepository().addRepayment({
        client_id: clientId,
        amount_usd: 20.12,
        amount_lbp: 0,
        created_by: USER_ID,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 20.12 }],
      });
      const repaymentId = lastTxnId("DEBT_REPAYMENT");
      const wed = today();
      const mon = shiftDay(wed, -2);
      db.prepare(`UPDATE transactions SET created_at = ? WHERE id = ?`).run(
        `${mon} 12:00:00`,
        repaymentId,
      );
      getTransactionRepository().refundTransaction(repaymentId, USER_ID, {
        refundLegs: [
          { method: "CASH", currencyCode: "USD", amount: keep ? 20 : 20.12 },
        ],
        ...(keep ? { keptChange: keptPayload(0.12, "USD") } : {}),
      });
      return {
        mon: surfaces(mon, mon),
        wed: surfaces(wed, wed),
        range: surfaces(mon, wed),
      };
    }
    const exact = world(false);
    const kept = world(true);
    expect(minus(kept.mon, exact.mon)).toEqual(ZERO);
    expect(minus(kept.wed, exact.wed)).toEqual(
      keptDelta(0.12, "USD", { withClose: true, keptCard: false }),
    );
    expect(minus(kept.range, exact.range)).toEqual(
      keptDelta(0.12, "USD", { withClose: false, keptCard: false }),
    );
  });
});

// ─── By Cashier: the refunder keeps the change (owner decision 2026-10-07) ──

/** Insert a cashier; returns its users.id. */
function addCashier(d: Database.Database, name: string): number {
  return Number(
    d
      .prepare(
        `INSERT INTO users (tenant_id, username, password_hash, role, is_active) VALUES (1, ?, '', 'staff', 1)`,
      )
      .run(name).lastInsertRowid,
  );
}

type CashierMap = Record<string, { usd: number; lbp: number }>;

/** By Cashier over [from, to], keyed by user_id, non-zero rows only. */
function byCashier(from: string, to: string): CashierMap {
  const out: CashierMap = {};
  for (const u of new ProfitService(new ProfitRepository()).getByUser(
    from,
    to,
  )) {
    const usd = r2(u.profit_usd);
    const lbp = r2(u.profit_lbp);
    if (usd !== 0 || lbp !== 0) out[String(u.user_id)] = { usd, lbp };
  }
  return out;
}

/** kept − exact, per cashier (a cashier missing from one side reads 0). */
function cashierDelta(kept: CashierMap, exact: CashierMap): CashierMap {
  const out: CashierMap = {};
  for (const id of new Set([...Object.keys(kept), ...Object.keys(exact)])) {
    const usd = r2((kept[id]?.usd ?? 0) - (exact[id]?.usd ?? 0));
    const lbp = r2((kept[id]?.lbp ?? 0) - (exact[id]?.lbp ?? 0));
    if (usd !== 0 || lbp !== 0) out[id] = { usd, lbp };
  }
  return out;
}

describe("By Cashier — refund kept change goes to the cashier who did the refund (owner decision 2026-10-07)", () => {
  // Rami (USER_ID) sells on Monday; Sara refunds on Wednesday and keeps the
  // change. Sara gets the kept part on Wednesday; Rami is untouched by it
  // on every window. Rule 17: written before the fix.
  describe.each(CASES)("$name", (c) => {
    it("Rami sells Monday, Sara refunds Wednesday keeping the change: Sara +kept on Wednesday, Rami unchanged by it", () => {
      const world = (keep: boolean) => {
        let sara = 0;
        runWorld(c, keep, (d) => (sara = addCashier(d, "sara")));
        const wed = today();
        const mon = shiftDay(wed, -2);
        // The REFUND row is Sara's own (the writer stamps the refunder).
        expect(
          (
            db
              .prepare(
                `SELECT user_id FROM transactions WHERE type = 'REFUND' ORDER BY id DESC LIMIT 1`,
              )
              .get() as { user_id: number }
          ).user_id,
        ).toBe(sara);
        return {
          sara,
          mon: byCashier(mon, mon),
          wed: byCashier(wed, wed),
          range: byCashier(mon, wed),
        };
      };
      const exact = world(false);
      const kept = world(true);
      const expected = {
        [String(kept.sara)]: {
          usd: c.currency === "USD" ? c.kept : 0,
          lbp: c.currency === "LBP" ? c.kept : 0,
        },
      };
      expect(cashierDelta(kept.mon, exact.mon)).toEqual({});
      expect(cashierDelta(kept.wed, exact.wed)).toEqual(expected);
      expect(cashierDelta(kept.range, exact.range)).toEqual(expected);
      // Sara has a By Cashier row of her own on Wednesday (she sold nothing).
      expect(kept.wed[String(kept.sara)]).toEqual(expected[String(kept.sara)]);
      expect(kept.wed[String(USER_ID)]).toEqual(exact.wed[String(USER_ID)]);
    });
  });

  it("an undo by a third cashier: Sara +0.12 on Wednesday (her refund), Omar −0.12 on Thursday (his undo), Rami unchanged; the kept part nets to 0 over the range", () => {
    function world(keep: boolean) {
      freshWorld();
      const sara = addCashier(db, "sara");
      const omar = addCashier(db, "omar");
      const { saleId, txnId, itemA } = cashSale();
      const thu = today();
      const wed = shiftDay(thu, -1);
      const mon = shiftDay(thu, -3);
      backdate(txnId, mon);
      refundUserId = sara;
      const refundId = itemRefund(saleId, itemA, keep);
      db.prepare(`UPDATE transactions SET created_at = ? WHERE id = ?`).run(
        `${wed} 12:00:00`,
        refundId,
      );
      new SalesRepository().undoSaleItemRefund({
        refundTransactionId: refundId,
        userId: omar,
      });
      return {
        sara,
        omar,
        mon: byCashier(mon, mon),
        wed: byCashier(wed, wed),
        thu: byCashier(thu, thu),
        range: byCashier(mon, thu),
      };
    }
    const exact = world(false);
    const kept = world(true);
    expect(cashierDelta(kept.mon, exact.mon)).toEqual({});
    expect(cashierDelta(kept.wed, exact.wed)).toEqual({
      [String(kept.sara)]: { usd: 0.12, lbp: 0 },
    });
    expect(cashierDelta(kept.thu, exact.thu)).toEqual({
      [String(kept.omar)]: { usd: -0.12, lbp: 0 },
    });
    expect(cashierDelta(kept.range, exact.range)).toEqual({
      [String(kept.sara)]: { usd: 0.12, lbp: 0 },
      [String(kept.omar)]: { usd: -0.12, lbp: 0 },
    });
    // Rami's own row over the whole range is exactly the no-kept world's.
    expect(kept.range[String(USER_ID)]).toEqual(exact.range[String(USER_ID)]);
  });
});

/**
 * LIRA-388 — "Refund" on every transaction row except the structural ones.
 *
 * One real-schema database (create_db.sql, `testHelpers/debtItemDb`) for the
 * whole file; every case creates its own rows through the REAL writers and
 * asserts deltas only (rule 15 style), so cases never depend on each other.
 *
 * Every refund goes through `TransactionService.refundTransaction` — the ONE
 * entry point both transports call — so the dispatch is under test too.
 *
 * Rule 17: each block was run on the unfixed code first; the red lines are
 * recorded in specs/388-refund-any-transaction/tasks.md ("Red → green log").
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
} from "../testHelpers/debtItemDb";
import {
  snapshotLedgers,
  ledgerDeltas,
  expectPostings,
} from "../testHelpers/postingAssert";
import {
  getTransactionRepository,
  type TransactionEntity,
} from "../TransactionRepository";
import { LotoCashPrizeRepository } from "../LotoCashPrizeRepository";
import { getTransactionService } from "../../services/TransactionService";
import { insertPaymentRow, applyDrawerDelta } from "../moneyPosting";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  getDebtRepository,
  BUNDLED_REPAYMENT_TXN_KEY,
} from "../DebtRepository";
import { getDebtService } from "../../services/DebtService";
import { getHoldMoneyRepository } from "../HoldMoneyRepository";
import { getVoucherService } from "../../services/VoucherService";
import { getWarrantyService } from "../../services/WarrantyService";
import { SalesRepository } from "../SalesRepository";
import { getStockBatchRepository } from "../StockBatchRepository";
import { getDrawerTopUpRepository } from "../DrawerTopUpRepository";
import { getDrawerCashoutRepository } from "../DrawerCashoutRepository";
import { getLotoMonthlyFeeRepository } from "../LotoMonthlyFeeRepository";
import { getSupplierRepository } from "../SupplierRepository";
import { getPartnerService } from "../../services/PartnerService";
import { getCarrierLineRepository } from "../CarrierLineRepository";
import { partnerNettingBalanceSql } from "../../constants/partnerObligation";

const USER_ID = 1;
let db: Database.Database;

beforeAll(() => {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  // Cash on hand so payouts never trip an insufficient-drawer guard.
  for (const [cur, amt] of [
    ["USD", 100_000],
    ["LBP", 9_000_000_000],
  ] as const) {
    applyDrawerDelta(db, {
      drawerName: "General",
      currencyCode: cur,
      delta: amt,
      tenantId: 1,
    });
  }
});

afterAll(() => {
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

const txn = (id: number): TransactionEntity =>
  getTransactionRepository().findById(id)!;

/** The ACTIVE REFUND row reversing `id`, if any. */
function refundRowOf(id: number): TransactionEntity | undefined {
  return db
    .prepare(
      `SELECT * FROM transactions WHERE reverses_id = ? AND type = 'REFUND' AND status = 'ACTIVE'`,
    )
    .get(id) as TransactionEntity | undefined;
}

function refund(
  id: number,
  opts: Parameters<
    ReturnType<typeof getTransactionService>["refundTransaction"]
  >[2] = {},
): { success: boolean; refundId?: number; error?: string } {
  // The service throws on a refusal and returns the reversal row's id —
  // the same contract the IPC handler and REST route wrap in the envelope.
  try {
    const refundId = getTransactionService().refundTransaction(
      id,
      USER_ID,
      opts,
    );
    return { success: true, refundId };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

// ─── US1 — standalone loto cash prize ───────────────────────────────────────

function payStandalonePrize(amountLbp: number): {
  prizeId: number;
  txnId: number;
} {
  const repo = new LotoCashPrizeRepository(db);
  const prize = repo.createCashPrize({
    ticket_number: `T-${amountLbp}`,
    prize_amount: amountLbp,
    prize_date: "2026-11-11",
    userId: USER_ID,
  });
  const t = db
    .prepare(
      `SELECT id FROM transactions WHERE type = 'LOTO_CASH_PRIZE' AND source_table = 'loto_cash_prizes' AND source_id = ?`,
    )
    .get(prize.id) as { id: number };
  return { prizeId: prize.id, txnId: t.id };
}

describe("US1 — a standalone loto cash prize is refundable from its row", () => {
  it("refund: the paying drawer gets the prize back, prize voided, ledger row soft-voided, REFUND row linked; every ledger nets 0", () => {
    const before = snapshotLedgers(db);
    const { prizeId, txnId } = payStandalonePrize(500_000);
    const result = refund(txnId);
    expect(result).toMatchObject({ success: true });
    // create + refund nets every ledger to 0, per currency
    expectPostings(before, snapshotLedgers(db), {});
    const r = refundRowOf(txnId);
    expect(r).toBeDefined();
    expect(r!.amount_lbp).toBe(500_000);
    expect(JSON.parse(r!.metadata_json ?? "{}").refundType).toBe("standalone");
    const prize = db
      .prepare(`SELECT voided FROM loto_cash_prizes WHERE id = ?`)
      .get(prizeId) as { voided: number };
    expect(prize.voided).toBe(1);
    const ledger = db
      .prepare(
        `SELECT is_refunded FROM supplier_ledger WHERE transaction_id = ? AND entry_type = 'CASH_PRIZE'`,
      )
      .get(txnId) as { is_refunded: number };
    expect(ledger.is_refunded).toBe(1);
  });

  it("the customer may pay the prize back another way (method changed): every ledger still nets 0", () => {
    const before = snapshotLedgers(db);
    const { txnId } = payStandalonePrize(178_000);
    // 178,000 LBP = $2 at 89,000: the customer pays the prize back in
    // dollars instead of lira.
    const ok = refund(txnId, {
      refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 2 }],
      exchangeRate: 89_000,
    });
    expect(ok).toMatchObject({ success: true });
    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(d.supplier).toEqual({});
    expect(d.debt).toEqual({});
    // General paid 178,000 LBP out and took $2 back in.
    expect(d.drawers["General|LBP"]).toBe(-178_000);
    expect(d.drawers["General|USD"]).toBe(2);
  });

  it("the raw void stays refused (the gate is unchanged)", () => {
    const { txnId } = payStandalonePrize(100_000);
    expect(() =>
      getTransactionRepository().voidTransaction(txnId, USER_ID),
    ).toThrow(/cannot be voided or refunded/);
  });

  it("a prize already included in a day settlement is refused, nothing written", () => {
    const { txnId } = payStandalonePrize(250_000);
    // A LIRA-351 day settlement stamps the prize's CASH_PRIZE ledger row.
    const settlement = db
      .prepare(
        `INSERT INTO supplier_ledger (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_at)
         VALUES (1, (SELECT supplier_id FROM supplier_ledger WHERE transaction_id = ? LIMIT 1), 'PAYMENT', 0, 0, 'day settle', '2026-11-11 18:00:00')`,
      )
      .run(txnId);
    db.prepare(
      `UPDATE supplier_ledger SET settlement_id = ? WHERE transaction_id = ? AND entry_type = 'CASH_PRIZE'`,
    ).run(settlement.lastInsertRowid, txnId);
    const before = snapshotLedgers(db);
    const result = refund(txnId);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already included in settlement/);
    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
    expect(refundRowOf(txnId)).toBeUndefined();
  });
});

// ─── US2 — an untouched refund books the same money as today's Void ─────────

let rowSeq = 0;
/** A two-leg SALE-shaped row (cash in + change out) through the shared writers. */
function twoLegRow(
  type: "SALE" | "CUSTOM_SERVICE" | "RECHARGE",
  usdIn: number,
  lbpChange: number,
): number {
  const id = getTransactionRepository().createTransaction({
    type,
    // A source no module table owns: only the generic legs are compared.
    source_table: "lira388_rows",
    source_id: ++rowSeq,
    user_id: USER_ID,
    amount_usd: usdIn - lbpChange / 89_000,
    amount_lbp: 0,
    profit_usd: 3,
    profit_lbp: 0,
    summary: `${type} two-leg`,
    metadata_json: {},
  });
  insertPaymentRow(db, {
    transactionId: id,
    method: "CASH",
    drawerName: "General",
    currencyCode: "USD",
    amount: usdIn,
    createdBy: USER_ID,
    tenantId: 1,
  });
  insertPaymentRow(db, {
    transactionId: id,
    method: "CASH",
    drawerName: "General",
    currencyCode: "LBP",
    amount: -lbpChange,
    createdBy: USER_ID,
    tenantId: 1,
  });
  applyDrawerDelta(db, {
    drawerName: "General",
    currencyCode: "USD",
    delta: usdIn,
    tenantId: 1,
  });
  applyDrawerDelta(db, {
    drawerName: "General",
    currencyCode: "LBP",
    delta: -lbpChange,
    tenantId: 1,
  });
  return id;
}

describe("US2 — same-method refund = today's Void, in money", () => {
  it.each(["SALE", "CUSTOM_SERVICE", "RECHARGE"] as const)(
    "%s: void and an untouched refund move every ledger identically",
    (type) => {
      const a = twoLegRow(type, 20, 89_000);
      const b = twoLegRow(type, 20, 89_000);
      const s0 = snapshotLedgers(db);
      getTransactionRepository().voidTransaction(a, USER_ID);
      const s1 = snapshotLedgers(db);
      expect(refund(b)).toMatchObject({ success: true });
      const s2 = snapshotLedgers(db);
      expect(ledgerDeltas(s1, s2)).toEqual(ledgerDeltas(s0, s1));
      // the refund keeps the original and links a REFUND row instead of
      // flipping it to VOIDED
      expect(txn(b).status).toBe("ACTIVE");
      expect(refundRowOf(b)!.profit_usd).toBe(-3);
    },
  );
});

// ─── US3 — customer-money rows ──────────────────────────────────────────────

let clientSeq = 3880;
function newClient(): number {
  clientSeq += 1;
  addClient(db, clientSeq, `Client ${clientSeq}`, `70${clientSeq}`);
  return clientSeq;
}

/** The newest transaction of a type (rows are created one at a time). */
function newest(type: string): TransactionEntity {
  return db
    .prepare(
      `SELECT * FROM transactions WHERE type = ? AND reverses_id IS NULL ORDER BY id DESC LIMIT 1`,
    )
    .get(type) as TransactionEntity;
}

const cashUsd = (amount: number) => [
  { method: "CASH", currencyCode: "USD", amount },
];

const nothingMoved = (before: ReturnType<typeof snapshotLedgers>) =>
  expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
    drawers: {},
    supplier: {},
    partner: {},
    debt: {},
  });

describe("US3 — account cash in / out", () => {
  it("CREDIT_CASH_IN: drawer and client credit return; REFUND row linked", () => {
    const c = newClient();
    const before = snapshotLedgers(db);
    getDebtRepository().addAccountCashEntry({
      direction: "credit",
      client_id: c,
      amount_usd: 50,
      amount_lbp: 0,
      payments: cashUsd(50),
      created_by: USER_ID,
    });
    const t = newest("CREDIT_CASH_IN");
    expect(refund(t.id)).toMatchObject({ success: true });
    expectPostings(before, snapshotLedgers(db), {});
    expect(refundRowOf(t.id)).toBeDefined();
  });

  it("CREDIT_CASH_IN whose credit was since spent is refused, naming what is left", () => {
    const c = newClient();
    getDebtRepository().addAccountCashEntry({
      direction: "credit",
      client_id: c,
      amount_usd: 50,
      amount_lbp: 0,
      payments: cashUsd(50),
      created_by: USER_ID,
    });
    const t = newest("CREDIT_CASH_IN");
    // $30 of the credit goes on a charge afterwards.
    getDebtRepository().addAccountCashEntry({
      direction: "debt",
      client_id: c,
      amount_usd: 30,
      amount_lbp: 0,
      created_by: USER_ID,
      move_cash: false,
    });
    const before = snapshotLedgers(db);
    const res = refund(t.id);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/credit.*\$20/i);
    nothingMoved(before);
  });

  it("CREDIT_CASH_OUT (beyond credit): drawer back, credit and the excess debt both reversed", () => {
    const c = newClient();
    const before = snapshotLedgers(db);
    getDebtRepository().addAccountCashEntry({
      direction: "credit",
      client_id: c,
      amount_usd: 20,
      amount_lbp: 0,
      payments: cashUsd(20),
      created_by: USER_ID,
    });
    const afterCredit = snapshotLedgers(db);
    getDebtService().cashOut({
      clientId: c,
      amountUSD: 50,
      amountLBP: 0,
      payments: cashUsd(50),
      userId: USER_ID,
    });
    const t = newest("CREDIT_CASH_OUT");
    expect(refund(t.id)).toMatchObject({ success: true });
    // back to "credit given, nothing cashed out"
    expect(ledgerDeltas(afterCredit, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
    expect(ledgerDeltas(before, afterCredit).debt).toEqual({
      [`${c}|USD`]: -20,
    });
  });

  it("CREDIT_CASH_OUT refuses Customer Account as the method (circular)", () => {
    const c = newClient();
    getDebtRepository().addAccountCashEntry({
      direction: "credit",
      client_id: c,
      amount_usd: 10,
      amount_lbp: 0,
      payments: cashUsd(10),
      created_by: USER_ID,
    });
    getDebtService().cashOut({
      clientId: c,
      amountUSD: 10,
      amountLBP: 0,
      payments: cashUsd(10),
      userId: USER_ID,
    });
    const t = newest("CREDIT_CASH_OUT");
    const before = snapshotLedgers(db);
    const res = refund(t.id, {
      refundLegs: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 10 },
      ],
    });
    expect(res.success).toBe(false);
    nothingMoved(before);
  });

  it("DEBT_CASH_OUT: drawer and the client's debt return", () => {
    const c = newClient();
    const before = snapshotLedgers(db);
    getDebtRepository().addAccountCashEntry({
      direction: "debt",
      client_id: c,
      amount_usd: 40,
      amount_lbp: 0,
      payments: cashUsd(40),
      created_by: USER_ID,
    });
    const t = newest("DEBT_CASH_OUT");
    expect(refund(t.id)).toMatchObject({ success: true });
    expectPostings(before, snapshotLedgers(db), {});
  });

  it.each(["credit", "debt"] as const)(
    "ACCOUNT_ADJUSTMENT (%s, no cash): the client's balance returns; legs refused",
    (direction) => {
      const c = newClient();
      const before = snapshotLedgers(db);
      getDebtRepository().addAccountCashEntry({
        direction,
        client_id: c,
        amount_usd: 25,
        amount_lbp: 0,
        created_by: USER_ID,
        move_cash: false,
      });
      const t = newest("ACCOUNT_ADJUSTMENT");
      expect(refund(t.id, { refundLegs: cashUsd(25) }).success).toBe(false);
      expect(refund(t.id)).toMatchObject({ success: true });
      expectPostings(before, snapshotLedgers(db), {});
      expect(
        JSON.parse(refundRowOf(t.id)!.metadata_json ?? "{}").refundType,
      ).toBe("bookkeeping");
    },
  );
});

describe("US3 — Hold Money", () => {
  const holds = () => getHoldMoneyRepository();

  it("HOLD_MONEY drop-off: cash back, the hold leaves the active list and cannot be collected", () => {
    const before = snapshotLedgers(db);
    const res = holds().createHold(
      { client_name: "Hold A", usd_amount: 100, lbp_amount: 0 },
      USER_ID,
    );
    expect(res.success).toBe(true);
    const t = newest("HOLD_MONEY");
    expect(refund(t.id)).toMatchObject({ success: true });
    expectPostings(before, snapshotLedgers(db), {});
    expect(
      holds()
        .getActiveHolds()
        .some((h) => h.id === res.id),
    ).toBe(false);
    // the Hold Money page's "Held" list (getAll status 'held') too
    expect(
      holds()
        .getAll({ status: "held" })
        .some((h) => h.id === res.id),
    ).toBe(false);
    expect(holds().collectHold({ id: res.id! }, USER_ID).success).toBe(false);
  });

  it("HOLD_MONEY drop-off with a live pickup is refused", () => {
    const res = holds().createHold(
      { client_name: "Hold B", usd_amount: 100, lbp_amount: 0 },
      USER_ID,
    );
    const drop = newest("HOLD_MONEY");
    expect(
      holds().collectHold({ id: res.id!, usd_amount: 40 }, USER_ID).success,
    ).toBe(true);
    const before = snapshotLedgers(db);
    const r = refund(drop.id);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/pick/i);
    nothingMoved(before);
  });

  it("HOLD_MONEY_COLLECT: runs the Hold Money page's own 'Void pickup' (pickup voided, hold back to held)", () => {
    const res = holds().createHold(
      { client_name: "Hold C", usd_amount: 100, lbp_amount: 0 },
      USER_ID,
    );
    const before = snapshotLedgers(db);
    expect(holds().collectHold({ id: res.id! }, USER_ID).success).toBe(true);
    const pickupTxn = newest("HOLD_MONEY_COLLECT");
    expect(refund(pickupTxn.id)).toMatchObject({ success: true });
    expectPostings(before, snapshotLedgers(db), {});
    const pickup = holds().getPickupByTransactionId(pickupTxn.id)!;
    expect(pickup.is_voided).toBe(1);
    expect(holds().getById(res.id!)!.status).toBe("held");
    // the row now reads as reversed on the Transactions page
    const row = getTransactionRepository()
      .getRecent(500)
      .find((x) => x.id === pickupTxn.id)!;
    expect(row.reversed_by_id).not.toBeNull();
  });
});

describe("US3 — Vouchers and Warranty", () => {
  it("VOUCHER_SALE: runs the Vouchers page's 'Cancel voucher' (cash back, voucher cancelled, row reversed)", () => {
    const c = newClient();
    const before = snapshotLedgers(db);
    const sold = getVoucherService().createVoucher(
      {
        clientId: c,
        amount: 30,
        currency: "USD",
        exchange_rate: 89_000,
        payments: [{ method: "CASH", currency_code: "USD", amount: 30 }],
      },
      USER_ID,
    );
    expect(sold.success).toBe(true);
    const t = newest("VOUCHER_SALE");
    expect(refund(t.id)).toMatchObject({ success: true });
    expectPostings(before, snapshotLedgers(db), {});
    const v = db
      .prepare(`SELECT status FROM vouchers WHERE id = ?`)
      .get(sold.voucher!.id) as { status: string };
    expect(v.status).toBe("cancelled");
    const row = getTransactionRepository()
      .getRecent(500)
      .find((x) => x.id === t.id)!;
    expect(row.reversed_by_id).not.toBeNull();
  });

  it("a redeemed voucher is refused with the Vouchers page's own message", () => {
    const c = newClient();
    const sold = getVoucherService().createVoucher(
      {
        clientId: c,
        amount: 15,
        currency: "USD",
        exchange_rate: 89_000,
        payments: [{ method: "CASH", currency_code: "USD", amount: 15 }],
      },
      USER_ID,
    );
    const t = newest("VOUCHER_SALE");
    db.prepare(`UPDATE vouchers SET status = 'redeemed' WHERE id = ?`).run(
      sold.voucher!.id,
    );
    const before = snapshotLedgers(db);
    const r = refund(t.id);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Only pending vouchers can be cancelled/);
    nothingMoved(before);
  });

  it("WARRANTY_COST: runs the Warranty page's 'void claim'; every ledger nets 0", () => {
    const c = newClient();
    const productId = Number(
      db
        .prepare(
          `INSERT INTO products (tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity, warranty_months)
           VALUES (1, 'Earbuds 388', 'Product', 'Accessories', 6, 20, 5, 3)`,
        )
        .run().lastInsertRowid,
    );
    getStockBatchRepository().createBatch({
      product_id: productId,
      supplier_id: null,
      quantity: 5,
      unit_cost_usd: 6,
      books_debt: false,
      created_by: USER_ID,
    });
    const sale = new SalesRepository().processSale(
      {
        client_id: c,
        items: [{ product_id: productId, quantity: 1, price: 20 }],
        total_amount: 20,
        discount: 0,
        final_amount: 20,
        payment_usd: 20,
        payment_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: 20 }],
        exchange_rate: 89_000,
        status: "completed",
        client_day: "2026-11-11",
      },
      USER_ID,
    );
    const saleItemId = (
      db
        .prepare(`SELECT id FROM sale_items WHERE sale_id = ?`)
        .get(sale.id) as {
        id: number;
      }
    ).id;
    const before = snapshotLedgers(db);
    const created = getWarrantyService().createClaim(
      { sale_item_id: saleItemId, action: "REFUND", client_day: "2026-11-11" },
      { userId: USER_ID, role: "admin" },
    );
    expect(created.success).toBe(true);
    const cost = newest("WARRANTY_COST");
    expect(refund(cost.id, { actorRole: "admin" })).toMatchObject({
      success: true,
    });
    expectPostings(before, snapshotLedgers(db), {});
    const claim = db
      .prepare(`SELECT status FROM warranty_claims WHERE id = ?`)
      .get(cost.source_id) as { status: string };
    expect(claim.status).toBe("VOIDED");
  });
});

// ─── US4 — bookkeeping rows ─────────────────────────────────────────────────

describe("US4 — bookkeeping rows: one confirm writes the opposite entry", () => {
  it("DRAWER_TOPUP (external): drawer back", () => {
    const before = snapshotLedgers(db);
    getDrawerTopUpRepository().createTopUp(
      { amount_usd: 100, amount_lbp: 0 },
      USER_ID,
    );
    const t = newest("DRAWER_TOPUP");
    expect(refund(t.id)).toMatchObject({ success: true });
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("DRAWER_TOPUP from another drawer: both drawers back; an old row with only one leg is refused", () => {
    applyDrawerDelta(db, {
      drawerName: "OMT_System",
      currencyCode: "USD",
      delta: 500,
      tenantId: 1,
    });
    const before = snapshotLedgers(db);
    getDrawerTopUpRepository().createTopUpFromDrawer(
      { amount_usd: 60, amount_lbp: 0, source_drawer: "OMT_System" },
      USER_ID,
    );
    const t = newest("DRAWER_TOPUP");
    expect(refund(t.id)).toMatchObject({ success: true });
    expectPostings(before, snapshotLedgers(db), {});

    getDrawerTopUpRepository().createTopUpFromDrawer(
      { amount_usd: 10, amount_lbp: 0, source_drawer: "OMT_System" },
      USER_ID,
    );
    const legacy = newest("DRAWER_TOPUP");
    // Pre-LIRA-258 shape: only the General leg was journaled.
    db.prepare(
      `DELETE FROM payments WHERE transaction_id = ? AND drawer_name = 'OMT_System'`,
    ).run(legacy.id);
    const b2 = snapshotLedgers(db);
    expect(refund(legacy.id).success).toBe(false);
    nothingMoved(b2);
  });

  it("DRAWER_CASHOUT: drawer back", () => {
    const before = snapshotLedgers(db);
    getDrawerCashoutRepository().createCashout(
      { amount_usd: 30, amount_lbp: 0, notes: "lira388" },
      USER_ID,
    );
    const t = newest("DRAWER_CASHOUT");
    expect(refund(t.id)).toMatchObject({ success: true });
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("LOTO_MONTHLY_FEE: drawer back and the month reads unpaid again", () => {
    const fee = getLotoMonthlyFeeRepository().createMonthlyFee({
      fee_amount: 1_000_000,
      fee_month: "10",
      fee_year: 2026,
      recorded_date: "2026-10-31",
    });
    const before = snapshotLedgers(db);
    getLotoMonthlyFeeRepository().markFeePaid(fee.id, "2026-11-01", USER_ID);
    const t = newest("LOTO_MONTHLY_FEE");
    expect(refund(t.id)).toMatchObject({ success: true });
    expectPostings(before, snapshotLedgers(db), {});
    const row = db
      .prepare(`SELECT is_paid, paid_date FROM loto_monthly_fees WHERE id = ?`)
      .get(fee.id) as { is_paid: number; paid_date: string | null };
    expect(row).toEqual({ is_paid: 0, paid_date: null });
  });

  it("SUPPLIER_ADJUSTMENT: supplier balance back; a whole-row settled one is refused", () => {
    const sid = Number(
      db
        .prepare(
          `INSERT INTO suppliers (tenant_id, name) VALUES (1, 'Supp 388')`,
        )
        .run().lastInsertRowid,
    );
    const before = snapshotLedgers(db);
    getSupplierRepository().addLedgerEntry({
      supplier_id: sid,
      entry_type: "ADJUSTMENT",
      amount_usd: 40,
      amount_lbp: 0,
      created_by: USER_ID,
    });
    const t = newest("SUPPLIER_ADJUSTMENT");
    expect(refund(t.id)).toMatchObject({ success: true });
    expectPostings(before, snapshotLedgers(db), {});

    const e2 = getSupplierRepository().addLedgerEntry({
      supplier_id: sid,
      entry_type: "ADJUSTMENT",
      amount_usd: 15,
      amount_lbp: 0,
      created_by: USER_ID,
    });
    const t2 = newest("SUPPLIER_ADJUSTMENT");
    db.prepare(`UPDATE supplier_ledger SET settlement_id = ? WHERE id = ?`).run(
      e2.id,
      e2.id,
    );
    const b2 = snapshotLedgers(db);
    const r = refund(t2.id);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/settlement/i);
    nothingMoved(b2);
  });

  const netting = (partnerId: number): number =>
    (
      db
        .prepare(
          `SELECT ${partnerNettingBalanceSql("x")} AS b FROM (SELECT ? AS partner_id, 'USD' AS currency, 1 AS tenant_id) x`,
        )
        .get(partnerId) as { b: number }
    ).b;

  it.each(["CREDIT", "DEBIT"] as const)(
    "PARTNER_ADJUSTMENT (%s): partner ledger and the netting balance both return",
    (direction) => {
      const pid = Number(
        db
          .prepare(`INSERT INTO partners (tenant_id, name) VALUES (1, ?)`)
          .run(`Partner 388 ${direction}`).lastInsertRowid,
      );
      const before = snapshotLedgers(db);
      const nettingBefore = netting(pid);
      getPartnerService().recordPartnerTransaction({
        partnerId: pid,
        transactionType: "ADJUSTMENT",
        amount: 30,
        currency: "USD",
        direction,
        userId: USER_ID,
      });
      const t = newest("PARTNER_ADJUSTMENT");
      expect(refund(t.id)).toMatchObject({ success: true });
      expectPostings(before, snapshotLedgers(db), {});
      expect(netting(pid)).toBe(nettingBefore);
    },
  );

  const discountProfit = () =>
    db
      .prepare(
        `SELECT COALESCE(SUM(profit_usd), 0) AS usd FROM transactions WHERE type = 'COUNTERPARTY_DISCOUNT' AND status = 'ACTIVE'`,
      )
      .get() as { usd: number };

  it("COUNTERPARTY_DISCOUNT (client write-off): debt and discount profit both return", () => {
    const c = newClient();
    getDebtRepository().addAccountCashEntry({
      direction: "debt",
      client_id: c,
      amount_usd: 50,
      amount_lbp: 0,
      created_by: USER_ID,
      move_cash: false,
    });
    const before = snapshotLedgers(db);
    const p0 = discountProfit();
    getDebtRepository().writeOffDebt({
      client_id: c,
      amount_usd: 10,
      amount_lbp: 0,
      created_by: USER_ID,
    });
    const t = newest("COUNTERPARTY_DISCOUNT");
    expect(refund(t.id)).toMatchObject({ success: true });
    expectPostings(before, snapshotLedgers(db), {});
    expect(discountProfit()).toEqual(p0);
  });

  it("COUNTERPARTY_DISCOUNT (partner write-off): partner ledger and discount profit both return", () => {
    const pid = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name) VALUES (1, 'Partner 388 WO')`,
        )
        .run().lastInsertRowid,
    );
    // The partner owes the shop $40 (a paper debit).
    getPartnerService().recordPartnerTransaction({
      partnerId: pid,
      transactionType: "ADJUSTMENT",
      amount: 40,
      currency: "USD",
      direction: "DEBIT",
      userId: USER_ID,
    });
    const before = snapshotLedgers(db);
    const p0 = discountProfit();
    const wo = getPartnerService().writeOff({
      partnerId: pid,
      amount_usd: 5,
      amount_lbp: 0,
      userId: USER_ID,
    });
    expect(wo.success).toBe(true);
    const t = newest("COUNTERPARTY_DISCOUNT");
    expect(refund(t.id)).toMatchObject({ success: true });
    expectPostings(before, snapshotLedgers(db), {});
    expect(discountProfit()).toEqual(p0);
  });

  it("COUNTERPARTY_DISCOUNT given with a repayment is refused (refund the repayment)", () => {
    const c = newClient();
    getDebtRepository().addAccountCashEntry({
      direction: "debt",
      client_id: c,
      amount_usd: 20,
      amount_lbp: 0,
      created_by: USER_ID,
      move_cash: false,
    });
    getDebtRepository().writeOffDebt({
      client_id: c,
      amount_usd: 5,
      amount_lbp: 0,
      created_by: USER_ID,
    });
    const t = newest("COUNTERPARTY_DISCOUNT");
    db.prepare(
      `UPDATE transactions SET metadata_json = json_set(COALESCE(metadata_json, '{}'), ?, 999999) WHERE id = ?`,
    ).run(`$.${BUNDLED_REPAYMENT_TXN_KEY}`, t.id);
    const before = snapshotLedgers(db);
    const r = refund(t.id);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/#999999/);
    nothingMoved(before);
  });

  it("CARRIER_LINE_ADJUSTMENT with recorded values: line and drawer return; edited since → refused; old rows refused", () => {
    const lines = getCarrierLineRepository();
    const line = lines.createLine(
      { carrier: "alfa", phone_number: "03388388", credits: 10 },
      USER_ID,
    );
    const before = snapshotLedgers(db);
    lines.updateBalance(line.id, { credits: 25 }, USER_ID);
    const t = newest("CARRIER_LINE_ADJUSTMENT");
    expect(JSON.parse(t.metadata_json ?? "{}")).toMatchObject({
      credits_before: 10,
      credits_after: 25,
    });
    expect(refund(t.id)).toMatchObject({ success: true });
    expectPostings(before, snapshotLedgers(db), {});
    expect(lines.getById(line.id)!.credits).toBe(10);

    lines.updateBalance(line.id, { credits: 18 }, USER_ID);
    const t2 = newest("CARRIER_LINE_ADJUSTMENT");
    lines.updateBalance(line.id, { credits: 12 }, USER_ID); // sold down since
    const b2 = snapshotLedgers(db);
    const r = refund(t2.id);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/changed since/i);
    nothingMoved(b2);

    // A row written before values were recorded.
    db.prepare(
      `UPDATE transactions SET metadata_json = json_remove(metadata_json, '$.credits_before', '$.credits_after') WHERE id = ?`,
    ).run(t2.id);
    expect(refund(t2.id).success).toBe(false);
  });
});

// ─── US5 — the structural rows stay refused ─────────────────────────────────

describe("US5 — non-refundable rows are refused by the one entry point", () => {
  it.each([
    "CHECKPOINT",
    "LOTO_SETTLEMENT",
    "CLIENT_CREATED",
    "MTC_TOPUP",
  ] as const)("%s is refused, nothing written", (type) => {
    const id = getTransactionRepository().createTransaction({
      type,
      source_table: "lira388_rows",
      source_id: ++rowSeq,
      user_id: USER_ID,
      amount_usd: 5,
      amount_lbp: 0,
      summary: type,
      metadata_json: {},
    });
    const before = snapshotLedgers(db);
    expect(refund(id).success).toBe(false);
    nothingMoved(before);
    expect(refundRowOf(id)).toBeUndefined();
  });
});

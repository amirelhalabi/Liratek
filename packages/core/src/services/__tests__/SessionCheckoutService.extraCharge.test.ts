/**
 * LIRA-319 T049 — an extra at the session basket checkout.
 *
 * Owner decisions: one extra per basket, set at the session checkout, in the
 * basket's currency. The checkout sends `extra_usd/extra_lbp`; the server
 * books ONE `EXTRA_CHARGE` row (amount = extra, profit 0, extra_* = extra)
 * and links it to the session with a POSITIVE amount (like KEPT_CHANGE /
 * WAIVED_SHORTFALL), so the basket charge the payment is checked against
 * includes it.
 *
 * Reversal (rule 20): the whole-basket void/refund sweeps the row with the
 * basket; refunding ONE item gives back its share of the extra by its share
 * of the basket charge, and the shares add up to exactly the extra. Every
 * case nets to 0 across every ledger, per currency (postingAssert).
 *
 * Rule 17: written before the schema/service learned `extra_*`; the red run
 * is recorded under T049 in specs/319-extra-charges/tasks.md.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
} from "../../repositories/testHelpers/debtItemDb";
import {
  snapshotLedgers,
  expectPostings,
} from "../../repositories/testHelpers/postingAssert";
import {
  SessionCheckoutService,
  type CheckoutRequest,
} from "../SessionCheckoutService";
import {
  CustomerSessionRepository,
  resetCustomerSessionRepository,
} from "../../repositories/CustomerSessionRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../../repositories/TransactionRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import { resetFinancialServiceRepository } from "../../repositories/FinancialServiceRepository";
import { resetSupplierRepository } from "../../repositories/SupplierRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";
import { resetPaymentMethodRepository } from "../../repositories/PaymentMethodRepository";
import { resetSessionPaymentRepository } from "../../repositories/SessionPaymentRepository";
import { resetSalesRepository } from "../../repositories/SalesRepository";
import { resetProfitRepository } from "../../repositories/ProfitRepository";
import { resetCustomServiceRepository } from "../../repositories/CustomServiceRepository";
import { resetSessionPaymentService } from "../SessionPaymentService";
import { resetCustomServiceService } from "../CustomServiceService";
import { getProfitService, resetProfitService } from "../ProfitService";
import { sessionCheckoutSchema } from "../../validators/session";
import {
  DISCOUNT_AND_EXTRA_MESSAGE,
  EXTRA_ABOVE_TOTAL_MESSAGE,
} from "../../validators/common";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

const RATE = 89_000; // debtItemDb pins every rate to this
const FROM = "2000-01-01";
const TO = "2100-12-31";

let db: Database.Database;
let service: SessionCheckoutService;
let sessionRepo: CustomerSessionRepository;

function resetAll(): void {
  resetTransactionRepository();
  resetClientRepository();
  resetFinancialServiceRepository();
  resetSupplierRepository();
  resetSettingsRepository();
  resetPaymentMethodRepository();
  resetCustomerSessionRepository();
  resetSessionPaymentRepository();
  resetSessionPaymentService();
  resetSalesRepository();
  resetProfitRepository();
  resetProfitService();
  resetCustomServiceRepository();
  resetCustomServiceService();
}

beforeEach(() => {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  resetAll();
  service = new SessionCheckoutService();
  sessionRepo = new CustomerSessionRepository(db);
});
afterEach(() => {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

/** A custom service sold for `price` (cost $1) — a sold, item-refundable
 *  basket member. */
function serviceItem(id: string, price: number) {
  return {
    id,
    module: "custom_service",
    label: `Service ${id}`,
    amount: price,
    currency: "USD",
    formData: { description: `Service ${id}`, price_usd: price, cost_usd: 1 },
    ipcChannel: "custom-services:add",
  };
}

/** The new fields, typed loosely so the file runs against the unchanged
 *  `CheckoutRequest` (red for the right reason). */
type ExtraRequest = CheckoutRequest & {
  extra_usd?: number;
  extra_lbp?: number;
};

function newSession(name = "Jean Dupont"): number {
  return sessionRepo.createSession({
    customer_name: name,
    started_by: "admin",
    user_id: 1,
  });
}

/** Default basket: $6 + $4 services, extra $2, paid $12 cash. */
async function checkout(
  sessionId: number,
  o: Partial<ExtraRequest> = {},
): Promise<{ success: boolean; error?: string }> {
  const req: ExtraRequest = {
    sessionId,
    cartItems: [serviceItem("a", 6), serviceItem("b", 4)],
    exchangeRate: RATE,
    userId: 1,
    payments: [
      { method: "CASH", currency_code: "USD", amount: 12, direction: "IN" },
    ],
    extra_usd: 2,
    ...o,
  };
  return service.checkout(req, { username: "admin" });
}

type ExtraRow = {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  extra_usd: number;
  extra_lbp: number;
  client_name: string | null;
  status: string;
};

function extraRows(sessionId: number): ExtraRow[] {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, extra_usd, extra_lbp, client_name, status
         FROM transactions
        WHERE type = 'EXTRA_CHARGE' AND source_table = 'customer_sessions' AND source_id = ?
          AND reverses_id IS NULL`,
    )
    .all(sessionId) as ExtraRow[];
}

/** "Extra charges" as the Profits page reads it. */
function extraCharges(): { usd: number; lbp: number } {
  resetProfitRepository();
  resetProfitService();
  return getProfitService().getSummary(FROM, TO).extra_charges;
}

function grossProfit(): { usd: number; lbp: number } {
  resetProfitRepository();
  resetProfitService();
  const t = getProfitService().getSummary(FROM, TO).totals;
  return { usd: t.gross_profit_usd, lbp: t.gross_profit_lbp };
}

function memberIds(): number[] {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE type = 'CUSTOM_SERVICE' AND reverses_id IS NULL ORDER BY id ASC`,
      )
      .all() as { id: number }[]
  ).map((r) => r.id);
}

function refundRow(id: number) {
  return db
    .prepare(
      `SELECT amount_usd, amount_lbp, extra_usd, extra_lbp FROM transactions WHERE id = ?`,
    )
    .get(id) as {
    amount_usd: number;
    amount_lbp: number;
    extra_usd: number;
    extra_lbp: number;
  };
}

describe("session checkout — extra (LIRA-319 US4)", () => {
  it("books ONE EXTRA_CHARGE row (amount 2, profit 0, extra 2) linked with +2; the basket charge and drawer carry it", async () => {
    const before = snapshotLedgers(db);
    const extraBefore = extraCharges();
    const sessionId = newSession();
    const result = await checkout(sessionId);
    expect(result).toMatchObject({ success: true });

    const rows = extraRows(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amount_usd: 2,
      amount_lbp: 0,
      profit_usd: 0,
      profit_lbp: 0,
      extra_usd: 2,
      extra_lbp: 0,
      client_name: "Jean Dupont",
      status: "ACTIVE",
    });

    const link = db
      .prepare(
        `SELECT transaction_type, amount_usd, amount_lbp, profit_usd FROM customer_session_transactions
          WHERE session_id = ? AND unified_transaction_id = ?`,
      )
      .get(sessionId, rows[0].id) as {
      transaction_type: string;
      amount_usd: number;
      amount_lbp: number;
      profit_usd: number;
    };
    expect(link).toMatchObject({
      transaction_type: "extra_charge",
      amount_usd: 2,
      amount_lbp: 0,
      profit_usd: 0,
    });

    // The whole $12 (items 10 + extra 2) lands in the drawer — nothing else.
    expectPostings(before, snapshotLedgers(db), {
      drawers: { "General|USD": 12 },
    });
    expect(extraCharges().usd - extraBefore.usd).toBeCloseTo(2, 6);
  });

  it("keeping change is checked against items + extra (the extra is part of the charge)", async () => {
    // Paid $13 for a $12 charge → $1 kept change is the real gap.
    const sessionId = newSession();
    const result = await checkout(sessionId, {
      payments: [
        { method: "CASH", currency_code: "USD", amount: 13, direction: "IN" },
      ],
      kept_change_usd: 1,
    });
    expect(result).toMatchObject({ success: true });
  });

  it.each(["void", "refund"] as const)(
    "basket %s: every ledger, the Profits total and Extra charges net to 0 per currency",
    async (how) => {
      const before = snapshotLedgers(db);
      const profitBefore = grossProfit();
      const extraBefore = extraCharges();
      const sessionId = newSession();
      expect(await checkout(sessionId)).toMatchObject({ success: true });
      // Not vacuous: the extra really is in the books before the reversal.
      expect(extraCharges().usd - extraBefore.usd).toBeCloseTo(2, 6);

      const txnRepo = getTransactionRepository();
      if (how === "void") txnRepo.voidSessionBasket(sessionId, 1);
      else txnRepo.refundSessionBasket(sessionId, 1);

      expectPostings(before, snapshotLedgers(db), {});
      const profit = grossProfit();
      expect(profit.usd).toBeCloseTo(profitBefore.usd, 6);
      expect(profit.lbp).toBeCloseTo(profitBefore.lbp, 6);
      const extra = extraCharges();
      expect(extra.usd).toBeCloseTo(extraBefore.usd, 6);
      expect(extra.lbp).toBeCloseTo(extraBefore.lbp, 6);
    },
  );

  it("refunding one item gives back its share of the extra (6/10 of $2 = $1.20); the second item the rest; all nets to 0", async () => {
    const before = snapshotLedgers(db);
    const profitBefore = grossProfit();
    const extraBefore = extraCharges();
    const sessionId = newSession();
    expect(await checkout(sessionId)).toMatchObject({ success: true });
    const [a, b] = memberIds();
    const txnRepo = getTransactionRepository();

    const midBefore = snapshotLedgers(db);
    const r1 = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: a,
      userId: 1,
    });
    const row1 = refundRow(r1.refundTransactionId);
    expect(row1.extra_usd).toBeCloseTo(-1.2, 6);
    expect(row1.amount_usd).toBeCloseTo(-7.2, 6);
    // $6 item + $1.20 extra share handed back from the drawer.
    expectPostings(midBefore, snapshotLedgers(db), {
      drawers: { "General|USD": -7.2 },
    });
    expect(extraCharges().usd - extraBefore.usd).toBeCloseTo(0.8, 6);

    const r2 = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: b,
      userId: 1,
    });
    const row2 = refundRow(r2.refundTransactionId);
    expect(row2.extra_usd).toBeCloseTo(-0.8, 6);
    expect(row2.amount_usd).toBeCloseTo(-4.8, 6);

    expectPostings(before, snapshotLedgers(db), {});
    expect(extraCharges().usd).toBeCloseTo(extraBefore.usd, 6);
    expect(grossProfit().usd).toBeCloseTo(profitBefore.usd, 6);

    // Nothing left: a whole-basket refund now adds no further extra back
    // (refused as already fully refunded, or a no-op on the extra).
    try {
      txnRepo.refundSessionBasket(sessionId, 1);
    } catch {
      /* refused — fine */
    }
    expectPostings(before, snapshotLedgers(db), {});
    expect(extraCharges().usd).toBeCloseTo(extraBefore.usd, 6);
  });

  it("whole-basket refund after one item refund gives back only the REMAINING extra", async () => {
    const before = snapshotLedgers(db);
    const extraBefore = extraCharges();
    const sessionId = newSession();
    expect(await checkout(sessionId)).toMatchObject({ success: true });
    const [a] = memberIds();
    const txnRepo = getTransactionRepository();
    txnRepo.refundSessionBasketItem({ sessionId, transactionId: a, userId: 1 });
    txnRepo.refundSessionBasket(sessionId, 1);

    expectPostings(before, snapshotLedgers(db), {});
    expect(extraCharges().usd).toBeCloseTo(extraBefore.usd, 6);
  });

  it("three $1 items with a $1 extra: the shares add up to exactly $1 (rounding absorbed by the last)", async () => {
    const before = snapshotLedgers(db);
    const extraBefore = extraCharges();
    const sessionId = newSession();
    expect(
      await checkout(sessionId, {
        cartItems: [
          serviceItem("a", 1),
          serviceItem("b", 1),
          serviceItem("c", 1),
        ],
        payments: [
          { method: "CASH", currency_code: "USD", amount: 4, direction: "IN" },
        ],
        extra_usd: 1,
      }),
    ).toMatchObject({ success: true });
    const txnRepo = getTransactionRepository();
    const shares: number[] = [];
    for (const id of memberIds()) {
      const r = txnRepo.refundSessionBasketItem({
        sessionId,
        transactionId: id,
        userId: 1,
      });
      shares.push(refundRow(r.refundTransactionId).extra_usd);
    }
    expect(shares.reduce((s, x) => s + x, 0)).toBeCloseTo(-1, 9);
    for (const s of shares) expect(Math.abs(s)).toBeGreaterThan(0.3);
    expectPostings(before, snapshotLedgers(db), {});
    expect(extraCharges().usd).toBeCloseTo(extraBefore.usd, 9);
  });

  it("an extra in LBP on the basket: booked in LBP, refund nets 0 in both currencies", async () => {
    const before = snapshotLedgers(db);
    const extraBefore = extraCharges();
    const sessionId = newSession();
    expect(
      await checkout(sessionId, {
        payments: [
          { method: "CASH", currency_code: "USD", amount: 10, direction: "IN" },
          {
            method: "CASH",
            currency_code: "LBP",
            amount: 89_000,
            direction: "IN",
          },
        ],
        extra_usd: undefined,
        extra_lbp: 89_000,
      }),
    ).toMatchObject({ success: true });
    const rows = extraRows(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amount_usd: 0,
      amount_lbp: 89_000,
      extra_usd: 0,
      extra_lbp: 89_000,
    });
    expect(extraCharges().lbp - extraBefore.lbp).toBeCloseTo(89_000, 6);
    getTransactionRepository().refundSessionBasket(sessionId, 1);
    expectPostings(before, snapshotLedgers(db), {});
    expect(extraCharges().lbp).toBeCloseTo(extraBefore.lbp, 6);
  });

  it("refuses an extra above the basket itself and books nothing", async () => {
    const before = snapshotLedgers(db);
    const sessionId = newSession();
    const result = await checkout(sessionId, {
      payments: [
        { method: "CASH", currency_code: "USD", amount: 20.01, direction: "IN" },
      ],
      extra_usd: 10.01,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain(EXTRA_ABOVE_TOTAL_MESSAGE);
    expect(extraRows(sessionId)).toHaveLength(0);
    expect(memberIds()).toHaveLength(0);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("refuses an extra together with a waive (discount analogue) and books nothing", async () => {
    const before = snapshotLedgers(db);
    const sessionId = newSession();
    const result = await checkout(sessionId, {
      payments: [
        { method: "CASH", currency_code: "USD", amount: 11, direction: "IN" },
      ],
      waived_usd: 1,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain(DISCOUNT_AND_EXTRA_MESSAGE);
    expect(extraRows(sessionId)).toHaveLength(0);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("the schema declares extra_usd / extra_lbp: kept, and a negative extra refused (rule 23)", () => {
    expect(
      sessionCheckoutSchema.safeParse({
        sessionId: 1,
        cartItems: [serviceItem("a", 6)],
        userId: 1,
        extra_usd: -1,
      }).success,
    ).toBe(false);
    const parsed = sessionCheckoutSchema.safeParse({
      sessionId: 1,
      cartItems: [serviceItem("a", 6)],
      userId: 1,
      extra_usd: 2,
      extra_lbp: 0,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      extra_usd: 2,
      extra_lbp: 0,
    });
  });

  it("no regression: a basket with no extra books no EXTRA_CHARGE row", async () => {
    const sessionId = newSession();
    const result = await checkout(sessionId, {
      payments: [
        { method: "CASH", currency_code: "USD", amount: 10, direction: "IN" },
      ],
      extra_usd: undefined,
    });
    expect(result).toMatchObject({ success: true });
    expect(extraRows(sessionId)).toHaveLength(0);
  });
});

/**
 * Advisor follow-ups (not proven failing-first — written after the fix):
 * the SALE-member branch (its REFUND row is written inline, not through
 * `_createRefundRow`), the undo of a session item refund (re-charges the
 * share; `_sessionExtraState` counts the REFUND_UNDO row), and an
 * on-account basket (the extra rides in the 'Session Debt' and the
 * account-first step).
 */
describe("session checkout — extra, sale lines / undo / on account (LIRA-319)", () => {
  function addProducts(): void {
    db.prepare(
      `INSERT INTO products (id, tenant_id, name, item_type, cost_price_usd, stock_quantity)
       VALUES (901, 1, 'Case', 'Accessory', 1, 10), (902, 1, 'Cable', 'Accessory', 1, 10)`,
    ).run();
  }
  function saleItem() {
    return {
      id: "cart-sale",
      module: "pos",
      label: "Sale",
      amount: 10,
      currency: "USD",
      formData: {
        client_id: null,
        items: [
          { product_id: 901, quantity: 1, price: 6 },
          { product_id: 902, quantity: 1, price: 4 },
        ],
        total_amount: 10,
        discount: 0,
        final_amount: 10,
        payment_usd: 0,
        payment_lbp: 0,
        exchange_rate: RATE,
        status: "completed",
      },
      ipcChannel: "sales:process",
    };
  }

  function checkoutSale(sessionId: number) {
    return checkout(sessionId, { cartItems: [saleItem()] });
  }
  function saleMember(): { txnId: number; lineId: number } {
    const sale = db
      .prepare(
        `SELECT t.id AS txn_id, t.source_id AS sale_id FROM transactions t WHERE t.type = 'SALE' ORDER BY t.id DESC LIMIT 1`,
      )
      .get() as { txn_id: number; sale_id: number };
    const line = db
      .prepare(`SELECT id FROM sale_items WHERE sale_id = ? AND product_id = 901`)
      .get(sale.sale_id) as { id: number };
    return { txnId: sale.txn_id, lineId: line.id };
  }

  it("sale line refund stamps its share; the basket refund returns the rest and nets every ledger to 0", async () => {
    addProducts();
    const before = snapshotLedgers(db);
    const extraBefore = extraCharges();
    const sessionId = newSession();
    expect(await checkoutSale(sessionId)).toMatchObject({ success: true });
    const { txnId, lineId } = saleMember();
    const txnRepo = getTransactionRepository();
    const r = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: lineId,
      quantity: 1,
      userId: 1,
    });
    const row = refundRow(r.refundTransactionId);
    expect(row.extra_usd).toBeCloseTo(-1.2, 6);
    expect(row.amount_usd).toBeCloseTo(-7.2, 6);
    expect(extraCharges().usd - extraBefore.usd).toBeCloseTo(0.8, 6);

    txnRepo.refundSessionBasket(sessionId, 1);
    expectPostings(before, snapshotLedgers(db), {});
    expect(extraCharges().usd).toBeCloseTo(extraBefore.usd, 6);
  });

  it("undoing a sale line refund re-charges its share and puts every ledger back as it was before the refund", async () => {
    addProducts();
    const extraBefore = extraCharges();
    const sessionId = newSession();
    expect(await checkoutSale(sessionId)).toMatchObject({ success: true });
    const { txnId, lineId } = saleMember();
    const txnRepo = getTransactionRepository();
    const afterCheckout = snapshotLedgers(db);
    const r = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: lineId,
      quantity: 1,
      userId: 1,
    });
    txnRepo.undoSessionBasketItemRefund({
      refundTransactionId: r.refundTransactionId,
      userId: 1,
    });
    expectPostings(afterCheckout, snapshotLedgers(db), {});
    expect(extraCharges().usd - extraBefore.usd).toBeCloseTo(2, 6);
    // Refunding the same line again gives the same share back (the undo's
    // re-charge is counted by `_sessionExtraState`).
    const r2 = txnRepo.refundSessionBasketItem({
      sessionId,
      transactionId: txnId,
      saleItemId: lineId,
      quantity: 1,
      userId: 1,
    });
    expect(refundRow(r2.refundTransactionId).extra_usd).toBeCloseTo(-1.2, 6);
    // NOTE (pre-existing, not LIRA-319): undo + a later WHOLE-basket refund
    // leaves the General drawer short by the undone refund's money — the
    // pooled reversal still subtracts the undone refund's poolSplit. Proven
    // with NO extra on the basket (2026-10-14 probe: +$6 left in General),
    // so it is not asserted here; reported to the coordinator.
  });

  const onAccount = {
    payments: [
      {
        method: "CUSTOMER_ACCOUNT",
        currency_code: "USD",
        amount: 12,
        direction: "IN" as const,
      },
    ],
  };

  it("on account: the client owes items + extra; a basket void nets every ledger (debt included) to 0", async () => {
    addClient(db, 77, "Jean Dupont", "03123456");
    const before = snapshotLedgers(db);
    const sessionId = sessionRepo.createSession({
      customer_name: "Jean Dupont",
      customer_phone: "03123456",
      started_by: "admin",
      user_id: 1,
    });
    expect(await checkout(sessionId, onAccount)).toMatchObject({
      success: true,
    });
    expectPostings(before, snapshotLedgers(db), {
      debt: { "77|USD": 12 },
    });
    getTransactionRepository().voidSessionBasket(sessionId, 1);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("on account: an item refund then the basket refund net every ledger (debt included) to 0", async () => {
    addClient(db, 77, "Jean Dupont", "03123456");
    const before = snapshotLedgers(db);
    const extraBefore = extraCharges();
    const sessionId = sessionRepo.createSession({
      customer_name: "Jean Dupont",
      customer_phone: "03123456",
      started_by: "admin",
      user_id: 1,
    });
    expect(await checkout(sessionId, onAccount)).toMatchObject({
      success: true,
    });
    const [a] = memberIds();
    const txnRepo = getTransactionRepository();
    const mid = snapshotLedgers(db);
    txnRepo.refundSessionBasketItem({ sessionId, transactionId: a, userId: 1 });
    // Account first: the client's debt drops by the item + its share.
    expectPostings(mid, snapshotLedgers(db), { debt: { "77|USD": -7.2 } });
    txnRepo.refundSessionBasket(sessionId, 1);
    expectPostings(before, snapshotLedgers(db), {});
    expect(extraCharges().usd).toBeCloseTo(extraBefore.usd, 6);
  });
});

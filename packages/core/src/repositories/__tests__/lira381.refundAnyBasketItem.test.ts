/**
 * LIRA-381 — "Refund item" on a checked-out session basket works for EVERY
 * basket member, each through its own existing reversal owner (rule 20).
 *
 * Table-driven guard (SC-001): one row per member type. Each row checks out
 * a real basket through `SessionCheckoutService.checkout` (real module
 * writers: sales, custom services, recharges, loto tickets and prizes,
 * financial services, maintenance), refunds ONE member on its own, then
 * refunds the rest of the basket, and proves:
 *   1. the item refund moved the drawers by the expected amount, in the
 *      expected direction (`metadata_json.direction`);
 *   2. create + item refund + whole-basket refund nets EVERY ledger to 0 per
 *      currency (drawers, supplier, partner, customer debt), plus stock and
 *      the profit stamp (Σ over every transactions row);
 *   3. the module's own flags are reversed (loto ticket refunded, prize
 *      voided).
 *
 * Why these helpers and not the LIRA-232 file's: that file's hand-rolled
 * schema has no loto, supplier, lot or maintenance tables, so the real
 * reversal owners cannot run there. This file uses the real schema
 * (`testHelpers/debtItemDb`, create_db.sql) and the shared posting snapshot
 * helpers (`testHelpers/postingAssert`).
 *
 * One database for the whole file; every row has its own session and
 * asserts deltas only (rule 15 style), so rows never depend on each other.
 *
 * Rule 17: run on the unfixed code first — see specs/381-refund-any-basket-
 * item/tasks.md "Failing-first evidence" for the exact refusal per row.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  drawers,
  drawerDelta,
  RATE,
} from "../testHelpers/debtItemDb";
import {
  snapshotLedgers,
  expectPostings,
  snapshotStockAndProfit,
} from "../testHelpers/postingAssert";
import {
  SessionCheckoutService,
  type CheckoutCartItem,
} from "../../services/SessionCheckoutService";
import { CustomerSessionRepository } from "../CustomerSessionRepository";
import { getTransactionRepository } from "../TransactionRepository";
import { getExchangeService } from "../../services/ExchangeService";
import {
  getProfitService,
  resetProfitService,
} from "../../services/ProfitService";
import { resetProfitRepository } from "../ProfitRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

const USER_ID = 1;
/** Drawers that hold the shop's cash (General + the primary systems). */
const CASH_DRAWERS = new Set(["General", "OMT_System", "Whish_System"]);
const CLIENT_ID = 381;
const PARTNER_ID = 381;

let db: Database.Database;
let checkoutService: SessionCheckoutService;
let sessionRepo: CustomerSessionRepository;
let productSeq = 0;

beforeAll(() => {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  addClient(db, CLIENT_ID, "Basket Customer", "70381381");
  db.prepare(
    `INSERT INTO partners (id, tenant_id, name) VALUES (?, 1, 'Partner 381')`,
  ).run(PARTNER_ID);
  checkoutService = new SessionCheckoutService();
  sessionRepo = new CustomerSessionRepository(db);
});

afterAll(() => {
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

// ─── cart items (the shapes the frontend's session cart sends) ──────────────

function companionService(priceUsd = 20): CheckoutCartItem {
  return {
    id: "companion",
    module: "custom_service",
    label: "Screen glass",
    amount: priceUsd,
    currency: "USD",
    ipcChannel: "custom-services:add",
    formData: {
      description: "Screen glass",
      cost_usd: 5,
      price_usd: priceUsd,
      cost_lbp: 0,
      price_lbp: 0,
    },
  };
}

function saleItem(): CheckoutCartItem {
  productSeq += 1;
  const productId = Number(
    db
      .prepare(
        `INSERT INTO products (tenant_id, name, item_type, cost_price_usd, selling_price_usd, stock_quantity)
         VALUES (1, ?, 'Product', 6, 15, 10)`,
      )
      .run(`Charger ${productSeq}`).lastInsertRowid,
  );
  return {
    id: "sale",
    module: "pos",
    label: "Charger",
    amount: 15,
    currency: "USD",
    ipcChannel: "sales:process",
    formData: {
      client_id: null,
      items: [{ product_id: productId, quantity: 1, price: 15 }],
      total_amount: 15,
      discount: 0,
      final_amount: 15,
      payment_usd: 0,
      payment_lbp: 0,
      exchange_rate: RATE,
      status: "completed",
    },
  };
}

function customServiceItem(priceUsd: number): CheckoutCartItem {
  return {
    id: "service",
    module: "custom_service",
    label: "Software fix",
    amount: priceUsd,
    currency: "USD",
    ipcChannel: "custom-services:add",
    formData: {
      description: "Software fix",
      cost_usd: 3,
      price_usd: priceUsd,
      cost_lbp: 0,
      price_lbp: 0,
    },
  };
}

/** A Via-Partner "Pay out" custom service (money arrived through the
 *  partner; the shop hands the recipient the cost): the customer is PAID
 *  `costUsd`, the partner owes the shop `priceUsd`. */
function customServicePayoutItem(costUsd: number): CheckoutCartItem {
  return {
    id: "service-payout",
    module: "custom_service",
    label: "Pay out",
    amount: -costUsd,
    currency: "USD",
    ipcChannel: "custom-services:add",
    formData: {
      description: "Transfer pay out",
      partnerMode: "VIA",
      partnerId: PARTNER_ID,
      direction: "OUT",
      cost_usd: costUsd,
      price_usd: costUsd + 3,
      cost_lbp: 0,
      price_lbp: 0,
    },
  };
}

function rechargeItem(): CheckoutCartItem {
  return {
    id: "recharge",
    module: "recharge_mtc",
    label: "MTC credit",
    amount: 20,
    currency: "USD",
    ipcChannel: "recharge:process",
    formData: {
      provider: "MTC",
      type: "CREDIT_TRANSFER",
      amount: 20,
      cost: 15,
      price: 20,
      currency: "USD",
    },
  };
}

function lotoTicketItem(lbp = 300_000): CheckoutCartItem {
  return {
    id: "ticket",
    module: "loto_ticket",
    label: "Loto ticket",
    amount: lbp,
    currency: "LBP",
    ipcChannel: "loto:sell",
    formData: { sale_amount: lbp, commission_rate: 0.05, currency: "LBP" },
  };
}

function lotoPrizeItem(lbp = 500_000): CheckoutCartItem {
  return {
    id: "prize",
    module: "loto_prize",
    label: "Loto prize",
    amount: -lbp,
    currency: "LBP",
    ipcChannel: "loto:cash-prize:create",
    formData: { prize_amount: lbp, ticket_number: "T-381" },
  };
}

function omtSendItem(): CheckoutCartItem {
  return {
    id: "omt-send",
    module: "omt_system",
    label: "OMT Send",
    amount: 52,
    currency: "USD",
    ipcChannel: "financial:create",
    formData: {
      provider: "OMT",
      serviceType: "SEND",
      amount: 50,
      currency: "USD",
      commission: 1,
      omtFee: 2,
    },
  };
}

function omtReceiveItem(): CheckoutCartItem {
  return {
    id: "omt-receive",
    module: "omt_system",
    label: "OMT Receive",
    amount: -60,
    currency: "USD",
    ipcChannel: "financial:create",
    formData: {
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 60,
      currency: "USD",
      commission: 0,
    },
  };
}

function whishAppReceiveItem(): CheckoutCartItem {
  return {
    id: "whish-app-receive",
    module: "whish_app",
    label: "Whish App cash-out",
    amount: -40,
    currency: "USD",
    ipcChannel: "financial:create",
    formData: {
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 40,
      currency: "USD",
      commission: 0,
      cashoutMethod: "CASH",
    },
  };
}

/** A netted Binance cash-out: the customer sends 30 USDT to the shop's
 *  Binance wallet and takes $30 cash (shape of
 *  SessionCheckoutService.nettedPayoutSignal.test.ts). */
function binanceReceiveItem(): CheckoutCartItem {
  return {
    id: "binance-receive",
    module: "binance_receive",
    label: "Binance Receive",
    amount: -30,
    currency: "USDT",
    ipcChannel: "financial:create",
    formData: {
      provider: "BINANCE",
      serviceType: "RECEIVE",
      amount: 30,
      currency: "USDT",
      commission: 0,
      cashoutMethod: "CASH",
    },
  };
}

function maintenanceItem(): CheckoutCartItem {
  return {
    id: "repair",
    module: "maintenance",
    label: "Repair",
    amount: 30,
    currency: "USD",
    ipcChannel: "maintenance:save",
    formData: {
      device_name: "Galaxy A52",
      issue_description: "Screen",
      client_name: "Basket Customer",
      cost_usd: 10,
      price_usd: 30,
      final_amount_usd: 30,
      status: "Delivered_Paid",
    },
  };
}

// ─── checkout + helpers ──────────────────────────────────────────────────────

/** Pays the basket in cash: per currency, a positive net is an IN leg; a
 *  negative net is a PAYOUT leg (General, or the primary system's drawer for
 *  an OMT SYSTEM receive) — the shape the checkout modal sends. */
/** The basket's customer is "Basket Customer" — the checkout's own client
 *  resolution (`resolveSessionClientForCheckout`) links every item to the
 *  existing client of that name (CLIENT_ID), as in the shop. */
async function checkoutBasket(
  items: CheckoutCartItem[],
  payoutOrigin: "GENERAL" | "SYSTEM" = "GENERAL",
  explicitPayments?: Array<Record<string, unknown>>,
): Promise<number> {
  const sessionId = sessionRepo.createSession({
    customer_name: "Basket Customer",
    started_by: "admin",
    user_id: USER_ID,
  });
  const net: Record<string, number> = {};
  for (const it of items) {
    const cur = it.currency === "LBP" ? "LBP" : "USD";
    net[cur] = (net[cur] ?? 0) + it.amount;
  }
  const payments =
    explicitPayments ??
    Object.entries(net)
      .filter(([, v]) => Math.abs(v) > 0)
      .map(([cur, v]) =>
        v > 0
          ? { method: "CASH", currency_code: cur, amount: v, direction: "IN" }
          : {
              method: "CASH",
              currency_code: cur,
              amount: -v,
              direction: "OUT",
              kind: "PAYOUT",
              payoutOrigin,
            },
      );
  const result = await checkoutService.checkout(
    {
      sessionId,
      cartItems: items,
      exchangeRate: RATE,
      userId: USER_ID,
      payments,
    } as Parameters<SessionCheckoutService["checkout"]>[0],
    { username: "admin" },
  );
  if (!result.success) {
    throw new Error(`checkout failed: ${result.error}`);
  }
  return sessionId;
}

function memberTxnId(sessionId: number, type: string): number {
  const row = db
    .prepare(
      `SELECT t.id FROM customer_session_transactions cst
         JOIN transactions t ON t.id = cst.unified_transaction_id
        WHERE cst.session_id = ? AND t.type = ? AND cst.transaction_type <> 'session_item_refund'
        ORDER BY cst.id ASC LIMIT 1`,
    )
    .get(sessionId, type) as { id: number } | undefined;
  if (!row) throw new Error(`no ${type} member in session ${sessionId}`);
  return row.id;
}

function refundMeta(refundTxnId: number): Record<string, unknown> {
  const row = db
    .prepare(`SELECT metadata_json FROM transactions WHERE id = ?`)
    .get(refundTxnId) as { metadata_json: string | null };
  return row.metadata_json ? JSON.parse(row.metadata_json) : {};
}

interface Row {
  name: string;
  items: () => CheckoutCartItem[];
  memberType: string;
  /** Pick the member when the type alone is ambiguous (two custom services). */
  pick?: (sessionId: number) => number;
  direction: "to_customer" | "from_customer";
  /** Value of the item refund's cash-drawer movement (General + the
   *  primary-system drawers), in USD at RATE: negative = handed back to the
   *  customer, positive = the customer paid back. The currency mix of a
   *  hand-back follows the basket's own pool (LIRA-232 decision 9b-1). */
  cashValueUsd: number;
  /** Exact General-drawer movement, when the row pins it (story 1). */
  generalDelta?: Record<string, number>;
  payoutOrigin?: "GENERAL" | "SYSTEM";
  /** Extra module checks after the item refund. */
  afterItem?: (memberId: number) => void;
}

function customServiceByPrice(sessionId: number, price: number): number {
  const row = db
    .prepare(
      `SELECT t.id FROM customer_session_transactions cst
         JOIN transactions t ON t.id = cst.unified_transaction_id
        WHERE cst.session_id = ? AND t.type = 'CUSTOM_SERVICE' AND cst.amount_usd = ?`,
    )
    .get(sessionId, price) as { id: number };
  return row.id;
}

const ROWS: Row[] = [
  {
    name: "sale line",
    items: () => [saleItem(), companionService()],
    memberType: "SALE",
    direction: "to_customer",
    cashValueUsd: -15,
  },
  {
    name: "custom service",
    items: () => [customServiceItem(25), companionService()],
    memberType: "CUSTOM_SERVICE",
    pick: (sid) => customServiceByPrice(sid, 25),
    direction: "to_customer",
    cashValueUsd: -25,
  },
  {
    name: "recharge",
    items: () => [rechargeItem(), companionService()],
    memberType: "RECHARGE",
    direction: "to_customer",
    cashValueUsd: -20,
  },
  {
    name: "loto ticket",
    items: () => [lotoTicketItem(), companionService()],
    memberType: "LOTO",
    direction: "to_customer",
    cashValueUsd: -300_000 / RATE,
    afterItem: (memberId) => {
      const t = db
        .prepare(
          `SELECT lt.is_refunded FROM loto_tickets lt JOIN transactions t ON t.source_id = lt.id
            WHERE t.id = ?`,
        )
        .get(memberId) as { is_refunded: number };
      expect(t.is_refunded).toBe(1);
    },
  },
  {
    name: "loto cash prize (payout)",
    items: () => [lotoPrizeItem(), companionService()],
    memberType: "LOTO_CASH_PRIZE",
    direction: "from_customer",
    cashValueUsd: 500_000 / RATE,
    afterItem: (memberId) => {
      const p = db
        .prepare(
          `SELECT p.voided FROM loto_cash_prizes p JOIN transactions t ON t.source_id = p.id
            WHERE t.id = ?`,
        )
        .get(memberId) as { voided: number };
      expect(p.voided).toBe(1);
    },
  },
  {
    name: "story 1 basket: loto ticket refunded in LBP out of a basket netted by a prize",
    items: () => [saleItem(), lotoTicketItem(), lotoPrizeItem()],
    memberType: "LOTO",
    direction: "to_customer",
    cashValueUsd: -300_000 / RATE,
    // Owner's story 1: the ticket goes back as 300,000 LBP, not as USD
    // (the pool's mix is meaningless once a prize was netted against it).
    generalDelta: { "General|LBP": -300_000 },
  },
  {
    name: "story 3: sold item in a basket that had a prize",
    items: () => [saleItem(), lotoTicketItem(), lotoPrizeItem()],
    memberType: "SALE",
    direction: "to_customer",
    cashValueUsd: -15,
  },
  {
    name: "OMT send (amount + fee back)",
    items: () => [omtSendItem(), companionService()],
    memberType: "FINANCIAL_SERVICE",
    direction: "to_customer",
    cashValueUsd: -52,
  },
  {
    name: "OMT SYSTEM receive (payout, not netted)",
    items: () => [omtReceiveItem(), companionService(80)],
    memberType: "FINANCIAL_SERVICE",
    direction: "from_customer",
    payoutOrigin: "SYSTEM",
    cashValueUsd: 60,
  },
  {
    name: "Whish App cash-out (payout, netted)",
    items: () => [whishAppReceiveItem(), companionService(50)],
    memberType: "FINANCIAL_SERVICE",
    direction: "from_customer",
    cashValueUsd: 40,
  },
  {
    name: "Binance cash-out (payout, netted, USDT)",
    items: () => [binanceReceiveItem(), companionService(50)],
    memberType: "FINANCIAL_SERVICE",
    direction: "from_customer",
    cashValueUsd: 30,
  },
  {
    name: "maintenance job",
    items: () => [maintenanceItem(), companionService()],
    memberType: "MAINTENANCE",
    direction: "to_customer",
    cashValueUsd: -30,
  },
  {
    name: "custom service booked as a payout",
    items: () => [customServicePayoutItem(10), companionService(30)],
    memberType: "CUSTOM_SERVICE",
    pick: (sid) => customServiceByPrice(sid, -10),
    direction: "from_customer",
    cashValueUsd: 10,
  },
];

describe("LIRA-381 — refund any member of a session basket on its own", () => {
  it.each(ROWS.map((r) => [r.name, r] as const))(
    "%s: item refund moves the right way and the basket nets to 0",
    async (_name, row) => {
      const repo = getTransactionRepository();
      const items = row.items();
      const ledgersBefore = snapshotLedgers(db);
      const stockBefore = snapshotStockAndProfit(db);

      const sessionId = await checkoutBasket(items, row.payoutOrigin);
      const memberId = row.pick
        ? row.pick(sessionId)
        : memberTxnId(sessionId, row.memberType);

      const drawersBeforeItem = drawers(db);
      const result = repo.refundSessionBasketItem({
        sessionId,
        transactionId: memberId,
        userId: USER_ID,
      });
      const itemDelta = drawerDelta(drawersBeforeItem, drawers(db));
      let cashValue = 0;
      const generalOnly: Record<string, number> = {};
      for (const [k, v] of Object.entries(itemDelta)) {
        const [drawerName, currency] = k.split("|");
        if (!CASH_DRAWERS.has(drawerName)) continue;
        if (drawerName === "General") generalOnly[k] = v;
        cashValue += currency === "LBP" ? v / RATE : v;
      }
      expect(cashValue).toBeCloseTo(row.cashValueUsd, 1);
      if (row.generalDelta) expect(generalOnly).toEqual(row.generalDelta);
      expect(refundMeta(result.refundTransactionId)).toMatchObject({
        refundType: "sessionItem",
        refundDirection: row.direction,
      });
      row.afterItem?.(memberId);

      // The rest of the basket, then every ledger is back where it started.
      repo.refundSessionBasket(sessionId, USER_ID);
      expectPostings(ledgersBefore, snapshotLedgers(db), {});
      const stockAfter = snapshotStockAndProfit(db);
      expect(stockAfter.stock).toEqual(stockBefore.stock);
      expect(stockAfter.profit.usd).toBeCloseTo(stockBefore.profit.usd, 6);
      expect(stockAfter.profit.lbp).toBeCloseTo(stockBefore.profit.lbp, 6);
    },
  );

  it("story 2: a prize given back on the customer's account books a debt, no drawer moves", async () => {
    const repo = getTransactionRepository();
    const sessionId = await checkoutBasket([
      lotoPrizeItem(),
      companionService(),
    ]);
    const memberId = memberTxnId(sessionId, "LOTO_CASH_PRIZE");
    const before = snapshotLedgers(db);
    repo.refundSessionBasketItem({
      sessionId,
      transactionId: memberId,
      userId: USER_ID,
      refundLegs: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 500_000 },
      ],
    });
    const loto = db
      .prepare(
        `SELECT id FROM suppliers WHERE provider = 'LOTO' AND tenant_id = 1`,
      )
      .get() as { id: number };
    expectPostings(before, snapshotLedgers(db), {
      // the customer owes the prize back
      debt: { [`${CLIENT_ID}|LBP`]: 500_000 },
      // the prize's CASH_PRIZE row is soft-voided: Loto no longer owes it
      supplier: { [`${loto.id}|LBP`]: 500_000 },
    });
  });

  it("a basket-level sibling (kept change) is still refused on its own", async () => {
    const repo = getTransactionRepository();
    const sessionId = await checkoutBasket([companionService()]);
    const keptId = Number(
      db
        .prepare(
          `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd)
           VALUES (1, 'KEPT_CHANGE', 'ACTIVE', 'customer_sessions', ?, 1, 0, 0, 0.5)`,
        )
        .run(sessionId).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO customer_session_transactions (tenant_id, session_id, transaction_type, transaction_id, unified_transaction_id, amount_usd, amount_lbp)
       VALUES (1, ?, 'kept_change', ?, ?, 0, 0)`,
    ).run(sessionId, sessionId, keptId);
    expect(() =>
      repo.refundSessionBasketItem({
        sessionId,
        transactionId: keptId,
        userId: USER_ID,
      }),
    ).toThrow(/not an item/);
  });
});

describe("LIRA-381 — whole-basket interplay and refusals", () => {
  it("story 3.2: every member of a prize-netted basket refunded one by one closes the basket and nets every ledger to 0", async () => {
    const repo = getTransactionRepository();
    const items = [saleItem(), lotoTicketItem(), lotoPrizeItem()];
    const ledgersBefore = snapshotLedgers(db);
    const sessionId = await checkoutBasket(items);
    for (const type of ["LOTO_CASH_PRIZE", "LOTO", "SALE"]) {
      expect(repo.isSessionBasketFullyRefunded(sessionId)).toBe(false);
      repo.refundSessionBasketItem({
        sessionId,
        transactionId: memberTxnId(sessionId, type),
        userId: USER_ID,
      });
    }
    expect(repo.isSessionBasketFullyRefunded(sessionId)).toBe(true);
    expectPostings(ledgersBefore, snapshotLedgers(db), {});
    expect(() => repo.refundSessionBasket(sessionId, USER_ID)).toThrow(
      /already been refunded item by item/,
    );
  });

  it("a prize paid back on account, then the rest of the basket refunded: the account charge is cancelled and every ledger nets to 0", async () => {
    const repo = getTransactionRepository();
    const items = [lotoPrizeItem(), companionService()];
    const ledgersBefore = snapshotLedgers(db);
    const sessionId = await checkoutBasket(items);
    repo.refundSessionBasketItem({
      sessionId,
      transactionId: memberTxnId(sessionId, "LOTO_CASH_PRIZE"),
      userId: USER_ID,
      refundLegs: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 500_000 },
      ],
    });
    repo.refundSessionBasket(sessionId, USER_ID);
    expectPostings(ledgersBefore, snapshotLedgers(db), {});
  });

  it("a payout paid back through a wallet method lands in that wallet, not the cash drawer", async () => {
    const repo = getTransactionRepository();
    const sessionId = await checkoutBasket([
      whishAppReceiveItem(),
      companionService(50),
    ]);
    const before = drawers(db);
    const result = repo.refundSessionBasketItem({
      sessionId,
      transactionId: memberTxnId(sessionId, "FINANCIAL_SERVICE"),
      userId: USER_ID,
      refundLegs: [{ method: "WHISH", currencyCode: "USD", amount: 40 }],
    });
    // The customer sends the $40 back to the shop's Whish wallet (+40), and
    // the cash-out's own wallet line is reversed (−40): the wallet nets 0,
    // the cash drawer does not move.
    expect(drawerDelta(before, drawers(db))).toEqual({});
    const payback = db
      .prepare(
        `SELECT method, drawer_name, amount FROM payments WHERE transaction_id = ? AND amount > 0`,
      )
      .all(result.refundTransactionId);
    expect(payback).toEqual([
      { method: "WHISH", drawer_name: "Whish_App", amount: 40 },
    ]);
  });

  it("story 1.4: a ticket whose loto checkpoint is settled is refused, by the preview too", async () => {
    const repo = getTransactionRepository();
    const sessionId = await checkoutBasket([
      lotoTicketItem(),
      companionService(),
    ]);
    const memberId = memberTxnId(sessionId, "LOTO");
    const checkpointId = Number(
      db
        .prepare(
          `INSERT INTO loto_checkpoints (tenant_id, checkpoint_date, period_start, period_end, is_settled, settled_at)
           VALUES (1, '2026-11-01', '2026-10-25', '2026-11-01', 1, '2026-11-02')`,
        )
        .run().lastInsertRowid,
    );
    db.prepare(
      `UPDATE loto_tickets SET checkpoint_id = ? WHERE id = (SELECT source_id FROM transactions WHERE id = ?)`,
    ).run(checkpointId, memberId);
    expect(() =>
      repo.getSessionItemRefundPreview({ sessionId, transactionId: memberId }),
    ).toThrow(/already been settled on 2026-11-01/);
    expect(() =>
      repo.refundSessionBasketItem({
        sessionId,
        transactionId: memberId,
        userId: USER_ID,
      }),
    ).toThrow(/already been settled on 2026-11-01/);
  });

  it("the preview says which way the money moves", async () => {
    const repo = getTransactionRepository();
    const sessionId = await checkoutBasket([
      lotoPrizeItem(),
      lotoTicketItem(),
      companionService(),
    ]);
    const prize = repo.getSessionItemRefundPreview({
      sessionId,
      transactionId: memberTxnId(sessionId, "LOTO_CASH_PRIZE"),
    });
    expect(prize).toMatchObject({
      direction: "from_customer",
      paidOnItsOwn: false,
      accountReductionUsd: 0,
      accountReductionLbp: 0,
      remainderLbp: 500_000,
    });
    expect(prize.defaultLegs).toEqual([
      expect.objectContaining({
        direction: "in",
        signed_amount: 500_000,
        currency_code: "LBP",
        method: "CASH",
      }),
    ]);
    const ticket = repo.getSessionItemRefundPreview({
      sessionId,
      transactionId: memberTxnId(sessionId, "LOTO"),
    });
    expect(ticket.direction).toBe("to_customer");
  });
});

describe("LIRA-381 — an exchange linked to the session from its own page", () => {
  it("is refunded by mirroring its own lines (no method choice, no pool money) and nets to 0 with the rest of the basket", async () => {
    const repo = getTransactionRepository();
    const ledgersBefore = snapshotLedgers(db);
    const sessionId = await checkoutBasket([companionService()]);
    const ex = getExchangeService().addTransaction({
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 100,
      amountOut: 8_900_000,
      leg1Rate: 89_000,
      leg1MarketRate: 89_000,
      leg1ProfitUsd: 0,
      totalProfitUsd: 0,
      userId: USER_ID,
    } as Parameters<
      ReturnType<typeof getExchangeService>["addTransaction"]
    >[0]);
    expect(ex.success).toBe(true);
    const exTxn = db
      .prepare(
        `SELECT id, source_id FROM transactions WHERE type = 'EXCHANGE' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { id: number; source_id: number };
    sessionRepo.linkTransaction(
      sessionId,
      "exchange",
      exTxn.source_id,
      100,
      -8_900_000,
      0,
      0,
      exTxn.id,
    );

    const preview = repo.getSessionItemRefundPreview({
      sessionId,
      transactionId: exTxn.id,
    });
    expect(preview.paidOnItsOwn).toBe(true);
    expect(() =>
      repo.refundSessionBasketItem({
        sessionId,
        transactionId: exTxn.id,
        userId: USER_ID,
        refundLegs: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
      }),
    ).toThrow(/swapping the money back|exactly as it was paid/);

    const beforeItem = drawers(db);
    repo.refundSessionBasketItem({
      sessionId,
      transactionId: exTxn.id,
      userId: USER_ID,
    });
    // The exchange's own lines mirrored: $100 back to the customer, the
    // 8,900,000 LBP back into the drawer.
    expect(drawerDelta(beforeItem, drawers(db))).toEqual({
      "General|USD": -100,
      "General|LBP": 8_900_000,
    });
    repo.refundSessionBasket(sessionId, USER_ID);
    expectPostings(ledgersBefore, snapshotLedgers(db), {});
  });
});

describe("LIRA-381 — an exchange as a basket line (LIRA-380, paid from the basket's pool)", () => {
  it("is refunded by the exact mirror of both sides: the $100 back, the 8,950,000 LBP collected, and the basket nets to 0", async () => {
    const repo = getTransactionRepository();
    const exchangeLine: CheckoutCartItem = {
      id: "ex",
      module: "exchange",
      label: "Exchange",
      amount: 100,
      currency: "USD",
      ipcChannel: "exchange:add-transaction",
      formData: {
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 100,
        amountOut: 8_950_000,
        leg1Rate: 89_500,
        leg1MarketRate: 89_500,
        leg1ProfitUsd: 0,
        totalProfitUsd: 0,
      },
    };
    const items = [companionService(), exchangeLine];
    const ledgersBefore = snapshotLedgers(db);
    const sessionId = await checkoutBasket(items, "GENERAL", [
      { method: "CASH", currency_code: "USD", amount: 120, direction: "IN" },
      {
        method: "CASH",
        currency_code: "LBP",
        amount: 8_950_000,
        direction: "OUT",
        kind: "PAYOUT",
        payoutOrigin: "GENERAL",
      },
    ]);
    const memberId = memberTxnId(sessionId, "EXCHANGE");
    const preview = repo.getSessionItemRefundPreview({
      sessionId,
      transactionId: memberId,
    });
    expect(preview.paidOnItsOwn).toBe(true); // no method window
    const beforeItem = drawers(db);
    const result = repo.refundSessionBasketItem({
      sessionId,
      transactionId: memberId,
      userId: USER_ID,
    });
    expect(refundMeta(result.refundTransactionId)).toMatchObject({
      refundDirection: "to_customer",
    });
    expect(drawerDelta(beforeItem, drawers(db))).toEqual({
      "General|USD": -100,
      "General|LBP": 8_950_000,
    });
    repo.refundSessionBasket(sessionId, USER_ID);
    expectPostings(ledgersBefore, snapshotLedgers(db), {});
  });
});

describe("LIRA-381 — the Profits page drops the refunded member's margin, once", () => {
  /** Gross profit as the Profits page reads it (ProfitService.getSummary). */
  function grossProfit(): { usd: number; lbp: number } {
    resetProfitRepository();
    resetProfitService();
    const t = getProfitService().getSummary("2000-01-01", "2100-12-31").totals;
    return { usd: t.gross_profit_usd, lbp: t.gross_profit_lbp };
  }

  it.each([
    [
      "loto ticket",
      () => [lotoTicketItem(), companionService()],
      "LOTO",
      15,
      true,
    ],
    [
      "OMT send",
      () => [omtSendItem(), companionService()],
      "FINANCIAL_SERVICE",
      15,
      // An OMT SYSTEM send's commission is not on the Profits page until
      // OMT settles it, so nothing to drop — and nothing may go negative.
      false,
    ],
    [
      "maintenance job",
      () => [maintenanceItem(), companionService()],
      "MAINTENANCE",
      15,
      true,
    ],
    [
      "OMT SYSTEM receive",
      () => [omtReceiveItem(), companionService(80)],
      "FINANCIAL_SERVICE",
      75,
      false,
    ],
    [
      "Binance cash-out",
      () => [binanceReceiveItem(), companionService(50)],
      "FINANCIAL_SERVICE",
      45,
      false,
    ],
  ] as const)(
    "%s: after the item refund only the companion's margin is left; after the whole basket, nothing",
    async (_name, build, memberType, companionMarginUsd, memberHasMargin) => {
      const repo = getTransactionRepository();
      const items = build();
      const p0 = grossProfit();
      const sessionId = await checkoutBasket(
        [...items],
        memberType === "FINANCIAL_SERVICE" && _name === "OMT SYSTEM receive"
          ? "SYSTEM"
          : "GENERAL",
      );
      const p1 = grossProfit();
      repo.refundSessionBasketItem({
        sessionId,
        transactionId: memberTxnId(sessionId, memberType),
        userId: USER_ID,
      });
      const p2 = grossProfit();
      // Non-vacuous: the member's own margin was counted, then dropped.
      const dropUsdEq = p1.usd - p2.usd + (p1.lbp - p2.lbp) / RATE;
      if (memberHasMargin) expect(dropUsdEq).toBeGreaterThan(0.01);
      else expect(dropUsdEq).toBeCloseTo(0, 2);
      expect(p2.usd - p0.usd).toBeCloseTo(companionMarginUsd, 2);
      expect(p2.lbp - p0.lbp).toBeCloseTo(0, 0);
      repo.refundSessionBasket(sessionId, USER_ID);
      const p3 = grossProfit();
      expect(p3.usd).toBeCloseTo(p0.usd, 2);
      expect(p3.lbp).toBeCloseTo(p0.lbp, 0);
    },
  );
});

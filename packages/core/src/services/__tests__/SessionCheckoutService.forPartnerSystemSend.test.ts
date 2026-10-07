/**
 * A For-Partner (FOR) OMT/Whish SYSTEM transfer inside a customer-session
 * basket must not be charged to the walk-in customer.
 *
 * Owner rule (POSTING_MAP §4.1, FEATURE_GUIDE §8.1.0, LIRA-258 D1): a
 * FOR-partner OMT/WHISH SEND books obligations only — the shop owes the
 * provider x + f, the partner owes the shop the same x + f, and NO drawer
 * moves. A FOR-partner RECEIVE likewise moves no drawer; the shop owes the
 * partner. The walk-in customer of the session neither pays nor is paid for
 * such an item.
 *
 * The Services page adds a FOR transfer to the basket with the CUSTOMER
 * total as its cart `amount` (SEND: +(x + f), RECEIVE: −x). Before the fix,
 * checkout stamped that amount on the session link row, so the server
 * counted it as a basket charge/payout (pro-rata cash split, Session Debt,
 * session totals) on top of the partner + supplier obligations the item
 * itself books — the same transfer charged twice.
 *
 * The FOR item's formData below is a literal copy of the Services page
 * `apiPayload` for a session SEND (OMT, INTRA, $100, fee $5).
 *
 * Real production schema (create_db.sql + migrations); nothing in the money
 * path is mocked.
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
  SessionCheckoutService,
  type CheckoutCartItem,
} from "../SessionCheckoutService";
import { resetSessionPaymentService } from "../SessionPaymentService";
import { resetDebtService } from "../DebtService";
import { resetFinancialService } from "../FinancialService";
import { resetCustomServiceService } from "../CustomServiceService";
import { resetDebtRepository } from "../../repositories/DebtRepository";
import { resetCustomerSessionRepository } from "../../repositories/CustomerSessionRepository";
import { resetSessionPaymentRepository } from "../../repositories/SessionPaymentRepository";
import { resetClientRepository } from "../../repositories/ClientRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../../repositories/TransactionRepository";
import { resetPartnerRepository } from "../../repositories/PartnerRepository";
import { resetCustomServiceRepository } from "../../repositories/CustomServiceRepository";
import { resetSettingsRepository } from "../../repositories/SettingsRepository";
import { resetFinancialServiceRepository } from "../../repositories/FinancialServiceRepository";
import { resetSupplierRepository } from "../../repositories/SupplierRepository";
import {
  snapshotLedgers,
  ledgerDeltas,
} from "../../repositories/testHelpers/postingAssert";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");

function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

function resetAll(): void {
  resetSessionPaymentService();
  resetDebtService();
  resetFinancialService();
  resetCustomServiceService();
  resetDebtRepository();
  resetCustomerSessionRepository();
  resetSessionPaymentRepository();
  resetClientRepository();
  resetTransactionRepository();
  resetPartnerRepository();
  resetCustomServiceRepository();
  resetSettingsRepository();
  resetFinancialServiceRepository();
  resetSupplierRepository();
}

describe("FOR-partner OMT/Whish system transfer in a session basket", () => {
  let db: Database.Database;
  let partnerId: number;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    partnerId = Number(
      db
        .prepare(
          `INSERT INTO partners (tenant_id, name) VALUES (1, 'Partner A')`,
        )
        .run().lastInsertRowid,
    );
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__;
    resetTenantContext();
    resetAll();
    db.close();
  });

  function newSession(): number {
    return Number(
      db
        .prepare(
          `INSERT INTO customer_sessions (tenant_id, customer_name, started_by) VALUES (1, 'Walk-in', 'admin')`,
        )
        .run().lastInsertRowid,
    );
  }

  /** $20 walk-in service the customer pays for. */
  const walkInItem = (): CheckoutCartItem => ({
    id: "walk-in",
    module: "custom_service",
    label: "Screen protector",
    amount: 20,
    currency: "USD",
    ipcChannel: "custom-services:add",
    formData: {
      description: "Screen protector",
      price_usd: 20,
      cost_usd: 5,
    },
  });

  /** Exactly what Services/index.tsx puts in the cart for a FOR-partner
   *  OMT INTRA SEND of $100 with a $5 fee inside a session: cart amount =
   *  customerTotal = sentAmount + fee = 105; formData = apiPayload. */
  const forSendItem = (): CheckoutCartItem => ({
    id: "for-send",
    module: "omt_system",
    label: "OMT SEND - Walk-in - $100.00 + $5.00 fees",
    amount: 105,
    currency: "USD",
    ipcChannel: "financial:create",
    formData: {
      provider: "OMT",
      serviceType: "SEND",
      amount: 100,
      currency: "USD",
      tender_exchange_rate: 89500,
      clientName: "Walk-in",
      phoneNumber: "",
      senderName: "Walk-in",
      senderPhone: "",
      receiverName: "Partner customer",
      receiverPhone: "03999888",
      omtServiceType: "INTRA",
      omtFee: 5,
      includingFees: false,
      payments: [],
      paymentMethodFee: 0,
      note: "OMT - SEND",
      partnerId,
      partnerMode: "FOR",
    },
  });

  /** FOR-partner OMT RECEIVE of $100 as the Services page carts it:
   *  amount = −customerTotal = −100. */
  const forReceiveItem = (): CheckoutCartItem => ({
    id: "for-receive",
    module: "omt_system",
    label: "OMT RECEIVE - Walk-in - $100.00",
    amount: -100,
    currency: "USD",
    ipcChannel: "financial:create",
    formData: {
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      currency: "USD",
      clientName: "Walk-in",
      phoneNumber: "",
      senderName: "Abroad",
      senderPhone: "",
      receiverName: "Walk-in",
      receiverPhone: "",
      omtServiceType: "INTRA",
      omtFee: 0,
      includingFees: false,
      payments: [],
      paymentMethodFee: 0,
      note: "OMT - RECEIVE",
      partnerId,
      partnerMode: "FOR",
      cashoutMethod: "CASH",
    },
  });

  function checkout(
    sessionId: number,
    cartItems: CheckoutCartItem[],
    paidUsd: number,
  ) {
    return new SessionCheckoutService().checkout(
      {
        sessionId,
        cartItems,
        payments:
          paidUsd > 0
            ? [
                {
                  method: "CASH",
                  currency_code: "USD",
                  amount: paidUsd,
                  direction: "IN",
                },
              ]
            : [],
        exchangeRate: 89500,
        userId: 1,
      },
      { username: "admin" },
    );
  }

  function omtSupplierId(): number {
    return (
      db
        .prepare(
          `SELECT id FROM suppliers WHERE name = 'OMT' AND tenant_id = 1`,
        )
        .get() as { id: number }
    ).id;
  }

  function sessionLinkAmounts(sessionId: number) {
    return db
      .prepare(
        `SELECT transaction_type, amount_usd, amount_lbp
           FROM customer_session_transactions
          WHERE session_id = ? ORDER BY id`,
      )
      .all(sessionId) as Array<{
      transaction_type: string;
      amount_usd: number;
      amount_lbp: number;
    }>;
  }

  it("SEND: customer pays only the walk-in item; partner owes x+f, OMT is owed x+f, the drawer moves only by the walk-in $20", async () => {
    const sessionId = newSession();
    const before = snapshotLedgers(db);

    const result = await checkout(sessionId, [walkInItem(), forSendItem()], 20);
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);

    const d = ledgerDeltas(before, snapshotLedgers(db));
    // Obligations only for the FOR item.
    expect(d.partner).toEqual({ [`${partnerId}|USD`]: 105 });
    expect(d.supplier).toEqual({ [`${omtSupplierId()}|USD`]: 105 });
    // No customer debt for a transfer the customer never owed.
    expect(d.debt).toEqual({});
    // The walk-in's $20 lands in General; no share of it is routed to the
    // OMT system box on the strength of the FOR item.
    expect(d.drawers).toEqual({ "General|USD": 20 });

    // The session link row carries the CUSTOMER amount: 0 for the FOR item.
    const links = sessionLinkAmounts(sessionId);
    const forLink = links.find((l) => l.transaction_type === "omt_system");
    expect(forLink?.amount_usd).toBe(0);
    expect(forLink?.amount_lbp).toBe(0);
    // Checkout total = what the customer was charged.
    expect(result.checkoutTotalUsd).toBe(20);
  });

  it("RECEIVE: the walk-in customer is not paid the partner's transfer", async () => {
    const sessionId = newSession();
    const before = snapshotLedgers(db);
    const result = await checkout(
      sessionId,
      [walkInItem(), forReceiveItem()],
      20,
    );
    expect(result.error).toBeUndefined();
    const links = sessionLinkAmounts(sessionId);
    const forLink = links.find((l) => l.transaction_type === "omt_system");
    expect(forLink?.amount_usd).toBe(0);
    expect(result.checkoutTotalUsd).toBe(20);

    const d = ledgerDeltas(before, snapshotLedgers(db));
    // The FOR RECEIVE's own postings (unchanged by this fix): the shop owes
    // the partner the $100 and owes OMT $100 less.
    expect(d.partner).toEqual({ [`${partnerId}|USD`]: -100 });
    expect(d.supplier).toEqual({ [`${omtSupplierId()}|USD`]: -100 });
    expect(d.debt).toEqual({});
    // Only the walk-in's $20 reaches the till; no basket payout leg pays the
    // walk-in the partner's $100, and the FOR RECEIVE moves no drawer
    // (FEATURE_GUIDE §8.1.0).
    expect(d.drawers).toEqual({ "General|USD": 20 });
  });

  it("a basket holding ONLY a FOR-partner SEND checks out with no payment: obligations booked, no drawer moves", async () => {
    const sessionId = newSession();
    const before = snapshotLedgers(db);
    const result = await checkout(sessionId, [forSendItem()], 0);
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.checkoutTotalUsd).toBe(0);
    const d = ledgerDeltas(before, snapshotLedgers(db));
    expect(d).toEqual({
      drawers: {},
      supplier: { [`${omtSupplierId()}|USD`]: 105 },
      partner: { [`${partnerId}|USD`]: 105 },
      debt: {},
    });
  });

  it("refunding the basket nets every ledger to 0 per currency", async () => {
    const sessionId = newSession();
    const before = snapshotLedgers(db);
    const result = await checkout(sessionId, [walkInItem(), forSendItem()], 20);
    expect(result.error).toBeUndefined();

    getTransactionRepository().refundSessionBasket(sessionId, 1);

    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
  });

  it("voiding a basket with a FOR-partner RECEIVE nets every ledger to 0 per currency", async () => {
    const sessionId = newSession();
    const before = snapshotLedgers(db);
    const result = await checkout(
      sessionId,
      [walkInItem(), forReceiveItem()],
      20,
    );
    expect(result.error).toBeUndefined();

    getTransactionRepository().voidSessionBasket(sessionId, 1);

    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
  });

  it("voiding the basket nets every ledger to 0 per currency", async () => {
    const sessionId = newSession();
    const before = snapshotLedgers(db);
    const result = await checkout(sessionId, [walkInItem(), forSendItem()], 20);
    expect(result.error).toBeUndefined();

    getTransactionRepository().voidSessionBasket(sessionId, 1);

    expect(ledgerDeltas(before, snapshotLedgers(db))).toEqual({
      drawers: {},
      supplier: {},
      partner: {},
      debt: {},
    });
  });
});

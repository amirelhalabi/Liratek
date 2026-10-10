/**
 * LIRA-304 T003 — invariant I1 (specs/304-debt-item-picking/data-model.md):
 * a basket checked out on Customer Account stays ONE 'Session Debt' row, and
 * each non-sale member carries its own share (`owed_*`) and coverage
 * (`covered_*`). Per currency, the members' open amounts must always add up
 * to the row's outstanding amount (the shared `coverageOutstandingSql`
 * definition every repayment / profit query already reads).
 *
 * The member split follows owner decision 2026-10-10 ("OMT first"): cash
 * paid at checkout covers primary-system transfers first, so the debt lands
 * on sales first (pre-covered, as today), then the other non-sale items,
 * then the primary-system transfers.
 *
 * Failing-first (rule 17): written before migration v209; on the unfixed
 * code it fails because `customer_session_transactions.owed_usd` does not
 * exist.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  seedBasketMembers,
  sessionDebtRow,
  RATE,
} from "../testHelpers/debtItemDb";
import { coverageOutstandingSql } from "../sessionDebtCoverage";
import {
  getSessionPaymentService,
  resetSessionPaymentService,
} from "../../services/SessionPaymentService";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository";
import { resetCustomerSessionRepository } from "../CustomerSessionRepository";
import { resetSalesRepository } from "../SalesRepository";
import { resetClientRepository } from "../ClientRepository";
import { initFixedTenantContext, resetTenantContext } from "../../db/tenantContext";

let db: Database.Database;

function resetAll(): void {
  resetSessionPaymentService();
  resetSessionPaymentRepository();
  resetCustomerSessionRepository();
  resetSalesRepository();
  resetClientRepository();
}

beforeEach(() => {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  resetAll();
  addClient(db, 7, "Claude Demo", "03101010");
});

afterEach(() => {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

function memberRows(sessionId: number) {
  return db
    .prepare(
      `SELECT cst.id, t.type, cst.owed_usd, cst.owed_lbp, cst.covered_usd, cst.covered_lbp
       FROM customer_session_transactions cst
       JOIN transactions t ON t.id = cst.unified_transaction_id
       WHERE cst.session_id = ? ORDER BY cst.id`,
    )
    .all(sessionId) as Array<{
    id: number;
    type: string;
    owed_usd: number;
    owed_lbp: number;
    covered_usd: number;
    covered_lbp: number;
  }>;
}

function rowOutstanding(sessionId: number): { usd: number; lbp: number } {
  return db
    .prepare(
      `SELECT ${coverageOutstandingSql("dl", "usd")} AS usd,
              ${coverageOutstandingSql("dl", "lbp")} AS lbp
       FROM debt_ledger dl
       WHERE dl.session_id = ? AND dl.transaction_type = 'Session Debt' AND dl.transaction_id IS NULL`,
    )
    .get(sessionId) as { usd: number; lbp: number };
}

function expectI1(sessionId: number): void {
  const members = memberRows(sessionId).filter((m) => m.type !== "SALE");
  const openUsd = members.reduce((s, m) => s + m.owed_usd - m.covered_usd, 0);
  const openLbp = members.reduce((s, m) => s + m.owed_lbp - m.covered_lbp, 0);
  const row = rowOutstanding(sessionId);
  expect(openUsd).toBeCloseTo(row.usd, 2);
  expect(openLbp).toBeCloseTo(row.lbp, 0);
}

describe("LIRA-304 I1 — basket members carry the row's outstanding", () => {
  it("whole basket on account: OMT $101 + cable $14 + Loto 200,000 LBP", () => {
    const basket = seedBasketMembers(db, 7, [
      { kind: "transfer", provider: "OMT", usd: 101 },
      { kind: "sale", usd: 14 },
      { kind: "loto", lbp: 200_000 },
    ]);
    getSessionPaymentService().recordBasketPayment(basket.sessionId, {
      legs: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 115 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 200_000 },
      ],
      exchangeRate: RATE,
      userId: 1,
      clientId: 7,
    });

    const row = sessionDebtRow(db, basket.sessionId);
    expect(row.amount_usd).toBe(115);
    expect(row.amount_lbp).toBe(200_000);

    const [omt, cable, loto] = memberRows(basket.sessionId);
    expect(omt.owed_usd).toBeCloseTo(101, 2);
    expect(omt.owed_lbp).toBe(0);
    expect(loto.owed_lbp).toBe(200_000);
    expect(loto.owed_usd).toBe(0);
    // The sale is tracked on `sales.paid_usd`, never on its member row.
    expect(cable.owed_usd).toBe(0);
    expectI1(basket.sessionId);
  });

  it("partly paid at checkout: $50 cash covers the OMT first (owner decision)", () => {
    const basket = seedBasketMembers(db, 7, [
      { kind: "transfer", provider: "OMT", usd: 101 },
      { kind: "sale", usd: 14 },
    ]);
    getSessionPaymentService().recordBasketPayment(basket.sessionId, {
      legs: [
        { method: "CASH", currencyCode: "USD", amount: 50 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 65 },
      ],
      exchangeRate: RATE,
      userId: 1,
      clientId: 7,
    });

    const [omt] = memberRows(basket.sessionId);
    // Debt goes to the sale first ($14, pre-covered), the remaining $51 is
    // what the OMT send still owes.
    expect(omt.owed_usd).toBeCloseTo(51, 2);
    expectI1(basket.sessionId);
  });

  it("non-primary items are owed before primary-system transfers", () => {
    const basket = seedBasketMembers(db, 7, [
      { kind: "transfer", provider: "OMT", usd: 100 },
      { kind: "transfer", provider: "WHISH_APP", usd: 30 },
    ]);
    getSessionPaymentService().recordBasketPayment(basket.sessionId, {
      legs: [
        { method: "CASH", currencyCode: "USD", amount: 90 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 40 },
      ],
      exchangeRate: RATE,
      userId: 1,
      clientId: 7,
    });
    const [omt, wallet] = memberRows(basket.sessionId);
    // Cash $90 covered the OMT send first ($90 of $100), then nothing left;
    // so the $40 owed is: Whish App $30, OMT $10.
    expect(wallet.owed_usd).toBeCloseTo(30, 2);
    expect(omt.owed_usd).toBeCloseTo(10, 2);
    expectI1(basket.sessionId);
  });
});

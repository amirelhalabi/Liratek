/**
 * LIRA-308 (owner decisions 2026-10-11) — the posting side of "ticks and
 * amount stay in step": `addRepayment` pays what the repayment modal
 * previews, through the same allocation.
 *
 *  - decision 4: inside the ticked items the cash-drawer transfer is paid
 *    (and its cash routed) before an older non-drawer item;
 *  - decision 5: `auto` targets (ticked by the amount, not the cashier) are
 *    paid only after the cashier's ticks;
 *  - decision 8: a bundled discount covers the ticked items, in the same
 *    order, instead of "sales first";
 *  - decision 6: an amount above the whole debt goes to the customer's
 *    account through the EXISTING change-to-account path (a
 *    CUSTOMER_ACCOUNT change leg → CREDIT_DEPOSIT linked to the repayment),
 *    and the repayment's refund takes the credit back — per currency, the
 *    ledger nets to zero.
 *
 * Failing-first (rule 17): the decision 4/5/8 cases were run against the
 * pre-LIRA-308 code and failed (recorded in current_sprint.md, LIRA-308).
 * The decision 6 case is a characterization of the existing path the
 * modal now uses; it passed before any code change (not a regression
 * guard, and it says so).
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  seedTransferDebt,
  seedSaleDebt,
  seedChargeDebt,
  drawers,
  drawerDelta,
  RATE,
} from "../testHelpers/debtItemDb";
import { DebtRepository, type CreateRepaymentData } from "../DebtRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import { resetSessionPaymentService } from "../../services/SessionPaymentService";
import { resetSessionPaymentRepository } from "../SessionPaymentRepository";
import { resetCustomerSessionRepository } from "../CustomerSessionRepository";
import { resetSalesRepository } from "../SalesRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

let db: Database.Database;
let repo: DebtRepository;

function resetAll(): void {
  resetSessionPaymentService();
  resetSessionPaymentRepository();
  resetCustomerSessionRepository();
  resetSalesRepository();
  resetClientRepository();
  resetSettingsRepository();
  resetPaymentMethodRepository();
  resetTransactionRepository();
}

beforeEach(() => {
  db = installDebtItemTestDb();
  initFixedTenantContext(1);
  resetAll();
  repo = new DebtRepository();
  addClient(db, 7, "Claude Demo", "03101010");
});

afterEach(() => {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

type Target = {
  kind: "sale" | "charge" | "member";
  id: number;
  auto?: boolean;
};

function repay(o: {
  usd?: number;
  lbp?: number;
  legs: Array<{
    method: string;
    currencyCode: "USD" | "LBP";
    amount: number;
    direction?: "IN" | "OUT";
  }>;
  targets?: Target[];
  discount?: { amount_usd: number; amount_lbp: number };
}): number {
  const data = {
    client_id: 7,
    amount_usd: o.usd ?? 0,
    amount_lbp: o.lbp ?? 0,
    created_by: 1,
    payments: o.legs,
    tender_exchange_rate: RATE,
    ...(o.targets ? { targets: o.targets } : {}),
    ...(o.discount ? { discount: o.discount } : {}),
  } as unknown as CreateRepaymentData;
  return repo.addRepayment(data).id;
}

const cashUsd = (amount: number) => [
  { method: "CASH", currencyCode: "USD" as const, amount },
];

const coveredUsd = (debtRowId: number): number =>
  (
    db
      .prepare(`SELECT covered_usd FROM debt_ledger WHERE id = ?`)
      .get(debtRowId) as { covered_usd: number }
  ).covered_usd;

const salePaid = (saleId: number): number =>
  (
    db.prepare(`SELECT paid_usd FROM sales WHERE id = ?`).get(saleId) as {
      paid_usd: number;
    }
  ).paid_usd;

const balance = (): { usd: number; lbp: number } =>
  db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM debt_ledger WHERE client_id = 7`,
    )
    .get() as { usd: number; lbp: number };

describe("decision 4 — ticked: cash-drawer transfer first, then oldest", () => {
  it("older Loto charge + newer OMT send ticked, $50 cash → the OMT send takes it all, routed to OMT_System", () => {
    const loto = seedChargeDebt(db, {
      clientId: 7,
      debtType: "Loto Debt",
      txnType: "LOTO",
      usd: 20,
    });
    const omt = seedTransferDebt(db, {
      clientId: 7,
      provider: "OMT",
      usd: 101,
    });
    const before = drawers(db);
    repay({
      usd: 50,
      legs: cashUsd(50),
      targets: [
        { kind: "charge", id: loto.debtRowId },
        { kind: "charge", id: omt.debtRowId },
      ],
    });
    expect(coveredUsd(omt.debtRowId)).toBeCloseTo(50, 2);
    expect(coveredUsd(loto.debtRowId)).toBe(0);
    expect(drawerDelta(before, drawers(db))).toEqual({ "OMT_System|USD": 50 });
  });
});

describe("decision 5 — auto targets never short a cashier tick", () => {
  it("cashier ticks the newer $10 charge, $15: the auto-ticked older $20 charge gets only $5", () => {
    const older = seedChargeDebt(db, {
      clientId: 7,
      debtType: "Loto Debt",
      txnType: "LOTO",
      usd: 20,
    });
    const newer = seedChargeDebt(db, {
      clientId: 7,
      debtType: "Recharge Debt",
      txnType: "RECHARGE",
      usd: 10,
    });
    repay({
      usd: 15,
      legs: cashUsd(15),
      targets: [
        { kind: "charge", id: newer.debtRowId },
        { kind: "charge", id: older.debtRowId, auto: true },
      ],
    });
    expect(coveredUsd(newer.debtRowId)).toBeCloseTo(10, 2);
    expect(coveredUsd(older.debtRowId)).toBeCloseTo(5, 2);
  });
});

describe("decision 8 — a bundled discount covers the ticked items", () => {
  it("$10 cash + $10 discount, Loto charge ticked: the charge is cleared, the older unticked sale is untouched", () => {
    const sale = seedSaleDebt(db, { clientId: 7, usd: 14 });
    const loto = seedChargeDebt(db, {
      clientId: 7,
      debtType: "Loto Debt",
      txnType: "LOTO",
      usd: 20,
    });
    repay({
      usd: 10,
      legs: cashUsd(10),
      targets: [{ kind: "charge", id: loto.debtRowId }],
      discount: { amount_usd: 10, amount_lbp: 0 },
    });
    expect(coveredUsd(loto.debtRowId)).toBeCloseTo(20, 2);
    expect(salePaid(sale.saleId)).toBe(0);
  });

  it("no targets: the discount keeps today's order (sales first)", () => {
    const sale = seedSaleDebt(db, { clientId: 7, usd: 14 });
    seedChargeDebt(db, {
      clientId: 7,
      debtType: "Loto Debt",
      txnType: "LOTO",
      usd: 20,
    });
    repay({
      usd: 10,
      legs: cashUsd(10),
      discount: { amount_usd: 10, amount_lbp: 0 },
    });
    expect(salePaid(sale.saleId)).toBeCloseTo(14, 2);
  });
});

describe("decision 6 — an amount above the whole debt becomes account credit (existing path)", () => {
  it("$120 for a $101 debt, $19 change to the account → balance −$19; refund nets the ledger back to the debt", () => {
    const omt = seedTransferDebt(db, {
      clientId: 7,
      provider: "OMT",
      usd: 101,
    });
    const ledgerBefore = balance();
    const before = drawers(db);
    const id = repay({
      usd: 101,
      legs: [
        { method: "CASH", currencyCode: "USD", amount: 120 },
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 19,
          direction: "OUT",
        },
      ],
      targets: [{ kind: "charge", id: omt.debtRowId }],
    });
    expect(balance().usd).toBeCloseTo(-19, 2);
    expect(balance().lbp).toBe(0);
    const credit = db
      .prepare(
        `SELECT amount_usd, transaction_id FROM debt_ledger WHERE client_id = 7 AND transaction_type = 'CREDIT_DEPOSIT'`,
      )
      .get() as { amount_usd: number; transaction_id: number };
    expect(credit.amount_usd).toBeCloseTo(-19, 2);
    const txn = db
      .prepare(
        `SELECT id, profit_usd FROM transactions WHERE source_table = 'debt_ledger' AND source_id = ? AND type = 'DEBT_REPAYMENT'`,
      )
      .get(id) as { id: number; profit_usd: number };
    expect(credit.transaction_id).toBe(txn.id);
    // No kept-change profit: the extra is the customer's credit.
    expect(txn.profit_usd).toBe(0);
    // All $120 cash is in the drawers ($101 routed to OMT_System).
    expect(drawerDelta(before, drawers(db))).toEqual({
      "General|USD": 19,
      "OMT_System|USD": 101,
    });

    getTransactionRepository().refundTransaction(txn.id, 1);
    expect(balance().usd).toBeCloseTo(ledgerBefore.usd, 2);
    expect(balance().lbp).toBeCloseTo(ledgerBefore.lbp, 0);
    // Rule 20: every drawer nets back to zero, per currency.
    const net = drawerDelta(before, drawers(db));
    for (const v of Object.values(net)) expect(v).toBeCloseTo(0, 2);
  });

  it("the same overpay, VOIDED: the credit and every drawer net back to zero", () => {
    const omt = seedTransferDebt(db, {
      clientId: 7,
      provider: "OMT",
      usd: 101,
    });
    const ledgerBefore = balance();
    const before = drawers(db);
    const id = repay({
      usd: 101,
      legs: [
        { method: "CASH", currencyCode: "USD", amount: 120 },
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 19,
          direction: "OUT",
        },
      ],
      targets: [{ kind: "charge", id: omt.debtRowId }],
    });
    expect(balance().usd).toBeCloseTo(-19, 2);
    const txn = db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'debt_ledger' AND source_id = ? AND type = 'DEBT_REPAYMENT'`,
      )
      .get(id) as { id: number };
    getTransactionRepository().voidTransaction(txn.id, 1);
    expect(balance().usd).toBeCloseTo(ledgerBefore.usd, 2);
    expect(balance().lbp).toBeCloseTo(ledgerBefore.lbp, 0);
    const net = drawerDelta(before, drawers(db));
    for (const v of Object.values(net)) expect(v).toBeCloseTo(0, 2);
  });
});

// LIRA-308 owner answer 1 (2026-10-11) — the payload the Debts page now
// sends on an overpay: the change the cashier typed as returned (CASH OUT)
// PLUS the rest as account credit (CUSTOMER_ACCOUNT OUT) on ONE repayment,
// and an LBP rounding overpay on a USD due credited in LBP. Rule 20: void
// and refund net the ledger and every drawer to zero, per currency.
// Characterizations — the existing server path, written after the page
// change (they passed on first run; not regression guards).
describe("answer 1 — cash back + account credit on one repayment (characterization)", () => {
  it.each(["void", "refund"] as const)(
    "$115 for a $101 OMT send, $4 cash back, $10 credit → balance −$10; %s nets everything to zero",
    (how) => {
      const omt = seedTransferDebt(db, {
        clientId: 7,
        provider: "OMT",
        usd: 101,
      });
      const ledgerBefore = balance();
      const before = drawers(db);
      const id = repay({
        usd: 101,
        legs: [
          { method: "CASH", currencyCode: "USD", amount: 115 },
          { method: "CASH", currencyCode: "USD", amount: 4, direction: "OUT" },
          {
            method: "CUSTOMER_ACCOUNT",
            currencyCode: "USD",
            amount: 10,
            direction: "OUT",
          },
        ],
        targets: [{ kind: "charge", id: omt.debtRowId }],
      });
      expect(balance().usd).toBeCloseTo(-10, 2);
      expect(drawerDelta(before, drawers(db))).toEqual({
        "General|USD": 10,
        "OMT_System|USD": 101,
      });
      const txn = db
        .prepare(
          `SELECT id, profit_usd FROM transactions WHERE source_table = 'debt_ledger' AND source_id = ? AND type = 'DEBT_REPAYMENT'`,
        )
        .get(id) as { id: number; profit_usd: number };
      expect(txn.profit_usd).toBe(0);
      if (how === "void") getTransactionRepository().voidTransaction(txn.id, 1);
      else getTransactionRepository().refundTransaction(txn.id, 1);
      expect(balance().usd).toBeCloseTo(ledgerBefore.usd, 2);
      expect(balance().lbp).toBeCloseTo(ledgerBefore.lbp, 0);
      for (const v of Object.values(drawerDelta(before, drawers(db)))) {
        expect(v).toBeCloseTo(0, 2);
      }
    },
  );

  it.each(["void", "refund"] as const)(
    "a $10 charge paid with 900,000 LBP, 10,000 LBP credited → LBP credit only; %s nets to zero",
    (how) => {
      seedChargeDebt(db, {
        clientId: 7,
        debtType: "Loto Debt",
        txnType: "LOTO",
        usd: 10,
      });
      const ledgerBefore = balance();
      const before = drawers(db);
      const id = repay({
        usd: 10,
        legs: [
          { method: "CASH", currencyCode: "LBP", amount: 900_000 },
          {
            method: "CUSTOMER_ACCOUNT",
            currencyCode: "LBP",
            amount: 10_000,
            direction: "OUT",
          },
        ],
      });
      expect(balance().usd).toBeCloseTo(0, 2);
      expect(balance().lbp).toBeCloseTo(-10_000, 0);
      const txnId = (
        db
          .prepare(
            `SELECT id FROM transactions WHERE source_table = 'debt_ledger' AND source_id = ? AND type = 'DEBT_REPAYMENT'`,
          )
          .get(id) as { id: number }
      ).id;
      if (how === "void") getTransactionRepository().voidTransaction(txnId, 1);
      else getTransactionRepository().refundTransaction(txnId, 1);
      expect(balance().usd).toBeCloseTo(ledgerBefore.usd, 2);
      expect(balance().lbp).toBeCloseTo(ledgerBefore.lbp, 0);
      for (const v of Object.values(drawerDelta(before, drawers(db)))) {
        expect(v).toBeCloseTo(0, 0);
      }
    },
  );
});

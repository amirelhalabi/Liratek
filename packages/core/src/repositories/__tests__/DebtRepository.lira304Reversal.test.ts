/**
 * LIRA-304 — US5 + US2 guards (tasks T022, T034, T035, T038):
 *  - voiding a repayment puts every drawer, every item's coverage, the
 *    basket row and the client's balance back exactly, per currency — ticked
 *    or not, basket or separate visit, cross-currency included (rule 20);
 *  - a refund that overrides the payment method still mirrors the routed
 *    internal pair exactly (research D4);
 *  - a ticked item that is not one of the client's open items is refused
 *    with nothing written (FR-011).
 *
 * Not proven failing-first: written after the code (rule 17 — said plainly).
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  seedBasketMembers,
  seedTransferDebt,
  seedSaleDebt,
  drawers,
  RATE,
} from "../testHelpers/debtItemDb";
import { DebtRepository, type CreateRepaymentData } from "../DebtRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  getSessionPaymentService,
  resetSessionPaymentService,
} from "../../services/SessionPaymentService";
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
  addClient(db, 8, "Someone Else", "03888888");
});
afterEach(() => {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

type Target = { kind: "sale" | "charge" | "member"; id: number };

function repay(o: {
  client?: number;
  usd?: number;
  lbp?: number;
  legs: Array<{ method: string; currencyCode: "USD" | "LBP"; amount: number }>;
  targets?: Target[];
}): number {
  return repo.addRepayment({
    client_id: o.client ?? 7,
    amount_usd: o.usd ?? 0,
    amount_lbp: o.lbp ?? 0,
    created_by: 1,
    payments: o.legs,
    tender_exchange_rate: RATE,
    ...(o.targets ? { targets: o.targets } : {}),
  } as CreateRepaymentData).id;
}

function txnOf(ledgerId: number): number {
  return (
    db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'debt_ledger' AND source_id = ? AND type = 'DEBT_REPAYMENT'`,
      )
      .get(ledgerId) as { id: number }
  ).id;
}

/** Everything a repayment can touch, for exact before/after comparison. */
function snapshot() {
  const balance = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM debt_ledger WHERE client_id = 7`,
    )
    .get() as { usd: number; lbp: number };
  const rows = db
    .prepare(
      // The repayment's own ledger rows ('Repayment' and its 'Repayment
      // Reversal') stay by design; what must come back is every charge.
      `SELECT id, covered_usd, covered_lbp FROM debt_ledger
       WHERE client_id = 7 AND transaction_type NOT IN ('Repayment', 'Repayment Reversal')
       ORDER BY id`,
    )
    .all();
  const members = db
    .prepare(
      `SELECT id, covered_usd, covered_lbp, owed_usd, owed_lbp FROM customer_session_transactions ORDER BY id`,
    )
    .all();
  const sales = db.prepare(`SELECT id, paid_usd FROM sales ORDER BY id`).all();
  return {
    drawers: drawers(db),
    balance: { usd: Math.round(balance.usd * 100) / 100, lbp: Math.round(balance.lbp) },
    rows,
    members,
    sales,
  };
}

function basket() {
  const b = seedBasketMembers(db, 7, [
    { kind: "transfer", provider: "OMT", usd: 101 },
    { kind: "sale", usd: 14 },
    { kind: "loto", lbp: 200_000 },
  ]);
  getSessionPaymentService().recordBasketPayment(b.sessionId, {
    legs: [
      { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 115 },
      { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 200_000 },
    ],
    exchangeRate: RATE,
    userId: 1,
    clientId: 7,
  });
  return b;
}

describe("T035/T038 — voiding a repayment restores everything exactly", () => {
  it.each([
    ["basket, nothing ticked, full", "basket", undefined, 115, 200_000],
    ["basket, OMT ticked, $50", "basket", "omt", 50, 0],
    ["separate visits, nothing ticked, $50", "visits", undefined, 50, 0],
    ["separate visits, OMT ticked, $60", "visits", "omt", 60, 0],
  ] as const)("%s", (_name, shape, tick, usd, lbp) => {
    let targets: Target[] | undefined;
    if (shape === "basket") {
      const b = basket();
      if (tick) targets = [{ kind: "member", id: b.members[0].cstId }];
    } else {
      const omt = seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 101 });
      seedSaleDebt(db, { clientId: 7, usd: 14 });
      if (tick) targets = [{ kind: "charge", id: omt.debtRowId }];
    }
    const before = snapshot();
    const legs: Array<{ method: string; currencyCode: "USD" | "LBP"; amount: number }> = [
      { method: "CASH", currencyCode: "USD", amount: usd },
    ];
    if (lbp) legs.push({ method: "CASH", currencyCode: "LBP", amount: lbp });
    const id = repay({ usd, lbp, legs, targets });
    expect(snapshot()).not.toEqual(before);
    getTransactionRepository().voidTransaction(txnOf(id), 1);
    expect(snapshot()).toEqual(before);
  });

  it("cross-currency: LBP paid for a USD OMT debt, then voided", () => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 101 });
    const before = snapshot();
    const id = repay({
      usd: 101,
      legs: [{ method: "CASH", currencyCode: "LBP", amount: 8_989_000 }],
    });
    getTransactionRepository().voidTransaction(txnOf(id), 1);
    expect(snapshot()).toEqual(before);
  });
});

describe("T034 — refund with a different method still mirrors the routed pair", () => {
  it("every drawer nets to zero; the OMT drawer gives back exactly what was routed", () => {
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 101 });
    const before = drawers(db);
    const id = repay({ usd: 50, legs: [{ method: "CASH", currencyCode: "USD", amount: 50 }] });
    expect(drawers(db)["OMT_System|USD"] ?? 0).toBe(50);
    getTransactionRepository().refundTransaction(txnOf(id), 1, {
      refundLegs: [{ method: "WHISH", currencyCode: "USD", amount: 50 }],
    });
    const after = drawers(db);
    // The routed internal pair is mirrored exactly, never swapped by the
    // override: the OMT drawer gives back the $50 and is where it was. The
    // refund itself leaves through the Whish wallet, so the customer's
    // original $50 cash stays in General — net across all drawers: 0.
    expect(after["OMT_System|USD"] ?? 0).toBe(before["OMT_System|USD"] ?? 0);
    expect(after["General|USD"] ?? 0).toBe((before["General|USD"] ?? 0) + 50);
    expect(after["Whish_App|USD"] ?? 0).toBe((before["Whish_App|USD"] ?? 0) - 50);
  });
});

describe("T022 — a ticked item must be one of the client's open items", () => {
  it.each([
    ["another client's item", "other"],
    ["an item that is already paid", "paid"],
    ["a hand-added (Manual Debt) line", "manual"],
  ] as const)("refuses %s and writes nothing", (_name, kind) => {
    let target: Target;
    if (kind === "other") {
      const omt = seedTransferDebt(db, { clientId: 8, provider: "OMT", usd: 30 });
      seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 30 });
      target = { kind: "charge", id: omt.debtRowId };
    } else if (kind === "paid") {
      const omt = seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 30 });
      repay({ usd: 30, legs: [{ method: "CASH", currencyCode: "USD", amount: 30 }] });
      seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 30 });
      target = { kind: "charge", id: omt.debtRowId };
    } else {
      const manual = Number(
        db
          .prepare(
            `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, created_by)
             VALUES (1, 7, 'Manual Debt', 30, 1)`,
          )
          .run().lastInsertRowid,
      );
      target = { kind: "charge", id: manual };
    }
    const before = snapshot();
    const txnCount = (db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as { n: number }).n;
    expect(() =>
      repay({
        usd: 30,
        legs: [{ method: "CASH", currencyCode: "USD", amount: 30 }],
        targets: [target],
      }),
    ).toThrow(/no longer open/);
    expect(snapshot()).toEqual(before);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get() as { n: number }).n).toBe(txnCount);
  });
});

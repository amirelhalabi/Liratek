/**
 * LIRA-349 A2 — a session basket's on-account part belongs to the item(s)
 * actually put on account, in that item's own currency.
 *
 * Test-tenant case (session #162): a phone case $12 paid CASH (USD) and an
 * MTC recharge of 600,000 LBP put on the CUSTOMER_ACCOUNT (LBP). Before the
 * fix the checkout attributed the LBP account debt to the SALE first
 * ("sales first", ignoring currency): the 'Session Debt' row was fully
 * pre-covered in LBP, the recharge member owed nothing, and the cash-paid
 * case stayed open for $6.74 (600,000 / 89,000) — so the Settle Debt
 * planner could not apply an LBP payment to it ("pays $0 · leaves $6.74").
 *
 * Expected: the recharge member owes 600,000 LBP, the case is fully paid,
 * the planner pre-ticks the recharge for a 600,000 LBP payment, that
 * payment closes it, and voiding the repayment restores everything exactly.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  seedBasketMembers,
  sessionDebtRow,
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
import { planRepaymentTargets } from "../../utils/debtRepaymentAllocation";
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
  addClient(db, 7, "New Customer", "03101010");
});
afterEach(() => {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

/** Session #162's basket: case $12 paid cash + MTC 600,000 LBP on account. */
function checkout() {
  const b = seedBasketMembers(db, 7, [
    { kind: "sale", usd: 12, profitUsd: 8 },
    { kind: "recharge", lbp: 600_000, profitLbp: 50_000 },
  ]);
  getSessionPaymentService().recordBasketPayment(b.sessionId, {
    legs: [
      { method: "CASH", currencyCode: "USD", amount: 12 },
      { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 600_000 },
    ],
    exchangeRate: RATE,
    userId: 1,
    clientId: 7,
  });
  return b;
}

function snapshot() {
  return {
    drawers: drawers(db),
    rows: db
      .prepare(
        `SELECT id, covered_usd, covered_lbp FROM debt_ledger
         WHERE client_id = 7 AND transaction_type NOT IN ('Repayment', 'Repayment Reversal')
         ORDER BY id`,
      )
      .all(),
    members: db
      .prepare(
        `SELECT id, covered_usd, covered_lbp, owed_usd, owed_lbp
         FROM customer_session_transactions ORDER BY id`,
      )
      .all(),
    sales: db.prepare(`SELECT id, paid_usd, paid_lbp FROM sales ORDER BY id`).all(),
    open: repo
      .findOpenDebtItems(7)
      .map((i) => ({ kind: i.kind, id: i.id, usd: i.openUsd, lbp: i.openLbp })),
  };
}

describe("LIRA-349 A2 — basket on-account debt lands on the on-account item, in its currency", () => {
  it("the LBP recharge owes 600,000 LBP; the cash-paid case owes nothing", () => {
    const b = checkout();
    const recharge = b.members[1].cstId;

    const row = sessionDebtRow(db, b.sessionId);
    expect(row.amount_lbp).toBe(600_000);
    expect(row.covered_lbp).toBe(0);
    expect(row.covered_usd).toBe(0);

    const sale = db
      .prepare(`SELECT paid_usd FROM sales ORDER BY id LIMIT 1`)
      .get() as { paid_usd: number };
    expect(sale.paid_usd).toBe(12);

    const open = repo.findOpenDebtItems(7);
    expect(open.map((i) => ({ kind: i.kind, id: i.id, usd: i.openUsd, lbp: i.openLbp }))).toEqual([
      { kind: "member", id: recharge, usd: 0, lbp: 600_000 },
    ]);
  });

  it("the planner pre-ticks the recharge for a 600,000 LBP payment and pays it in full", () => {
    const b = checkout();
    const recharge = b.members[1].cstId;
    const plan = planRepaymentTargets({
      items: repo.findOpenDebtItems(7),
      ticked: [],
      reductionUsd: 0,
      reductionLbp: 600_000,
      rate: RATE,
    });
    expect(plan.targets).toEqual([{ kind: "member", id: recharge, auto: true }]);
    expect(plan.coverage).toEqual([
      { kind: "member", id: recharge, usd: 0, lbp: 600_000 },
    ]);
  });

  it("a full 600,000 LBP repayment closes it; voiding the repayment restores it exactly", () => {
    const b = checkout();
    const recharge = b.members[1].cstId;
    const before = snapshot();
    const ledgerId = repo.addRepayment({
      client_id: 7,
      amount_usd: 0,
      amount_lbp: 600_000,
      created_by: 1,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 600_000 }],
      tender_exchange_rate: RATE,
      targets: [{ kind: "member", id: recharge }],
    } as CreateRepaymentData).id;

    expect(repo.findOpenDebtItems(7)).toEqual([]);
    const row = sessionDebtRow(db, b.sessionId);
    expect(row.covered_lbp).toBe(600_000);

    const txnId = (
      db
        .prepare(
          `SELECT id FROM transactions WHERE source_table = 'debt_ledger' AND source_id = ? AND type = 'DEBT_REPAYMENT'`,
        )
        .get(ledgerId) as { id: number }
    ).id;
    getTransactionRepository().voidTransaction(txnId, 1);
    expect(snapshot()).toEqual(before);
  });

  it("unchanged (G17): a USD account leg still goes to the sale first", () => {
    seedBasketMembers(db, 7, [
      { kind: "sale", usd: 12 },
      { kind: "recharge", lbp: 600_000 },
    ]);
    const sessionId = (
      db.prepare(`SELECT MAX(id) AS id FROM customer_sessions`).get() as { id: number }
    ).id;
    getSessionPaymentService().recordBasketPayment(sessionId, {
      legs: [
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 12 },
        { method: "CASH", currencyCode: "LBP", amount: 600_000 },
      ],
      exchangeRate: RATE,
      userId: 1,
      clientId: 7,
    });
    const open = repo.findOpenDebtItems(7);
    expect(open.map((i) => ({ kind: i.kind, usd: i.openUsd, lbp: i.openLbp }))).toEqual([
      { kind: "sale", usd: 12, lbp: 0 },
    ]);
  });

  it("an LBP OMT system transfer paid by checkout cash is never paid into the OMT drawer a second time", () => {
    // OMT first: the 900,000 LBP cash goes to the OMT drawer at checkout,
    // so the account debt must not land on the transfer as well.
    const b = seedBasketMembers(db, 7, [
      { kind: "sale", usd: 12 },
      { kind: "transfer", provider: "OMT", lbp: 900_000 },
    ]);
    const omtBefore = drawers(db)["OMT_System|LBP"] ?? 0;
    getSessionPaymentService().recordBasketPayment(b.sessionId, {
      legs: [
        { method: "CASH", currencyCode: "LBP", amount: 900_000 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 1_068_000 },
      ],
      exchangeRate: RATE,
      userId: 1,
      clientId: 7,
    });
    expect((drawers(db)["OMT_System|LBP"] ?? 0) - omtBefore).toBe(900_000);

    const open = repo.findOpenDebtItems(7);
    const openUsd = open.reduce((s2, i) => s2 + i.openUsd, 0);
    const openLbp = open.reduce((s2, i) => s2 + i.openLbp, 0);
    const legs: Array<{ method: string; currencyCode: "USD" | "LBP"; amount: number }> = [];
    if (openUsd > 0) legs.push({ method: "CASH", currencyCode: "USD", amount: Math.round(openUsd * 100) / 100 });
    if (openLbp > 0) legs.push({ method: "CASH", currencyCode: "LBP", amount: Math.round(openLbp) });
    repo.addRepayment({
      client_id: 7,
      amount_usd: Math.round(openUsd * 100) / 100,
      amount_lbp: Math.round(openLbp),
      created_by: 1,
      payments: legs,
      tender_exchange_rate: RATE,
    } as CreateRepaymentData);
    expect(repo.findOpenDebtItems(7)).toEqual([]);
    expect((drawers(db)["OMT_System|LBP"] ?? 0) - omtBefore).toBe(900_000);
  });
});

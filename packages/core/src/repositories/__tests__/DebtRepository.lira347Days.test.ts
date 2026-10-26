/**
 * LIRA-347 — settle-by-day calendar for client debts (owner D1–D3,
 * 2026-10-26):
 *  - month rows: one row per coverable item on its shop day (sale on
 *    account, charge, basket member), closed ones too; a cash-only sale is
 *    not a debt day; a refunded charge is not on the calendar;
 *  - picking 22 Oct and paying $30 pays only 22 Oct;
 *  - "Use credit $20" marks the 20 Oct debt paid by $20, leaves the ledger
 *    balance alone, and a void puts everything back (create + void = 0 per
 *    ledger per currency, rule 20);
 *  - the stale check refuses plainly, with nothing written;
 *  - invariant: open month rows = the open items the repayment screen lists.
 *
 * NOT proven failing-first (rule 17, said plainly): these were written after
 * the repository code they test. The D4 fix's guard
 * (DebtRepository.lira347RefundedCharge.test.ts) was failing-first.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  seedTransferDebt,
  seedChargeDebt,
  seedSaleDebt,
  seedBasketMembers,
  drawers,
  RATE,
} from "../testHelpers/debtItemDb";
import {
  CREDIT_ONLY_REPAYMENT_NOTE,
  DebtRepository,
  DEBT_CREDIT_NOT_AVAILABLE,
  DEBT_DAYS_CHANGED,
} from "../DebtRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
import {
  getSessionPaymentService,
  resetSessionPaymentService,
} from "../../services/SessionPaymentService";
import { DebtService } from "../../services/DebtService";
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
import { buildDebtDayTargets } from "../../utils/debtSettleDays";
import { buildSettleDays } from "../../utils/settleDays";
import { addRepaymentSchema } from "../../validators/debt";

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

/** Noon UTC: the same calendar day in any shop zone within ±11h. */
const at = (day: string) => `${day} 12:00:00`;

function dateRow(table: string, id: number, day: string): void {
  db.prepare(`UPDATE ${table} SET created_at = ? WHERE id = ?`).run(at(day), id);
}

function chargeOn(day: string, usd: number) {
  const c = seedChargeDebt(db, {
    clientId: 7,
    debtType: "Custom Service Debt",
    txnType: "CUSTOM_SERVICE",
    usd,
  });
  dateRow("debt_ledger", c.debtRowId, day);
  dateRow("transactions", c.txnId, day);
  return c;
}

function saleOn(day: string, usd: number) {
  const s = seedSaleDebt(db, { clientId: 7, usd });
  dateRow("debt_ledger", s.debtRowId, day);
  dateRow("transactions", s.txnId, day);
  dateRow("sales", s.saleId, day);
  return s;
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

function balance() {
  const b = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp FROM debt_ledger WHERE client_id = 7`,
    )
    .get() as { usd: number; lbp: number };
  return { usd: Math.round(b.usd * 100) / 100, lbp: Math.round(b.lbp) };
}

/** Every ledger a repayment can touch, per currency. */
function snapshot() {
  return {
    drawers: drawers(db),
    balance: balance(),
    charges: db
      .prepare(
        `SELECT id, covered_usd, covered_lbp FROM debt_ledger
         WHERE client_id = 7 AND transaction_type NOT IN ('Repayment', 'Repayment Reversal')
         ORDER BY id`,
      )
      .all(),
    members: db
      .prepare(
        `SELECT id, covered_usd, covered_lbp FROM customer_session_transactions ORDER BY id`,
      )
      .all(),
    sales: db.prepare(`SELECT id, paid_usd FROM sales ORDER BY id`).all(),
    credit: repo.getClientDebtMonthRows(7, "2026-10").account,
  };
}

function covered(id: number): number {
  return (
    db.prepare(`SELECT covered_usd FROM debt_ledger WHERE id = ?`).get(id) as {
      covered_usd: number;
    }
  ).covered_usd;
}

describe("LIRA-347 — month rows (one per coverable item on its shop day)", () => {
  it("lists a sale on account, a charge, a basket member and a closed charge; not a cash sale", () => {
    const sale = saleOn("2026-10-20", 50);
    const charge = chargeOn("2026-10-21", 40);
    const closed = chargeOn("2026-10-18", 10);
    db.prepare(`UPDATE debt_ledger SET covered_usd = 10 WHERE id = ?`).run(
      closed.debtRowId,
    );
    // A cash sale with no account debt: paid in full, no 'Sale Debt' row.
    const cash = seedSaleDebt(db, { clientId: 7, usd: 25 });
    db.prepare(`DELETE FROM debt_ledger WHERE id = ?`).run(cash.debtRowId);
    db.prepare(`UPDATE sales SET paid_usd = 25 WHERE id = ?`).run(cash.saleId);
    dateRow("sales", cash.saleId, "2026-10-19");
    // A basket with one OMT transfer on account.
    const b = seedBasketMembers(db, 7, [
      { kind: "transfer", provider: "OMT", usd: 30 },
    ]);
    dateRow("transactions", b.members[0].txnId, "2026-10-22");
    getSessionPaymentService().recordBasketPayment(b.sessionId, {
      legs: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 30 }],
      exchangeRate: RATE,
      userId: 1,
      clientId: 7,
    });

    const { rows } = repo.getClientDebtMonthRows(7, "2026-10");
    const pick = (kind: string, id: number) =>
      rows.find((r) => r.kind === kind && r.id === id);
    expect(pick("sale", sale.saleId)).toMatchObject({
      shop_day: "2026-10-20",
      amount_usd: 50,
      remaining_usd: 50,
      covered_usd: 0,
      row_scope: "DAY",
    });
    expect(pick("charge", charge.debtRowId)).toMatchObject({
      shop_day: "2026-10-21",
      remaining_usd: 40,
    });
    expect(pick("charge", closed.debtRowId)).toMatchObject({
      shop_day: "2026-10-18",
      amount_usd: 10,
      covered_usd: 10,
      remaining_usd: 0,
    });
    expect(pick("member", b.members[0].cstId)).toMatchObject({
      shop_day: "2026-10-22",
      remaining_usd: 30,
    });
    expect(rows.some((r) => r.kind === "sale" && r.id === cash.saleId)).toBe(
      false,
    );

    // The generic calendar paints them: 18 settled, 20/21/22 unpaid, 19 none.
    const days = buildSettleDays(rows, { today: "2026-10-26", month: "2026-10" });
    const state = (d: string) => days.find((x) => x.day === d)!.state;
    expect(state("2026-10-18")).toBe("SETTLED");
    expect(state("2026-10-19")).toBe("NONE");
    expect(state("2026-10-20")).toBe("UNPAID");
    expect(state("2026-10-22")).toBe("UNPAID");
  });

  it("a refunded charge is not on the calendar", () => {
    const c = chargeOn("2026-10-10", 50);
    getTransactionRepository().refundTransaction(c.txnId, 1);
    const { rows } = repo.getClientDebtMonthRows(7, "2026-10");
    expect(rows.some((r) => r.kind === "charge" && r.id === c.debtRowId)).toBe(
      false,
    );
  });

  it("account lines: a manual debt is the earlier balance, a deposit is credit", () => {
    chargeOn("2026-10-20", 50);
    repo.insertRawEntry({
      client_id: 7,
      transaction_type: "Manual Debt",
      amount_usd: 30,
      amount_lbp: 0,
      note: "opening",
      created_by: 1,
    });
    expect(repo.getClientDebtMonthRows(7, "2026-10").account).toEqual({
      earlier_usd: 30,
      earlier_lbp: 0,
      credit_usd: 0,
      credit_lbp: 0,
    });
    repo.addCredit({
      clientId: 7,
      amountUsd: 50,
      amountLbp: 0,
      note: "deposit",
      createdBy: "1",
    });
    expect(repo.getClientDebtMonthRows(7, "2026-10").account).toEqual({
      earlier_usd: 0,
      earlier_lbp: 0,
      credit_usd: 20,
      credit_lbp: 0,
    });
  });

  it("invariant: the month's open rows = the open items the repayment screen lists", () => {
    saleOn("2026-10-20", 50);
    chargeOn("2026-10-21", 40);
    seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 15 });
    repo.addRepayment({
      client_id: 7,
      amount_usd: 35,
      amount_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 35 }],
      tender_exchange_rate: RATE,
    });
    const month = repo
      .getClientDebtMonthRows(7, "2026-10")
      .rows.filter((r) => r.remaining_usd > 0.005 || r.remaining_lbp > 0.5);
    const open = repo
      .findOpenDebtItems(7)
      .filter((i) => i.kind !== "balance" && i.shopDay?.startsWith("2026-10"));
    const key = (k: string, id: number) => `${k}:${id}`;
    expect(new Set(month.map((r) => key(r.kind, r.id)))).toEqual(
      new Set(open.map((i) => key(i.kind, i.id))),
    );
    for (const i of open) {
      const r = month.find((m) => m.kind === i.kind && m.id === i.id)!;
      expect(r.remaining_usd).toBeCloseTo(i.openUsd, 2);
      expect(r.shop_day).toBe(i.shopDay);
    }
  });
});

describe("LIRA-347 D1 — pick days, then pay through the repayment", () => {
  it("pick 22 Oct, pay $30 → only 22 Oct is paid", () => {
    const sale = saleOn("2026-10-20", 50);
    const c22 = chargeOn("2026-10-22", 40);
    const plan = buildDebtDayTargets(repo.findOpenDebtItems(7), {
      pickedDays: ["2026-10-22"],
      credit: { usd: 0, lbp: 0 },
    });
    expect(plan.targets).toEqual([{ kind: "charge", id: c22.debtRowId }]);
    expect(plan.owed).toEqual({ usd: 40, lbp: 0 });
    repo.addRepayment({
      client_id: 7,
      amount_usd: 30,
      amount_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 30 }],
      tender_exchange_rate: RATE,
      targets: plan.targets,
      expected_owed: plan.owed,
    });
    expect(covered(c22.debtRowId)).toBeCloseTo(30, 2);
    expect(
      (db.prepare(`SELECT paid_usd FROM sales WHERE id = ?`).get(sale.saleId) as {
        paid_usd: number;
      }).paid_usd,
    ).toBe(0);
  });

  it("stale check: refused plainly, nothing written, when a picked day changed", () => {
    chargeOn("2026-10-20", 50);
    const plan = buildDebtDayTargets(repo.findOpenDebtItems(7), {
      pickedDays: ["2026-10-20"],
      credit: { usd: 0, lbp: 0 },
    });
    // Someone else pays $10 of it meanwhile.
    repo.addRepayment({
      client_id: 7,
      amount_usd: 10,
      amount_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 10 }],
      tender_exchange_rate: RATE,
    });
    const before = snapshot();
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM debt_ledger`).get();
    const txns = db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get();
    const res = new DebtService(repo).addRepayment({
      clientId: 7,
      amountUSD: 50,
      amountLBP: 0,
      userId: 1,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 50 }],
      tender_exchange_rate: RATE,
      targets: plan.targets,
      expectedOwed: plan.owed,
    });
    expect(res).toEqual({ success: false, error: DEBT_DAYS_CHANGED });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM debt_ledger`).get()).toEqual(rows);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM transactions`).get()).toEqual(txns);
    expect(snapshot()).toEqual(before);
  });
});

describe("LIRA-347 D2 — use the client's credit on the picked days", () => {
  function seedWithCredit() {
    const c20 = chargeOn("2026-10-20", 50);
    const c21 = chargeOn("2026-10-21", 40);
    repo.addCredit({
      clientId: 7,
      amountUsd: 20,
      amountLbp: 0,
      note: "deposit",
      createdBy: "1",
    });
    return { c20, c21 };
  }

  it("pre-fills min(owed of picked days, credit) and the payment as the rest", () => {
    seedWithCredit();
    const credit = repo.getClientDebtMonthRows(7, "2026-10").account;
    expect(credit.credit_usd).toBe(20);
    const plan = buildDebtDayTargets(repo.findOpenDebtItems(7), {
      pickedDays: ["2026-10-20"],
      credit: { usd: credit.credit_usd, lbp: credit.credit_lbp },
    });
    expect(plan.credit_used).toEqual({ usd: 20, lbp: 0 });
    expect(plan.prefill).toEqual({ usd: 30, lbp: 0 });
    // The cashier lowers it: clamped 0…limit, the payment follows.
    const lower = buildDebtDayTargets(repo.findOpenDebtItems(7), {
      pickedDays: ["2026-10-20"],
      credit: { usd: 20, lbp: 0 },
      creditUsed: { usd: 5 },
    });
    expect(lower.credit_used.usd).toBe(5);
    expect(lower.prefill.usd).toBe(45);
  });

  it("credit only: $20 marks 20 Oct paid by $20, balance unchanged; void restores everything", () => {
    const { c20, c21 } = seedWithCredit();
    const before = snapshot();
    const res = new DebtService(repo).addRepayment({
      clientId: 7,
      amountUSD: 0,
      amountLBP: 0,
      userId: 1,
      targets: [{ kind: "charge", id: c20.debtRowId }],
      expectedOwed: { usd: 50, lbp: 0 },
      creditUseUSD: 20,
    });
    expect(res.success).toBe(true);
    expect(covered(c20.debtRowId)).toBeCloseTo(20, 2);
    expect(covered(c21.debtRowId)).toBe(0);
    // The credit already lowered the balance when deposited: using it on
    // an item moves neither the balance nor any drawer.
    expect(balance()).toEqual(before.balance);
    expect(drawers(db)).toEqual(before.drawers);
    expect(repo.getClientDebtMonthRows(7, "2026-10").account.credit_usd).toBe(0);

    getTransactionRepository().voidTransaction(txnOf(res.id as number), 1);
    expect(snapshot()).toEqual(before);
  });

  it("cash $30 + credit $20 pays the 20 Oct $50; create + void nets 0 on every ledger", () => {
    const { c20 } = seedWithCredit();
    const before = snapshot();
    const id = repo.addRepayment({
      client_id: 7,
      amount_usd: 30,
      amount_lbp: 0,
      created_by: 1,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 30 }],
      tender_exchange_rate: RATE,
      targets: [{ kind: "charge", id: c20.debtRowId }],
      expected_owed: { usd: 50, lbp: 0 },
      credit_use_usd: 20,
    }).id;
    expect(covered(c20.debtRowId)).toBeCloseTo(50, 2);
    expect(balance().usd).toBeCloseTo(before.balance.usd - 30, 2);
    getTransactionRepository().voidTransaction(txnOf(id), 1);
    expect(snapshot()).toEqual(before);
  });

  it("LBP: a 300,000 LBP credit pays an LBP charge; balance unchanged; void nets 0 per ledger", () => {
    const loto = seedChargeDebt(db, {
      clientId: 7,
      debtType: "Loto Debt",
      txnType: "LOTO",
      lbp: 900_000,
    });
    dateRow("debt_ledger", loto.debtRowId, "2026-10-21");
    repo.addCredit({
      clientId: 7,
      amountUsd: 0,
      amountLbp: 300_000,
      note: "deposit",
      createdBy: "1",
    });
    expect(repo.getClientDebtMonthRows(7, "2026-10").account.credit_lbp).toBe(
      300_000,
    );
    const before = snapshot();
    const res = new DebtService(repo).addRepayment({
      clientId: 7,
      amountUSD: 0,
      amountLBP: 0,
      userId: 1,
      targets: [{ kind: "charge", id: loto.debtRowId }],
      expectedOwed: { usd: 0, lbp: 900_000 },
      creditUseLBP: 300_000,
    });
    expect(res.success).toBe(true);
    expect(
      (db
        .prepare(`SELECT covered_lbp FROM debt_ledger WHERE id = ?`)
        .get(loto.debtRowId) as { covered_lbp: number }).covered_lbp,
    ).toBe(300_000);
    expect(balance()).toEqual(before.balance);
    expect(drawers(db)).toEqual(before.drawers);
    getTransactionRepository().voidTransaction(txnOf(res.id as number), 1);
    expect(snapshot()).toEqual(before);
  });

  it("a repayment wholly from credit says so: paid from the account, summary and note name the credit", () => {
    const { c20 } = seedWithCredit();
    const res = new DebtService(repo).addRepayment({
      clientId: 7,
      amountUSD: 0,
      amountLBP: 0,
      userId: 1,
      targets: [{ kind: "charge", id: c20.debtRowId }],
      creditUseUSD: 20,
    });
    const txn = db
      .prepare(`SELECT summary, metadata_json FROM transactions WHERE id = ?`)
      .get(txnOf(res.id as number)) as { summary: string; metadata_json: string };
    expect(txn.summary).toContain("(credit used: $20)");
    const meta = JSON.parse(txn.metadata_json) as Record<string, unknown>;
    expect(meta.paid_by).toBe("CUSTOMER_ACCOUNT");
    expect(meta.credit_used).toEqual({ usd: 20, lbp: 0 });
    expect(
      (db.prepare(`SELECT note FROM debt_ledger WHERE id = ?`).get(res.id) as {
        note: string;
      }).note,
    ).toBe(CREDIT_ONLY_REPAYMENT_NOTE);
  });

  it("a few cents of rounding residue is not offered as credit", () => {
    chargeOn("2026-10-20", 50);
    repo.addCredit({
      clientId: 7,
      amountUsd: 0.03,
      amountLbp: 0,
      note: "residue",
      createdBy: "1",
    });
    expect(repo.getClientDebtMonthRows(7, "2026-10").account.credit_usd).toBe(0);
  });

  it("refuses more credit than the account has, nothing written", () => {
    const { c20 } = seedWithCredit();
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM debt_ledger`).get();
    expect(() =>
      repo.addRepayment({
        client_id: 7,
        amount_usd: 0,
        amount_lbp: 0,
        created_by: 1,
        targets: [{ kind: "charge", id: c20.debtRowId }],
        credit_use_usd: 25,
      }),
    ).toThrow(DEBT_CREDIT_NOT_AVAILABLE);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM debt_ledger`).get()).toEqual(rows);
  });

  it("a USD credit never pays an LBP debt", () => {
    const loto = seedChargeDebt(db, {
      clientId: 7,
      debtType: "Loto Debt",
      txnType: "LOTO",
      lbp: 900_000,
    });
    repo.addCredit({
      clientId: 7,
      amountUsd: 20,
      amountLbp: 0,
      note: "deposit",
      createdBy: "1",
    });
    // Account lines: the USD credit nets against nothing in USD, so it is
    // credit; LBP has no gap (the item accounts for it).
    const lines = repo.getClientDebtMonthRows(7, "2026-10").account;
    expect(lines.credit_lbp).toBe(0);
    expect(() =>
      repo.addRepayment({
        client_id: 7,
        amount_usd: 0,
        amount_lbp: 0,
        created_by: 1,
        targets: [{ kind: "charge", id: loto.debtRowId }],
        credit_use_lbp: 100_000,
      }),
    ).toThrow(DEBT_CREDIT_NOT_AVAILABLE);
  });

  it("schema: a credit-only repayment is accepted; nothing at all is still refused", () => {
    expect(
      addRepaymentSchema.safeParse({ clientId: 7, creditUseUSD: 20 }).success,
    ).toBe(true);
    expect(addRepaymentSchema.safeParse({ clientId: 7 }).success).toBe(false);
    const parsed = addRepaymentSchema.parse({
      clientId: 7,
      amountUSD: 10,
      expectedOwed: { usd: 10, lbp: 0 },
      creditUseUSD: 5,
      creditUseLBP: 0,
    });
    // Rule 23 — the new keys survive validation (Zod strips unknown keys).
    expect(parsed).toMatchObject({
      expectedOwed: { usd: 10, lbp: 0 },
      creditUseUSD: 5,
      creditUseLBP: 0,
    });
  });
});

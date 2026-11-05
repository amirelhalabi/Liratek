/**
 * LIRA-372 (T020) — Debts Repay discount through `DebtService.addRepayment`
 * (the service both transports call after the shared schema):
 *   - $5.01 → `{ success: false }` (the one settle-discount cap);
 *   - $5 → accepted, booked as a 'Debt Discount' ledger row + one
 *     COUNTERPARTY_DISCOUNT transaction with profit −5 ("given");
 *   - void of the repayment nets every ledger, profit and coverage to 0
 *     (FR-007, rule 20).
 *
 * Seen failing on the unfixed code (2026-11-05): the service-level $5.01
 * refusal and the void netting (the bundled discount was left booked —
 * overturned by owner decision A), before decisions A/B were built.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  seedChargeDebt,
  RATE,
} from "../testHelpers/debtItemDb";
import { DebtRepository } from "../DebtRepository";
import { DebtService } from "../../services/DebtService";
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
import type { z } from "zod";
import { addRepaymentSchema } from "../../validators/debt";
import { expectPostings, snapshotLedgers } from "../testHelpers/postingAssert";

let db: Database.Database;
let service: DebtService;

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
  service = new DebtService(new DebtRepository());
  addClient(db, 7, "Cap Client", "03101010");
  seedChargeDebt(db, {
    clientId: 7,
    debtType: "Custom Service Debt",
    txnType: "CUSTOM_SERVICE",
    usd: 100,
    profitUsd: 0,
  });
});

afterEach(() => {
  resetAll();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
});

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const num = (sql: string, ...args: unknown[]): number =>
  r6((db.prepare(sql).get(...args) as { v: number | null }).v ?? 0);

/** The payload the Debts page builds: keys from `addRepaymentSchema`. */
function payload(discountUsd: number) {
  const input: z.input<typeof addRepaymentSchema> = {
    clientId: 7,
    amountUSD: 100 - Math.min(discountUsd, 5),
    amountLBP: 0,
    payments: [
      { method: "CASH", currencyCode: "USD", amount: 100 - Math.min(discountUsd, 5) },
    ],
    discount: { amount_usd: discountUsd, amount_lbp: 0, reason: "rounded" },
    tender_exchange_rate: RATE,
  };
  return input;
}

function side() {
  return {
    profitUsd: num(`SELECT SUM(profit_usd) AS v FROM transactions WHERE status = 'ACTIVE'`),
    profitLbp: num(`SELECT SUM(profit_lbp) AS v FROM transactions WHERE status = 'ACTIVE'`),
    coveredUsd: num(`SELECT SUM(covered_usd) AS v FROM debt_ledger`),
    coveredLbp: num(`SELECT SUM(covered_lbp) AS v FROM debt_ledger`),
  };
}

describe("LIRA-372 — Debts Repay discount cap, booking and void (service envelope)", () => {
  it("the shared schema refuses $5.01 with the cap sentence", () => {
    const res = addRepaymentSchema.safeParse(payload(5.01));
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toContain(
      "The discount is more than $5.",
    );
  });

  it("DebtService.addRepayment refuses a $5.01 discount: { success: false }, nothing written", () => {
    const before = snapshotLedgers(db);
    const res = service.addRepayment({ ...payload(5.01), userId: 1 } as Parameters<
      DebtService["addRepayment"]
    >[0]);
    expect(res.success).toBe(false);
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("$95 + $5 discount → 'Debt Discount' −5 + COUNTERPARTY_DISCOUNT profit −5; debt closes", () => {
    const parsed = addRepaymentSchema.parse(payload(5));
    const res = service.addRepayment({ ...parsed, userId: 1 });
    expect(res).toMatchObject({ success: true });
    const row = db
      .prepare(
        `SELECT amount_usd, note, transaction_id FROM debt_ledger WHERE client_id = 7 AND transaction_type = 'Debt Discount'`,
      )
      .get() as { amount_usd: number; note: string; transaction_id: number };
    expect(r6(row.amount_usd)).toBe(-5);
    expect(row.note).toBe("rounded");
    const txn = db
      .prepare(`SELECT type, amount_usd, profit_usd, profit_lbp FROM transactions WHERE id = ?`)
      .get(row.transaction_id) as {
      type: string;
      amount_usd: number;
      profit_usd: number;
      profit_lbp: number;
    };
    expect(txn).toEqual({
      type: "COUNTERPARTY_DISCOUNT",
      amount_usd: 0,
      profit_usd: -5,
      profit_lbp: 0,
    });
    expect(num(`SELECT SUM(amount_usd) AS v FROM debt_ledger WHERE client_id = 7`)).toBe(0);
  });

  it("void of the discounted repayment nets debt, drawers, profit and coverage to 0 (FR-007)", () => {
    const before = snapshotLedgers(db);
    const sideBefore = side();
    const res = service.addRepayment({ ...addRepaymentSchema.parse(payload(5)), userId: 1 });
    expect(res).toMatchObject({ success: true });
    const txnId = num(
      `SELECT id AS v FROM transactions WHERE type = 'DEBT_REPAYMENT' AND source_table = 'debt_ledger' AND source_id = ?`,
      res.id,
    );
    getTransactionRepository().voidTransaction(txnId, 1);
    expectPostings(before, snapshotLedgers(db), {});
    expect(side()).toEqual(sideBefore);
  });
});

/**
 * LBP side of decisions A and B (per currency). Written AFTER the fix —
 * rule 17: not proven failing-first.
 */
describe("LIRA-372 — Debts Repay discount in LBP (per currency)", () => {
  beforeEach(() => {
    addClient(db, 8, "Lira Client", "03202020");
    seedChargeDebt(db, {
      clientId: 8,
      debtType: "Custom Service Debt",
      txnType: "CUSTOM_SERVICE",
      lbp: 1_000_000,
      profitUsd: 0,
    });
  });

  function lbpPayload(discountLbp: number) {
    const paid = 1_000_000 - Math.min(discountLbp, 450_000);
    const input: z.input<typeof addRepaymentSchema> = {
      clientId: 8,
      amountUSD: 0,
      amountLBP: paid,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: paid }],
      discount: { amount_usd: 0, amount_lbp: discountLbp, reason: "rounded" },
      tender_exchange_rate: RATE,
    };
    return input;
  }

  it("DebtService.addRepayment refuses a 450,001 LBP discount: { success: false }, nothing written", () => {
    const before = snapshotLedgers(db);
    const res = service.addRepayment({ ...lbpPayload(450_001), userId: 1 } as Parameters<
      DebtService["addRepayment"]
    >[0]);
    expect(res.success).toBe(false);
    expect(res.error).toContain("450,000 LBP");
    expectPostings(before, snapshotLedgers(db), {});
  });

  it("600,000 LBP + 400,000 LBP discount, then refund: debt, drawers, profit and coverage net to 0", () => {
    const before = snapshotLedgers(db);
    const sideBefore = side();
    const res = service.addRepayment({
      ...addRepaymentSchema.parse(lbpPayload(400_000)),
      userId: 1,
    });
    expect(res).toMatchObject({ success: true });
    expect(
      num(`SELECT SUM(amount_lbp) AS v FROM debt_ledger WHERE client_id = 8`),
    ).toBe(0);
    expect(
      num(
        `SELECT profit_lbp AS v FROM transactions WHERE type = 'COUNTERPARTY_DISCOUNT' AND client_id = 8`,
      ),
    ).toBe(-400_000);
    const txnId = num(
      `SELECT id AS v FROM transactions WHERE type = 'DEBT_REPAYMENT' AND source_table = 'debt_ledger' AND source_id = ?`,
      res.id,
    );
    getTransactionRepository().refundTransaction(txnId, 1);
    expectPostings(before, snapshotLedgers(db), {});
    expect(side()).toEqual(sideBefore);
  });
});

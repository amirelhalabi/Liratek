/**
 * LIRA-308 owner answer 2 (2026-10-11) — the posting side of the
 * "Earlier balance (no items)" line: a client's balance that no listed item
 * accounts for (manual / imported / opening debt).
 *
 *  - `findOpenDebtItems` lists it as its own line (kind "balance") when the
 *    client also has listed items, so ticking everything = the whole
 *    balance; a client with ONLY such debt keeps today's no-picker flow;
 *  - `addRepayment` accepts it as a target and pays it in the ticked order,
 *    with the gap measured BEFORE this repayment's own ledger row;
 *  - ticked alone, its cash pays no listed item and is not routed into the
 *    primary cash drawer;
 *  - a bundled discount follows the same targets;
 *  - void and refund net the ledger and every drawer back to zero (rule 20:
 *    the line has no row of its own — the repayment's void owns it).
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  seedTransferDebt,
  seedChargeDebt,
  drawers,
  drawerDelta,
  nextTime,
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
import type { DebtItemRef } from "../../utils/debtRepaymentAllocation";

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

const BAL: DebtItemRef = { kind: "balance", id: 1 };

/** A 'Manual Debt' row (no transaction, no item) — e.g. an opening balance. */
function seedManualDebt(usd: number, lbp = 0): number {
  return Number(
    db
      .prepare(
        `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp,
           created_by, created_at)
         VALUES (1, 7, 'Manual Debt', ?, ?, 1, ?)`,
      )
      .run(usd, lbp, nextTime()).lastInsertRowid,
  );
}

function repay(o: {
  usd: number;
  targets?: DebtItemRef[];
  discount?: { amount_usd: number; amount_lbp: number };
}): number {
  const data = {
    client_id: 7,
    amount_usd: o.usd,
    amount_lbp: 0,
    created_by: 1,
    payments: [{ method: "CASH", currencyCode: "USD", amount: o.usd }],
    tender_exchange_rate: RATE,
    ...(o.targets ? { targets: o.targets } : {}),
    ...(o.discount ? { discount: o.discount } : {}),
  } as unknown as CreateRepaymentData;
  return repo.addRepayment(data).id;
}

const coveredUsd = (debtRowId: number): number =>
  (
    db
      .prepare(`SELECT covered_usd FROM debt_ledger WHERE id = ?`)
      .get(debtRowId) as { covered_usd: number }
  ).covered_usd;

const balance = (): { usd: number; lbp: number } =>
  db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
       FROM debt_ledger WHERE client_id = 7`,
    )
    .get() as { usd: number; lbp: number };

const repaymentTxnId = (ledgerId: number): number =>
  (
    db
      .prepare(
        `SELECT id FROM transactions WHERE source_table = 'debt_ledger' AND source_id = ? AND type = 'DEBT_REPAYMENT'`,
      )
      .get(ledgerId) as { id: number }
  ).id;

describe("findOpenDebtItems — the earlier-balance line", () => {
  it("manual $30 + a $20 Loto charge → a 'balance' line of $30 next to the charge", () => {
    seedManualDebt(30);
    seedChargeDebt(db, {
      clientId: 7,
      debtType: "Loto Debt",
      txnType: "LOTO",
      usd: 20,
    });
    const items = repo.findOpenDebtItems(7);
    const bal = items.find((i) => i.kind === "balance");
    expect(bal).toMatchObject({
      id: 1,
      openUsd: 30,
      openLbp: 0,
      label: "Earlier balance (no items)",
      isPrimary: false,
    });
    // Every line together = the whole balance.
    expect(items.reduce((s, i) => s + i.openUsd, 0)).toBeCloseTo(
      balance().usd,
      2,
    );
  });

  it("no manual debt → no balance line", () => {
    seedChargeDebt(db, {
      clientId: 7,
      debtType: "Loto Debt",
      txnType: "LOTO",
      usd: 20,
    });
    expect(repo.findOpenDebtItems(7).some((i) => i.kind === "balance")).toBe(
      false,
    );
  });

  it("only manual debt → no lines at all (today's no-picker repayment)", () => {
    seedManualDebt(30);
    expect(repo.findOpenDebtItems(7)).toEqual([]);
  });
});

describe("addRepayment — the earlier-balance line as a target", () => {
  it("ticked alone, $30 cash: the unticked OMT transfer is not paid and nothing moves to OMT_System", () => {
    seedManualDebt(30);
    const omt = seedTransferDebt(db, {
      clientId: 7,
      provider: "OMT",
      usd: 101,
    });
    const before = drawers(db);
    repay({ usd: 30, targets: [BAL] });
    expect(coveredUsd(omt.debtRowId)).toBe(0);
    expect(drawerDelta(before, drawers(db))).toEqual({ "General|USD": 30 });
    expect(balance().usd).toBeCloseTo(101, 2);
  });

  it("ticked with a newer Loto charge, $40: the balance (oldest) takes $30, the charge $10", () => {
    seedManualDebt(30);
    const loto = seedChargeDebt(db, {
      clientId: 7,
      debtType: "Loto Debt",
      txnType: "LOTO",
      usd: 20,
    });
    repay({ usd: 40, targets: [{ kind: "charge", id: loto.debtRowId }, BAL] });
    expect(coveredUsd(loto.debtRowId)).toBeCloseTo(10, 2);
  });

  it("refused when there is no earlier balance left", () => {
    seedChargeDebt(db, {
      clientId: 7,
      debtType: "Loto Debt",
      txnType: "LOTO",
      usd: 20,
    });
    expect(() => repay({ usd: 10, targets: [BAL] })).toThrow(/no longer open/);
  });

  it("a bundled discount follows the same ticks: $10 cash + $20 discount on the balance leaves the charge open", () => {
    seedManualDebt(30);
    const loto = seedChargeDebt(db, {
      clientId: 7,
      debtType: "Loto Debt",
      txnType: "LOTO",
      usd: 20,
    });
    repay({
      usd: 10,
      targets: [BAL],
      discount: { amount_usd: 20, amount_lbp: 0 },
    });
    expect(coveredUsd(loto.debtRowId)).toBe(0);
    expect(balance().usd).toBeCloseTo(20, 2);
  });

  it.each(["void", "refund"] as const)(
    "%s of a balance repayment nets the ledger and every drawer back to zero",
    (how) => {
      seedManualDebt(30);
      const omt = seedTransferDebt(db, {
        clientId: 7,
        provider: "OMT",
        usd: 101,
      });
      const ledgerBefore = balance();
      const before = drawers(db);
      const id = repay({
        usd: 50,
        targets: [BAL, { kind: "charge", id: omt.debtRowId }],
      });
      const txnId = repaymentTxnId(id);
      if (how === "void") getTransactionRepository().voidTransaction(txnId, 1);
      else getTransactionRepository().refundTransaction(txnId, 1);
      expect(balance().usd).toBeCloseTo(ledgerBefore.usd, 2);
      expect(balance().lbp).toBeCloseTo(ledgerBefore.lbp, 0);
      expect(coveredUsd(omt.debtRowId)).toBeCloseTo(0, 2);
      for (const v of Object.values(drawerDelta(before, drawers(db)))) {
        expect(v).toBeCloseTo(0, 2);
      }
    },
  );
});

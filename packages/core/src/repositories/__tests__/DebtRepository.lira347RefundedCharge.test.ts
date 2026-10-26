/**
 * LIRA-347 D4 (owner 2026-10-26, "fix first") — a refunded / voided
 * non-basket charge must stop counting as an open debt item.
 *
 * Before the fix, `coverageOutstandingSql` measured a charge as
 * `amount − covered` and never subtracted the 'Refund Reversal' row the
 * generic void / refund writes on the same transaction (`_cancelDebt`);
 * `debt_ledger.is_refunded` is never set on a module charge (the void marks
 * the transaction's own source table). So the refunded charge stayed in the
 * repayment screen's list, the page ticked it with everything else, and a
 * later repayment covered it instead of the client's real debt.
 *
 * Owner repro: $50 'Service Debt' on 10 Oct, refunded; a $50 sale on 12 Oct;
 * the client repays $50 → it must pay the 12 Oct sale.
 *
 * Failing-first (rule 17): written and run against the unfixed code first.
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  seedTransferDebt,
  seedChargeDebt,
  seedSaleDebt,
  RATE,
} from "../testHelpers/debtItemDb";
import { DebtRepository } from "../DebtRepository";
import {
  getTransactionRepository,
  resetTransactionRepository,
} from "../TransactionRepository";
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

function setDay(debtRowId: number, txnId: number, day: string): void {
  const at = `${day} 09:00:00`;
  db.prepare(`UPDATE debt_ledger SET created_at = ? WHERE id = ?`).run(
    at,
    debtRowId,
  );
  db.prepare(`UPDATE transactions SET created_at = ? WHERE id = ?`).run(
    at,
    txnId,
  );
}

/** $50 charge on 10 Oct (reversed by `how`), $50 sale on 12 Oct. */
function seed(
  how: "refund" | "void",
  charge: "transfer" | "custom" = "transfer",
) {
  const c =
    charge === "transfer"
      ? seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 50 })
      : seedChargeDebt(db, {
          clientId: 7,
          debtType: "Custom Service Debt",
          txnType: "CUSTOM_SERVICE",
          usd: 50,
        });
  setDay(c.debtRowId, c.txnId, "2026-10-10");
  const sale = seedSaleDebt(db, { clientId: 7, usd: 50 });
  setDay(sale.debtRowId, sale.txnId, "2026-10-12");
  db.prepare(`UPDATE sales SET created_at = ? WHERE id = ?`).run(
    "2026-10-12 09:00:00",
    sale.saleId,
  );
  if (how === "refund") getTransactionRepository().refundTransaction(c.txnId, 1);
  else getTransactionRepository().voidTransaction(c.txnId, 1);
  return { charge: c, sale };
}

function chargeCovered(id: number): number {
  return (
    db.prepare(`SELECT covered_usd FROM debt_ledger WHERE id = ?`).get(id) as {
      covered_usd: number;
    }
  ).covered_usd;
}
function salePaid(id: number): number {
  return (
    db.prepare(`SELECT paid_usd FROM sales WHERE id = ?`).get(id) as {
      paid_usd: number;
    }
  ).paid_usd;
}

describe("LIRA-347 D4 — a refunded / voided charge is not an open debt item", () => {
  it.each([
    ["refunded OMT transfer", "refund", "transfer"],
    ["voided OMT transfer", "void", "transfer"],
    ["refunded custom service", "refund", "custom"],
  ] as const)("%s is not listed as open", (_n, how, kind) => {
    const { charge, sale } = seed(how, kind);
    const items = repo.findOpenDebtItems(7);
    expect(
      items.some((i) => i.kind === "charge" && i.id === charge.debtRowId),
    ).toBe(false);
    expect(items.some((i) => i.kind === "sale" && i.id === sale.saleId)).toBe(
      true,
    );
  });

  it.each([
    ["refund", "transfer"],
    ["void", "transfer"],
    ["refund", "custom"],
  ] as const)(
    "%s %s: repaying $50 with every listed item ticked pays the 12 Oct sale",
    (how, kind) => {
      const { charge, sale } = seed(how, kind);
      // Exactly what the page sends: every listed item ticked on open.
      const targets = repo
        .findOpenDebtItems(7)
        .map((i) => ({ kind: i.kind, id: i.id }));
      repo.addRepayment({
        client_id: 7,
        amount_usd: 50,
        amount_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 50 }],
        tender_exchange_rate: RATE,
        targets,
      });
      expect(salePaid(sale.saleId)).toBeCloseTo(50, 2);
      expect(chargeCovered(charge.debtRowId)).toBe(0);
    },
  );

  it("a refunded charge cannot be ticked (refused, nothing written)", () => {
    const { charge } = seed("refund");
    const before = db.prepare(`SELECT COUNT(*) AS n FROM debt_ledger`).get();
    expect(() =>
      repo.addRepayment({
        client_id: 7,
        amount_usd: 50,
        amount_lbp: 0,
        created_by: 1,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 50 }],
        tender_exchange_rate: RATE,
        targets: [{ kind: "charge", id: charge.debtRowId }],
      }),
    ).toThrow(/no longer open/);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM debt_ledger`).get()).toEqual(
      before,
    );
  });

  it("a charge that is NOT reversed stays open (control)", () => {
    const c = seedTransferDebt(db, { clientId: 7, provider: "OMT", usd: 50 });
    const items = repo.findOpenDebtItems(7);
    expect(items.some((i) => i.kind === "charge" && i.id === c.debtRowId)).toBe(
      true,
    );
  });
});

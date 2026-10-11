/**
 * LIRA-306 T061 — pins TODAY's behaviour (not a failing-first guard): an
 * untargeted repayment larger than the client's open balance. The offline
 * "ticks dropped" retry (FR-029, O-new-3) rebooks a repayment without its
 * ticks and relies on exactly this behaviour for the extra.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { getDebtService, resetDebtService } from "../../services/DebtService";
import { resetDebtRepository } from "../DebtRepository";
import { installReplayDb, uninstallReplayDb } from "../../offline/testHelpers/replayHarness";

let db: Database.Database;
beforeEach(() => {
  resetDebtService();
  resetDebtRepository();
  ({ db } = installReplayDb());
  db.exec(`
    INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (50, 1, 'Owes 10', '70000050');
    INSERT INTO debt_ledger (id, tenant_id, client_id, transaction_type, amount_usd, amount_lbp, note, created_by)
      VALUES (50, 1, 50, 'Manual Debt', 10, 0, 'seeded', 1);
  `);
});
afterEach(() => uninstallReplayDb(db));

describe("DebtRepository — repayment above the open balance (today)", () => {
  it("is accepted; the extra becomes credit (the client's balance goes below zero)", () => {
    const r = runWithTenant(1, () =>
      getDebtService().addRepayment({ clientId: 50, amountUSD: 15, payments: [{ method: "CASH", currencyCode: "USD", amount: 15 }], userId: 1 } as never),
    );
    expect(r.success).toBe(true);
    const bal = db.prepare(`SELECT ROUND(SUM(amount_usd), 2) AS usd FROM debt_ledger WHERE client_id = 50`).get() as { usd: number };
    expect(bal.usd).toBe(-5);
  });
});

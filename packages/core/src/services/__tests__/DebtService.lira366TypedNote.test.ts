/**
 * LIRA-366 (T022) — the cashier's typed note on a debt repayment. The
 * Debts page switches its existing note box to send `typedNote`; the
 * repayment's ledger row and its transaction's `details.note` must both
 * carry it (rule 23, reverse: a key the schema accepts must be read).
 * An old payload that still sends `note` keeps today's behaviour.
 *
 * Money as ledger deltas (rule 15); payload parsed by the real schema
 * (rule 24). Rule 17: seen failing before the service read `typedNote`.
 */
import Database from "better-sqlite3";
import { DebtService } from "../DebtService.js";
import { DebtRepository } from "../../repositories/DebtRepository.js";
import { resetTransactionRepository } from "../../repositories/TransactionRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";
import { buildDb, fundDrawer } from "../../repositories/testHelpers/omtAccountDb.js";
import { addRepaymentSchema } from "../../validators/debt.js";

const TYPED = "paid for his brother";

let db: Database.Database;
let service: DebtService;
let clientId: number;

beforeEach(() => {
  resetTransactionRepository();
  db = buildDb();
  initFixedTenantContext(1);
  fundDrawer(db, "General", "USD", 0);
  clientId = Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Repay Client', '70111222')`,
      )
      .run().lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp, created_by)
     VALUES (1, ?, 'Sale Debt', 50, 0, 1)`,
  ).run(clientId);
  service = new DebtService(new DebtRepository());
});

afterEach(() => {
  resetTenantContext();
  resetTransactionRepository();
  db.close();
});

const owed = () =>
  (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount_usd),0) AS usd FROM debt_ledger WHERE client_id = ?`,
      )
      .get(clientId) as { usd: number }
  ).usd;

function repay(extra: Record<string, unknown>) {
  const result = service.addRepayment({
    ...addRepaymentSchema.parse({
      clientId,
      amountUSD: 20,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
      ...extra,
    }),
    userId: 1,
  });
  expect(result.success).toBe(true);
  const ledger = db
    .prepare(`SELECT note, transaction_id FROM debt_ledger WHERE id = ?`)
    .get(result.id) as { note: string | null; transaction_id: number };
  const txn = db
    .prepare(`SELECT metadata_json FROM transactions WHERE id = ?`)
    .get(ledger.transaction_id) as { metadata_json: string };
  const details = (
    JSON.parse(txn.metadata_json) as { details: Record<string, unknown> }
  ).details;
  return { ledgerNote: ledger.note, details };
}

describe("LIRA-366 — typed note on a debt repayment", () => {
  it("typedNote reaches the repayment row and details.note; debt falls by $20", () => {
    const before = owed();
    const { ledgerNote, details } = repay({ typedNote: ` ${TYPED} ` });
    expect(owed() - before).toBeCloseTo(-20, 6);
    expect(ledgerNote).toBe(TYPED);
    expect(details.note).toBe(TYPED);
  });

  it("an old payload with only `note` is unchanged", () => {
    const { ledgerNote, details } = repay({ note: "old box" });
    expect(ledgerNote).toBe("old box");
    expect(details.note).toBe("old box");
  });
});

/**
 * LIRA-339 (T008) — the ONE 'Refund Reversal' insert, shared by the generic
 * `_cancelDebt` and the voucher cancel (rule 14). Written before the helper
 * exists (rule 17).
 */
import Database from "better-sqlite3";
import { bookClientDebtCharge } from "../moneyPosting";
import { insertDebtRefundReversal } from "../debtReversal";

function createDebtLedgerDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE debt_ledger (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id        INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_usd       DECIMAL(10, 2),
      amount_lbp       DECIMAL(15, 2),
      transaction_id   INTEGER,
      due_date         TEXT,
      note             TEXT,
      created_by       INTEGER,
      tenant_id        INTEGER,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

describe("insertDebtRefundReversal", () => {
  it("writes one negated 'Refund Reversal' on the charge's transaction, netting the charge to 0 per currency", () => {
    const db = createDebtLedgerDb();
    bookClientDebtCharge(db, {
      clientId: 7,
      transactionType: "Voucher Debt",
      amountUsd: 30,
      amountLbp: 0,
      transactionId: 41,
      tenantId: 1,
    });
    bookClientDebtCharge(db, {
      clientId: 7,
      transactionType: "Voucher Debt",
      amountUsd: 0,
      amountLbp: 900000,
      transactionId: 41,
      tenantId: 1,
    });
    for (const charge of db
      .prepare(`SELECT * FROM debt_ledger WHERE transaction_type = 'Voucher Debt'`)
      .all() as Array<{ client_id: number; amount_usd: number; amount_lbp: number }>) {
      insertDebtRefundReversal(db, {
        clientId: charge.client_id,
        amountUsd: charge.amount_usd,
        amountLbp: charge.amount_lbp,
        transactionId: 41,
        createdBy: 5,
        tenantId: 1,
      });
    }
    const reversals = db
      .prepare(
        `SELECT client_id, amount_usd, amount_lbp, transaction_id, note, created_by, tenant_id
           FROM debt_ledger WHERE transaction_type = 'Refund Reversal' ORDER BY id`,
      )
      .all()
      .map((r) => {
        const row = r as Record<string, number | string>;
        // -0 and 0 are the same money; normalise for comparison.
        return { ...row, amount_usd: Number(row.amount_usd) + 0, amount_lbp: Number(row.amount_lbp) + 0 };
      });
    expect(reversals).toEqual([
      { client_id: 7, amount_usd: -30, amount_lbp: 0, transaction_id: 41, note: "Debt cancelled by refund/void", created_by: 5, tenant_id: 1 },
      { client_id: 7, amount_usd: 0, amount_lbp: -900000, transaction_id: 41, note: "Debt cancelled by refund/void", created_by: 5, tenant_id: 1 },
    ]);
    const net = db
      .prepare(
        `SELECT SUM(amount_usd) AS usd, SUM(amount_lbp) AS lbp FROM debt_ledger WHERE client_id = 7`,
      )
      .get();
    expect(net).toEqual({ usd: 0, lbp: 0 });
  });
});

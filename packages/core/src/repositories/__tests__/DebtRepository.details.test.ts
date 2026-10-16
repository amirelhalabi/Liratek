/**
 * LIRA-329 T032 — a debts / accounts entry keeps what the cashier entered on
 * its own transaction: what kind of entry it is, the note in full (it lived
 * only on the debt ledger and payments.note), the debt items the cashier
 * ticked, a bundled discount as typed and its reason, the client's name and
 * phone (the columns were empty; the name sat only in metadata
 * `counterparty`), and how it was paid.
 *
 * Money columns are asserted FIRST at today's values (FR-008). Expected
 * details go through the kind's own schema (rule 24). Rule 17: run before
 * the builder existed and seen failing.
 *
 * Real schema: create_db.sql (installed as the process test database).
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  seedChargeDebt,
  RATE,
} from "../testHelpers/debtItemDb";
import { DebtRepository, type CreateRepaymentData } from "../DebtRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetSettingsRepository } from "../SettingsRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetClientRepository } from "../ClientRepository";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  accountEntryDetailsSchema,
  paymentSnapshotSchema,
} from "../../validators/transactionDetails";
import { expectEverySnapshotMatchesPayments } from "../testHelpers/paymentSnapshotAssert";

const CLIENT = { id: 7, name: "Claude Demo", phone: "03101010" };
const NOTE =
  "Paid at the counter by his brother; he will bring the rest of the balance on Friday after work";

interface TxnRow {
  id: number;
  type: string;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  client_id: number | null;
  client_name: string | null;
  client_phone: string | null;
  metadata_json: string;
}

function txnById(db: Database.Database, id: number): TxnRow {
  return db
    .prepare(
      `SELECT id, type, amount_usd, amount_lbp, profit_usd, client_id, client_name,
              client_phone, metadata_json
         FROM transactions WHERE id = ?`,
    )
    .get(id) as TxnRow;
}

function txnOfLedger(db: Database.Database, ledgerId: number): TxnRow {
  const { transaction_id } = db
    .prepare(`SELECT transaction_id FROM debt_ledger WHERE id = ?`)
    .get(ledgerId) as { transaction_id: number };
  return txnById(db, transaction_id);
}

function latestOfType(db: Database.Database, type: string): TxnRow {
  const { id } = db
    .prepare(
      `SELECT id FROM transactions WHERE type = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(type) as { id: number };
  return txnById(db, id);
}

function meta(row: TxnRow): Record<string, unknown> {
  return JSON.parse(row.metadata_json) as Record<string, unknown>;
}

function expectDetails(row: TxnRow, expected: Record<string, unknown>): void {
  expect(accountEntryDetailsSchema.parse(expected)).toEqual(expected);
  expect(meta(row).details).toEqual(expected);
}

function expectSnapshot(row: TxnRow, expected: Record<string, unknown>): void {
  expect(paymentSnapshotSchema.parse(expected)).toEqual(expected);
  expect(meta(row).payment_snapshot).toEqual(expected);
}

function expectClient(row: TxnRow): void {
  expect(row).toMatchObject({
    client_id: CLIENT.id,
    client_name: CLIENT.name,
    client_phone: CLIENT.phone,
  });
}

describe("LIRA-329 — DebtRepository: account_entry details", () => {
  let db: Database.Database;
  let repo: DebtRepository;

  beforeEach(() => {
    db = installDebtItemTestDb();
    initFixedTenantContext(1);
    resetTransactionRepository();
    resetSettingsRepository();
    resetPaymentMethodRepository();
    resetClientRepository();
    repo = new DebtRepository();
    addClient(db, CLIENT.id, CLIENT.name, CLIENT.phone);
  });

  // LIRA-329 T036 — every payment snapshot saved by a case above equals
  // the payments rows it booked (method, currency, amount, direction).
  afterEach(() => {
    expectEverySnapshotMatchesPayments(db);
  });

  afterEach(() => {
    resetTransactionRepository();
    resetTenantContext();
    uninstallDebtItemTestDb(db);
  });

  it("a repayment keeps the note, the ticked items, the typed discount and the client; its discount keeps the reason", () => {
    const charge = seedChargeDebt(db, {
      clientId: CLIENT.id,
      debtType: "Loto Debt",
      txnType: "LOTO",
      usd: 50,
    });
    const ledgerId = repo.addRepayment({
      client_id: CLIENT.id,
      amount_usd: 30,
      amount_lbp: 0,
      note: NOTE,
      created_by: 1,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 30 }],
      tender_exchange_rate: RATE,
      targets: [{ kind: "charge", id: charge.debtRowId }],
      discount: { amount_usd: 5, amount_lbp: 0, reason: "goodwill" },
    } as CreateRepaymentData).id;

    const row = txnOfLedger(db, ledgerId);
    expect(row).toMatchObject({
      type: "DEBT_REPAYMENT",
      amount_usd: 30,
      profit_usd: 0,
    });
    expectClient(row);
    expectDetails(row, {
      v: 1,
      kind: "account_entry",
      action: "REPAYMENT",
      note: NOTE,
      targets: [{ type: "charge", id: charge.debtRowId }],
      discount: { amount: 5, currency: "USD" },
    });
    expectSnapshot(row, {
      lines: [{ method: "CASH", currency: "USD", amount: 30, direction: "IN" }],
    });

    const discount = latestOfType(db, "COUNTERPARTY_DISCOUNT");
    expect(discount).toMatchObject({ amount_usd: 0, profit_usd: -5 });
    expectClient(discount);
    expectDetails(discount, {
      v: 1,
      kind: "account_entry",
      action: "WRITE_OFF",
      note: "goodwill",
      targets: [{ type: "charge", id: charge.debtRowId }],
    });
  });

  it("a stand-alone write-off keeps its reason and the client", () => {
    seedChargeDebt(db, {
      clientId: CLIENT.id,
      debtType: "Loto Debt",
      txnType: "LOTO",
      usd: 50,
    });
    const txnId = repo.writeOffDebt({
      client_id: CLIENT.id,
      amount_usd: 10,
      amount_lbp: 0,
      reason: "moved abroad, will not come back",
      created_by: 1,
    }).id;
    const row = txnById(db, txnId);
    expect(row).toMatchObject({
      type: "COUNTERPARTY_DISCOUNT",
      amount_usd: 0,
      profit_usd: -10,
    });
    expectClient(row);
    expectDetails(row, {
      v: 1,
      kind: "account_entry",
      action: "WRITE_OFF",
      note: "moved abroad, will not come back",
    });
  });

  it("a credit cash-out keeps the note, the payout lines and the client", () => {
    repo.addAccountCashEntry({
      direction: "credit",
      client_id: CLIENT.id,
      amount_usd: 40,
      amount_lbp: 0,
      created_by: 1,
    });
    const ledgerId = repo.cashOutCredit({
      client_id: CLIENT.id,
      amount_usd: 20,
      amount_lbp: 0,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 20 }],
      note: "needed cash for the doctor",
      created_by: 1,
    }).id;
    const row = txnOfLedger(db, ledgerId);
    expect(row).toMatchObject({ type: "CREDIT_CASH_OUT", amount_usd: 20 });
    expectClient(row);
    expectDetails(row, {
      v: 1,
      kind: "account_entry",
      action: "CREDIT_CASH_OUT",
      note: "needed cash for the doctor",
    });
    expectSnapshot(row, {
      lines: [
        { method: "CASH", currency: "USD", amount: 20, direction: "OUT" },
      ],
    });
  });

  it("a note left empty is not replaced by the screen's default wording", () => {
    repo.addAccountCashEntry({
      direction: "credit",
      client_id: CLIENT.id,
      amount_usd: 40,
      amount_lbp: 0,
      created_by: 1,
    });
    const ledgerId = repo.cashOutCredit({
      client_id: CLIENT.id,
      amount_usd: 20,
      amount_lbp: 0,
      created_by: 1,
    }).id;
    expectDetails(txnOfLedger(db, ledgerId), {
      v: 1,
      kind: "account_entry",
      action: "CREDIT_CASH_OUT",
    });
  });

  it("add credit / add debt keep the action, the note and the lines; a paper entry is an adjustment with no lines", () => {
    const creditId = repo.addAccountCashEntry({
      direction: "credit",
      client_id: CLIENT.id,
      amount_usd: 0,
      amount_lbp: 900000,
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 900000 }],
      note: "left with us for next month's recharge",
      created_by: 1,
    }).id;
    const credit = txnOfLedger(db, creditId);
    expect(credit).toMatchObject({
      type: "CREDIT_CASH_IN",
      amount_lbp: 900000,
    });
    expectClient(credit);
    expectDetails(credit, {
      v: 1,
      kind: "account_entry",
      action: "CREDIT_CASH_IN",
      note: "left with us for next month's recharge",
    });
    expectSnapshot(credit, {
      lines: [
        { method: "CASH", currency: "LBP", amount: 900000, direction: "IN" },
      ],
    });

    const debtId = repo.addAccountCashEntry({
      direction: "debt",
      client_id: CLIENT.id,
      amount_usd: 15,
      amount_lbp: 0,
      note: "cash advance for the taxi",
      created_by: 1,
    }).id;
    const debt = txnOfLedger(db, debtId);
    expect(debt).toMatchObject({ type: "DEBT_CASH_OUT", amount_usd: 15 });
    expectDetails(debt, {
      v: 1,
      kind: "account_entry",
      action: "DEBT_CASH_OUT",
      note: "cash advance for the taxi",
    });

    const paperId = repo.addAccountCashEntry({
      direction: "debt",
      client_id: CLIENT.id,
      amount_usd: 7,
      amount_lbp: 0,
      note: "old balance from the notebook",
      created_by: 1,
      move_cash: false,
    }).id;
    const paper = txnOfLedger(db, paperId);
    expect(paper).toMatchObject({
      type: "ACCOUNT_ADJUSTMENT",
      amount_usd: 7,
    });
    expectClient(paper);
    expectDetails(paper, {
      v: 1,
      kind: "account_entry",
      action: "ADJUSTMENT",
      note: "old balance from the notebook",
    });
    expect(meta(paper).payment_snapshot).toBeUndefined();
  });
});

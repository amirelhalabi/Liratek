/**
 * LIRA-366 (T020) — the cashier's typed note on a Mobile Recharge / OMT /
 * Whish money-in entry. Sent as `typedNote` (the old `note` keeps generated
 * labels such as the selected Katsh items):
 *   - the transaction's `details.note` is the typed note;
 *   - the module `note` column is `typedNote ?? note`;
 *   - a part charged to the customer's account carries the note at the end
 *     of its debt note (`withTypedNote`);
 *   - a History edit of the note updates the transaction and the debt
 *     charge row together (rule 31, `syncTypedNote`).
 *
 * Money is asserted as ledger deltas (rule 15): the note moves no money.
 * Payloads are parsed through the real schema (rule 24).
 * Rule 17: seen failing before the repository read `typedNote`.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  FinancialServiceRepository,
  resetFinancialServiceRepository,
  type CreateFinancialServiceData,
} from "../FinancialServiceRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetSupplierRepository } from "../SupplierRepository";
import { buildDb, fundDrawer } from "../testHelpers/omtAccountDb";
import { createFinancialServiceSchema } from "../../validators/financial";
import { withTypedNote } from "../../utils/typedNote";

const TYPED = "rest on Monday";

function txnOf(db: Database.Database, fsId: number) {
  return db
    .prepare(
      `SELECT id, metadata_json FROM transactions
        WHERE source_table = 'financial_services' AND source_id = ?
          AND type = 'FINANCIAL_SERVICE' AND reverses_id IS NULL`,
    )
    .get(fsId) as { id: number; metadata_json: string };
}
const detailsOf = (db: Database.Database, fsId: number) =>
  (
    JSON.parse(txnOf(db, fsId).metadata_json) as {
      details: Record<string, unknown>;
    }
  ).details;
const debtRows = (db: Database.Database, txnId: number) =>
  db
    .prepare(
      `SELECT note, amount_usd, amount_lbp FROM debt_ledger
        WHERE transaction_id = ? AND transaction_type LIKE '% Debt' ORDER BY id`,
    )
    .all(txnId) as { note: string; amount_usd: number; amount_lbp: number }[];
const debtTotal = (db: Database.Database) =>
  db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd),0) AS usd, COALESCE(SUM(amount_lbp),0) AS lbp FROM debt_ledger`,
    )
    .get() as { usd: number; lbp: number };

/** A payload exactly as the schema hands it to the repository. */
const parsed = (input: Record<string, unknown>) =>
  createFinancialServiceSchema.parse(input) as unknown as CreateFinancialServiceData;

describe("LIRA-366 — typed note on financial services", () => {
  let db: Database.Database;
  let repo: FinancialServiceRepository;
  let clientId: number;

  beforeEach(() => {
    resetFinancialServiceRepository();
    resetTransactionRepository();
    resetSupplierRepository();
    db = buildDb();
    initFixedTenantContext(1);
    for (const d of ["General", "OMT_System", "Whish_App", "Katsh"]) {
      fundDrawer(db, d, "USD", 10000);
      fundDrawer(db, d, "LBP", 500_000_000);
    }
    clientId = Number(
      db
        .prepare(
          `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Hassan Ali', '76000111')`,
        )
        .run().lastInsertRowid,
    );
    repo = new FinancialServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const katshOnAccount = (typedNote?: string) =>
    repo.createTransaction(
      parsed({
        provider: "Katsh",
        serviceType: "SEND",
        amount: 150_000,
        cost: 119_617,
        currency: "LBP",
        commission: 30_383,
        itemKey: "mtc_prepaid_1",
        note: "MTC Prepaid 1",
        clientId,
        clientName: "Hassan Ali",
        phoneNumber: "76000111",
        paidByMethod: "CUSTOMER_ACCOUNT",
        exchangeRate: 90_000,
        ...(typedNote !== undefined ? { typedNote } : {}),
      }),
    );

  it("schema keeps typedNote (trimmed); blank is dropped", () => {
    expect(
      createFinancialServiceSchema.parse({
        provider: "Katsh",
        serviceType: "SEND",
        amount: 1,
        typedNote: `  ${TYPED}  `,
      }).typedNote,
    ).toBe(TYPED);
    expect(
      createFinancialServiceSchema.parse({
        provider: "Katsh",
        serviceType: "SEND",
        amount: 1,
        typedNote: "   ",
      }).typedNote,
    ).toBeUndefined();
  });

  it("Katsh item on account: details.note, module note, debt note suffix; money unchanged", () => {
    const before = debtTotal(db);
    const { id } = katshOnAccount(TYPED);
    const after = debtTotal(db);
    expect(after.lbp - before.lbp).toBeCloseTo(150_000, 2);
    expect(after.usd - before.usd).toBe(0);

    expect(detailsOf(db, id).note).toBe(TYPED);
    const row = db
      .prepare(`SELECT note FROM financial_services WHERE id = ?`)
      .get(id) as { note: string };
    expect(row.note).toBe(TYPED);
    const debts = debtRows(db, txnOf(db, id).id);
    expect(debts).toHaveLength(1);
    expect(debts[0].note).toBe(
      withTypedNote("Katsh service: MTC Prepaid 1", TYPED),
    );
  });

  it("no typed note: the debt note is exactly as today", () => {
    const { id } = katshOnAccount();
    expect(debtRows(db, txnOf(db, id).id)[0].note).toBe(
      "Katsh service: MTC Prepaid 1",
    );
    expect(detailsOf(db, id)).not.toHaveProperty("note", TYPED);
  });

  it("OMT system SEND, $5 on account: the debt note ends with the typed note", () => {
    const { id } = repo.createTransaction(
      parsed({
        provider: "OMT",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 0,
        omtServiceType: "CASH_TO_BUSINESS",
        omtFee: 5,
        includingFees: false,
        referenceNumber: "R-366",
        clientId,
        clientName: "Hassan Ali",
        phoneNumber: "76000111",
        senderName: "Hassan Ali",
        senderPhone: "76000111",
        receiverName: "Sara Khoury",
        receiverPhone: "71987654",
        exchangeRate: 90_000,
        typedNote: TYPED,
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 100 },
          { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 5 },
        ],
      }),
    );
    expect(detailsOf(db, id).note).toBe(TYPED);
    const debts = debtRows(db, txnOf(db, id).id);
    expect(debts).toHaveLength(1);
    expect(debts[0].amount_usd).toBeCloseTo(5, 2);
    expect(debts[0].note.endsWith(` — ${TYPED}`)).toBe(true);
  });

  it("History edit swaps the note on the transaction and the debt charge row", () => {
    const { id } = katshOnAccount(TYPED);
    const txnId = txnOf(db, id).id;
    const moneyBefore = debtTotal(db);
    repo.updateMetadata(id, { note: "rest on Tuesday" }, "admin");
    expect(detailsOf(db, id).note).toBe("rest on Tuesday");
    expect(debtRows(db, txnId)[0].note).toBe(
      withTypedNote("Katsh service: MTC Prepaid 1", "rest on Tuesday"),
    );
    expect(debtTotal(db)).toEqual(moneyBefore);

    // Clearing the note removes it from both.
    repo.updateMetadata(id, { note: "" }, "admin");
    expect(detailsOf(db, id)).not.toHaveProperty("note");
    expect(debtRows(db, txnId)[0].note).toBe("Katsh service: MTC Prepaid 1");
  });
});

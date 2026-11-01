/**
 * LIRA-366 (T021) — the cashier's typed note on a custom service sale.
 * Sent as `typedNote` (the page switches its existing note box to it):
 *   - `details.note` is the typed note;
 *   - the module `note` column is `typedNote ?? note`;
 *   - the part charged to the customer's account carries the note at the
 *     end of its "Custom Service Debt" note (`withTypedNote`);
 *   - a History edit of the note updates the transaction and the debt
 *     charge row together (rule 31, `syncTypedNote`).
 *
 * Money as ledger deltas (rule 15); payloads parsed by the real schema
 * (rule 24). Rule 17: seen failing before the repository read `typedNote`.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { CustomServiceRepository } from "../CustomServiceRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetPartnerRepository } from "../PartnerRepository";
import { buildDb, fundDrawer, USER_ID } from "../testHelpers/omtAccountDb";
import { createCustomServiceSchema } from "../../validators/customService";
import { withTypedNote } from "../../utils/typedNote";

const TYPED = "rest on Monday";

describe("LIRA-366 — typed note on custom services", () => {
  let db: Database.Database;
  let repo: CustomServiceRepository;
  let clientId: number;

  beforeEach(() => {
    resetTransactionRepository();
    resetPartnerRepository();
    db = buildDb();
    initFixedTenantContext(1);
    fundDrawer(db, "General", "USD", 10000);
    clientId = Number(
      db
        .prepare(
          `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Rami Nasr', '70444555')`,
        )
        .run().lastInsertRowid,
    );
    repo = new CustomServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const txnOf = (serviceId: number) =>
    db
      .prepare(
        `SELECT id, metadata_json FROM transactions
          WHERE source_table = 'custom_services' AND source_id = ? AND reverses_id IS NULL`,
      )
      .get(serviceId) as { id: number; metadata_json: string };
  const detailsOf = (serviceId: number) =>
    (
      JSON.parse(txnOf(serviceId).metadata_json) as {
        details: Record<string, unknown>;
      }
    ).details;
  const debtRows = (txnId: number) =>
    db
      .prepare(
        `SELECT note, amount_usd FROM debt_ledger
          WHERE transaction_id = ? AND transaction_type = 'Custom Service Debt'`,
      )
      .all(txnId) as { note: string; amount_usd: number }[];
  const owed = () =>
    (
      db
        .prepare(`SELECT COALESCE(SUM(amount_usd),0) AS usd FROM debt_ledger`)
        .get() as { usd: number }
    ).usd;

  const sell = (typedNote?: string) => {
    const result = repo.createService(
      createCustomServiceSchema.parse({
        description: "Screen protector",
        cost_usd: 2,
        price_usd: 20,
        client_id: clientId,
        client_name: "Rami Nasr",
        phone_number: "70444555",
        ...(typedNote !== undefined ? { typedNote } : {}),
        payments: [
          { method: "CASH", currency_code: "USD", amount: 15 },
          { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 5 },
        ],
      }),
      USER_ID,
    );
    expect(result).toMatchObject({ success: true });
    return result.id as number;
  };

  it("$15 cash + $5 on account: note on details, module row and the $5 debt", () => {
    const before = owed();
    const id = sell(TYPED);
    expect(owed() - before).toBeCloseTo(5, 2);
    expect(detailsOf(id).note).toBe(TYPED);
    expect(
      (
        db.prepare(`SELECT note FROM custom_services WHERE id = ?`).get(id) as {
          note: string;
        }
      ).note,
    ).toBe(TYPED);
    const debts = debtRows(txnOf(id).id);
    expect(debts).toHaveLength(1);
    expect(debts[0].note).toBe(
      withTypedNote("Custom Service: Screen protector", TYPED),
    );
  });

  it("no typed note: debt note exactly as today", () => {
    const id = sell();
    expect(debtRows(txnOf(id).id)[0].note).toBe(
      "Custom Service: Screen protector",
    );
    expect(detailsOf(id)).not.toHaveProperty("note");
  });

  it("History edit swaps the note on the transaction and the debt row; money unchanged", () => {
    const id = sell(TYPED);
    const txnId = txnOf(id).id;
    const before = owed();
    repo.updateMetadata(id, { note: "rest on Tuesday" }, "admin");
    expect(detailsOf(id).note).toBe("rest on Tuesday");
    expect(debtRows(txnId)[0].note).toBe(
      withTypedNote("Custom Service: Screen protector", "rest on Tuesday"),
    );
    expect(owed()).toBeCloseTo(before, 6);
  });
});

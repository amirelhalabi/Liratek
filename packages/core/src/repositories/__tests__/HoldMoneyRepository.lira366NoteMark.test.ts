/**
 * LIRA-366 (T024) — Hold money keeps its own `notes` box (owner
 * 2026-11-01: no new box, no rename). Its transaction stores them as
 * `details.notes`, and the Transactions list mark reads them through
 * `noteOfDetails` — so a hold deposit gets the note mark with no change
 * to the repository, and existing rows show it too. This pins that link:
 * renaming the key on either side would silently drop the mark.
 *
 * Example: a customer leaves $100 with the shop, note "for his son".
 * Real schema: create_db.sql + migrations. Payload parsed by the real
 * schema (rule 24).
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { HoldMoneyRepository } from "../HoldMoneyRepository";
import { resetTransactionRepository } from "../TransactionRepository";
import { buildDb, fundDrawer, USER_ID } from "../testHelpers/omtAccountDb";
import { holdMoneyCreateSchema } from "../../validators/holdMoney";
import { noteOfDetails } from "../../utils/typedNote";

describe("LIRA-366 — a hold deposit's notes give the list its note mark", () => {
  let db: Database.Database;
  let repo: HoldMoneyRepository;

  beforeEach(() => {
    resetTransactionRepository();
    db = buildDb();
    initFixedTenantContext(1);
    fundDrawer(db, "General", "USD", 10000);
    repo = new HoldMoneyRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const holdDetails = (notes?: string) => {
    const result = repo.createHold(
      holdMoneyCreateSchema.parse({
        client_name: "Joe Haddad",
        phone_number: "70222333",
        usd_amount: 100,
        ...(notes !== undefined ? { notes } : {}),
        payments: [{ method: "CASH", currency_code: "USD", amount: 100 }],
      }),
      USER_ID,
    );
    expect(result).toMatchObject({ success: true });
    const row = db
      .prepare(
        `SELECT metadata_json FROM transactions WHERE type = 'HOLD_MONEY' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { metadata_json: string };
    return (JSON.parse(row.metadata_json) as { details: unknown }).details;
  };

  it("notes 'for his son' → noteOfDetails returns it", () => {
    expect(noteOfDetails(holdDetails("for his son"))).toBe("for his son");
  });

  it("no notes → no mark", () => {
    expect(noteOfDetails(holdDetails())).toBeNull();
  });
});

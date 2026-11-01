/**
 * LIRA-366 T006 — `syncTypedNote`, the one update owner (rule 31) for the
 * copies of a typed note: `details.note` on the transaction and the
 * " — <note>" suffix on its debt CHARGE rows. Reversal rows ("Refund
 * Reversal") are never touched; a debt note edited by hand (suffix gone) is
 * left alone.
 *
 * Not proven failing-first: written after `syncTypedNote` (T004).
 */
import type Database from "better-sqlite3";
import { syncTypedNote } from "../moneyPosting";
import { withTypedNote } from "../../utils/typedNote";
import {
  addClient,
  installDebtItemTestDb,
  seedSaleDebt,
  uninstallDebtItemTestDb,
} from "../testHelpers/debtItemDb";

const SYSTEM = "Sale #1: Charger — $20";

function debtNote(db: Database.Database, id: number): string | null {
  return (
    db.prepare(`SELECT note FROM debt_ledger WHERE id = ?`).get(id) as {
      note: string | null;
    }
  ).note;
}

function detailsNote(db: Database.Database, txnId: number): unknown {
  const row = db
    .prepare(`SELECT metadata_json FROM transactions WHERE id = ?`)
    .get(txnId) as { metadata_json: string | null };
  return row.metadata_json
    ? (JSON.parse(row.metadata_json) as { details?: { note?: unknown } })
        .details?.note
    : undefined;
}

describe("LIRA-366 syncTypedNote", () => {
  let db: Database.Database;
  let txnId: number;
  let debtRowId: number;

  beforeEach(() => {
    db = installDebtItemTestDb();
    addClient(db, 7);
    ({ txnId, debtRowId } = seedSaleDebt(db, { clientId: 7, usd: 5 }));
    db.prepare(`UPDATE transactions SET metadata_json = ? WHERE id = ?`).run(
      JSON.stringify({
        details: { v: 1, kind: "pos_sale", items: [], note: "rest on Monday" },
      }),
      txnId,
    );
    db.prepare(`UPDATE debt_ledger SET note = ? WHERE id = ?`).run(
      withTypedNote(SYSTEM, "rest on Monday"),
      debtRowId,
    );
  });
  afterEach(() => uninstallDebtItemTestDb(db));

  const sync = (oldTyped: string | null, newTyped: string | null) =>
    syncTypedNote(db, { transactionId: txnId, oldTyped, newTyped, tenantId: 1 });

  it("swaps the suffix on the charge row and rewrites details.note", () => {
    sync("rest on Monday", "rest on Tuesday");
    expect(debtNote(db, debtRowId)).toBe(`${SYSTEM} — rest on Tuesday`);
    expect(detailsNote(db, txnId)).toBe("rest on Tuesday");
  });

  it("clearing the note removes the suffix and details.note", () => {
    sync("rest on Monday", "  ");
    expect(debtNote(db, debtRowId)).toBe(SYSTEM);
    expect(detailsNote(db, txnId)).toBeUndefined();
  });

  it("a first note is appended to a debt note that had none", () => {
    db.prepare(`UPDATE debt_ledger SET note = ? WHERE id = ?`).run(
      SYSTEM,
      debtRowId,
    );
    sync(null, "paid by his brother");
    expect(debtNote(db, debtRowId)).toBe(`${SYSTEM} — paid by his brother`);
  });

  it("a note containing the separator is swapped exactly", () => {
    db.prepare(`UPDATE debt_ledger SET note = ? WHERE id = ?`).run(
      withTypedNote(SYSTEM, "a — b"),
      debtRowId,
    );
    sync("a — b", "c");
    expect(debtNote(db, debtRowId)).toBe(`${SYSTEM} — c`);
  });

  it("a Refund Reversal row is never touched", () => {
    const reversalId = Number(
      db
        .prepare(
          `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp,
             transaction_id, note, created_by)
           VALUES (1, 7, 'Refund Reversal', -5, 0, ?, ?, 1)`,
        )
        .run(txnId, `Reversal — rest on Monday`).lastInsertRowid,
    );
    sync("rest on Monday", "rest on Tuesday");
    expect(debtNote(db, reversalId)).toBe("Reversal — rest on Monday");
  });

  it("a debt note edited by hand is left alone", () => {
    db.prepare(`UPDATE debt_ledger SET note = ? WHERE id = ?`).run(
      "owner wrote this",
      debtRowId,
    );
    sync("rest on Monday", "rest on Tuesday");
    expect(debtNote(db, debtRowId)).toBe("owner wrote this");
    // The transaction still follows the edit.
    expect(detailsNote(db, txnId)).toBe("rest on Tuesday");
  });

  it("no change → nothing written", () => {
    sync("rest on Monday", " rest on Monday ");
    expect(debtNote(db, debtRowId)).toBe(withTypedNote(SYSTEM, "rest on Monday"));
  });
});

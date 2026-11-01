/**
 * LIRA-366 T011 — the cashier's typed note on an exchange.
 *
 * $1,000 for 89,500,000 LBP: 87,600,000 cash + 1,900,000 on the client's
 * account, note "rest on Monday". The note goes to `details.note`, the
 * exchange's `note` column, and the end of the 'Exchange Debt' note (the
 * payment rows keep the generated label). Money is unchanged by it (deltas,
 * rule 15). Editing the note later moves every copy (rule 31).
 *
 * Through `addDirectTransaction` — the call both transports make — with the
 * payload parsed by `exchangeSubmitSchema` (rule 24). Rule 17: seen failing
 * before the repository read `typedNote`.
 */
import type Database from "better-sqlite3";
import { getExchangeRepository } from "../ExchangeRepository";
import {
  CLIENT_ID,
  US1_PART_ON_ACCOUNT,
  delta,
  setupExchangeDb,
  snapshot,
  teardownExchangeDb,
  unifiedExchangeTxnId,
} from "../testHelpers/exchangeCustomerPaysDb";
import { readTypedNoteCopies } from "../testHelpers/typedNoteAssert";
import { getExchangeService } from "../../services/ExchangeService";
import { exchangeSubmitSchema } from "../../validators/exchange";
import type { CreateExchangeData } from "../ExchangeRepository";

let db: Database.Database;
beforeEach(() => {
  db = setupExchangeDb();
});
afterEach(() => teardownExchangeDb(db));

function exchange(typedNote: string | undefined): number {
  const parsed = exchangeSubmitSchema.parse({
    ...US1_PART_ON_ACCOUNT,
    note: "Exchange LBP → USD",
    typedNote,
  });
  const r = getExchangeService().addDirectTransaction(
    parsed as unknown as CreateExchangeData,
  );
  expect(r.error).toBeUndefined();
  return r.id as number;
}

const column = (id: number) =>
  (
    db
      .prepare(`SELECT note FROM exchange_transactions WHERE id = ?`)
      .get(id) as { note: string | null }
  ).note;

describe("LIRA-366 — typed note on an exchange", () => {
  it("lands in details.note, the exchange note and the Exchange Debt note; money unchanged", () => {
    const before = snapshot(db);
    const id = exchange("  rest on Monday ");
    const d = delta(before, snapshot(db));
    expect(d.generalLbp).toBe(87_600_000);
    expect(d.generalUsd).toBe(-1_000);

    const c = readTypedNoteCopies(db, unifiedExchangeTxnId(db, id));
    expect(c.detailsNote).toBe("rest on Monday");
    expect(c.debtNotes).toEqual([
      expect.stringMatching(/^Exchange LBP → USD.* — rest on Monday$/),
    ]);
    expect(column(id)).toBe("rest on Monday");
    // The client owes the account line, as before.
    const owed = db
      .prepare(
        `SELECT SUM(amount_lbp) AS lbp FROM debt_ledger WHERE client_id = ?`,
      )
      .get(CLIENT_ID) as { lbp: number };
    expect(owed.lbp).toBe(1_900_000);
  });

  it("no typed note → the label stays, no details.note, no suffix", () => {
    const id = exchange(undefined);
    const c = readTypedNoteCopies(db, unifiedExchangeTxnId(db, id));
    expect(c.detailsNote).toBeUndefined();
    expect(c.debtNotes[0]).not.toMatch(/ — rest/);
    expect(column(id)).toBe("Exchange LBP → USD");
  });

  it("editing the note moves details.note and the debt note together", () => {
    const id = exchange("rest on Monday");
    const txnId = unifiedExchangeTxnId(db, id);
    const systemPart = readTypedNoteCopies(db, txnId).debtNotes[0].replace(
      / — rest on Monday$/,
      "",
    );
    getExchangeRepository().updateMetadata(
      id,
      { note: "rest on Tuesday" },
      "admin",
    );
    const c = readTypedNoteCopies(db, txnId);
    expect(c.detailsNote).toBe("rest on Tuesday");
    expect(c.debtNotes).toEqual([`${systemPart} — rest on Tuesday`]);
  });
});

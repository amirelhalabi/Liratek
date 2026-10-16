/**
 * LIRA-329 T021 — a wrong-number credits entry keeps, on its own
 * transaction, which card it recovers, both numbers and the sale it came
 * from (`wrong_number`).
 *
 * The money columns are asserted FIRST at the values today's code produces
 * (FR-008). Rule 24: the expected details go through the kind's schema.
 * Rule 17: run before the builder existed and seen failing (details absent);
 * the money assertion passed.
 *
 * Not covered here (stated): the wrong-number EXPENSE row is written by
 * `ExpenseRepository.createStockExpense` — the expense writer's details are
 * LIRA-329 phase 7 (`expense` kind), not this module.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import {
  recordWrongNumberSchema,
  wrongNumberCreditsSchema,
} from "../../validators/wrongNumber";
import { wrongNumberDetailsSchema } from "../../validators/transactionDetails";
import { WrongNumberService } from "../WrongNumberService";
import {
  USER_ID,
  buildDb,
  resetAll,
  seed,
  type WrongNumberFixture,
} from "../../repositories/testHelpers/wrongNumberDb";
import { expectEverySnapshotMatchesPayments } from "../../repositories/testHelpers/paymentSnapshotAssert";

const DAY = "2026-10-16";

describe("LIRA-329 — wrong-number credits details", () => {
  let db: Database.Database;
  let f: WrongNumberFixture;
  let service: WrongNumberService;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    f = seed(db);
    service = new WrongNumberService();
  });

  // LIRA-329 T036 — every payment snapshot saved by a case above equals
  // the payments rows it booked (method, currency, amount, direction).
  afterEach(() => {
    expectEverySnapshotMatchesPayments(db);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("credits received: card, catalog item, both numbers and the sale link", () => {
    const recorded = service.recordWrongNumber(
      recordWrongNumberSchema.parse({
        provider: "iPick",
        mobile_service_item_id: f.alfaCardId,
        wrong_number: "03111111",
        right_number: "03222333",
        sale_transaction_id: f.saleId,
        expense_date: DAY,
      }),
      USER_ID,
    );
    if (!recorded.success) throw new Error(recorded.error);
    const recordId = recorded.data.id;

    const credited = service.recordCreditsReceived(
      wrongNumberCreditsSchema.parse({
        wrong_number_card_id: recordId,
        amount_usd: 6.68,
        carrier_line_id: f.shopLineId,
        client_day: DAY,
      }),
      USER_ID,
    );
    if (!credited.success) throw new Error(credited.error);

    const row = db
      .prepare(
        `SELECT amount_usd, profit_lbp, metadata_json FROM transactions WHERE id = ?`,
      )
      .get(credited.data.transaction_id) as {
      amount_usd: number;
      profit_lbp: number;
      metadata_json: string;
    };
    // FR-008 — today's money (passed on the pre-change run).
    expect(row).toMatchObject({ amount_usd: 6.68, profit_lbp: 668_000 });

    const card = db
      .prepare(
        `SELECT wrong_number, right_number FROM wrong_number_cards WHERE id = ?`,
      )
      .get(recordId) as { wrong_number: string; right_number: string };
    const expected = {
      v: 1,
      kind: "wrong_number",
      cardId: recordId,
      itemId: f.alfaCardId,
      wrongNumber: card.wrong_number,
      rightNumber: card.right_number,
      saleTransactionId: f.saleId,
    };
    expect(wrongNumberDetailsSchema.parse(expected)).toEqual(expected);
    expect(
      (JSON.parse(row.metadata_json) as Record<string, unknown>).details,
    ).toEqual(expected);
  });

  it("the wrong-number expense itself: catalog item, both numbers, the sale link and the note", () => {
    const recorded = service.recordWrongNumber(
      recordWrongNumberSchema.parse({
        provider: "iPick",
        mobile_service_item_id: f.alfaCardId,
        wrong_number: "03111111",
        right_number: "03222333",
        sale_transaction_id: f.saleId,
        note: "customer gave the old number",
        expense_date: DAY,
      }),
      USER_ID,
    );
    if (!recorded.success) throw new Error(recorded.error);

    const expense = db
      .prepare(
        `SELECT type, amount_lbp, metadata_json FROM transactions WHERE id = ?`,
      )
      .get(recorded.data.expense_transaction_id) as {
      type: string;
      amount_lbp: number;
      metadata_json: string;
    };
    // FR-008 — today's money (passed on the pre-change run): the card's cost.
    expect(expense.amount_lbp).toBe(-770_000);

    const card = db
      .prepare(
        `SELECT wrong_number, right_number FROM wrong_number_cards WHERE id = ?`,
      )
      .get(recorded.data.id) as { wrong_number: string; right_number: string };
    const expected = {
      v: 1,
      kind: "wrong_number",
      itemId: f.alfaCardId,
      wrongNumber: card.wrong_number,
      rightNumber: card.right_number,
      saleTransactionId: f.saleId,
      note: "customer gave the old number",
    };
    expect(wrongNumberDetailsSchema.parse(expected)).toEqual(expected);
    expect(
      (JSON.parse(expense.metadata_json) as Record<string, unknown>).details,
    ).toEqual(expected);
  });
});

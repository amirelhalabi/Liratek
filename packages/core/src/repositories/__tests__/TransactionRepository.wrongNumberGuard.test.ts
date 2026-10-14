/**
 * LIRA-312 US4 (quickstart W8) — undo order. A wrong-number expense cannot be
 * undone while credits received for it are still active ("Undo the credits
 * received first."); once they are undone, the expense void gives the
 * provider balance back. A plain stock-use expense is unaffected.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { getTransactionRepository } from "../TransactionRepository";
import { getExpenseRepository } from "../ExpenseRepository";
import { snapshotLedgers } from "../testHelpers/postingAssert";
import {
  recordWrongNumberSchema,
  wrongNumberCreditsSchema,
} from "../../validators/wrongNumber";
import {
  UNDO_CREDITS_FIRST_ERROR,
  WrongNumberService,
} from "../../services/WrongNumberService";
import {
  USER_ID,
  buildDb,
  drawer,
  resetAll,
  seed,
  type WrongNumberFixture,
} from "../testHelpers/wrongNumberDb";

const DAY = "2026-10-14";

describe("TransactionRepository — wrong-number expense undo guard (LIRA-312)", () => {
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

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  it("W8 — refuses the expense void while credits are active; voids cleanly once they are undone", () => {
    const before = snapshotLedgers(db);
    const ipickBefore = drawer(db, "iPick", "LBP");

    const rec = service.recordWrongNumber(
      recordWrongNumberSchema.parse({
        provider: "iPick",
        mobile_service_item_id: f.alfaCardId,
        wrong_number: "03111111",
        expense_date: DAY,
      }),
      USER_ID,
    );
    if (!rec.success) throw new Error(rec.error);
    const cr = service.recordCreditsReceived(
      wrongNumberCreditsSchema.parse({
        wrong_number_card_id: rec.data.id,
        amount_usd: 6.68,
        carrier_line_id: f.shopLineId,
      }),
      USER_ID,
    );
    if (!cr.success) throw new Error(cr.error);

    const txRepo = getTransactionRepository();
    expect(() =>
      txRepo.voidTransaction(rec.data.expense_transaction_id, USER_ID),
    ).toThrow(UNDO_CREDITS_FIRST_ERROR);
    expect(() =>
      txRepo.refundTransaction(rec.data.expense_transaction_id, USER_ID),
    ).toThrow(UNDO_CREDITS_FIRST_ERROR);
    expect(drawer(db, "iPick", "LBP")).toBe(ipickBefore - 770000);

    txRepo.voidTransaction(cr.data.transaction_id, USER_ID);
    txRepo.voidTransaction(rec.data.expense_transaction_id, USER_ID);

    expect(drawer(db, "iPick", "LBP")).toBe(ipickBefore);
    expect(snapshotLedgers(db)).toEqual(before);
    expect(service.list({ id: rec.data.id })[0].status).toBe("VOIDED");
  });

  it("deleting the expense from the Expenses page is refused the same way", () => {
    const rec = service.recordWrongNumber(
      recordWrongNumberSchema.parse({
        provider: "iPick",
        mobile_service_item_id: f.alfaCardId,
        wrong_number: "03111111",
        expense_date: DAY,
        credits_received: { amount_usd: 2, carrier_line_id: f.shopLineId },
      }),
      USER_ID,
    );
    if (!rec.success) throw new Error(rec.error);
    const expenseId = (
      db.prepare(`SELECT expense_id FROM wrong_number_cards WHERE id = ?`).get(rec.data.id) as {
        expense_id: number;
      }
    ).expense_id;
    expect(() => getExpenseRepository().deleteExpense(expenseId, USER_ID)).toThrow(
      UNDO_CREDITS_FIRST_ERROR,
    );
    expect(
      (db.prepare(`SELECT status FROM expenses WHERE id = ?`).get(expenseId) as { status: string }).status,
    ).not.toBe("voided");
    expect(service.list({ id: rec.data.id })[0].status).toBe("PARTLY_RECOVERED");
  });

  it("a plain stock-use expense (no wrong-number record) voids as before", () => {
    const ipickBefore = drawer(db, "iPick", "LBP");
    const expenseId = getExpenseRepository().createStockExpense(
      { source: "IPICK", item_id: f.alfaCardId, quantity: 1, category: "Shop use", expense_date: DAY },
      USER_ID,
    );
    const txnId = (
      db
        .prepare(`SELECT id FROM transactions WHERE source_table = 'expenses' AND source_id = ?`)
        .get(expenseId) as { id: number }
    ).id;
    expect(() => getTransactionRepository().voidTransaction(txnId, USER_ID)).not.toThrow();
    expect(drawer(db, "iPick", "LBP")).toBe(ipickBefore);
  });
});

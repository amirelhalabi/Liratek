/**
 * LIRA-312 US1 / US3 — recording a wrong-number card (quickstart W1–W3).
 *
 * "Wrong number" is not a refund: the sale stays untouched (it becomes the
 * correct recharge) and the wasted card is a stock-use expense paid from the
 * provider balance — the loss.
 *
 * NOT proven failing-first (rule 17): WrongNumberService was written before
 * this file.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { recordWrongNumberSchema } from "../../validators/wrongNumber";
import { createFinancialServiceSchema } from "../../validators/financial";
import { buildCatalogSalePayload } from "../../utils/catalogSale";
import { getFinancialService, resetFinancialService } from "../FinancialService";
import {
  WrongNumberService,
  WRONG_NUMBER_EXPENSE_CATEGORY,
} from "../WrongNumberService";
import {
  USER_ID,
  buildDb,
  drawer,
  resetAll,
  seed,
  type WrongNumberFixture,
} from "../../repositories/testHelpers/wrongNumberDb";

const DAY = "2026-10-14";

describe("WrongNumberService.recordWrongNumber (LIRA-312)", () => {
  let db: Database.Database;
  let f: WrongNumberFixture;
  let service: WrongNumberService;

  beforeEach(() => {
    resetAll();
    resetFinancialService();
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

  const record = (over: Record<string, unknown> = {}) =>
    service.recordWrongNumber(
      recordWrongNumberSchema.parse({
        provider: "iPick",
        mobile_service_item_id: f.alfaCardId,
        wrong_number: "03 111 111",
        right_number: "03 222 333",
        sale_transaction_id: f.saleId,
        expense_date: DAY,
        ...over,
      }),
      USER_ID,
    );

  const saleSnapshot = () => ({
    txn: db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(f.saleId),
    payments: db.prepare(`SELECT * FROM payments WHERE transaction_id = ?`).all(f.saleId),
  });

  it("W2 — from a saved sale: iPick −770,000, a 'Wrong number card' expense, the sale untouched", () => {
    const ipickBefore = drawer(db, "iPick", "LBP");
    const cashBefore = drawer(db, "General", "LBP");
    const saleBefore = saleSnapshot();

    const result = record();
    expect(result).toMatchObject({
      success: true,
      data: { status: "WAITING", remaining_loss_lbp: 770000 },
    });
    if (!result.success) return;

    expect(drawer(db, "iPick", "LBP") - ipickBefore).toBe(-770000);
    expect(drawer(db, "General", "LBP")).toBe(cashBefore);
    expect(saleSnapshot()).toEqual(saleBefore);

    const expenseTxn = db
      .prepare(`SELECT type, status, amount_lbp, metadata_json FROM transactions WHERE id = ?`)
      .get(result.data.expense_transaction_id) as {
      type: string;
      status: string;
      amount_lbp: number;
      metadata_json: string;
    };
    expect(expenseTxn).toMatchObject({ type: "EXPENSE_IPICK", status: "ACTIVE", amount_lbp: -770000 });
    expect(JSON.parse(expenseTxn.metadata_json).category).toBe(WRONG_NUMBER_EXPENSE_CATEGORY);

    const expense = db
      .prepare(`SELECT category, amount_lbp, paid_by_method FROM expenses`)
      .get() as { category: string; amount_lbp: number; paid_by_method: string };
    expect(expense).toEqual({
      category: WRONG_NUMBER_EXPENSE_CATEGORY,
      amount_lbp: 770000,
      paid_by_method: "iPick",
    });

    const row = db.prepare(`SELECT * FROM wrong_number_cards WHERE id = ?`).get(result.data.id) as Record<string, unknown>;
    expect(row).toMatchObject({
      provider: "iPick",
      carrier: "alfa",
      card_label: "Alfa 7.58",
      card_cost_lbp: 770000,
      card_credit_usd: 7.58,
      sale_transaction_id: f.saleId,
      wrong_number: "03111111",
      right_number: "03222333",
    });
  });

  it("W2 — on a REAL iPick card sale (shared catalog builder): accepted, the sale's rows untouched", () => {
    const body = createFinancialServiceSchema.parse(
      buildCatalogSalePayload({
        provider: "iPick",
        lines: [
          {
            item: { category: "alfa", label: "Alfa 7.58", subcategory: "Prepaid", cost_lbp: 770000, sell_lbp: 800000 },
            quantity: 1,
          },
        ],
        paidByMethod: "CASH",
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 800000 }],
      }),
    );
    const sold = getFinancialService().addTransaction({
      ...(body as unknown as Parameters<ReturnType<typeof getFinancialService>["addTransaction"]>[0]),
      userId: USER_ID,
    });
    expect(sold.success).toBe(true);
    const saleTxn = (
      db
        .prepare(`SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ?`)
        .get(sold.id) as { id: number }
    ).id;
    const snapshot = () => ({
      txn: db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(saleTxn),
      payments: db.prepare(`SELECT * FROM payments WHERE transaction_id = ?`).all(saleTxn),
      fs: db.prepare(`SELECT * FROM financial_services WHERE id = ?`).get(sold.id),
    });
    const before = snapshot();
    const ipickBefore = drawer(db, "iPick", "LBP");

    const result = record({ sale_transaction_id: saleTxn });
    expect(result).toMatchObject({ success: true, data: { status: "WAITING" } });
    expect(drawer(db, "iPick", "LBP") - ipickBefore).toBe(-770000);
    expect(snapshot()).toEqual(before);
  });

  it("W1 — from Expenses (no sale): the same loss, no right number needed", () => {
    const result = record({ sale_transaction_id: undefined, right_number: undefined });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const row = db.prepare(`SELECT sale_transaction_id, right_number FROM wrong_number_cards`).get();
    expect(row).toEqual({ sale_transaction_id: null, right_number: null });
    expect(service.list({ id: result.data.id })[0].status).toBe("WAITING");
  });

  it("Katsh / Whish App cards book on their own provider", () => {
    const katshBefore = drawer(db, "Katsh", "LBP");
    const result = record({
      provider: "Katsh",
      mobile_service_item_id: f.katshAlfaCardId,
      sale_transaction_id: f.katshSaleId,
    });
    expect(result.success).toBe(true);
    expect(drawer(db, "Katsh", "LBP") - katshBefore).toBe(-760000);
    expect(
      (db.prepare(`SELECT type FROM transactions WHERE type LIKE 'EXPENSE_%'`).get() as { type: string }).type,
    ).toBe("EXPENSE_KATSH");
  });

  describe("W3 — refusals write nothing", () => {
    const nothingWritten = () => {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM expenses`).get() as { n: number }).n).toBe(0);
      expect((db.prepare(`SELECT COUNT(*) AS n FROM wrong_number_cards`).get() as { n: number }).n).toBe(0);
    };

    it("same number typed in two formats", () => {
      expect(record({ wrong_number: "+961 3 111 111", right_number: "03 111 111" })).toEqual({
        success: false,
        error: "The right number is the same as the wrong one.",
      });
      nothingWritten();
    });

    it("an item that is not an MTC/Alfa card", () => {
      expect(record({ mobile_service_item_id: f.billItemId })).toEqual({
        success: false,
        error: "Pick the MTC or Alfa card that was sent.",
      });
      nothingWritten();
    });

    it("a card with no credit set (its credits could never be entered)", () => {
      db.prepare(`UPDATE mobile_service_items SET credits = NULL WHERE id = ?`).run(f.alfaCardId);
      expect(record()).toEqual({
        success: false,
        error: "Set this card's credit in Settings → Mobile Services first.",
      });
      nothingWritten();
    });

    it("another provider's card", () => {
      expect(record({ mobile_service_item_id: f.katshAlfaCardId })).toEqual({
        success: false,
        error: "Pick the MTC or Alfa card that was sent.",
      });
      nothingWritten();
    });

    it("another provider's sale", () => {
      expect(record({ sale_transaction_id: f.katshSaleId })).toEqual({
        success: false,
        error: "This sale is not a card recharge from iPick.",
      });
      nothingWritten();
    });

    it("a Katsh bill payment (not a card)", () => {
      db.prepare(`UPDATE transactions SET metadata_json = ? WHERE id = ?`).run(
        JSON.stringify({ provider: "Katsh", service_type: "BILL", cost: 500000, price: 500000 }),
        f.katshSaleId,
      );
      expect(
        record({ provider: "Katsh", mobile_service_item_id: f.katshAlfaCardId, sale_transaction_id: f.katshSaleId }),
      ).toEqual({ success: false, error: "This sale is not a card recharge from Katsh." });
      nothingWritten();
    });

    it("a Whish App wallet transfer (no catalog cost)", () => {
      const transferId = Number(
        db
          .prepare(
            `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, summary, metadata_json)
             VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', 2, 1, 50, 'WHISH_APP SEND', ?)`,
          )
          .run(JSON.stringify({ provider: "WHISH_APP", service_type: "SEND", cost: 0 })).lastInsertRowid,
      );
      const whishCardId = Number(
        db
          .prepare(
            `INSERT INTO mobile_service_items (tenant_id, provider, category, subcategory, label, cost_lbp, sell_lbp, credits)
             VALUES (1, 'WHISH_APP', 'alfa', 'Prepaid', 'Alfa 7.58', 770000, 800000, 7.58)`,
          )
          .run().lastInsertRowid,
      );
      expect(
        record({ provider: "WHISH_APP", mobile_service_item_id: whishCardId, sale_transaction_id: transferId }),
      ).toEqual({
        success: false,
        error: "This sale is not a card recharge from Whish App.",
      });
      nothingWritten();
    });

    it("a voided sale", () => {
      db.prepare(`UPDATE transactions SET status = 'VOIDED' WHERE id = ?`).run(f.saleId);
      expect(record()).toEqual({
        success: false,
        error: "This sale is not a card recharge from iPick.",
      });
      nothingWritten();
    });

    it("a saved sale without the right number is refused by the schema", () => {
      expect(
        recordWrongNumberSchema.safeParse({
          provider: "iPick",
          mobile_service_item_id: f.alfaCardId,
          wrong_number: "03111111",
          sale_transaction_id: f.saleId,
          expense_date: DAY,
        }).success,
      ).toBe(false);
    });
  });

  it("first credits entry in the same call", () => {
    const result = record({ credits_received: { amount_usd: 6.68, carrier_line_id: f.shopLineId } });
    expect(result).toMatchObject({
      success: true,
      data: { status: "PARTLY_RECOVERED", remaining_loss_lbp: 102000 },
    });
  });

  it("a refused first credits entry rolls the whole record back", () => {
    const ipickBefore = drawer(db, "iPick", "LBP");
    const result = record({ credits_received: { amount_usd: 6.68, carrier_line_id: f.mtcShopLineId } });
    expect(result).toEqual({ success: false, error: "Pick an active Alfa shop line." });
    expect(drawer(db, "iPick", "LBP")).toBe(ipickBefore);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM wrong_number_cards`).get() as { n: number }).n).toBe(0);
  });
});

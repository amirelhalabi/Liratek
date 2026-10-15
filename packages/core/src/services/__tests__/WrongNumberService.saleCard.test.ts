/**
 * LIRA-325 — the card a wrong number is recorded for comes FROM THE SALE.
 *
 * We sold the item, so we know what we sold. The Transactions page locks the
 * card when it can be read from the sale, and the server refuses another
 * card for that sale. It cannot always be read (an older or unusual sale, a
 * card removed from the catalog, a cart with several different cards); then
 * `getSaleCard` answers null and the operator picks, as before.
 *
 * How a sale names its card (both written by the Mobile Recharge forms):
 *  - one `financial_services` row per unit with `item_key`
 *    "provider/category/subcategory/label" (Whish App, session carts,
 *    partner orders);
 *  - the walk-in Katsh/iPick cart: ONE row, no `item_key`, the cart in
 *    `note` (`catalogCartNote`: "alfa: 7.58 (Prepaid) x2, mtc: …").
 *
 * Also: the wrong number itself is optional (owner 2026-10-16).
 *
 * Written failing-first (rule 17) — see the ticket for the recorded failure.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { recordWrongNumberSchema } from "../../validators/wrongNumber";
import { createFinancialServiceSchema } from "../../validators/financial";
import {
  buildCatalogSalePayload,
  parseCatalogCartNote,
  type CatalogCartLine,
} from "../../utils/catalogSale";
import { getFinancialService, resetFinancialService } from "../FinancialService";
import { WrongNumberService, soldCardMismatchError } from "../WrongNumberService";
import {
  USER_ID,
  buildDb,
  resetAll,
  seed,
  type WrongNumberFixture,
} from "../../repositories/testHelpers/wrongNumberDb";

const DAY = "2026-10-16";

const ALFA: CatalogCartLine["item"] = {
  category: "alfa",
  label: "Alfa 7.58",
  subcategory: "Prepaid",
  cost_lbp: 770000,
  sell_lbp: 800000,
};
const MTC: CatalogCartLine["item"] = {
  category: "mtc",
  label: "MTC 4.5",
  subcategory: "Prepaid",
  cost_lbp: 466000,
  sell_lbp: 496000,
};

describe("parseCatalogCartNote — the inverse of catalogCartNote", () => {
  it("one line, quantities and the Only Days suffix", () => {
    expect(parseCatalogCartNote("alfa: 7.58 (Prepaid)")).toEqual([
      { name: "alfa: 7.58 (Prepaid)", quantity: 1 },
    ]);
    expect(parseCatalogCartNote("alfa: 7.58 (Prepaid) x3 [Only Days], mtc: 4.5 (Prepaid)")).toEqual([
      { name: "alfa: 7.58 (Prepaid)", quantity: 3 },
      { name: "mtc: 4.5 (Prepaid)", quantity: 1 },
    ]);
    expect(parseCatalogCartNote(null)).toEqual([]);
    expect(parseCatalogCartNote("  ")).toEqual([]);
  });
});

describe("WrongNumberService — the card comes from the sale (LIRA-325)", () => {
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

  type AddTx = Parameters<ReturnType<typeof getFinancialService>["addTransaction"]>[0];

  /** Book a sale as the Mobile Recharge form does; returns its transaction id. */
  const sell = (body: Record<string, unknown>): number => {
    const sold = getFinancialService().addTransaction({
      ...(body as unknown as AddTx),
      userId: USER_ID,
    });
    expect(sold.success).toBe(true);
    return (
      db
        .prepare(`SELECT id FROM transactions WHERE source_table = 'financial_services' AND source_id = ?`)
        .get(sold.id) as { id: number }
    ).id;
  };

  /** The walk-in Katsh/iPick cart (one row, the cart in the note). */
  const sellCart = (lines: CatalogCartLine[]): number =>
    sell(
      createFinancialServiceSchema.parse(
        buildCatalogSalePayload({
          provider: "iPick",
          lines,
          paidByMethod: "CASH",
          payments: [
            {
              method: "CASH",
              currencyCode: "LBP",
              amount: lines.reduce((s, l) => s + l.item.sell_lbp * l.quantity, 0),
            },
          ],
        }),
      ) as unknown as Record<string, unknown>,
    );

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

  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  describe("getSaleCard", () => {
    it("a walk-in cart of one card → that card", () => {
      const saleId = sellCart([{ item: ALFA, quantity: 1 }]);
      expect(service.getSaleCard(saleId)).toMatchObject({
        id: f.alfaCardId,
        label: "Alfa 7.58",
        category: "alfa",
        subcategory: "Prepaid",
        cost_lbp: 770000,
      });
    });

    it("the same card twice (x2) is still one card", () => {
      const saleId = sellCart([{ item: ALFA, quantity: 2 }]);
      expect(service.getSaleCard(saleId)?.id).toBe(f.alfaCardId);
    });

    it("an Only Days line names the same card", () => {
      const saleId = sellCart([{ item: ALFA, quantity: 1, noteSuffix: " [Only Days]" }]);
      expect(service.getSaleCard(saleId)?.id).toBe(f.alfaCardId);
    });

    it("a cart with two different cards → null (the operator picks)", () => {
      const saleId = sellCart([
        { item: ALFA, quantity: 1 },
        { item: MTC, quantity: 1 },
      ]);
      expect(service.getSaleCard(saleId)).toBeNull();
    });

    it("a per-unit row names its card by item_key", () => {
      const saleId = sell({
        provider: "iPick",
        serviceType: "SEND",
        amount: 496000,
        cost: 466000,
        currency: "LBP",
        commission: 30000,
        paidByMethod: "CASH",
        payments: [{ method: "CASH", currencyCode: "LBP", amount: 496000 }],
        itemKey: "iPick/mtc/Prepaid/MTC 4.5",
        itemCategory: "mtc",
        // A note that would NOT match — the key wins.
        note: "something else",
      });
      expect(service.getSaleCard(saleId)?.id).toBe(f.mtcCardId);
    });

    it("a card no longer in the catalog → null", () => {
      const saleId = sellCart([{ item: ALFA, quantity: 1 }]);
      db.prepare(`UPDATE mobile_service_items SET is_active = 0 WHERE id = ?`).run(f.alfaCardId);
      expect(service.getSaleCard(saleId)).toBeNull();
    });

    it("a card whose catalog cost is now 0 → null (the server could not record it)", () => {
      const saleId = sellCart([{ item: ALFA, quantity: 1 }]);
      db.prepare(`UPDATE mobile_service_items SET cost_lbp = 0 WHERE id = ?`).run(f.alfaCardId);
      expect(service.getSaleCard(saleId)).toBeNull();
    });

    it("an older sale with nothing to read (no catalog row) → null", () => {
      expect(service.getSaleCard(f.saleId)).toBeNull();
    });

    it("not a card sale → null", () => {
      expect(service.getSaleCard(999999)).toBeNull();
    });
  });

  describe("recording from a sale whose card is known", () => {
    it("the sold card is accepted", () => {
      const saleId = sellCart([{ item: ALFA, quantity: 1 }]);
      expect(record({ sale_transaction_id: saleId })).toMatchObject({ success: true });
    });

    it("another card is refused, nothing written", () => {
      const saleId = sellCart([{ item: ALFA, quantity: 1 }]);
      const expensesBefore = count("expenses");
      const result = record({ sale_transaction_id: saleId, mobile_service_item_id: f.mtcCardId });
      expect(result.success).toBe(false);
      expect(result).toEqual({
        success: false,
        error: soldCardMismatchError("Alfa Alfa 7.58"),
      });
      expect(soldCardMismatchError("Alfa 7.58")).toBe(
        "This sale was for Alfa 7.58 — record the wrong number for that card.",
      );
      expect(count("expenses")).toBe(expensesBefore);
      expect(count("wrong_number_cards")).toBe(0);
    });

    it("a sale whose card cannot be read still takes the operator's pick", () => {
      expect(record({ mobile_service_item_id: f.alfaCardId })).toMatchObject({ success: true });
    });
  });

  describe("the wrong number is optional", () => {
    it("the schema: missing, null or blank all mean 'not entered'", () => {
      const base = {
        provider: "iPick",
        mobile_service_item_id: f.alfaCardId,
        expense_date: DAY,
      };
      for (const wrong of [undefined, null, "", "   "]) {
        const parsed = recordWrongNumberSchema.safeParse({ ...base, wrong_number: wrong });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.wrong_number).toBeNull();
      }
      // Something typed must still be a phone number.
      expect(recordWrongNumberSchema.safeParse({ ...base, wrong_number: "abc" }).success).toBe(false);
    });

    it("recorded without it: the record reads back null, the texts leave it out", () => {
      const result = record({ wrong_number: undefined });
      expect(result).toMatchObject({ success: true, data: { status: "WAITING" } });
      if (!result.success) return;
      const row = service.list({ id: result.data.id })[0];
      expect(row.wrong_number).toBeNull();
      expect(row.right_number).toBe("03222333");
      const expense = db
        .prepare(`SELECT description FROM expenses ORDER BY id DESC LIMIT 1`)
        .get() as { description: string };
      expect(expense.description).toBe("Wrong number — Alfa 7.58");

      const credits = service.recordCreditsReceived(
        { wrong_number_card_id: result.data.id, amount_usd: 1, carrier_line_id: f.shopLineId },
        USER_ID,
      );
      expect(credits.success).toBe(true);
      const txn = db
        .prepare(`SELECT summary, metadata_json FROM transactions WHERE type = 'WRONG_NUMBER_CREDITS'`)
        .get() as { summary: string; metadata_json: string };
      expect(txn.summary).not.toMatch(/null|undefined/);
      expect(txn.summary).toContain("Alfa 7.58");
      expect(JSON.parse(txn.metadata_json).wrong_number).toBeNull();
    });

    it("the right number must still differ from the wrong one when both are entered", () => {
      expect(record({ wrong_number: "03 222 333", right_number: "03222333" })).toEqual({
        success: false,
        error: "The right number is the same as the wrong one.",
      });
    });
  });
});

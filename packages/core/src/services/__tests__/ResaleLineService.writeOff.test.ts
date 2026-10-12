/**
 * LIRA-309 (US2, C14) — writing off a lost line held for sale.
 *
 * Owner decision 2026-10-11: a lost for-sale line stays in stock until the
 * owner taps Write off; only then is its full cost booked as a loss. The
 * write-off reuses the existing reversible stock-expense flow
 * (`ExpenseRepository.createStockExpense`, EXPENSE_INVENTORY), so its void
 * path is the one that flow already has (`restoreExpenseStock`) — covered by
 * that flow's own tests; this file pins what ResaleLineService sends it and
 * when it refuses.
 *
 * Written before `writeOff` existed; first run failed with
 * "service.writeOff is not a function".
 */
import { ResaleLineService } from "../ResaleLineService.js";
import type { ResaleLineRepository, ResaleLineRow } from "../../repositories/ResaleLineRepository.js";
import type { CarrierLineRepository } from "../../repositories/CarrierLineRepository.js";
import type { ExpenseRepository } from "../../repositories/ExpenseRepository.js";

const TODAY = "2026-10-12";

function row(over: Partial<ResaleLineRow>): ResaleLineRow {
  return {
    product_id: 7,
    phone_number: "70444202",
    name: "Alfa line 70 444 202",
    category: "Phone Lines",
    cost_price_usd: 18,
    selling_price_usd: 28,
    stock_quantity: 1,
    is_unsold: 1,
    resale_line_id: 1,
    carrier: "alfa",
    credits: 0,
    validity_expires_at: "2026-10-01", // 11 days ago → past the 5-day grace
    ...over,
  };
}

function makeService(line: ResaleLineRow | null) {
  const createStockExpense = jest.fn().mockReturnValue(55);
  const resaleRepo = {
    listLines: jest.fn().mockReturnValue(line ? [line] : []),
  } as unknown as ResaleLineRepository;
  const expenseRepo = { createStockExpense } as unknown as ExpenseRepository;
  const service = new ResaleLineService(
    resaleRepo,
    {} as CarrierLineRepository,
    expenseRepo,
  );
  return { service, createStockExpense };
}

describe("ResaleLineService.writeOff (LIRA-309)", () => {
  it("books a lost unsold line as a stock expense of 1 unit, category 'Lost phone line'", () => {
    const { service, createStockExpense } = makeService(row({}));
    const result = service.writeOff({ product_id: 7, note: "number burned", client_day: TODAY }, 9);
    expect(result).toEqual({ success: true, data: { expense_id: 55 } });
    expect(createStockExpense).toHaveBeenCalledWith(
      {
        source: "INVENTORY",
        item_id: 7,
        quantity: 1,
        category: "Lost phone line",
        description: "Lost phone line 70444202 — number burned",
        expense_date: TODAY,
      },
      9,
    );
  });

  it("refuses a line that is still inside its grace period", () => {
    const { service, createStockExpense } = makeService(
      row({ validity_expires_at: "2026-10-09" }), // 3 days ago → IN_GRACE
    );
    const result = service.writeOff({ product_id: 7, client_day: TODAY }, 9);
    expect(result.success).toBe(false);
    expect(createStockExpense).not.toHaveBeenCalled();
  });

  it("refuses a line with no expiry recorded", () => {
    const { service, createStockExpense } = makeService(row({ validity_expires_at: null }));
    expect(service.writeOff({ product_id: 7, client_day: TODAY }, 9).success).toBe(false);
    expect(createStockExpense).not.toHaveBeenCalled();
  });

  it("refuses a line that is not in stock (sold or unknown)", () => {
    const { service, createStockExpense } = makeService(null);
    const result = service.writeOff({ product_id: 7, client_day: TODAY }, 9);
    expect(result).toEqual({ success: false, error: "This line is not in stock." });
    expect(createStockExpense).not.toHaveBeenCalled();
  });

  it("reports the stock-expense refusal as a plain error", () => {
    const { service, createStockExpense } = makeService(row({}));
    createStockExpense.mockImplementation(() => {
      throw new Error("Not enough stock");
    });
    expect(service.writeOff({ product_id: 7, client_day: TODAY }, 9)).toEqual({
      success: false,
      error: "Not enough stock",
    });
  });
});

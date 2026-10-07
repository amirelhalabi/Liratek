/**
 * Owner decision 2026-10-07 (Expenses, payer = "shop"): a manual expense now
 * carries the bill (`amount_*`), the cash lines (`payments` — IN = handed,
 * OUT = change the vendor hands back), the not-returned claim
 * (`kept_change_*`) and the till's `tender_exchange_rate`.
 *
 * Rule 23: the desktop `AddExpenseSchema` is a separate zod-3 literal that
 * strips unknown keys silently — every one of these must survive it, or the
 * desktop build books the bill with no change legs while web books it right.
 *
 * Not proven failing-first (rule 17): written after the keys were added.
 */
import { AddExpenseSchema } from "../index";

describe("AddExpenseSchema — cash lines and change back survive validation", () => {
  const base = {
    description: "Printer ink",
    category: "Shop_Supply",
    paid_by_method: "CASH",
    amount_usd: 18.5,
    amount_lbp: 0,
    expense_date: "2026-10-07",
  };

  it("keeps payments (with OUT change legs), kept_change_* and tender_exchange_rate", () => {
    const input = {
      ...base,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 20 },
        { method: "CASH", currencyCode: "USD", amount: 1, direction: "OUT" },
      ],
      kept_change_usd: 0.5,
      kept_change_lbp: 0,
      tender_exchange_rate: 89500,
    };
    const parsed = AddExpenseSchema.parse(input) as Record<string, unknown>;
    expect(parsed.payments).toEqual(input.payments);
    expect(parsed.kept_change_usd).toBe(0.5);
    expect(parsed.kept_change_lbp).toBe(0);
    expect(parsed.tender_exchange_rate).toBe(89500);
  });

  it("rejects a negative not-returned claim and a zero-amount line", () => {
    expect(() =>
      AddExpenseSchema.parse({ ...base, kept_change_usd: -1 }),
    ).toThrow();
    expect(() =>
      AddExpenseSchema.parse({
        ...base,
        payments: [{ method: "CASH", currencyCode: "USD", amount: 0 }],
      }),
    ).toThrow();
  });

  it("still accepts an expense with no cash lines (internal / scripted callers)", () => {
    expect(() => AddExpenseSchema.parse(base)).not.toThrow();
  });
});

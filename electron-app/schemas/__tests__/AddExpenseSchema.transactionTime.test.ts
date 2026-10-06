/**
 * G41 (LIRA-262 follow-up, found 2026-10-06): the desktop `AddExpenseSchema`
 * had no `transaction_time` key, so Zod silently stripped a backdated manual
 * expense's time on desktop (rule 23) while the web schema kept it.
 */
import { AddExpenseSchema } from "../index";

describe("AddExpenseSchema — transaction_time survives validation (G41)", () => {
  const base = {
    description: "Rent",
    category: "Rent",
    paid_by_method: "CASH",
    amount_usd: 100,
    amount_lbp: 0,
    expense_date: "2026-10-05",
  };

  it("keeps a backdated transaction_time", () => {
    const parsed = AddExpenseSchema.parse({
      ...base,
      transaction_time: "2026-10-05T09:30:00.000Z",
    }) as { transaction_time?: string };
    expect(parsed.transaction_time).toBe("2026-10-05T09:30:00.000Z");
  });

  it("still accepts an expense without transaction_time", () => {
    expect(() => AddExpenseSchema.parse(base)).not.toThrow();
  });
});

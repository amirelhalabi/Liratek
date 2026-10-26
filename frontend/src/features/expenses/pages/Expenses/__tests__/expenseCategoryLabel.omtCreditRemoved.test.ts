/**
 * LIRA-344 — the "OMT credit not accepted" category (written by "Remove
 * credit" on the OMT Settle Account sheet) is translated like a seeded
 * category, from core's one definition (rule 14), in English and Arabic.
 *
 * Not proven failing-first: written after the label change.
 */
import { OMT_CREDIT_REMOVED_EXPENSE_CATEGORY } from "@liratek/core";
import { i18n } from "@/i18n/setup";
import { expenseCategoryLabel } from "../expenseCategoryLabel";
import arExpenses from "@liratek/ui/i18n/locales/ar/expenses.json";

describe("expenseCategoryLabel — OMT credit not accepted (LIRA-344)", () => {
  it("reads the category in English and in Arabic", () => {
    const en = i18n.getFixedT("en", "expenses");
    expect(expenseCategoryLabel(OMT_CREDIT_REMOVED_EXPENSE_CATEGORY, en)).toBe(
      "OMT credit not accepted",
    );
    const t = jest.fn((key: string) => `T(${key})`);
    expect(
      expenseCategoryLabel(
        OMT_CREDIT_REMOVED_EXPENSE_CATEGORY,
        t as unknown as Parameters<typeof expenseCategoryLabel>[1],
      ),
    ).toBe("T(category.OMT_credit_not_accepted)");
    const arLabel = (arExpenses as { category: Record<string, string> })
      .category.OMT_credit_not_accepted;
    expect(arLabel).toMatch(/[؀-ۿ]/);
  });
});

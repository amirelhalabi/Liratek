/**
 * LIRA-335 — the "Drawer shortage" category is translated like a seeded
 * category (the stored value is core's DRAWER_SHORTAGE_EXPENSE_CATEGORY,
 * rule 14), in English and Arabic.
 *
 * Rule 17: written before the label change.
 */
import { DRAWER_SHORTAGE_EXPENSE_CATEGORY } from "@liratek/core";
import { i18n } from "@/i18n/setup";
import { expenseCategoryLabel } from "../expenseCategoryLabel";
import arExpenses from "@liratek/ui/i18n/locales/ar/expenses.json";

describe("expenseCategoryLabel — Drawer shortage (LIRA-335)", () => {
  it("looks the category up in the catalog instead of echoing the stored value", () => {
    const t = jest.fn((key: string) => `T(${key})`);
    expect(
      expenseCategoryLabel(
        DRAWER_SHORTAGE_EXPENSE_CATEGORY,
        t as unknown as Parameters<typeof expenseCategoryLabel>[1],
      ),
    ).toBe("T(category.Drawer_shortage)");
  });

  it("reads Drawer shortage in English and in Arabic", () => {
    const en = i18n.getFixedT("en", "expenses");
    expect(expenseCategoryLabel(DRAWER_SHORTAGE_EXPENSE_CATEGORY, en)).toBe(
      "Drawer shortage",
    );
    const arLabel = (arExpenses as { category: Record<string, string> })
      .category.Drawer_shortage;
    expect(arLabel).toBeTruthy();
    expect(arLabel).toMatch(/[؀-ۿ]/);
  });
});

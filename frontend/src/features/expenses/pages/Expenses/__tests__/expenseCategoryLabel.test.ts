/**
 * expenseCategoryLabel — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import {
  DRAWER_SHORTAGE_EXPENSE_CATEGORY,
  OMT_CREDIT_REMOVED_EXPENSE_CATEGORY,
} from "@liratek/core";
import { i18n } from "@/i18n/setup";
import { expenseCategoryLabel } from "../expenseCategoryLabel";
import arExpenses from "@liratek/ui/i18n/locales/ar/expenses.json";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("expenseCategoryLabel.drawerShortage (LIRA-335)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-335 — the "Drawer shortage" category is translated like a seeded
   * category (the stored value is core's DRAWER_SHORTAGE_EXPENSE_CATEGORY,
   * rule 14), in English and Arabic.
   *
   * Rule 17: written before the label change.
   */

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
});

describe("expenseCategoryLabel.omtCreditRemoved (LIRA-344)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-344 — the "OMT credit not accepted" category (written by "Remove
   * credit" on the OMT Settle Account sheet) is translated like a seeded
   * category, from core's one definition (rule 14), in English and Arabic.
   *
   * Not proven failing-first: written after the label change.
   */

  describe("expenseCategoryLabel — OMT credit not accepted (LIRA-344)", () => {
    it("reads the category in English and in Arabic", () => {
      const en = i18n.getFixedT("en", "expenses");
      expect(
        expenseCategoryLabel(OMT_CREDIT_REMOVED_EXPENSE_CATEGORY, en),
      ).toBe("OMT credit not accepted");
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
});

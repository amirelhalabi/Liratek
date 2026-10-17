import type { TFunction } from "i18next";

/**
 * LIRA-331 (OD-3): the label shown for an expense category. The stored value
 * is a code (`Shop_Supply`) and is what every payload, option `value` and
 * comparison uses; only the text on screen is translated. A seeded code gets
 * its catalog label; anything else (a category typed in History, or a code
 * written by another module such as `SMS_Transfer_Fee`) is shown as stored,
 * with underscores as spaces, exactly as before.
 */
const SEEDED_CATEGORY_KEYS = {
  Shop_Supply: "category.Shop_Supply",
  Bill: "category.Bill",
  Inventory_Loss: "category.Inventory_Loss",
  Refund_Damaged: "category.Refund_Damaged",
  Line_Usage: "category.Line_Usage",
  Other: "category.Other",
} as const;

type SeededCategory = keyof typeof SEEDED_CATEGORY_KEYS;

function isSeeded(code: string): code is SeededCategory {
  return Object.prototype.hasOwnProperty.call(SEEDED_CATEGORY_KEYS, code);
}

export function expenseCategoryLabel(
  code: string,
  t: TFunction<"expenses">,
): string {
  if (isSeeded(code)) return t(SEEDED_CATEGORY_KEYS[code]);
  return code.replace(/_/g, " ");
}

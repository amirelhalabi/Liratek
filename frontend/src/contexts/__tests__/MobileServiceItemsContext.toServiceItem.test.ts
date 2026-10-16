import { catalogItemLabelFromKey } from "@liratek/core";
import { toServiceItem } from "../MobileServiceItemsContext";
import type { MobileServiceItem } from "@/types/electron";

/**
 * Shop-day 2026-10-16 (bug 5) — the grid's catalog key comes from core's
 * `catalogItemKey` (rule 14) instead of a hand-built template. The key must
 * stay byte-for-byte what it was ("provider/category/subcategory/label"),
 * because saved costs and voucher images are looked up by it and a sale's
 * details read the label back from it.
 *
 * NOT proven failing-first (rule 17): a refactor with no behaviour change;
 * this pins that the output is identical to the old template.
 */

function row(overrides: Partial<MobileServiceItem>): MobileServiceItem {
  return {
    id: 1,
    provider: "Katsh",
    category: "alfa",
    subcategory: "Prepaid",
    label: "4.5",
    cost_lbp: 400_000,
    sell_lbp: 450_000,
    sort_order: 0,
    is_active: 1,
    ...overrides,
  } as MobileServiceItem;
}

const oldKey = (i: MobileServiceItem): string =>
  `${i.provider}/${i.category}/${i.subcategory}/${i.label}`;

describe("toServiceItem — catalog key", () => {
  it.each([
    row({}),
    row({
      provider: "iPick",
      category: "internet",
      subcategory: "DSL",
      label: "ARMY DSL 10GB",
    }),
    row({
      provider: "WHISH_APP",
      category: "Gaming",
      subcategory: "PUBG",
      label: "60 UC / 1 card",
    }),
  ])("key for $provider/$label is unchanged", (item) => {
    const mapped = toServiceItem(item);
    expect(mapped.key).toBe(oldKey(item));
    expect(catalogItemLabelFromKey(mapped.key)).toBe(item.label);
  });

  it("keeps the other fields as before", () => {
    const item = row({ validity_days: 30, credits: 4.5 });
    expect(toServiceItem(item)).toEqual({
      id: 1,
      key: "Katsh/alfa/Prepaid/4.5",
      provider: "Katsh",
      category: "alfa",
      subcategory: "Prepaid",
      label: "4.5",
      catalogCost: 400_000,
      catalogSellPrice: 450_000,
      sortOrder: 0,
      validityDays: 30,
      credits: 4.5,
    });
  });
});

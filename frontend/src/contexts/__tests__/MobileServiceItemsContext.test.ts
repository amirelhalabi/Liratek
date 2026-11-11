/**
 * MobileServiceItemsContext — 2 per-ticket test files merged into one suite
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
  sortItems,
  type ServiceItem,
  toServiceItem,
} from "../MobileServiceItemsContext";
import { catalogItemLabelFromKey } from "@liratek/core";
import { type MobileServiceItem } from "@/types/electron";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("MobileServiceItemsContext.sortItems", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Item-grid order inside a subcategory: cards of one product line stay
   * together (ARMY DSL with ARMY DSL, FIBER with FIBER, …), then go by size, with
   * MB read as a thousandth of a GB. Fixtures are real labels from the iPick,
   * Katsh and Whish App catalogs.
   */

  function items(
    provider: ServiceItem["provider"],
    category: string,
    subcategory: string,
    labels: string[],
  ): ServiceItem[] {
    return labels.map((label, i) => ({
      key: `${provider}-${category}-${subcategory}-${label}`,
      provider,
      category,
      subcategory,
      label,
      sortOrder: i,
    }));
  }

  const labelsOf = (list: ServiceItem[]) => list.map((i) => i.label);

  /** Every label matching `re` sits in one unbroken run. */
  function isContiguous(labels: string[], re: RegExp): boolean {
    const idx = labels.flatMap((l, i) => (re.test(l) ? [i] : []));
    return idx.length > 0 && idx[idx.length - 1] - idx[0] === idx.length - 1;
  }

  // iPick › internet › Terranet, in catalog (file) order
  const IPICK_TERRANET = [
    "8MB UNL",
    "4MB 100GB",
    "4MB 50GB",
    "ARMY DSL 4MB 100GB",
    "ARMY DSL 4MB 50GB",
    "ARMY DSL 50MB UNL",
    "ARMY DSL OS 120GB",
    "ARMY DSL OS 400GB",
    "DSL 50MB UNL",
    "FIBER 300MB 1000GB",
    "FIBER 300MB 300GB",
    "FIBER 300MB 400GB",
    "FIBER 50MB UNL",
    "OPEN SPEED 1000GB",
    "OPEN SPEED 120GB",
    "OS 160GB/4MB UNL/SMART",
  ];

  // Whish App › internet › Terranet, in catalog order (DSL, Army, Fiber tabs)
  const WHISH_TERRANET = [
    "TERR DSL 4MB 60GB",
    "TERR DSL OS 120GB",
    "TERR ARMY DSL 8MB UNLIMITED / PLAY",
    "TERR DSL 50MB UNLIMITED",
    "TERR ARMY DSL 50 MB UNLIMITED",
    "TERR FIBER 50 MB UNLIMITED",
    "TERR ARMY DSL OS 120GB",
    "TERR FIBER 300GB",
    "TERR DSL OS 240GB",
    "TERR FIBER 1000GB",
  ];

  describe("sortItems — product lines stay together", () => {
    it("keeps each Terranet line in one run on iPick (Army, Fiber, Open Speed)", () => {
      const out = labelsOf(
        sortItems(items("iPick", "internet", "Terranet", IPICK_TERRANET)),
      );
      expect(isContiguous(out, /^ARMY DSL /)).toBe(true);
      expect(isContiguous(out, /^FIBER /)).toBe(true);
      // "OS" and "OPEN SPEED" are the same Open Speed line
      expect(isContiguous(out, /^(OS|OPEN SPEED) /)).toBe(true);
    });

    it("keeps each Terranet line in one run on Whish App (DSL, Army, Fiber)", () => {
      const out = labelsOf(
        sortItems(items("WHISH_APP", "internet", "Terranet", WHISH_TERRANET)),
      );
      expect(isContiguous(out, /^TERR ARMY /)).toBe(true);
      expect(isContiguous(out, /^TERR FIBER /)).toBe(true);
    });

    it("orders a line by size, reading MB as a thousandth of a GB", () => {
      const out = labelsOf(
        sortItems(items("iPick", "internet", "Terranet", IPICK_TERRANET)),
      );
      const fiber = out.filter((l) => l.startsWith("FIBER "));
      expect(fiber).toEqual([
        "FIBER 50MB UNL",
        "FIBER 300MB 300GB",
        "FIBER 300MB 400GB",
        "FIBER 300MB 1000GB",
      ]);
    });

    it("puts 500MB before 1.5GB and 5GB (Alfa weekly data)", () => {
      const out = labelsOf(
        sortItems(
          items("WHISH_APP", "alfa", "Weekly data", ["5GB", "500MB", "1.5GB"]),
        ),
      );
      expect(out).toEqual(["500MB", "1.5GB", "5GB"]);
    });

    it("leaves the mtc Prepaid order as it was: face values ascending, then the named plans", () => {
      const labels = [
        "1",
        "1.67",
        "3.79",
        "4.5",
        "10",
        "77.28",
        "start",
        "startSOS",
        "smart",
        "super",
      ];
      const shuffled = items("Katsh", "mtc", "Prepaid", labels).reverse();
      shuffled.forEach((it) => (it.sortOrder = labels.indexOf(it.label)));
      expect(labelsOf(sortItems(shuffled))).toEqual(labels);
    });

    it("still keeps whole subcategories together, in catalog order", () => {
      const list = [
        ...items("iPick", "alfa", "Weekly data", ["5GB", "500MB"]),
        ...items("iPick", "alfa", "Boosters", ["50MB"]).map((i) => ({
          ...i,
          sortOrder: 10,
        })),
      ];
      expect(sortItems(list).map((i) => i.subcategory)).toEqual([
        "Weekly data",
        "Weekly data",
        "Boosters",
      ]);
    });
  });
});

describe("MobileServiceItemsContext.toServiceItem", () => {
  beforeAll(resetBetweenFiles);

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
});

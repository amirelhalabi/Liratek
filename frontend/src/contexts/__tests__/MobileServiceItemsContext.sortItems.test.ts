import { sortItems, type ServiceItem } from "../MobileServiceItemsContext";

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

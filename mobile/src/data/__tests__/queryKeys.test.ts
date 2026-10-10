import { queryKeys } from "../queryKeys";

const ALL = (shop: string) => [
  queryKeys.balances(shop),
  queryKeys.sinceLastCountAll(shop),
  queryKeys.sinceLastCount(shop, ["Whish_App", "OMT_App"]),
  queryKeys.recentAll(shop),
  queryKeys.recent(shop, 15),
  queryKeys.debtors(shop),
  queryKeys.clientBalance(shop, 7),
];

describe("query keys (LIRA-300)", () => {
  it("every key starts with the shop", () => {
    for (const key of ALL("cornertech")) expect(key[0]).toBe("cornertech");
  });

  it("two shops never share a key for the same read", () => {
    const a = ALL("shop-a").map((k) => JSON.stringify(k));
    const b = new Set(ALL("shop-b").map((k) => JSON.stringify(k)));
    for (const k of a) expect(b.has(k)).toBe(false);
  });

  it("the prefix keys cover their specific keys (used for invalidation)", () => {
    expect(queryKeys.sinceLastCount("s", ["Whish_App"]).slice(0, 2)).toEqual([...queryKeys.sinceLastCountAll("s")]);
    expect(queryKeys.recent("s", 15).slice(0, 2)).toEqual([...queryKeys.recentAll("s")]);
  });
});

/**
 * Remembered shops (LIRA-287): after a sign-in on a shop's own address, that
 * shop's slug + name go in a cookie on the PARENT domain so www can offer
 * "Continue" to it. localStorage is per-origin, so a cookie is the only
 * place both `<slug>.<base>` and `www.<base>` can read.
 *
 * The cookie is untrusted input on read (any subdomain could write it):
 * every entry is validated with the slug rule and names are cut short; the
 * page renders names as text (React escapes them) and builds links from the
 * validated slug only.
 */

import {
  MAX_REMEMBERED_SHOPS,
  REMEMBERED_SHOPS_COOKIE,
  forgetShop,
  parseRememberedShops,
  rememberShop,
  rememberedShopsCookie,
  type RememberedShop,
} from "../rememberedShops";

const T1 = "2026-10-01T10:00:00.000Z";
const T2 = "2026-10-02T10:00:00.000Z";

function cookieHeaderFor(list: RememberedShop[]): string {
  const set = rememberedShopsCookie(list, "liratek.shop");
  // "lt_shops=<value>; Domain=…" -> the "name=value" pair a browser returns.
  return `other=1; ${set.split(";")[0]}`;
}

describe("rememberShop / forgetShop", () => {
  it("adds a shop, most recent first, and refreshes a known one", () => {
    let list = rememberShop([], { slug: "beta", name: "Beta" }, T1);
    list = rememberShop(list, { slug: "cellcity", name: "Cell City" }, T1);
    list = rememberShop(list, { slug: "beta", name: "Beta Phones" }, T2);
    expect(list).toEqual([
      { slug: "beta", name: "Beta Phones", lastUsedAt: T2 },
      { slug: "cellcity", name: "Cell City", lastUsedAt: T1 },
    ]);
  });

  it(`keeps at most ${MAX_REMEMBERED_SHOPS}`, () => {
    let list: RememberedShop[] = [];
    for (let i = 0; i < MAX_REMEMBERED_SHOPS + 3; i++) {
      list = rememberShop(list, { slug: `shop${i}`, name: `Shop ${i}` }, T1);
    }
    expect(list).toHaveLength(MAX_REMEMBERED_SHOPS);
    expect(list[0]!.slug).toBe(`shop${MAX_REMEMBERED_SHOPS + 2}`);
  });

  it("refuses a slug the slug rule refuses, or a platform label", () => {
    expect(rememberShop([], { slug: "www", name: "x" }, T1)).toEqual([]);
    expect(rememberShop([], { slug: "Bad Slug", name: "x" }, T1)).toEqual([]);
  });

  it("forgets one shop", () => {
    const list = rememberShop(
      rememberShop([], { slug: "beta", name: "Beta" }, T1),
      { slug: "cellcity", name: "Cell City" },
      T2,
    );
    expect(forgetShop(list, "beta").map((s) => s.slug)).toEqual(["cellcity"]);
  });
});

describe("the cookie", () => {
  it("is set on the parent domain, a year, Lax, Secure, readable by script", () => {
    const set = rememberedShopsCookie(
      [{ slug: "beta", name: "Beta", lastUsedAt: T1 }],
      "liratek.shop",
    );
    expect(set.startsWith(`${REMEMBERED_SHOPS_COOKIE}=`)).toBe(true);
    expect(set).toContain("; Domain=.liratek.shop");
    expect(set).toContain("; Path=/");
    expect(set).toContain("; Max-Age=31536000");
    expect(set).toContain("; SameSite=Lax");
    expect(set).toContain("; Secure");
    expect(set).not.toMatch(/HttpOnly/i);
  });

  it("holds only slug, name and time — round-trips through a cookie header", () => {
    const list = [
      { slug: "beta", name: "Beta; Phones = 1", lastUsedAt: T1 },
      { slug: "cellcity", name: "Cell City", lastUsedAt: T2 },
    ];
    expect(parseRememberedShops(cookieHeaderFor(list))).toEqual(list);
  });

  it("an empty list deletes the cookie (Max-Age=0, same Domain and Path)", () => {
    const set = rememberedShopsCookie([], "liratek.shop");
    expect(set).toContain("; Max-Age=0");
    expect(set).toContain("; Domain=.liratek.shop");
    expect(set).toContain("; Path=/");
  });

  it("reads nothing from a missing or garbled cookie", () => {
    expect(parseRememberedShops("")).toEqual([]);
    expect(parseRememberedShops(`${REMEMBERED_SHOPS_COOKIE}=%7Bnot-json`)).toEqual(
      [],
    );
    expect(parseRememberedShops(`${REMEMBERED_SHOPS_COOKIE}=%7B%7D`)).toEqual([]);
  });

  it("drops entries a hostile subdomain could have planted", () => {
    const planted = encodeURIComponent(
      JSON.stringify([
        { s: "javascript:alert(1)", n: "x", t: T1 },
        { s: "www", n: "x", t: T1 },
        { s: "beta", n: 42, t: T1 },
        { s: "cellcity", n: "x".repeat(500), t: T1 },
        { s: "gamma", n: "<img src=x onerror=alert(1)>", t: "not a date" },
      ]),
    );
    const read = parseRememberedShops(`${REMEMBERED_SHOPS_COOKIE}=${planted}`);
    expect(read.map((s) => s.slug)).toEqual(["cellcity", "gamma"]);
    expect(read[0]!.name.length).toBeLessThanOrEqual(80);
    // Kept as plain text; React escapes it when rendering.
    expect(read[1]!.name).toBe("<img src=x onerror=alert(1)>");
    expect(read[1]!.lastUsedAt).toBe("");
  });
});

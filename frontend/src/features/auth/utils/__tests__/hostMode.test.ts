/**
 * Which login page a web host gets (owner UX change 2026-10-07):
 *   - the platform front door (www.<base>) asks for the shop address,
 *   - a shop's own address (<slug>.<base>) signs in to that shop only,
 *   - everything else (desktop, localhost, previews, an unknown address, a
 *     backend that did not answer) keeps today's combined page.
 *
 * The backend decides; the hostname is only used to recover the base domain
 * on a shop address, AFTER the backend has confirmed that address is a shop.
 * Classifying from the hostname alone would read `liratek.vercel.app` as shop
 * "liratek".
 */

import {
  normalizeShopAddress,
  resolveHostMode,
  shopLoginUrl,
  shopSlugFromAddress,
} from "../hostMode";

describe("shopSlugFromAddress (what people paste around a slug)", () => {
  it.each([
    ["cornertech", "cornertech"],
    ["  CornerTech  ", "cornertech"],
    ["cornertech.liratek.shop", "cornertech"],
    ["https://CornerTech.liratek.shop/", "cornertech"],
    ["https://cornertech.liratek.shop/#/login", "cornertech"],
    ["http://cornertech.liratek.shop?x=1", "cornertech"],
    ["", ""],
  ])("%j -> %j", (input, slug) => {
    expect(shopSlugFromAddress(input)).toBe(slug);
  });
});

describe("normalizeShopAddress (a slug the server could accept, or null)", () => {
  it.each([
    ["cornertech", "cornertech"],
    ["cornertech.liratek.shop", "cornertech"],
    ["https://cornertech.liratek.shop/#/login", "cornertech"],
    ["cell-city", "cell-city"],
  ])("accepts %j as %j", (input, slug) => {
    expect(normalizeShopAddress(input)).toBe(slug);
  });

  it.each([
    [""],
    ["   "],
    ["a"], // too short for the server's slug rule
    ["-shop"],
    ["my shop"],
    ["shop_1"],
    // The platform's own labels name no shop: typing them must not bounce
    // the visitor straight back to this page.
    ["www"],
    ["www.liratek.shop"],
    ["admin"],
  ])("rejects %j", (input) => {
    expect(normalizeShopAddress(input)).toBeNull();
  });
});

describe("shopLoginUrl", () => {
  it("builds the shop's own login address", () => {
    expect(shopLoginUrl("cornertech", "liratek.shop")).toBe(
      "https://cornertech.liratek.shop/#/login",
    );
  });
});

describe("resolveHostMode", () => {
  const platformInfo = {
    platformHost: true,
    baseDomain: "liratek.shop",
    shopName: null,
  };
  const shopInfo = {
    platformHost: false,
    baseDomain: null,
    shopName: "CornerTech",
  };
  const plainInfo = { platformHost: false, baseDomain: null, shopName: null };

  it("platform host (production www answer)", () => {
    expect(resolveHostMode(platformInfo, "www.liratek.shop")).toEqual({
      kind: "platform",
      baseDomain: "liratek.shop",
    });
  });

  it("shop host: base domain is the hostname minus the shop label", () => {
    expect(resolveHostMode(shopInfo, "cornertech.liratek.shop")).toEqual({
      kind: "shop",
      baseDomain: "liratek.shop",
    });
  });

  it("platform without a base domain stays combined (cannot build addresses)", () => {
    expect(
      resolveHostMode(
        { ...platformInfo, baseDomain: null },
        "www.liratek.shop",
      ),
    ).toEqual({ kind: "combined" });
  });

  it.each([
    ["localhost (dev / e2e: host tenancy off)", plainInfo, "localhost"],
    ["a preview deployment", plainInfo, "liratek.vercel.app"],
    ["an unknown shop address", plainInfo, "nosuchshop.liratek.shop"],
    ["no answer from the backend", null, "www.liratek.shop"],
    [
      "no answer from the backend on a shop address",
      null,
      "cornertech.liratek.shop",
    ],
    // The dev override (x-tenant-slug) can name a shop on localhost: there is
    // no base domain to send anyone to, so nothing changes there.
    ["a shop named on localhost", shopInfo, "localhost"],
    ["a shop named on an IP address", shopInfo, "10.0.0.5"],
  ])("combined: %s", (_label, info, hostname) => {
    expect(resolveHostMode(info, hostname)).toEqual({ kind: "combined" });
  });
});

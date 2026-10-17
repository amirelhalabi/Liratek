/** @jest-environment jsdom */
/**
 * LIRA-331 (OD-3) — seeded category names translate only while they still
 * equal the seed. Written with the helper; NOT RUN when written (owner paused
 * test runs until every LIRA-331 agent finishes). Not failing-first: the
 * helper is new.
 */
import { loadLanguage } from "@/i18n/setup";
import { categoryLabel } from "../categoryLabel";

beforeAll(async () => {
  await loadLanguage("ar");
});

describe("categoryLabel (OD-3)", () => {
  it("shows a seeded category in the display language", () => {
    expect(categoryLabel("Phones", "en")).toBe("Phones");
    expect(categoryLabel("Phones", "ar")).not.toBe("Phones");
  });

  it("shows a renamed or shop-added category as stored", () => {
    expect(categoryLabel("Phones & Tablets", "ar")).toBe("Phones & Tablets");
    expect(categoryLabel("Laptops", "ar")).toBe("Laptops");
  });

  it("is case-exact: a seed typed differently is not the seed", () => {
    expect(categoryLabel("phones", "ar")).toBe("phones");
  });
});

import { getCardImage } from "../cardImages";
import { whishAppCatalog } from "@/data/providers/whishApp";

describe("getCardImage", () => {
  it("returns artwork for a known Prepaid card of either carrier", () => {
    expect(
      getCardImage({ category: "mtc", subcategory: "Prepaid", label: "7.58" }),
    ).toBeDefined();
    expect(
      getCardImage({
        category: "alfa",
        subcategory: "Prepaid",
        label: "15.15",
      }),
    ).toBeDefined();
    expect(
      getCardImage({ category: "mtc", subcategory: "Prepaid", label: "start" }),
    ).toBeDefined();
  });

  it("covers the Prepaid cards added from the Whish app artwork", () => {
    for (const label of ["1.22", "4.5", "10"]) {
      expect(
        getCardImage({ category: "alfa", subcategory: "Prepaid", label }),
      ).toBeDefined();
    }
    for (const label of ["10", "smart", "super", "startSOS"]) {
      expect(
        getCardImage({ category: "mtc", subcategory: "Prepaid", label }),
      ).toBeDefined();
    }
  });

  it("matches label variants of the same face value", () => {
    for (const label of ["4.5", "4.50", "4.5$", "$4.50", " 4.5 "]) {
      expect(
        getCardImage({ category: "mtc", subcategory: "Prepaid", label }),
      ).toBeDefined();
    }
  });

  it("covers non-Prepaid groups: data bundles, validity, gaming, internet", () => {
    expect(
      getCardImage({
        category: "alfa",
        subcategory: "Mobile Internet",
        label: "7GB",
      }),
    ).toBeDefined();
    expect(
      getCardImage({
        category: "mtc",
        subcategory: "Validity",
        label: "30 days",
      }),
    ).toBeDefined();
    expect(
      getCardImage({
        category: "Gaming",
        subcategory: "PlayStation LEB",
        label: "10$ PSN",
      }),
    ).toBeDefined();
    expect(
      getCardImage({
        category: "Gaming",
        subcategory: "Pubg voucher",
        label: "600UC +60 free",
      }),
    ).toBeDefined();
    expect(
      getCardImage({
        category: "internet",
        subcategory: "Wise",
        label: "2890",
      }),
    ).toBeDefined();
  });

  it("returns the same image for the same card in two groups (direct vs voucher)", () => {
    expect(
      getCardImage({
        category: "Gaming",
        subcategory: "Pubg direct",
        label: "660 UC",
      }),
    ).toBe(
      getCardImage({
        category: "Gaming",
        subcategory: "Pubg voucher",
        label: "600UC +60 free",
      }),
    );
  });

  it("returns undefined for denominations without artwork", () => {
    expect(
      getCardImage({ category: "mtc", subcategory: "Prepaid", label: "1" }),
    ).toBeUndefined();
    expect(
      getCardImage({ category: "Gaming", subcategory: "Steam", label: "5$" }),
    ).toBeUndefined();
  });

  it("does not leak a Prepaid card into another group with the same label", () => {
    expect(
      getCardImage({ category: "mtc", subcategory: "Credits", label: "7.58" }),
    ).toBeUndefined();
    expect(
      getCardImage({
        category: "internet",
        subcategory: "Prepaid",
        label: "7.58",
      }),
    ).toBeUndefined();
  });

  it("has a card for every Whish App item sold in USD only (LIRA-324)", () => {
    const usdOnly: Array<[string, string, string]> = [];
    for (const [category, subs] of Object.entries(whishAppCatalog)) {
      for (const [subcategory, labels] of Object.entries(subs)) {
        for (const [label, p] of Object.entries(labels)) {
          if (p.cost === "0" && p.cost_usd !== undefined) {
            usdOnly.push([category, subcategory, label]);
          }
        }
      }
    }
    expect(usdOnly).toHaveLength(33);
    for (const [category, subcategory, label] of usdOnly) {
      expect(getCardImage({ category, subcategory, label })).toBeDefined();
    }
  });
});

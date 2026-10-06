import { getCardImage } from "../cardImages";

describe("getCardImage", () => {
  it("returns artwork for a known Prepaid card of either carrier", () => {
    expect(
      getCardImage({ category: "mtc", subcategory: "Prepaid", label: "7.58" }),
    ).toBeDefined();
    expect(
      getCardImage({ category: "alfa", subcategory: "Prepaid", label: "15.15" }),
    ).toBeDefined();
    expect(
      getCardImage({ category: "mtc", subcategory: "Prepaid", label: "start" }),
    ).toBeDefined();
  });

  it("matches label variants of the same face value", () => {
    for (const label of ["4.5", "4.50", "4.5$", "$4.50", " 4.5 "]) {
      expect(
        getCardImage({ category: "mtc", subcategory: "Prepaid", label }),
      ).toBeDefined();
    }
  });

  it("returns undefined for denominations without artwork", () => {
    expect(
      getCardImage({ category: "alfa", subcategory: "Prepaid", label: "4.5" }),
    ).toBeUndefined();
    expect(
      getCardImage({ category: "mtc", subcategory: "Prepaid", label: "10" }),
    ).toBeUndefined();
  });

  it("ignores non-Prepaid groups and other categories", () => {
    expect(
      getCardImage({ category: "mtc", subcategory: "Credits", label: "7.58" }),
    ).toBeUndefined();
    expect(
      getCardImage({ category: "internet", subcategory: "Prepaid", label: "7.58" }),
    ).toBeUndefined();
  });
});

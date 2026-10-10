import { isAutoRow, isHiddenByDefault } from "../transactionVisibility.js";

const auto = JSON.stringify({ is_auto: true });

describe("isHiddenByDefault", () => {
  it("hides client-log rows whatever their metadata", () => {
    expect(isHiddenByDefault({ type: "CLIENT_CREATED", metadata_json: null })).toBe(true);
  });

  it("hides system-written supplier, expense and warranty-cost rows", () => {
    for (const type of ["SUPPLIER_PAYMENT", "EXPENSE", "WARRANTY_COST"]) {
      expect(isHiddenByDefault({ type, metadata_json: auto })).toBe(true);
    }
  });

  it("keeps the manual rows of those same types", () => {
    for (const type of ["SUPPLIER_PAYMENT", "EXPENSE", "WARRANTY_COST"]) {
      expect(isHiddenByDefault({ type, metadata_json: JSON.stringify({ note: "x" }) })).toBe(false);
      expect(isHiddenByDefault({ type, metadata_json: null })).toBe(false);
    }
  });

  it("keeps operator rows of other types even if flagged", () => {
    expect(isHiddenByDefault({ type: "SALE", metadata_json: auto })).toBe(false);
  });

  it("reads missing or broken metadata as visible", () => {
    expect(isAutoRow(undefined)).toBe(false);
    expect(isAutoRow("{not json")).toBe(false);
    expect(isAutoRow("null")).toBe(false);
    expect(isAutoRow(JSON.stringify({ is_auto: "true" }))).toBe(false);
  });
});

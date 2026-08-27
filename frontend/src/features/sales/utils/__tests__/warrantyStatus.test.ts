import { getWarrantyState } from "../warrantyStatus";

describe("getWarrantyState", () => {
  it("is NONE when there is no warranty_until at all", () => {
    expect(getWarrantyState(null, "2026-08-25", false)).toBe("NONE");
    expect(getWarrantyState(undefined, "2026-08-25", false)).toBe("NONE");
  });

  it("is VOID when the line is refunded, regardless of the date", () => {
    expect(getWarrantyState("2027-01-01", "2026-08-25", true)).toBe("VOID");
    expect(getWarrantyState("2020-01-01", "2026-08-25", true)).toBe("VOID");
  });

  it("is COVERED when warranty_until is today or later", () => {
    expect(getWarrantyState("2026-08-25", "2026-08-25", false)).toBe("COVERED");
    expect(getWarrantyState("2027-01-01", "2026-08-25", false)).toBe("COVERED");
  });

  it("is EXPIRED when warranty_until is before today", () => {
    expect(getWarrantyState("2026-08-24", "2026-08-25", false)).toBe("EXPIRED");
  });

  it("compares only the date prefix of a full ISO datetime", () => {
    expect(
      getWarrantyState("2026-08-25T23:59:00Z", "2026-08-25T00:00:00Z", false),
    ).toBe("COVERED");
  });

  it("VOID takes precedence over an otherwise-covered date", () => {
    expect(getWarrantyState("2099-01-01", "2026-08-25", true)).toBe("VOID");
  });
});

import { snapValidityDaysUp, VALIDITY_DAYS_PER_SMS } from "../validityDays";

describe("snapValidityDaysUp", () => {
  it("snaps up to the next multiple of 10", () => {
    expect(snapValidityDaysUp("1")).toBe("10");
    expect(snapValidityDaysUp("11")).toBe("20");
    expect(snapValidityDaysUp("25")).toBe("30");
    expect(snapValidityDaysUp("31")).toBe("40");
  });

  it("leaves an exact multiple of 10 alone", () => {
    expect(snapValidityDaysUp("10")).toBe("10");
    expect(snapValidityDaysUp("30")).toBe("30");
    expect(snapValidityDaysUp("360")).toBe("360");
  });

  it("leaves every Quick Days button value untouched", () => {
    for (const days of [10, 20, 30, 60, 90, 120, 180, 360]) {
      expect(snapValidityDaysUp(String(days))).toBe(String(days));
    }
  });

  it("rounds a fractional entry up to a whole block", () => {
    // A partial block still costs a whole SMS.
    expect(snapValidityDaysUp("0.5")).toBe("10");
    expect(snapValidityDaysUp("10.2")).toBe("20");
  });

  it("returns empty / blank input unchanged", () => {
    expect(snapValidityDaysUp("")).toBe("");
    expect(snapValidityDaysUp("   ")).toBe("   ");
  });

  it("returns non-numeric input unchanged rather than guessing", () => {
    expect(snapValidityDaysUp("abc")).toBe("abc");
    expect(snapValidityDaysUp("-")).toBe("-");
  });

  it("returns zero and negatives unchanged (nothing to snap)", () => {
    expect(snapValidityDaysUp("0")).toBe("0");
    expect(snapValidityDaysUp("-5")).toBe("-5");
  });

  it("tolerates surrounding whitespace", () => {
    expect(snapValidityDaysUp(" 25 ")).toBe("30");
  });

  it("exposes the block size as one named constant", () => {
    expect(VALIDITY_DAYS_PER_SMS).toBe(10);
  });
});

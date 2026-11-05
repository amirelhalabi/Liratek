import {
  CASH_DRAWER_CHOICES,
  cashDrawerChoiceNotApplicable,
  systemCashDrawerChoiceApplies,
} from "../cashDrawerChoice.js";

// LIRA-371 — supplier applicability predicate (shared by screens + server).
const isGeneralCash = (m: string) => m === "CASH";

describe("LIRA-371 systemCashDrawerChoiceApplies", () => {
  it("OMT shop + provider OMT + one CASH leg → true", () => {
    expect(
      systemCashDrawerChoiceApplies({
        provider: "OMT",
        baseSystem: "OMT",
        legs: [{ method: "CASH" }],
        isGeneralCash,
      }),
    ).toBe(true);
  });

  it("provider WHISH on an OMT shop → false", () => {
    expect(
      systemCashDrawerChoiceApplies({
        provider: "WHISH",
        baseSystem: "OMT",
        legs: [{ method: "CASH" }],
        isGeneralCash,
      }),
    ).toBe(false);
  });

  it("provider OMT on a Whish shop → false", () => {
    expect(
      systemCashDrawerChoiceApplies({
        provider: "OMT",
        baseSystem: "WHISH",
        legs: [{ method: "CASH" }],
        isGeneralCash,
      }),
    ).toBe(false);
  });

  it("Katsh / null provider → false", () => {
    for (const provider of ["KATSH", null, undefined]) {
      expect(
        systemCashDrawerChoiceApplies({
          provider,
          baseSystem: "OMT",
          legs: [{ method: "CASH" }],
          isGeneralCash,
        }),
      ).toBe(false);
    }
  });

  it("only non-cash legs (WHISH_APP) → false", () => {
    expect(
      systemCashDrawerChoiceApplies({
        provider: "OMT",
        baseSystem: "OMT",
        legs: [{ method: "WHISH_APP" }],
        isGeneralCash,
      }),
    ).toBe(false);
  });

  it("a CASH change (OUT) leg alone → true", () => {
    expect(
      systemCashDrawerChoiceApplies({
        provider: "WHISH",
        baseSystem: "WHISH",
        legs: [{ method: "CASH", direction: "OUT" } as { method: string }],
        isGeneralCash,
      }),
    ).toBe(true);
  });

  it("refusal text names the base system", () => {
    expect(cashDrawerChoiceNotApplicable("OMT")).toContain("OMT system transfer");
    expect(cashDrawerChoiceNotApplicable("WHISH")).toContain("Whish system transfer");
    expect(CASH_DRAWER_CHOICES).toEqual(["SYSTEM", "GENERAL"]);
  });
});

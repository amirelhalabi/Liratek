/**
 * Custom Services' partner mode (Customer / For Partner / Via Partner) is
 * one segmented control since 2026-10-16. It replaced two checkboxes whose
 * onChange handlers (plus ForPartnerToggle's own "unchecking clears the
 * partner") carried side effects. This pins every transition so none of
 * those side effects is lost.
 */
import {
  partnerModeTransition,
  type PartnerMode,
} from "../partnerModeTransition";

const NOTHING = {
  clearPayments: false,
  clearPayout: false,
  clearPartner: false,
};

describe("partnerModeTransition", () => {
  it.each<[PartnerMode]>([["none"], ["FOR"], ["VIA"]])(
    "re-selecting the active mode (%s) does nothing",
    (mode) => {
      expect(partnerModeTransition(mode, mode)).toBeNull();
    },
  );

  it("Customer → For Partner drops payment lines and Pay out, keeps the partner", () => {
    expect(partnerModeTransition("none", "FOR")).toEqual({
      clearPayments: true,
      clearPayout: true,
      clearPartner: false,
    });
  });

  it("Customer → Via Partner keeps the payment lines (the customer still pays)", () => {
    expect(partnerModeTransition("none", "VIA")).toEqual(NOTHING);
  });

  it("For Partner → Customer clears the partner", () => {
    expect(partnerModeTransition("FOR", "none")).toEqual({
      clearPayments: false,
      clearPayout: true,
      clearPartner: true,
    });
  });

  it("Via Partner → Customer clears the partner and Pay out", () => {
    expect(partnerModeTransition("VIA", "none")).toEqual({
      clearPayments: false,
      clearPayout: true,
      clearPartner: true,
    });
  });

  it("Via Partner → For Partner drops payment lines and Pay out, keeps the partner", () => {
    expect(partnerModeTransition("VIA", "FOR")).toEqual({
      clearPayments: true,
      clearPayout: true,
      clearPartner: false,
    });
  });

  it("For Partner → Via Partner keeps the partner and touches nothing else", () => {
    expect(partnerModeTransition("FOR", "VIA")).toEqual(NOTHING);
  });
});

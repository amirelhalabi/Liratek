/**
 * LIRA-270 — `basketHasNothingToCollect` must refuse a customer payment leg
 * ONLY when the checkout modal would also have hidden its payment input
 * (net charge below the widget's dust: $0.01 / 0.5 LBP per currency). A
 * cross-currency netted basket can owe a few hundred LBP that is worth less
 * than a cent — the modal still asks for it, so the server must accept it.
 *
 * Rule 17: the "180 LBP still due" case was run against the first version
 * (USD-equivalent < $0.01) and observed RED before the threshold was fixed.
 */
import { basketHasNothingToCollect } from "../SessionPaymentService";

describe("LIRA-270 — basketHasNothingToCollect", () => {
  it("nothing due in either currency → true", () => {
    expect(basketHasNothingToCollect({ usd: 0, lbp: 0 }, 89000)).toBe(true);
    expect(basketHasNothingToCollect({ usd: -30, lbp: 0 }, 89000)).toBe(true);
  });

  it("a cross-currency payout that covers the charge exactly → true", () => {
    // 890,000 LBP charge netted against a $10 cash prize at 89,000.
    expect(basketHasNothingToCollect({ usd: -10, lbp: 890000 }, 89000)).toBe(
      true,
    );
  });

  it("180 LBP still due after a cross-currency netting → false (the modal asks for it)", () => {
    // 890,180 LBP charge − $10 prize = 180 LBP, worth $0.002.
    expect(basketHasNothingToCollect({ usd: -10, lbp: 890180 }, 89000)).toBe(
      false,
    );
  });

  it("a few cents still due → false", () => {
    expect(basketHasNothingToCollect({ usd: 0.03, lbp: 0 }, 89000)).toBe(false);
  });

  it("missing rate (fallback 1): only the per-currency test applies", () => {
    expect(basketHasNothingToCollect({ usd: -10, lbp: 890000 }, 1)).toBe(false);
    expect(basketHasNothingToCollect({ usd: 0, lbp: 0 }, 1)).toBe(true);
  });
});

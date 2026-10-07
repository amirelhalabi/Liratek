/**
 * Refund kept change (owner decision 2026-10-07) — the pure halves of the
 * refund popup's Confirm gate: `validateRefundValue`'s optional `kept`
 * argument (legs + kept must equal the refund value; only a shortfall is
 * ever kept) and `validateRefundKeptChange` (cash only, the refund's own
 * currency) — both mirror the server's `_resolveRefundKeptChange`.
 *
 * Rule 17 disclosure: written AFTER these two functions were changed, so
 * NOT proven failing-first. The modal-level test
 * (RefundMethodModal.keptChange.test.tsx) was written first and seen
 * failing.
 */
import {
  validateRefundKeptChange,
  validateRefundValue,
} from "../refundLegOverride";

const RATE = 89_000;
const cash = (amount: number, currencyCode: "USD" | "LBP" = "USD") => ({
  method: "CASH",
  currencyCode,
  amount,
});

describe("validateRefundValue with kept change", () => {
  it("$20 handed back + $0.12 kept matches a $20.12 refund", () => {
    expect(
      validateRefundValue([cash(20)], { USD: 20.12 }, RATE, {
        usd: 0.12,
        lbp: 0,
      }),
    ).toBeNull();
  });

  it("without kept, $20 of $20.12 is still refused (unchanged)", () => {
    expect(validateRefundValue([cash(20)], { USD: 20.12 }, RATE)).toMatch(
      /must equal \$20\.12/,
    );
  });

  it("LBP: 1,750,000 handed back + 50,000 kept matches 1,800,000", () => {
    expect(
      validateRefundValue([cash(1_750_000, "LBP")], { LBP: 1_800_000 }, RATE, {
        usd: 0,
        lbp: 50_000,
      }),
    ).toBeNull();
  });
});

describe("validateRefundKeptChange", () => {
  it("nothing kept → no objection, whatever the lines", () => {
    expect(
      validateRefundKeptChange(
        [{ method: "OMT", currencyCode: "USD", amount: 20 }],
        "USD",
        null,
      ),
    ).toBeNull();
  });

  it("a non-cash line refuses kept change", () => {
    expect(
      validateRefundKeptChange(
        [{ method: "OMT", currencyCode: "USD", amount: 20 }],
        "USD",
        { usd: 0.12, lbp: 0 },
      ),
    ).toMatch(/cash/);
  });

  it("a line in another currency refuses kept change", () => {
    expect(
      validateRefundKeptChange([cash(1_780_000, "LBP")], "USD", {
        usd: 0.12,
        lbp: 0,
      }),
    ).toMatch(/USD/);
  });

  it("all cash, same currency → allowed", () => {
    expect(
      validateRefundKeptChange([cash(20)], "USD", { usd: 0.12, lbp: 0 }),
    ).toBeNull();
  });
});

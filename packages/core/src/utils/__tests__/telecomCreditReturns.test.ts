/**
 * LIRA-153 — Only-Days credit-return resolution and valuation, as pure logic.
 *
 * `FinancialServiceRepository.telecomOnlyDays.test.ts` proves the repository
 * stamps the right profit. This file proves the two decisions underneath it in
 * isolation: WHICH lines return HOW MUCH credit, and WHAT that credit is worth.
 *
 * The resolution used to live inside the repository's booking closure, where it
 * could only be exercised through a database and could not be reused by the
 * profit stamp — which is exactly how the stamp came to ignore it.
 */

import {
  TELECOM_CREDIT_COST_RATE_LBP,
  maxReturnableCredits,
  parseCarrierKey,
  resolveReturnedCredits,
  resolveTelecomCreditReturns,
  telecomCreditReturnValueLbp,
  type TelecomCreditReturnItem,
} from "../telecomCredit.js";

/** A catalog item whose split is complete (cost + days cost + credits). */
const SPLIT_COMPLETE: TelecomCreditReturnItem = {
  category: "mtc",
  cost_lbp: 7_600_000,
  days_cost_lbp: 1_162_000,
  credits: 77,
};

/** Same card, but nobody has configured the days/credit split yet. */
const SPLIT_INCOMPLETE: TelecomCreditReturnItem = {
  category: "mtc",
  cost_lbp: 7_600_000,
  days_cost_lbp: null,
  credits: 77,
};

describe("parseCarrierKey", () => {
  it("accepts every casing the layers below actually send", () => {
    for (const raw of ["alfa", "Alfa", "ALFA", " alfa "]) {
      expect(parseCarrierKey(raw)).toBe("alfa");
    }
    for (const raw of ["mtc", "Mtc", "MTC", " MTC "]) {
      expect(parseCarrierKey(raw)).toBe("mtc");
    }
  });

  it("returns null for anything it cannot place", () => {
    for (const raw of [null, undefined, "", "touch", "ogero"]) {
      expect(parseCarrierKey(raw)).toBeNull();
    }
  });
});

describe("resolveReturnedCredits", () => {
  it("computes the default from the item when no override is given", () => {
    expect(resolveReturnedCredits({}, SPLIT_COMPLETE)).toBe(
      maxReturnableCredits(77),
    );
    // Pin the headline figure so a change to the SMS model is visible here.
    expect(resolveReturnedCredits({}, SPLIT_COMPLETE)).toBe(73);
  });

  it("an explicit override always wins, even below the computed default", () => {
    expect(
      resolveReturnedCredits({ returnedCreditsUsd: 50 }, SPLIT_COMPLETE),
    ).toBe(50);
  });

  it("an override of exactly 0 is honoured, not treated as 'unset'", () => {
    // The operator dialing the return down to nothing is a real instruction.
    expect(
      resolveReturnedCredits({ returnedCreditsUsd: 0 }, SPLIT_COMPLETE),
    ).toBe(0);
  });

  it("a split-INCOMPLETE item has no default to fall back to", () => {
    expect(resolveReturnedCredits({}, SPLIT_INCOMPLETE)).toBe(0);
  });

  it("no item at all means no default", () => {
    expect(resolveReturnedCredits({}, null)).toBe(0);
    expect(resolveReturnedCredits({}, undefined)).toBe(0);
  });
});

describe("resolveTelecomCreditReturns", () => {
  const lookup = (id: number): TelecomCreditReturnItem | null =>
    id === 1 ? SPLIT_COMPLETE : null;

  it("resolves a single line to its carrier and credit", () => {
    const { resolved, skipped } = resolveTelecomCreditReturns(
      [{ itemCategory: "mtc", mobileServiceItemId: 1 }],
      lookup,
    );
    expect(resolved).toEqual([{ carrier: "mtc", credits: 73 }]);
    expect(skipped).toHaveLength(0);
  });

  it("resolves every line of a multi-line walk-in cart", () => {
    const { resolved } = resolveTelecomCreditReturns(
      [
        { itemCategory: "mtc", mobileServiceItemId: 1 },
        { itemCategory: "alfa", mobileServiceItemId: 1 },
        { itemCategory: "mtc", returnedCreditsUsd: 12 },
      ],
      lookup,
    );
    expect(resolved).toEqual([
      { carrier: "mtc", credits: 73 },
      { carrier: "alfa", credits: 73 },
      { carrier: "mtc", credits: 12 },
    ]);
  });

  it("falls back to the ITEM's category when the line omits one", () => {
    const { resolved } = resolveTelecomCreditReturns(
      [{ mobileServiceItemId: 1 }],
      lookup,
    );
    expect(resolved).toEqual([{ carrier: "mtc", credits: 73 }]);
  });

  it("drops lines that return nothing, without reporting them as skipped", () => {
    // Returning 0 is a legitimate outcome, not an anomaly worth logging.
    const { resolved, skipped } = resolveTelecomCreditReturns(
      [
        { itemCategory: "mtc", returnedCreditsUsd: 0 },
        { itemCategory: "mtc", mobileServiceItemId: 999 },
      ],
      lookup,
    );
    expect(resolved).toHaveLength(0);
    expect(skipped).toHaveLength(0);
  });

  it("reports a line whose carrier cannot be identified as SKIPPED", () => {
    // It returns credit but has nowhere to put it — the caller must log this.
    const { resolved, skipped } = resolveTelecomCreditReturns(
      [{ itemCategory: "ogero", returnedCreditsUsd: 5 }],
      lookup,
    );
    expect(resolved).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });

  it("never calls the lookup for a line with no item id", () => {
    // The manual path must not need a catalog row to exist.
    const spy = jest.fn(() => null);
    const { resolved } = resolveTelecomCreditReturns(
      [{ itemCategory: "mtc", returnedCreditsUsd: 9 }],
      spy,
    );
    expect(spy).not.toHaveBeenCalled();
    expect(resolved).toEqual([{ carrier: "mtc", credits: 9 }]);
  });

  it("is a no-op on an empty list", () => {
    expect(resolveTelecomCreditReturns([], lookup)).toEqual({
      resolved: [],
      skipped: [],
    });
  });
});

describe("telecomCreditReturnValueLbp", () => {
  it("values the credit at the shop's own cost of credit", () => {
    expect(telecomCreditReturnValueLbp(73)).toBe(
      73 * TELECOM_CREDIT_COST_RATE_LBP,
    );
    expect(telecomCreditReturnValueLbp(73)).toBe(6_205_000);
  });

  it("uses a supplied per-tenant rate over the constant", () => {
    expect(telecomCreditReturnValueLbp(73, 90_000)).toBe(6_570_000);
  });

  it("rounds to whole LBP — there is no sub-lira", () => {
    expect(telecomCreditReturnValueLbp(0.005, 85_000)).toBe(425);
    expect(Number.isInteger(telecomCreditReturnValueLbp(7.58, 85_000))).toBe(
      true,
    );
  });

  it("is zero for a non-return, and never negative", () => {
    expect(telecomCreditReturnValueLbp(0)).toBe(0);
    expect(telecomCreditReturnValueLbp(-5)).toBe(0);
    expect(telecomCreditReturnValueLbp(NaN)).toBe(0);
  });

  it("refuses a nonsensical rate rather than inventing a value", () => {
    expect(telecomCreditReturnValueLbp(73, 0)).toBe(0);
    expect(telecomCreditReturnValueLbp(73, -1)).toBe(0);
    expect(telecomCreditReturnValueLbp(73, NaN)).toBe(0);
  });

  it("D2.1: valuing the ACTUAL recovery costs less than valuing the face", () => {
    // The gap is the SMS transfer haircut — a real cost of extracting the
    // credit, and the whole substance of the owner's decision.
    const face = telecomCreditReturnValueLbp(77);
    const actual = telecomCreditReturnValueLbp(maxReturnableCredits(77));
    expect(face - actual).toBe(4 * TELECOM_CREDIT_COST_RATE_LBP);
    expect(face - actual).toBe(340_000);
  });
});

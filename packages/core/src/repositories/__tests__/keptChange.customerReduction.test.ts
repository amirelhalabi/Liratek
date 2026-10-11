/**
 * LIRA-310 T018 — `resolveKeptChange` customer branch learns a REDUCTION
 * claim: the shop accepts a little less than the total (the Waive button,
 * a Loto ticket discount, a session basket waive). The reduction lowers
 * profit only; the helper's job is to make sure the claim is REAL:
 *
 *   IN − OUT = expected − reduction       (USD-equivalent, at the tender rate)
 *
 * and the claimed reduction equals the real gap within cents / whole-LBP
 * rounding, never above the caller's cap (per currency AND in total), never
 * together with kept change, change given back, a partner transaction or an
 * empty payment.
 *
 * Kept in its own file (not inside keptChange.test.ts) because another
 * LIRA-310 lane edits that file's payout cases at the same time.
 *
 * Rule 17: written before the helper learned `claimedReduction`; the run
 * against the unchanged helper is recorded under T018 in
 * specs/310-waive-everywhere/tasks.md.
 */

import { resolveKeptChange } from "../keptChange";
import type { ReconciliationLeg } from "../moneyPosting";
import { SHORTFALL_MAX } from "../../validators/exchange";

const RATE = 90_000;

function leg(
  currencyCode: "USD" | "LBP",
  amount: number,
  extra: Partial<ReconciliationLeg> = {},
): ReconciliationLeg {
  return { method: "CASH", currencyCode, amount, ...extra };
}

const base = {
  exchangeRate: RATE,
  context: "TEST",
  payer: "customer" as const,
};

const CAP = { usd: SHORTFALL_MAX.USD, lbp: SHORTFALL_MAX.LBP };

describe("resolveKeptChange — customer reduction (LIRA-310)", () => {
  it("(a) $16.50 due, $16.00 paid, $0.50 claimed → reductionUsd 0.5, no kept", () => {
    const r = resolveKeptChange({
      ...base,
      expected: { usd: 16.5, lbp: 0 },
      inLegs: [leg("USD", 16)],
      claimedReduction: { usd: 0.5, lbp: 0 },
      reductionCap: CAP,
    });
    expect(r.reductionUsd).toBe(0.5);
    expect(r.reductionLbp).toBe(0);
    expect(r.keptUsd).toBe(0);
    expect(r.keptLbp).toBe(0);
  });

  it("(b) $0.40 claimed on a $0.50 gap → refused, does not match", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        expected: { usd: 16.5, lbp: 0 },
        inLegs: [leg("USD", 16)],
        claimedReduction: { usd: 0.4, lbp: 0 },
        reductionCap: CAP,
      }),
    ).toThrow(/does not match what is left to pay/);
  });

  it("(b2) $0.60 claimed on a $0.50 gap (over-claim) → refused, does not match", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        expected: { usd: 16.5, lbp: 0 },
        inLegs: [leg("USD", 16)],
        claimedReduction: { usd: 0.6, lbp: 0 },
        reductionCap: CAP,
      }),
    ).toThrow(/does not match what is left to pay/);
  });

  it("(c) claim above the cap → refused even when it matches the gap", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        expected: { usd: 20, lbp: 0 },
        inLegs: [leg("USD", 14.99)],
        claimedReduction: { usd: 5.01, lbp: 0 },
        reductionCap: CAP,
      }),
    ).toThrow(/is more than/);
  });

  it("(c2) exactly at the cap ($5.00) → accepted (up to and including)", () => {
    const r = resolveKeptChange({
      ...base,
      expected: { usd: 20, lbp: 0 },
      inLegs: [leg("USD", 15)],
      claimedReduction: { usd: 5, lbp: 0 },
      reductionCap: CAP,
    });
    expect(r.reductionUsd).toBe(5);
  });

  it("(c3) split-currency claim inside each cap but over the cap in total → refused", () => {
    // Real gap $10: $5 + 450,000 LBP each sit at their own cap, but together
    // they waive $10 — exactly what the cap exists to stop.
    expect(() =>
      resolveKeptChange({
        ...base,
        expected: { usd: 20, lbp: 0 },
        inLegs: [leg("USD", 10)],
        claimedReduction: { usd: 5, lbp: 450_000 },
        reductionCap: CAP,
      }),
    ).toThrow(/is more than/);
  });

  it("(d) reduction together with kept change → refused", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        expected: { usd: 16.5, lbp: 0 },
        inLegs: [leg("USD", 16)],
        claimedKept: { usd: 0.1 },
        claimedReduction: { usd: 0.5, lbp: 0 },
        reductionCap: CAP,
      }),
    ).toThrow(/can't be combined with change kept/);
  });

  it("(e) reduction with an OUT (change) leg → refused", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        expected: { usd: 16.5, lbp: 0 },
        inLegs: [leg("USD", 20)],
        outLegs: [leg("USD", 4, { direction: "OUT" })],
        claimedReduction: { usd: 0.5, lbp: 0 },
        reductionCap: CAP,
      }),
    ).toThrow(/can't be combined with change given back/);
  });

  it("(f) reduction on a partner transaction → refused", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        isForPartner: true,
        expected: { usd: 16.5, lbp: 0 },
        inLegs: [leg("USD", 16)],
        claimedReduction: { usd: 0.5, lbp: 0 },
        reductionCap: CAP,
      }),
    ).toThrow(/partner/);
  });

  it("(g) reduction with no payment lines → refused", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        expected: { usd: 16.5, lbp: 0 },
        inLegs: [],
        claimedReduction: { usd: 0.5, lbp: 0 },
        reductionCap: CAP,
      }),
    ).toThrow(/no payment/);
  });

  it("(h) cross-currency: $20 due paid 1,530,000 LBP ($17) → a $3 claim is the real gap", () => {
    const r = resolveKeptChange({
      ...base,
      expected: { usd: 20, lbp: 0 },
      inLegs: [leg("LBP", 1_530_000)],
      claimedReduction: { usd: 3, lbp: 0 },
      reductionCap: CAP,
    });
    expect(r.reductionUsd).toBe(3);
    expect(r.reductionLbp).toBe(0);
  });

  it("(h2) cross-currency: the same $3 gap claimed as 270,000 LBP → accepted", () => {
    const r = resolveKeptChange({
      ...base,
      expected: { usd: 20, lbp: 0 },
      inLegs: [leg("USD", 17)],
      claimedReduction: { usd: 0, lbp: 270_000 },
      reductionCap: CAP,
    });
    expect(r.reductionLbp).toBe(270_000);
  });

  it("(i) a negative claim → refused", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        expected: { usd: 16.5, lbp: 0 },
        inLegs: [leg("USD", 16)],
        claimedReduction: { usd: -0.5, lbp: 0 },
        reductionCap: CAP,
      }),
    ).toThrow(/isn't valid/);
  });

  it("(j) refusals open with one plain sentence, detail in parentheses", () => {
    let message = "";
    try {
      resolveKeptChange({
        ...base,
        expected: { usd: 16.5, lbp: 0 },
        inLegs: [leg("USD", 16)],
        claimedReduction: { usd: 0.4, lbp: 0 },
        reductionCap: CAP,
        reductionLabel: "discount",
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(
      /^The discount does not match what is left to pay\. \(TEST: .+\)$/,
    );
  });

  it("no claim → reduction fields are 0 and the old behaviour is unchanged", () => {
    const r = resolveKeptChange({
      ...base,
      expected: { usd: 10, lbp: 0 },
      inLegs: [leg("USD", 10)],
    });
    expect(r.reductionUsd).toBe(0);
    expect(r.reductionLbp).toBe(0);
  });
});

describe("resolveKeptChange — customer reduction rounding across currencies (LIRA-310)", () => {
  it("an LBP claim off by under an LBP from a USD-tendered gap is accepted (screen rounding)", () => {
    // 500,000 LBP ticket paid $5.50 at 89,500 → gap 7,750 LBP; the screen's
    // 4-dp USD waive converts back to 7,750.7 → sent as 7,751.
    const r = resolveKeptChange({
      ...base,
      exchangeRate: 89_500,
      expected: { usd: 0, lbp: 500_000 },
      inLegs: [leg("USD", 5.5)],
      claimedReduction: { usd: 0, lbp: 7_751 },
      reductionCap: { usd: 22_250 / 89_500, lbp: 22_250 },
    });
    expect(r.reductionLbp).toBe(7_751);
  });

  it("…but a claim a cent off on a USD-only payment is still refused", () => {
    expect(() =>
      resolveKeptChange({
        ...base,
        expected: { usd: 16.5, lbp: 0 },
        inLegs: [leg("USD", 16)],
        claimedReduction: { usd: 0.49, lbp: 0 },
        reductionCap: CAP,
      }),
    ).toThrow(/does not match what is left to pay/);
  });
});

describe("resolveKeptChange — a typed discount with change (reductionAllowsChange)", () => {
  it("IN 500,000, OUT 20,000, 20,000 off a 500,000 total → accepted", () => {
    const r = resolveKeptChange({
      ...base,
      expected: { usd: 0, lbp: 500_000 },
      inLegs: [leg("LBP", 500_000)],
      outLegs: [leg("LBP", 20_000, { direction: "OUT" })],
      claimedReduction: { usd: 0, lbp: 20_000 },
      reductionCap: { usd: 25_000 / RATE, lbp: 25_000 },
      reductionAllowsChange: true,
    });
    expect(r.reductionLbp).toBe(20_000);
  });

  // The screen checks the cap in the total's own currency (450,000 LBP on an
  // LBP total); the server converts to USD-equivalent. At a rate where
  // 450,000 LBP is worth MORE than $5 the two must still agree, or the
  // screen offers a Waive the server refuses.
  it.each([89_000, 90_000, 100_000])(
    "LBP-only total exactly 450,000 LBP short at rate %p → accepted",
    (rate) => {
      const r = resolveKeptChange({
        ...base,
        exchangeRate: rate,
        expected: { usd: 0, lbp: 1_450_000 },
        inLegs: [leg("LBP", 1_000_000)],
        claimedReduction: { usd: 0, lbp: 450_000 },
        reductionCap: CAP,
      });
      expect(r.reductionLbp).toBe(450_000);
    },
  );

  it("USD-only total exactly $5.00 short at rate 89,000 → accepted", () => {
    const r = resolveKeptChange({
      ...base,
      exchangeRate: 89_000,
      expected: { usd: 105, lbp: 0 },
      inLegs: [leg("USD", 100)],
      claimedReduction: { usd: 5, lbp: 0 },
      reductionCap: CAP,
    });
    expect(r.reductionUsd).toBe(5);
  });
});

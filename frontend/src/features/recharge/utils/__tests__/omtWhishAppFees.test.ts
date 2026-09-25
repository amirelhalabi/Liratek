import { calculateOmtWhishAppFees } from "../omtWhishAppFees";

const base = {
  activeProvider: "WHISH_APP" as const,
  serviceType: "RECEIVE" as const,
  currency: "USD" as const,
  manualFee: "",
  includingFees: false,
};

describe("calculateOmtWhishAppFees — Whish App RECEIVE (lira-100)", () => {
  it("fee NOT included: wallet gets amount + fee, customer receives the entered amount, profit = full fee", () => {
    // The reported bug: entered 100, auto-fee $1, "fee not included". The
    // customer should receive exactly $99 (100 − 1), and the wallet should
    // show it received $101 (100 + the $1 fee charged on top).
    const result = calculateOmtWhishAppFees({
      ...base,
      parsedAmount: 100,
      includingFees: false,
    });

    expect(result.providerFee).toBeCloseTo(1, 2);
    expect(result.walletAmount).toBeCloseTo(101, 2);
    expect(result.totalAmount).toBeCloseTo(100, 2); // customer receives
    expect(result.shopProfit).toBeCloseTo(1, 2); // FULL fee, not fee × 10%
  });

  it("fee included: wallet gets exactly the entered amount, customer receives amount − fee", () => {
    const result = calculateOmtWhishAppFees({
      ...base,
      parsedAmount: 100,
      includingFees: true,
    });

    expect(result.providerFee).toBeCloseTo(1, 2);
    expect(result.walletAmount).toBeCloseTo(100, 2);
    expect(result.totalAmount).toBeCloseTo(99, 2); // customer receives
    expect(result.shopProfit).toBeCloseTo(1, 2);
  });

  it("manual fee explicitly cleared to zero: no fee, no profit, wallet == payout", () => {
    const result = calculateOmtWhishAppFees({
      ...base,
      parsedAmount: 100,
      manualFee: "0",
      includingFees: false,
    });

    expect(result.providerFee).toBe(0);
    expect(result.walletAmount).toBeCloseTo(100, 2);
    expect(result.totalAmount).toBeCloseTo(100, 2);
    expect(result.shopProfit).toBe(0);
  });

  it("manual fee overrides the auto-fee", () => {
    const result = calculateOmtWhishAppFees({
      ...base,
      parsedAmount: 100,
      manualFee: "5",
      includingFees: false,
    });

    expect(result.providerFee).toBeCloseTo(5, 2);
    expect(result.walletAmount).toBeCloseTo(105, 2);
    expect(result.shopProfit).toBeCloseTo(5, 2);
  });

  it("LBP currency: no auto-fee for Whish App RECEIVE", () => {
    const result = calculateOmtWhishAppFees({
      ...base,
      currency: "LBP",
      parsedAmount: 9_000_000,
      includingFees: false,
    });

    expect(result.autoFee).toBe(0);
    expect(result.providerFee).toBe(0);
    expect(result.walletAmount).toBeCloseTo(9_000_000, 2);
    expect(result.totalAmount).toBeCloseTo(9_000_000, 2);
  });
});

describe("calculateOmtWhishAppFees — OMT App RECEIVE has NO fee (D1, owner decision 2026-09-23)", () => {
  // SUPERSEDES the earlier lira-101 "mirrors Whish App full-fee-as-profit"
  // contract for this one combination. The owner's verbatim D1 answer: "OMT
  // App RECEIVE — no fee, for now."
  //
  // Actually run 2026-09-23: with `omtAppReceiveHasNoFee` temporarily forced
  // to `false` in omtWhishAppFees.ts, `npx jest omtWhishAppFees.test.ts`
  // FAILED — "a manual fee is IGNORED..." got providerFee 5 (Received: 5)
  // against `expect(result.providerFee).toBe(0)` — the other 12 tests in the
  // file still passed. Reverting to the real `omtAppReceiveHasNoFee` check
  // and re-running: 13/13 GREEN.
  it("with no fee: wallet == payout == entered amount, no profit", () => {
    const result = calculateOmtWhishAppFees({
      ...base,
      activeProvider: "OMT_APP",
      parsedAmount: 100,
    });

    expect(result.providerFee).toBe(0);
    expect(result.walletAmount).toBeCloseTo(100, 2);
    expect(result.totalAmount).toBeCloseTo(100, 2);
    expect(result.shopProfit).toBe(0);
  });

  it("a manual fee is IGNORED — forced to 0 regardless of a stale/typed value, wallet == payout == entered amount", () => {
    // Before D1 this manual fee would have folded into the wallet inflow
    // (walletAmount 105) and become shop profit (shopProfit 5) — see the
    // docblock above for the RED/GREEN proof. D1 forces it away entirely: a
    // stale manualFee left over from OMT App SEND (or from a provider switch
    // away from Whish App RECEIVE) must have zero financial effect here.
    const result = calculateOmtWhishAppFees({
      ...base,
      activeProvider: "OMT_APP",
      parsedAmount: 100,
      manualFee: "5",
    });

    expect(result.isAppWalletReceive).toBe(true);
    expect(result.providerFee).toBe(0);
    expect(result.walletAmount).toBeCloseTo(100, 2);
    expect(result.totalAmount).toBeCloseTo(100, 2);
    expect(result.shopProfit).toBe(0);
  });

  it("has no auto-fee — that mechanism is Whish-App-only", () => {
    const result = calculateOmtWhishAppFees({
      ...base,
      activeProvider: "OMT_APP",
      parsedAmount: 100,
    });

    expect(result.autoFee).toBe(0);
  });
});

describe("calculateOmtWhishAppFees — SEND with a fee (the missing-$2 bug)", () => {
  // Reported 2026-07-12: OMT App SEND $20 with a $2 fee, charged to the
  // customer's account, booked only $20 of debt. shopProfit was hardcoded 0
  // for SEND, so the form sent commission 0 and the repository derived the
  // customer total as amount + 0 — the fee vanished from the drawer/debt/
  // profit records (it existed only on screen). The SEND fee is charged on
  // top and kept whole by the shop, exactly like RECEIVE.
  it.each(["OMT_APP", "WHISH_APP"] as const)(
    "%s SEND $20 + $2 fee: wallet sends 20, customer owes 22, shop profits the full fee",
    (activeProvider) => {
      const result = calculateOmtWhishAppFees({
        ...base,
        activeProvider,
        serviceType: "SEND",
        parsedAmount: 20,
        manualFee: "2",
      });

      expect(result.providerFee).toBeCloseTo(2, 2);
      expect(result.walletAmount).toBeCloseTo(20, 2); // transfer leaving the wallet
      expect(result.totalAmount).toBeCloseTo(22, 2); // customer pays amount + fee
      expect(result.shopProfit).toBeCloseTo(2, 2); // NOT 0 — commission drives the repo's cash/debt total
    },
  );

  it("SEND with fee explicitly zero stays fee-less", () => {
    const result = calculateOmtWhishAppFees({
      ...base,
      activeProvider: "OMT_APP",
      serviceType: "SEND",
      parsedAmount: 20,
      manualFee: "0",
    });

    expect(result.totalAmount).toBeCloseTo(20, 2);
    expect(result.shopProfit).toBe(0);
  });
});

describe("calculateOmtWhishAppFees — unaffected paths", () => {
  it("Whish App SEND: no fee, no profit, wallet == entered amount", () => {
    const result = calculateOmtWhishAppFees({
      ...base,
      serviceType: "SEND",
      parsedAmount: 100,
    });

    expect(result.isAppWalletReceive).toBe(false);
    expect(result.providerFee).toBe(0);
    expect(result.walletAmount).toBeCloseTo(100, 2);
    expect(result.totalAmount).toBeCloseTo(100, 2);
    expect(result.shopProfit).toBe(0);
  });

  it("OMT App SEND: no fee, no profit, wallet == entered amount", () => {
    const result = calculateOmtWhishAppFees({
      ...base,
      activeProvider: "OMT_APP",
      serviceType: "SEND",
      parsedAmount: 100,
    });

    expect(result.isAppWalletReceive).toBe(false);
    expect(result.providerFee).toBe(0);
    expect(result.walletAmount).toBeCloseTo(100, 2);
    expect(result.totalAmount).toBeCloseTo(100, 2);
    expect(result.shopProfit).toBe(0);
  });
});

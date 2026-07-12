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

describe("calculateOmtWhishAppFees — OMT App RECEIVE (lira-101: mirrors the Whish App full-fee-as-profit contract)", () => {
  // LEFT_TO_DO.md "C4/C5 app-transfer fee split", decided 2026-07-04: the fee
  // is fully the shop's for BOTH OMT App and Whish App. Whish App RECEIVE was
  // fixed first (lira-100); this cluster brings OMT App RECEIVE onto the same
  // contract. OMT App has no auto-fee and no "fee included" toggle in the UI
  // (includingFees is always false in practice for this provider), so its
  // only reachable RECEIVE state is the "fee charged on top" branch.
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

  it("with a manual fee: wallet grosses up by the fee, customer receives the entered amount, shop keeps the FULL fee as profit", () => {
    // Previously (the lira-101 baseline): a $5 fee here produced walletAmount
    // 100 (fee not folded in) and shopProfit 0 — byte-identical to the no-fee
    // case above, i.e. the fee the cashier typed had zero financial effect.
    const result = calculateOmtWhishAppFees({
      ...base,
      activeProvider: "OMT_APP",
      parsedAmount: 100,
      manualFee: "5",
    });

    expect(result.isAppWalletReceive).toBe(true);
    expect(result.walletAmount).toBeCloseTo(105, 2); // NOT 100 — fee now folds into the wallet inflow
    expect(result.totalAmount).toBeCloseTo(100, 2); // customer receives the entered amount
    expect(result.shopProfit).toBeCloseTo(5, 2); // NOT 0 — the shop keeps the full fee
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

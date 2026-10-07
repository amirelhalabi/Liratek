/**
 * LIRA-269 — the ONE definition of what a wallet RECEIVE (Binance cash-out,
 * OMT App / Whish App RECEIVE) pays out, shared by the payout sheets and
 * FinancialServiceRepository's wallet-RECEIVE branch.
 *
 * A discount comes off the SHOP'S FEE (the sheet caps it at the fee): the
 * money that arrived in the wallet is a fact, so a smaller fee means the
 * customer receives MORE — or, when the customer pays the fee separately,
 * that less fee is collected. The shop's profit is the fee minus the
 * discount either way.
 */
import { walletReceiveAmounts } from "../walletReceivePayout";

describe("walletReceiveAmounts", () => {
  it("no discount: the fee comes out of the wallet inflow (fee on top or deducted)", () => {
    expect(walletReceiveAmounts({ walletInflow: 102, fee: 2 })).toEqual({
      discount: 0,
      commission: 2,
      payout: 100,
      feeToCollect: 0,
    });
  });

  it("a discount lowers the fee, so the customer receives that much MORE", () => {
    expect(
      walletReceiveAmounts({ walletInflow: 102, fee: 2, discount: 0.5 }),
    ).toEqual({ discount: 0.5, commission: 1.5, payout: 100.5, feeToCollect: 0 });
  });

  it("LBP: same rule in the wallet's own currency", () => {
    expect(
      walletReceiveAmounts({
        walletInflow: 2_020_000,
        fee: 20_000,
        discount: 10_000,
      }),
    ).toEqual({
      discount: 10_000,
      commission: 10_000,
      payout: 2_010_000,
      feeToCollect: 0,
    });
  });

  it("customer pays the fee separately: the payout is the whole inflow and the discount lowers the fee to collect", () => {
    expect(
      walletReceiveAmounts({
        walletInflow: 100,
        fee: 2,
        discount: 0.5,
        feeCollectedSeparately: true,
      }),
    ).toEqual({ discount: 0.5, commission: 1.5, payout: 100, feeToCollect: 1.5 });
  });

  it("a discount above the fee is capped at the fee (profit never below 0)", () => {
    expect(
      walletReceiveAmounts({ walletInflow: 102, fee: 2, discount: 5 }),
    ).toEqual({ discount: 2, commission: 0, payout: 102, feeToCollect: 0 });
  });

  it("a negative or missing discount is treated as none", () => {
    expect(
      walletReceiveAmounts({ walletInflow: 102, fee: 2, discount: -1 })
        .payout,
    ).toBe(100);
  });
});

describe("walletReceiveAmounts — no float noise", () => {
  it("100.37 + a 1% fee on top pays out exactly 100.37", () => {
    const fee = 100.37 * 0.01;
    expect(
      walletReceiveAmounts({ walletInflow: 100.37 + fee, fee }).payout,
    ).toBe(100.37);
  });
});

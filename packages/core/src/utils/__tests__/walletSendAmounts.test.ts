/**
 * walletSendAmounts — what a wallet SEND charges (LIRA-269 follow-up).
 * A discount comes off the shop's fee, capped at the fee; the wallet side
 * never changes. Written alongside the helper (not proven failing-first);
 * the behaviour guards are FinancialServiceRepository.sendDiscount.test.ts
 * and the page payload tests.
 */
import { walletSendAmounts } from "../walletReceivePayout";

describe("walletSendAmounts", () => {
  it("no discount: customer pays transfer + fee, the whole fee is booked", () => {
    expect(walletSendAmounts({ walletOutflow: 100, fee: 2 })).toEqual({
      discount: 0,
      commission: 2,
      customerPays: 102,
    });
  });

  it("a discount lowers both the fee booked and what the customer pays", () => {
    expect(
      walletSendAmounts({ walletOutflow: 100, fee: 2, discount: 0.5 }),
    ).toEqual({ discount: 0.5, commission: 1.5, customerPays: 101.5 });
  });

  it("is capped at the fee (never below the transfer) and ignores a negative discount", () => {
    expect(
      walletSendAmounts({ walletOutflow: 100, fee: 2, discount: 5 }),
    ).toEqual({ discount: 2, commission: 0, customerPays: 100 });
    expect(
      walletSendAmounts({ walletOutflow: 100, fee: 2, discount: -1 }),
    ).toEqual({ discount: 0, commission: 2, customerPays: 102 });
  });

  it("drops float noise (LBP and 4-decimal fees)", () => {
    expect(
      walletSendAmounts({
        walletOutflow: 2_000_000,
        fee: 50_000,
        discount: 20_000,
      }).customerPays,
    ).toBe(2_030_000);
    expect(
      walletSendAmounts({ walletOutflow: 100.37, fee: 1.0037, discount: 0.1 })
        .customerPays,
    ).toBe(101.2737);
  });
});

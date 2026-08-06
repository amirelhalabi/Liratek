/**
 * SessionCheckoutService — cart-item ipcChannel dispatch (BIDIRECTIONAL_PAYMENT_LEGS_PLAN
 * §2 bug 3, P0): a loto cash prize added to a session basket enqueues
 * `ipcChannel: "loto:cashPrize:create"` (camelCase — Loto/index.tsx), but the
 * checkout replay switch (processCartItem) only recognized the hyphenated
 * `"loto:cash-prize:create"` and its `default` throws "Unknown IPC channel
 * for session checkout: …" — so a prize added to a REAL customer-session
 * basket failed the WHOLE checkout. The guarding e2e spec
 * (lira-session-payout.spec.ts) hand-builds the hyphenated channel directly,
 * so it never caught this.
 *
 * Fix (2026-08-06): the frontend now always enqueues the canonical hyphenated
 * channel, but the switch ALSO keeps accepting the legacy camelCase spelling
 * — session_cart_items.ipc_channel is persisted in the DB, so a session
 * basket built before this fix (item added, checkout not yet run) can still
 * hold the old string.
 *
 * `processCartItem` is exported from SessionCheckoutService.ts purely for
 * this test — the narrowest seam that exercises the dispatch switch without
 * standing up the full checkout() transaction (session repo, client repo,
 * payment service, a real DB, …). LotoService is mocked out entirely so this
 * test asserts ONLY the dispatch, not loto's cash-prize business logic
 * (covered elsewhere, e.g. LotoService.checkpoint.test.ts).
 */

const mockRecordCashPrize = jest.fn();
jest.mock("../LotoService", () => ({
  getLotoService: () => ({
    recordCashPrize: mockRecordCashPrize,
    sellTicket: jest.fn(),
  }),
  resetLotoService: jest.fn(),
}));

import { processCartItem, CheckoutCartItem } from "../SessionCheckoutService";

function makePrizeCartItem(ipcChannel: string): CheckoutCartItem {
  return {
    id: "cart-1",
    module: "loto_prize",
    label: "Loto Prize - 50,000 LBP",
    amount: -50000,
    currency: "LBP",
    ipcChannel,
    formData: {
      prize_amount: 50000,
      prize_date: "2026-08-06",
    },
  };
}

describe("SessionCheckoutService processCartItem — loto cash-prize channel dispatch", () => {
  beforeEach(() => {
    mockRecordCashPrize.mockReset();
    mockRecordCashPrize.mockReturnValue({ id: 99 });
  });

  it("dispatches the canonical hyphenated channel (loto:cash-prize:create)", () => {
    const result = processCartItem(
      makePrizeCartItem("loto:cash-prize:create"),
      undefined,
      1,
    );

    expect(mockRecordCashPrize).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      sourceId: 99,
      sourceTable: "loto_cash_prizes",
      transactionType: "loto_prize",
    });
  });

  // Bug 3 (P0) regression guard — MUST fail on pre-fix code by throwing
  // "Unknown IPC channel for session checkout: loto:cashPrize:create".
  it("also dispatches the legacy camelCase channel (loto:cashPrize:create) instead of throwing", () => {
    let result: ReturnType<typeof processCartItem> | undefined;

    expect(() => {
      result = processCartItem(
        makePrizeCartItem("loto:cashPrize:create"),
        undefined,
        1,
      );
    }).not.toThrow();

    expect(mockRecordCashPrize).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      sourceId: 99,
      sourceTable: "loto_cash_prizes",
      transactionType: "loto_prize",
    });
  });

  it("still throws for a genuinely unknown channel", () => {
    expect(() =>
      processCartItem(
        makePrizeCartItem("loto:not-a-real-channel"),
        undefined,
        1,
      ),
    ).toThrow(/Unknown IPC channel for session checkout/);
  });
});

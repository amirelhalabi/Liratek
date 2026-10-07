/** @jest-environment jsdom */

/**
 * Whish App "From Client" top-up is a PAYOUT: the client hands the shop
 * credits and the shop pays out amount − fee from its drawers. Owner
 * decisions 2026-10-07 (FEATURE_GUIDE §4.1 "Kept change"): on a payout the
 * shop may hand out a round figure a little SHORT of what it owes (under
 * $1 / 100,000 LBP) and keep the leftover as profit — the payment form runs
 * in `payer="payout"` mode and the kept amount rides the SAME payload
 * (`kept_change_*`), which the server verifies (resolveKeptChange).
 *
 * Renders the real MultiPaymentInput (jest maps @liratek/ui to source).
 * Field names come from `topUpFromClientSchema` (rule 24).
 * Rule 17: run against the pre-change modal first — see the task report.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { TopUpModal } from "@liratek/ui";
import { topUpFromClientSchema } from "@liratek/core";

const ALL_DRAWERS = [
  { name: "General", usdBalance: 500, lbpBalance: 0 },
  { name: "Whish_App", usdBalance: 0, lbpBalance: 0 },
];
const CLIENT_PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];

function renderModal(onConfirmClient: jest.Mock) {
  render(
    <TopUpModal
      isOpen
      onClose={jest.fn()}
      onConfirm={jest.fn()}
      onConfirmClient={onConfirmClient}
      clientPaymentMethods={CLIENT_PAYMENT_METHODS}
      provider="WHISH_APP"
      allDrawers={ALL_DRAWERS}
      destinationDrawer="Whish_App"
      defaultSourceDrawer="General"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /from client/i }));
  // $100 credits → 1% auto fee → the shop owes $99.00.
  fireEvent.change(screen.getAllByPlaceholderText("0.00")[0], {
    target: { value: "100" },
  });
}

function setPayout(value: string) {
  const leg = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  expect(leg).not.toBeNull();
  fireEvent.change(leg as HTMLInputElement, { target: { value } });
}

function submit() {
  fireEvent.click(
    screen.getByRole("button", { name: /buy credits from client/i }),
  );
}

describe("TopUpModal — From Client payout keeps a small leftover as profit", () => {
  it("owes $99, hands out $98.50: sends kept_change_usd 0.50 with the legs", () => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderModal(onConfirmClient);
    setPayout("98.5");
    submit();

    expect(onConfirmClient).toHaveBeenCalledTimes(1);
    const parsed = topUpFromClientSchema.parse(onConfirmClient.mock.calls[0][0]);
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 98.5 }),
    ]);
    expect(parsed.kept_change_usd).toBe(0.5);
    expect(parsed.kept_change_lbp ?? 0).toBe(0);
  });

  it("an exact payout sends no kept change", () => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderModal(onConfirmClient);
    submit();

    const parsed = topUpFromClientSchema.parse(onConfirmClient.mock.calls[0][0]);
    expect(parsed.kept_change_usd ?? 0).toBe(0);
    expect(parsed.kept_change_lbp ?? 0).toBe(0);
  });
});

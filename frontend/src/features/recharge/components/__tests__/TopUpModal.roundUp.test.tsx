/** @jest-environment jsdom */

/**
 * Whish App "From Client" top-up — payout round-up (LIRA-334).
 *
 * The shop owes the client $99.00 and hands over $100: the $1.00 extra is
 * within the $5 cap, so it rides the SAME payload as the legs
 * (`rounding_given_*`) and the server books it as change rounding. Field
 * names come from `topUpFromClientSchema` (rule 24): the payload is parsed
 * through the real schema, so a field the schema does not know is stripped
 * and the assertion fails.
 *
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
  // $100 credits, fee included → the shop owes $99.00.
  fireEvent.change(screen.getAllByPlaceholderText("0.00")[0], {
    target: { value: "100" },
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: /fee included in amount/i }),
  );
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

describe("TopUpModal — From Client payout round-up (LIRA-334)", () => {
  it("owes $99, hands out $100: sends rounding_given_usd 1 with the legs and no kept change", () => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderModal(onConfirmClient);
    setPayout("100");
    expect(screen.getByTestId("payout-roundup-summary")).toBeInTheDocument();
    submit();

    expect(onConfirmClient).toHaveBeenCalledTimes(1);
    const parsed = topUpFromClientSchema.parse(
      onConfirmClient.mock.calls[0][0],
    );
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 100 }),
    ]);
    expect(parsed.rounding_given_usd).toBe(1);
    expect(parsed.rounding_given_lbp ?? 0).toBe(0);
    expect(parsed.kept_change_usd ?? 0).toBe(0);
  });

  it("an exact payout sends no rounding", () => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderModal(onConfirmClient);
    submit();

    const parsed = topUpFromClientSchema.parse(
      onConfirmClient.mock.calls[0][0],
    );
    expect(parsed.rounding_given_usd ?? 0).toBe(0);
    expect(parsed.rounding_given_lbp ?? 0).toBe(0);
  });

  it("a short payout keeps change and sends no rounding (never both)", () => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderModal(onConfirmClient);
    setPayout("98.5");
    submit();

    const parsed = topUpFromClientSchema.parse(
      onConfirmClient.mock.calls[0][0],
    );
    expect(parsed.kept_change_usd).toBe(0.5);
    expect(parsed.rounding_given_usd ?? 0).toBe(0);
  });
});

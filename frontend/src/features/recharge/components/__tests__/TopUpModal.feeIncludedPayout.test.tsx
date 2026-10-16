/** @jest-environment jsdom */

/**
 * Owner decision 2026-10-16 — Whish App top-up from a client: "Fee included
 * in amount" follows the usual RECEIVE rule (Whish receive, Binance
 * cash-out):
 *
 *   ticked   → the client sends the typed credits; the fee comes out of
 *              them: credits in = amount, payout = amount − fee.
 *   unticked → the client sends credits + fee; the shop pays out the full
 *              typed amount: credits in = amount + fee, payout = amount.
 *
 * The API's `amount` is the credits that arrive (the server books the
 * Whish_App wallet +amount and pays out amount − fee), so the modal folds
 * the choice into `amount` — the same fold every wallet RECEIVE form does.
 *
 * Field names come from the shared schema (rule 24): the payload is parsed
 * through `topUpFromClientSchema`. Rule 17: run against the unchanged modal
 * first and seen failing (unticked: amount 100 / payout 99).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { TopUpModal } from "@liratek/ui";
import { topUpFromClientSchema } from "@liratek/core";

const ALL_DRAWERS = [
  { name: "General", usdBalance: 500, lbpBalance: 0 },
  { name: "Whish_App", usdBalance: 0, lbpBalance: 0 },
];

function renderAndType(onConfirmClient: jest.Mock, typed: string) {
  render(
    <TopUpModal
      isOpen
      onClose={jest.fn()}
      onConfirm={jest.fn()}
      onConfirmClient={onConfirmClient}
      clientPaymentMethods={[{ code: "CASH", label: "Cash" }]}
      provider="WHISH_APP"
      allDrawers={ALL_DRAWERS}
      destinationDrawer="Whish_App"
      defaultSourceDrawer="General"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /from client/i }));
  fireEvent.change(screen.getAllByPlaceholderText("0.00")[0], {
    target: { value: typed },
  });
}

function submitAndParse(onConfirmClient: jest.Mock) {
  fireEvent.click(
    screen.getByRole("button", { name: /buy credits from client/i }),
  );
  expect(onConfirmClient).toHaveBeenCalledTimes(1);
  const parsed = topUpFromClientSchema.parse(onConfirmClient.mock.calls[0][0]);
  const payout = parsed.payments.reduce((sum, leg) => sum + leg.amount, 0);
  return { parsed, payout };
}

describe("TopUpModal — Whish App from client, fee included or not", () => {
  it("unticked (default): client sends $101, shop pays out the full $100, fee $1", () => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderAndType(onConfirmClient, "100");
    const { parsed, payout } = submitAndParse(onConfirmClient);

    expect(parsed.includingFees).toBe(false);
    expect(parsed.amount).toBeCloseTo(101, 6);
    expect(parsed.fee).toBe(1);
    expect(payout).toBeCloseTo(100, 6);
  });

  it("ticked: client sends $100, fee comes out of it, payout $99", () => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderAndType(onConfirmClient, "100");
    fireEvent.click(
      screen.getByRole("checkbox", { name: /fee included in amount/i }),
    );
    const { parsed, payout } = submitAndParse(onConfirmClient);

    expect(parsed.includingFees).toBe(true);
    expect(parsed.amount).toBe(100);
    expect(parsed.fee).toBe(1);
    expect(payout).toBeCloseTo(99, 6);
  });

  it("unticked shows what the client sends and the full payout", () => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderAndType(onConfirmClient, "100");
    expect(screen.getByText(/client sends:/i).textContent).toContain("$101.00");
    expect(screen.getByText(/cash paid to client:/i).textContent).toContain(
      "$100.00",
    );
  });
});

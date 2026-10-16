/** @jest-environment jsdom */

/**
 * LIRA-329 T020 — a Whish App top-up from a client sends the "Fee included
 * in amount" choice, so the transaction keeps it in its details. Before
 * this, the checkbox changed only what the modal displayed and never left
 * the screen.
 *
 * Field names come from the shared schema (rule 24): the payload is parsed
 * through `topUpFromClientSchema`, which strips any key it does not declare.
 *
 * Rule 17: run against the unchanged modal first and seen failing
 * (`includingFees` absent from the parsed payload).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { TopUpModal } from "@liratek/ui";
import { topUpFromClientSchema } from "@liratek/core";

const ALL_DRAWERS = [
  { name: "General", usdBalance: 500, lbpBalance: 0 },
  { name: "Whish_App", usdBalance: 0, lbpBalance: 0 },
];

function renderModal(onConfirmClient: jest.Mock) {
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
    target: { value: "100" },
  });
}

function submit() {
  fireEvent.click(
    screen.getByRole("button", { name: /buy credits from client/i }),
  );
}

describe("TopUpModal — LIRA-329 including-fees choice", () => {
  it("ticked: the payload says the fee was included", () => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderModal(onConfirmClient);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /fee included in amount/i }),
    );
    submit();

    expect(onConfirmClient).toHaveBeenCalledTimes(1);
    const payload = topUpFromClientSchema.parse(
      onConfirmClient.mock.calls[0][0],
    );
    expect(payload.includingFees).toBe(true);
  });

  it("left unticked: the payload says so too", () => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderModal(onConfirmClient);
    submit();

    const payload = topUpFromClientSchema.parse(
      onConfirmClient.mock.calls[0][0],
    );
    expect(payload.includingFees).toBe(false);
  });
});

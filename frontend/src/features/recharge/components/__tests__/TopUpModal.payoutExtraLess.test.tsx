/** @jest-environment jsdom */

/**
 * Whish App "From Client" top-up — the "− Less | + Extra" line on the
 * payout (LIRA-382). Table-driven, the same cases as every other payout
 * screen; the shop owes $99.00. The payload is parsed through
 * `topUpFromClientSchema` before its fields are read (rule 24).
 * Rule 17: run against the box without the line first — see the task report.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { TopUpModal } from "@liratek/ui";
import { topUpFromClientSchema } from "@liratek/core";
import {
  setPayoutLine,
  payoutLegAmounts,
  type PayoutLineSide,
} from "@/shared/testing/payoutExtraLess";

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

type Parsed = ReturnType<typeof topUpFromClientSchema.parse>;
const CASES: {
  name: string;
  side: PayoutLineSide;
  typed: string;
  leg: number;
  check: (p: Parsed) => void;
}[] = [
  {
    name: "+ Extra 0.10 on $99.00 → pays $99.10, rounding_given_usd 0.1",
    side: "extra",
    typed: "0.10",
    leg: 99.1,
    check: (p) => {
      expect(p.rounding_given_usd).toBe(0.1);
      expect(p.kept_change_usd ?? 0).toBe(0);
    },
  },
  {
    name: "− Less 0.50 on $99.00 → pays $98.50, kept_change_usd 0.5",
    side: "less",
    typed: "0.50",
    leg: 98.5,
    check: (p) => {
      expect(p.kept_change_usd).toBe(0.5);
      expect(p.rounding_given_usd ?? 0).toBe(0);
    },
  },
];

describe("TopUpModal — From Client payout '− Less | + Extra' line (LIRA-382)", () => {
  it.each(CASES)("$name", (c) => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderModal(onConfirmClient);
    setPayoutLine(c.side, c.typed);
    expect(payoutLegAmounts()).toEqual([c.leg]);
    fireEvent.click(
      screen.getByRole("button", { name: /buy credits from client/i }),
    );
    expect(onConfirmClient).toHaveBeenCalledTimes(1);
    const p = topUpFromClientSchema.parse(onConfirmClient.mock.calls[0][0]);
    expect(p.payments).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: c.leg }),
    ]);
    c.check(p);
  });
});

/** @jest-environment jsdom */

/**
 * Whish App "From Client" top-up — customer adds change (LIRA-336, T018).
 *
 * The shop owes the client $99.00 (100 credits, fee included) and has no
 * single dollar: the client hands over $1 and the cashier pays out $100.
 * The payout box gets an optional "Customer gives change" section; the
 * modal sends the client's non-zero lines as `customerPayments` plus
 * `added_change_*` (payout currency) in the SAME payload as the legs
 * (rule 22). Field names come from `topUpFromClientSchema` (rule 24): the
 * payload is parsed through the real schema, so a field the schema does not
 * know is stripped and the assertion fails. Real MultiPaymentInput.
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

function typeCustomerGives(value: string) {
  const cf = document.querySelector<HTMLInputElement>(
    '[data-testid^="counter-flow-amount-"]',
  );
  expect(cf).not.toBeNull();
  fireEvent.change(cf as HTMLInputElement, { target: { value } });
}

function submit() {
  fireEvent.click(
    screen.getByRole("button", { name: /buy credits from client/i }),
  );
}

function sent(onConfirmClient: jest.Mock) {
  expect(onConfirmClient).toHaveBeenCalledTimes(1);
  return onConfirmClient.mock.calls[0][0] as Record<string, unknown>;
}

describe("TopUpModal — From Client, customer adds change (LIRA-336)", () => {
  it("shows '+ Customer gives change', closed by default", () => {
    renderModal(jest.fn());
    expect(screen.getByTestId("counter-flow-add-change")).toBeInTheDocument();
    expect(screen.queryByTestId("counter-flow-section")).toBeNull();
  });

  it("owes $99, client gives $1, $100 paid out: sends customerPayments [$1] and added_change_usd 1", () => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderModal(onConfirmClient);
    fireEvent.click(screen.getByTestId("counter-flow-add-change"));
    typeCustomerGives("1");
    expect(
      screen.getByTestId("payout-added-change-summary"),
    ).toBeInTheDocument();
    submit();

    const parsed = topUpFromClientSchema.parse(sent(onConfirmClient));
    expect(parsed.added_change_usd).toBe(1);
    expect(parsed.added_change_lbp ?? 0).toBe(0);
    expect(parsed.customerPayments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 1 },
    ]);
    // The untouched payout line follows the raised target.
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 100 }),
    ]);
    expect(parsed.rounding_given_usd ?? 0).toBe(0);
    expect(parsed.kept_change_usd ?? 0).toBe(0);
  });

  it("section never opened: no customerPayments and no claim", () => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderModal(onConfirmClient);
    submit();
    const raw = sent(onConfirmClient);
    expect(raw).not.toHaveProperty("customerPayments");
    const parsed = topUpFromClientSchema.parse(raw);
    expect(parsed.added_change_usd).toBeUndefined();
    expect(parsed.added_change_lbp).toBeUndefined();
  });

  it("section opened but left at 0: the 0 line is dropped and no claim is sent", () => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderModal(onConfirmClient);
    fireEvent.click(screen.getByTestId("counter-flow-add-change"));
    submit();
    const raw = sent(onConfirmClient);
    expect(raw).not.toHaveProperty("customerPayments");
    const parsed = topUpFromClientSchema.parse(raw);
    expect(parsed.added_change_usd).toBeUndefined();
  });

  it("over the cap ($6): Confirm is disabled and nothing is sent", () => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderModal(onConfirmClient);
    fireEvent.click(screen.getByTestId("counter-flow-add-change"));
    typeCustomerGives("6");
    expect(screen.getByTestId("counter-flow-overpaid")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /buy credits from client/i }),
    ).toBeDisabled();
    submit();
    expect(onConfirmClient).not.toHaveBeenCalled();
  });

  // Written after the wiring — not proven failing-first (rule 17).
  it("LBP: owes 4,450,000, client gives 50,000 → added_change_lbp 50,000, 4,500,000 paid out", () => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderModal(onConfirmClient);
    fireEvent.click(screen.getByRole("button", { name: /^LBP$/ }));
    // The LBP amount box uses a "0" placeholder.
    fireEvent.change(screen.getAllByPlaceholderText("0")[0], {
      target: { value: "4450000" },
    });
    fireEvent.click(screen.getByTestId("counter-flow-add-change"));
    typeCustomerGives("50000");
    submit();
    const parsed = topUpFromClientSchema.parse(sent(onConfirmClient));
    expect(parsed.currency).toBe("LBP");
    expect(parsed.added_change_lbp).toBe(50_000);
    expect(parsed.added_change_usd ?? 0).toBe(0);
    expect(parsed.customerPayments).toEqual([
      { method: "CASH", currencyCode: "LBP", amount: 50_000 },
    ]);
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "LBP", amount: 4_500_000 }),
    ]);
  });

  // Written after the wiring — not proven failing-first (rule 17).
  it("an over-cap section does not keep Confirm off after a currency switch remounts the box", () => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderModal(onConfirmClient);
    fireEvent.click(screen.getByTestId("counter-flow-add-change"));
    typeCustomerGives("6");
    const confirm = () =>
      screen.getByRole("button", { name: /buy credits from client/i });
    expect(confirm()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^LBP$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^USD$/ }));
    fireEvent.change(screen.getAllByPlaceholderText("0.00")[0], {
      target: { value: "100" },
    });
    expect(screen.queryByTestId("counter-flow-section")).toBeNull();
    expect(confirm()).toBeEnabled();
    submit();
    const raw = sent(onConfirmClient);
    expect(raw).not.toHaveProperty("customerPayments");
    expect(raw).not.toHaveProperty("added_change_usd");
  });

  it("opened, $1 typed, then closed with ×: nothing is sent", () => {
    const onConfirmClient = jest.fn().mockResolvedValue(undefined);
    renderModal(onConfirmClient);
    fireEvent.click(screen.getByTestId("counter-flow-add-change"));
    typeCustomerGives("1");
    fireEvent.click(screen.getByTestId("counter-flow-remove-change"));
    submit();
    const raw = sent(onConfirmClient);
    expect(raw).not.toHaveProperty("customerPayments");
    const parsed = topUpFromClientSchema.parse(raw);
    expect(parsed.added_change_usd).toBeUndefined();
    expect(parsed.payments).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 99 }),
    ]);
  });
});

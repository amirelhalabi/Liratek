/** @jest-environment jsdom */
/**
 * CornerTech 2026-10-25 — a sale paid $55 cash with 250,000 LBP change at
 * 90,000 is a net $52.22 sale. The refund popup used to pre-fill $55 +
 * 250,000 LBP ($57.78) and keep Confirm disabled. It must now pre-fill the
 * net value as ONE line and let the operator confirm straight away.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { refundAddedChangeSchema } from "@liratek/core";
import { RefundMethodModal } from "../RefundMethodModal";
import type { TransactionPaymentLeg } from "../../cashFlow";

const leg = (
  direction: "in" | "out",
  amount: number,
  currency_code: string,
  method = "CASH",
): TransactionPaymentLeg => ({
  direction,
  amount,
  signed_amount: direction === "out" ? -amount : amount,
  currency_code,
  method,
});

describe("RefundMethodModal — change given in another currency", () => {
  it("pre-fills one Cash $52.22 line and Confirm is enabled", () => {
    render(
      <RefundMethodModal
        legs={[leg("in", 55, "USD"), leg("out", 250_000, "LBP")]}
        paymentMethods={[{ code: "CASH", label: "Cash" }]}
        exchangeRate={90_000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(screen.getAllByTestId(/payment-amount-/)).toHaveLength(1);
    expect(
      screen.queryByTestId("refund-validation-error"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm Refund" }),
    ).not.toBeDisabled();
  });

  it("'+ Customer gives change' 250,000 LBP → hand back $55, onConfirm gets the added change", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 55, "USD"), leg("out", 250_000, "LBP")]}
        paymentMethods={[{ code: "CASH", label: "Cash" }]}
        exchangeRate={90_000}
        allowAddedChange
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByTestId("counter-flow-add-change"));
    const cur = document.querySelector<HTMLSelectElement>(
      '[data-testid^="counter-flow-currency-"]',
    );
    if (!cur) throw new Error("no counter-flow currency select");
    fireEvent.change(cur, { target: { value: "LBP" } });
    const amt = document.querySelector<HTMLInputElement>(
      '[data-testid^="counter-flow-amount-"]',
    );
    if (!amt) throw new Error("no counter-flow amount input");
    fireEvent.change(amt, { target: { value: "250000" } });

    // The hand-back line follows the raised target: $52.22 + $2.78 = $55.
    expect(screen.getByTestId("refund-return-summary")).toHaveTextContent(
      "$55",
    );
    const confirm = screen.getByRole("button", { name: "Confirm Refund" });
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [legs, unitExtras, rate, kept, added] = onConfirm.mock.calls[0];
    expect(legs).toEqual([{ method: "CASH", currencyCode: "USD", amount: 55 }]);
    expect(unitExtras).toBeUndefined();
    expect(rate).toBe(90_000);
    expect(kept).toBeUndefined();
    // Rule 24 — the field names come from the core schema itself.
    const parsed = refundAddedChangeSchema.parse(added);
    expect(parsed).toEqual(added);
    expect(parsed.added_change_usd).toBeCloseTo(2.78, 2);
    expect(parsed.customerPayments).toEqual([
      { method: "CASH", currencyCode: "LBP", amount: 250_000 },
    ]);
  });

  it("untouched folded pre-fill confirms as a real $52.22 override (not the verbatim mirror)", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 55, "USD"), leg("out", 250_000, "LBP")]}
        paymentMethods={[{ code: "CASH", label: "Cash" }]}
        exchangeRate={90_000}
        allowAddedChange
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
    expect(onConfirm).toHaveBeenCalledWith(
      [{ method: "CASH", currencyCode: "USD", amount: 52.22 }],
      undefined,
      90_000,
    );
  });

  it("no '+ Customer gives change' link unless the caller allows it", () => {
    render(
      <RefundMethodModal
        legs={[leg("in", 55, "USD"), leg("out", 250_000, "LBP")]}
        paymentMethods={[{ code: "CASH", label: "Cash" }]}
        exchangeRate={90_000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(
      screen.queryByTestId("counter-flow-add-change"),
    ).not.toBeInTheDocument();
  });
});

/** @jest-environment jsdom */
/**
 * LIRA-078 — RefundMethodModal RTL tests.
 *
 * Covers the ticket's "modal test" requirement: prefill from the original
 * legs, method switch, and the payload shape sent to `onConfirm` —
 * including the "plain refund (no modal interaction) behaves exactly as
 * today" contract (`onConfirm(undefined)` when the operator changes
 * nothing, `onConfirm([...])` once they pick a different method).
 */
import { render, screen, fireEvent } from "@testing-library/react";
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

const PAYMENT_METHODS = [
  { code: "CASH", label: "Cash" },
  { code: "OMT", label: "OMT Wallet" },
];

describe("RefundMethodModal", () => {
  it("prefills one line per original currency, defaulting to the original method", () => {
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    expect(screen.getByTestId("multi-payment-input")).toBeInTheDocument();
    expect(screen.getByTestId("refund-return-summary")).toHaveTextContent(
      "$100 via Cash",
    );
  });

  it("confirming without touching anything sends NO override (byte-identical to today)", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("switching the method updates the summary and sends the override payload + the current rate on confirm", () => {
    // LIRA-236 — a legs override now carries the popup's current rate as a
    // 3rd onConfirm argument (see the "LIRA-236" describe block below for
    // the value-matching/rate-editing behavior itself); this test still
    // proves the pre-existing method-switch/summary wiring, updated only for
    // the new trailing argument (rule 24 — the OLD "same currency, same
    // amount" rule this test exercises is untouched, just the call shape).
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    const methodSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(methodSelect, { target: { value: "OMT" } });

    expect(screen.getByTestId("refund-return-summary")).toHaveTextContent(
      "$100 via OMT Wallet",
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
    expect(onConfirm).toHaveBeenCalledWith(
      [{ method: "OMT", currencyCode: "USD", amount: 100 }],
      undefined,
      89000,
    );
  });

  it("disables Confirm and shows a validation hint when the operator lowers the amount", () => {
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    const amountInput = screen.getByTestId(/payment-amount-/);
    fireEvent.change(amountInput, { target: { value: "60" } });

    expect(screen.getByTestId("refund-validation-error")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm Refund" }),
    ).toBeDisabled();
  });

  it("prefills TWO lines for a mixed-currency transaction, one per currency", () => {
    render(
      <RefundMethodModal
        legs={[leg("in", 60, "USD", "CASH"), leg("in", 900_000, "LBP", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    expect(screen.getByTestId("refund-return-summary")).toHaveTextContent(
      "$60 via Cash",
    );
    expect(screen.getByTestId("refund-return-summary")).toHaveTextContent(
      "900,000 LBP via Cash",
    );
  });
});

// LIRA-143 Phase 6b — "Returned phones" units section.
describe("RefundMethodModal — units (phone-refund extras)", () => {
  it("renders no units section when `units` is omitted (byte-identical to pre-Phase-6b)", () => {
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(
      screen.queryByTestId("refund-units-section"),
    ).not.toBeInTheDocument();
  });

  it("confirming with units present but untouched calls onConfirm with ONE argument (no unitExtras)", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        units={[{ id: 1, imei: "356938035643809" }]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByTestId("refund-units-section")).toBeInTheDocument();
    expect(screen.getByText("356938035643809")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
    expect(onConfirm.mock.calls[0]).toHaveLength(1);
  });

  it("checking Defective sends unitExtras as a SECOND argument alongside refundLegs", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        units={[{ id: 1, imei: "356938035643809" }]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));

    expect(onConfirm).toHaveBeenCalledWith(undefined, [
      { unit_id: 1, is_defective: true },
    ]);
  });

  // LIRA-296 follow-up (owner decision 2026-10-10): the warranty date is
  // chosen at the till when the phone is sold again, so the refund pop-up no
  // longer offers one — and nothing it sends carries a warranty date.
  it("offers no warranty-date input for a returned phone, and never sends one", () => {
    const onConfirm = jest.fn();
    const { container } = render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        units={[{ id: 1, imei: "356938035643809" }]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    const unitRow = screen.getByTestId("refund-unit-1");
    expect(unitRow.querySelector('input[type="date"]')).toBeNull();
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(screen.queryByLabelText("New warranty expiry")).toBeNull();
    // The Defective checkbox stays.
    expect(screen.getByRole("checkbox")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
    const sentExtras = onConfirm.mock.calls[0][1] as Record<string, unknown>[];
    expect(sentExtras).toStrictEqual([{ unit_id: 1, is_defective: true }]);
    expect(sentExtras[0]).not.toHaveProperty("warranty_override_until");
  });

  it("a units-only refund (no drawer legs) skips MultiPaymentInput and stays confirmable", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[]}
        units={[{ id: 1, imei: "356938035643809" }]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.queryByTestId("multi-payment-input")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("refund-return-summary"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm Refund" }),
    ).not.toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined, [
      { unit_id: 1, is_defective: true },
    ]);
  });

  it("renders one row per linked unit, each with its own checkbox", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        units={[
          { id: 1, imei: "111111111111111" },
          { id: 2, imei: "222222222222222" },
        ]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByTestId("refund-unit-1")).toBeInTheDocument();
    expect(screen.getByTestId("refund-unit-2")).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));

    expect(onConfirm).toHaveBeenCalledWith(undefined, [
      { unit_id: 2, is_defective: true },
    ]);
  });
});

// LIRA-232 phase 3 (SESSION_ITEM_REFUND_PLAN.md §4) — the account-reduction
// read-only line the session-item-refund flow adds above the payment lines.
describe("RefundMethodModal — account reduction (LIRA-232)", () => {
  it("omits the account-reduction line when the prop is not provided (backward compatible)", () => {
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(
      screen.queryByTestId("refund-account-reduction"),
    ).not.toBeInTheDocument();
  });

  it("shows a USD-only account-reduction line", () => {
    render(
      <RefundMethodModal
        legs={[leg("in", 135, "USD", "CASH")]}
        accountReduction={{ usd: 1500, lbp: 0, clientLabel: "amir" }}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(screen.getByTestId("refund-account-reduction")).toHaveTextContent(
      "Reduces amir's account by $1,500",
    );
  });

  it("shows both currencies when both are reduced", () => {
    render(
      <RefundMethodModal
        legs={[]}
        accountReduction={{ usd: 50, lbp: 200000, clientLabel: "amir" }}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    const line = screen.getByTestId("refund-account-reduction");
    expect(line).toHaveTextContent("$50");
    expect(line).toHaveTextContent("200,000 LBP");
  });

  it("remainder 0: no payment lines required, just the account line + an enabled Confirm", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[]}
        accountReduction={{ usd: 1500, lbp: 0, clientLabel: "amir" }}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByTestId("refund-account-reduction")).toHaveTextContent(
      "Reduces amir's account by $1,500",
    );
    expect(
      screen.queryByTestId("multi-payment-input"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm Refund" }),
    ).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });
});

// LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md) — editable exchange rate + free
// currency mixing. Written failing-first: at authoring time RefundMethodModal
// had no `bookedRateSource` prop (no fallback note), no `onRateChange` prop,
// `onConfirm` never received a 3rd (rate) argument, and Confirm's validation
// (`validateRefundLines`) hard-rejected any currency the original didn't
// carry — a same-value cross-currency mix stayed disabled. Run against the
// pre-LIRA-236 modal and confirmed failing before the implementation below.
describe("RefundMethodModal — LIRA-236 editable rate + value matching", () => {
  it("shows a fallback note when bookedRateSource is 'fallback'", () => {
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        bookedRateSource="fallback"
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(screen.getByTestId("refund-rate-fallback-note")).toHaveTextContent(
      /no rate was recorded/i,
    );
  });

  it("shows NO fallback note when bookedRateSource is 'sale' or omitted", () => {
    const { rerender } = render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        bookedRateSource="sale"
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(
      screen.queryByTestId("refund-rate-fallback-note"),
    ).not.toBeInTheDocument();

    rerender(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(
      screen.queryByTestId("refund-rate-fallback-note"),
    ).not.toBeInTheDocument();
  });

  it("the rate field is pre-filled with the caller's bookedRate (exchangeRate prop)", () => {
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={95000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(screen.getByTestId("payment-exchange-rate")).toHaveValue("95,000");
  });

  it("a $100 USD refund switched entirely to LBP (auto-converted at the shown rate) enables Confirm, and onConfirm receives the legs AND the rate", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    const currencySelect = screen.getByTestId(/payment-currency-/);
    fireEvent.change(currencySelect, { target: { value: "LBP" } });

    expect(
      screen.getByRole("button", { name: "Confirm Refund" }),
    ).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
    expect(onConfirm).toHaveBeenCalledWith(
      [{ method: "CASH", currencyCode: "LBP", amount: 8_900_000 }],
      undefined,
      89000,
    );
  });

  it("editing the rate then splitting into cash + LBP whose value matches the NEW rate enables Confirm", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    // Edit the rate first.
    fireEvent.change(screen.getByTestId("payment-exchange-rate"), {
      target: { value: "90000" },
    });
    // Then switch the single line to LBP — MultiPaymentInput auto-converts
    // the amount using the NEW effective rate (90,000), not the stale prop.
    fireEvent.change(screen.getByTestId(/payment-currency-/), {
      target: { value: "LBP" },
    });

    expect(
      screen.getByRole("button", { name: "Confirm Refund" }),
    ).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
    expect(onConfirm).toHaveBeenCalledWith(
      [{ method: "CASH", currencyCode: "LBP", amount: 9_000_000 }],
      undefined,
      90000,
    );
  });

  it("a currency mix whose value does NOT match the current rate keeps Confirm disabled", () => {
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    const currencySelect = screen.getByTestId(/payment-currency-/);
    fireEvent.change(currencySelect, { target: { value: "LBP" } });
    const amountInput = screen.getByTestId(/payment-amount-/);
    fireEvent.change(amountInput, { target: { value: "8000000" } }); // short of 8,900,000

    expect(screen.getByTestId("refund-validation-error")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm Refund" }),
    ).toBeDisabled();
  });

  it("confirming without touching anything sends NO override and NO rate (untouched default unaffected by LIRA-236)", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
    expect(onConfirm.mock.calls[0]).toHaveLength(1);
  });

  it("calls onRateChange whenever the operator edits the rate field", () => {
    const onRateChange = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onRateChange={onRateChange}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId("payment-exchange-rate"), {
      target: { value: "91000" },
    });
    expect(onRateChange).toHaveBeenCalledWith(91000);
  });
});

// LIRA-236 round-2/final review, finding F2 (HIGH) — a rate typed by the
// operator used to be dropped on confirm whenever the resulting line set
// happened to equal the default (e.g. a single-currency line, which a rate
// edit alone never changes — nothing to convert). Written failing-first: on
// the pre-fix `handleConfirm`, `rateArg` was only ever sent alongside a REAL
// `refundLegs` override (`finalLegs !== undefined`); this test's scenario
// (rate touched, but `isDefault` still true) sent `onConfirm(undefined)` with
// ONE argument, not three, confirmed failing before the fix below.
describe("RefundMethodModal — LIRA-236 F2 (typed rate must never be dropped)", () => {
  it("a rate typed by the operator is sent even when the resulting line set still equals the default", () => {
    const onConfirm = jest.fn();
    render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );

    // Edit the rate only — the single USD line's amount is unaffected (same
    // currency as totalAmountCurrency, nothing to convert), so the line set
    // still equals the default (`isDefault` stays true). Before the F2 fix
    // this made `handleConfirm` send NO override and NO rate at all.
    fireEvent.change(screen.getByTestId("payment-exchange-rate"), {
      target: { value: "91000" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined, undefined, 91000);
  });
});

// LIRA-236 round-2/final review, finding F15 (LOW) — the fallback note used
// to hardcode "sale" regardless of caller; `entityLabel` (new prop, not
// proven failing-first — it didn't exist before this pass) lets each caller
// word it correctly ("sale" for POS SaleDetailModal, "transaction" — the
// default — for the Transactions-page/session-item callers).
describe("RefundMethodModal — LIRA-236 F15 (fallback note wording by entityLabel)", () => {
  it("reads 'transaction' by default, and whatever entityLabel the caller supplies", () => {
    const { rerender } = render(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        bookedRateSource="fallback"
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(screen.getByTestId("refund-rate-fallback-note")).toHaveTextContent(
      "No rate was recorded for this transaction — using today's rate.",
    );

    rerender(
      <RefundMethodModal
        legs={[leg("in", 100, "USD", "CASH")]}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89000}
        bookedRateSource="fallback"
        entityLabel="sale"
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(screen.getByTestId("refund-rate-fallback-note")).toHaveTextContent(
      "No rate was recorded for this sale — using today's rate.",
    );
  });
});

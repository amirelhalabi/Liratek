/** @jest-environment jsdom */
/**
 * MultiPaymentInput — LIRA-318 (owner 2026-10-13): one Discount / Forgive
 * line in the same place on every page.
 *
 *  - `discountRow`: the page's own discount line, rendered under
 *    "Total Amount" inside the summary; the built-in Discount is not drawn;
 *  - `totalBeforeDiscount` + `afterDiscountLabel`: Total Amount shows the
 *    gross, an "After …" row shows the net `totals`;
 *  - `discountMovesPayment={false}`: the single line fills to the gross and a
 *    discount never moves it (default true: the line follows the total);
 *  - `owedLabel`: replaces "Remaining (Debt)" for a customer payer, and also
 *    shows at 0 when fully paid (not when overpaid);
 *  - `DiscountLine`: the shared line, with its "Capped to max" note.
 *
 * Written after the production change — not proven failing-first (rule 17).
 */

import { render, fireEvent, screen, within } from "@testing-library/react";
import {
  MultiPaymentInput,
  DiscountLine,
  discountFieldClass,
  type PaymentLine,
} from "@liratek/ui";
import type { ComponentProps } from "react";

const METHODS = [{ code: "CASH", label: "Cash" }];
const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];

type Money = { amount: number; currency: string };
type MpiProps = ComponentProps<typeof MultiPaymentInput>;

const usd = (amount: number): Money[] => [{ amount, currency: "USD" }];

function element(
  onChange: jest.Mock<void, [PaymentLine[]]>,
  extra: Partial<MpiProps>,
) {
  return (
    <MultiPaymentInput
      totals={usd(50)}
      currency="USD"
      totalAmountCurrency="USD"
      paymentMethods={METHODS}
      currencies={CURRENCIES}
      exchangeRate={90_000}
      hasClient={true}
      onChange={onChange}
      {...extra}
    />
  );
}

const amountInput = (): HTMLInputElement =>
  document.querySelector<HTMLInputElement>('[data-testid^="payment-amount-"]')!;

const lastLines = (m: jest.Mock<void, [PaymentLine[]]>): PaymentLine[] =>
  m.mock.calls.at(-1)?.[0] ?? [];

const pageForgiveRow = (
  <DiscountLine label="Forgive (no cash)" testId="page-forgive">
    <input aria-label="Forgive amount" className={discountFieldClass(false)} />
  </DiscountLine>
);

describe("MultiPaymentInput — discountRow slot (LIRA-318)", () => {
  it("renders the page's line inside the summary, under Total Amount, and drops the built-in Discount", () => {
    render(
      element(jest.fn(), {
        showDiscount: false,
        discountRow: pageForgiveRow,
      }),
    );
    const summary = screen.getByTestId("payment-summary");
    const row = within(summary).getByTestId("page-forgive");
    const totalLabel = within(summary).getByText("Total Amount");
    // DOM order: Total Amount first, then the page's row.
    expect(
      totalLabel.compareDocumentPosition(row) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByLabelText("Discount")).toBeNull();
    expect(screen.queryByText("After Discount")).toBeNull();
  });

  it("built-in Discount is absent even with showDiscount left on when discountRow is given", () => {
    render(element(jest.fn(), { discountRow: pageForgiveRow }));
    expect(screen.getByTestId("page-forgive")).toBeTruthy();
    expect(screen.queryByLabelText("Discount")).toBeNull();
  });

  it("Total Amount shows totalBeforeDiscount; the custom After row shows the net totals", () => {
    render(
      element(jest.fn(), {
        showDiscount: false,
        discountRow: pageForgiveRow,
        totals: usd(34),
        totalBeforeDiscount: usd(50),
        afterDiscountLabel: "After Forgive",
      }),
    );
    const summary = screen.getByTestId("payment-summary");
    const totalRow = within(summary).getByText("Total Amount").parentElement!;
    expect(totalRow.textContent).toContain("$50.00");
    const after = screen.getByTestId("after-page-discount");
    expect(after.textContent).toContain("After Forgive");
    expect(after.textContent).toContain("$34.00");
  });

  it("no After row when the page's discount is 0 (gross equals net)", () => {
    render(
      element(jest.fn(), {
        showDiscount: false,
        discountRow: pageForgiveRow,
        totals: usd(50),
        totalBeforeDiscount: usd(50),
      }),
    );
    expect(screen.queryByTestId("after-page-discount")).toBeNull();
  });
});

describe("MultiPaymentInput — discountMovesPayment (LIRA-318)", () => {
  it("false: the single line fills to the gross and stays there when the discount grows", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const props: Partial<MpiProps> = {
      showDiscount: false,
      discountRow: pageForgiveRow,
      totalBeforeDiscount: usd(50),
      discountMovesPayment: false,
    };
    const { rerender } = render(
      element(onChange, { ...props, totals: usd(50) }),
    );
    expect(lastLines(onChange)).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 50 }),
    ]);
    rerender(element(onChange, { ...props, totals: usd(30) }));
    expect(lastLines(onChange)).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 50 }),
    ]);
    expect(amountInput().value.replace(/,/g, "")).toBe("50");
  });

  it("default (true): the single line follows the net total", () => {
    const onChange = jest.fn<void, [PaymentLine[]]>();
    const props: Partial<MpiProps> = {
      showDiscount: false,
      discountRow: pageForgiveRow,
      totalBeforeDiscount: usd(50),
    };
    const { rerender } = render(
      element(onChange, { ...props, totals: usd(50) }),
    );
    expect(lastLines(onChange)[0].amount).toBe(50);
    rerender(element(onChange, { ...props, totals: usd(30) }));
    expect(lastLines(onChange)).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: 30 }),
    ]);
  });
});

describe("MultiPaymentInput — owedLabel (LIRA-318)", () => {
  const base: Partial<MpiProps> = {
    showDiscount: false,
    owedLabel: "Client will owe",
  };

  it("underpaid: the remaining row uses the label with what is left", () => {
    render(element(jest.fn(), base));
    fireEvent.change(amountInput(), { target: { value: "16" } });
    const row = screen.getByTestId("remaining-row");
    expect(row.textContent).toContain("Client will owe");
    expect(row.textContent).toContain("$34.00");
    expect(row.textContent).not.toContain("Remaining (Debt)");
    expect(screen.queryByTestId("owed-after-row")).toBeNull();
  });

  it("paid exactly: the owed-after row shows 0", () => {
    render(element(jest.fn(), base));
    fireEvent.change(amountInput(), { target: { value: "50" } });
    expect(screen.queryByTestId("remaining-row")).toBeNull();
    const row = screen.getByTestId("owed-after-row");
    expect(row.textContent).toContain("Client will owe");
    expect(row.textContent).toContain("$0.00");
  });

  it("overpaid: no owed-after row", () => {
    render(element(jest.fn(), base));
    fireEvent.change(amountInput(), { target: { value: "60" } });
    expect(screen.queryByTestId("owed-after-row")).toBeNull();
    expect(screen.queryByText("Client will owe")).toBeNull();
  });

  it.each([
    ["payout", "Remaining to pay out"],
    ["shop", "Remaining to pay"],
  ] as const)("payer=%s: the label is not used", (payer, expected) => {
    render(element(jest.fn(), { ...base, payer }));
    fireEvent.change(amountInput(), { target: { value: "16" } });
    expect(screen.queryByText("Client will owe")).toBeNull();
    expect(screen.getByTestId("remaining-row").textContent).toContain(
      expected,
    );
    fireEvent.change(amountInput(), { target: { value: "50" } });
    expect(screen.queryByTestId("owed-after-row")).toBeNull();
  });

  it("without owedLabel the old 'Remaining (Debt)' wording and no owed-after row", () => {
    render(element(jest.fn(), { showDiscount: false }));
    fireEvent.change(amountInput(), { target: { value: "16" } });
    expect(screen.getByTestId("remaining-row").textContent).toContain(
      "Remaining (Debt)",
    );
    fireEvent.change(amountInput(), { target: { value: "50" } });
    expect(screen.queryByTestId("owed-after-row")).toBeNull();
  });
});

describe("DiscountLine and the built-in Discount cap note (LIRA-318)", () => {
  it("DiscountLine shows capNote with data-testid=discount-cap-note, none without it", () => {
    const { rerender } = render(
      <DiscountLine label="Discount" capNote="Capped to max ($2.00)">
        <input aria-label="d" />
      </DiscountLine>,
    );
    expect(screen.getByTestId("discount-cap-note").textContent).toBe(
      "Capped to max ($2.00)",
    );
    rerender(
      <DiscountLine label="Discount">
        <input aria-label="d" />
      </DiscountLine>,
    );
    expect(screen.queryByTestId("discount-cap-note")).toBeNull();
  });

  it("DiscountLine reason field reports typed text", () => {
    const onReason = jest.fn<void, [string]>();
    render(
      <DiscountLine
        label="Forgive (no cash)"
        reason={{ value: "", onChange: onReason, testId: "forgive-reason" }}
      >
        <input aria-label="f" />
      </DiscountLine>,
    );
    fireEvent.change(screen.getByTestId("forgive-reason"), {
      target: { value: "old customer" },
    });
    expect(onReason).toHaveBeenCalledWith("old customer");
    expect(screen.getByLabelText("Forgive (no cash) reason")).toBeTruthy();
  });

  it("built-in Discount above maxDiscount shows 'Capped to max' via the shared note", () => {
    render(element(jest.fn(), { maxDiscount: 5 }));
    const input = screen.getByLabelText("Discount");
    fireEvent.change(input, { target: { value: "10" } });
    const note = screen.getByTestId("discount-cap-note");
    expect(note.textContent).toContain("Capped to max");
    expect(note.textContent).toContain("$5.00");
    fireEvent.change(input, { target: { value: "3" } });
    expect(screen.queryByTestId("discount-cap-note")).toBeNull();
  });
});

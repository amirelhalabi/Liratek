/** @jest-environment jsdom */
/**
 * MultiPaymentInput — `perCurrencyTotals` (LIRA-322 follow-up, owner
 * 2026-10-15). The OMT Settle Account sheet shows ONE payment box with a USD
 * line and an LBP line. OMT settles each currency on its own, so in this
 * opt-in mode the box never converts or nets one currency against the
 * other: the existing Total Amount / Paid / Remaining to pay rows show each
 * currency in its own currency, and change is worked out per currency.
 *
 * Fixture: $497 + 900,000 LBP owed, rate 89,000. Paying $600 + 0 LBP is the
 * case the default (converted) mode gets wrong for this sheet: it reads it
 * as "overpaid $92.89" (600 − 497 − 900,000/89,000), hiding that the whole
 * 900,000 LBP is still unpaid.
 *
 * Rows are found through their visible labels and the existing test ids
 * (`remaining-amount`, `change-due`, `return-usd`/`return-lbp`) so every
 * case can fail on the component before the prop did anything.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";

const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];
const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];
const TOTALS = [
  { amount: 497, currency: "USD" },
  { amount: 900_000, currency: "LBP" },
];

function renderMpi(opts: {
  perCurrencyTotals?: boolean;
  onReturnChange?: jest.Mock<void, [PaymentLine[]]>;
}) {
  return render(
    <MultiPaymentInput
      totals={TOTALS}
      {...(opts.perCurrencyTotals ? { perCurrencyTotals: true } : {})}
      initialLines={[
        { method: "CASH", currencyCode: "USD", amount: 497 },
        { method: "CASH", currencyCode: "LBP", amount: 900_000 },
      ]}
      currency="USD"
      totalAmountCurrency="USD"
      paymentMethods={PAYMENT_METHODS}
      currencies={CURRENCIES}
      returnCurrencies={["USD", "LBP"]}
      exchangeRate={89_000}
      showDiscount={false}
      waiveDisabled
      cashOnlyReturn
      unreturnedChangeTo="ACCOUNT_BALANCE"
      payer="shop"
      onChange={jest.fn()}
      {...(opts.onReturnChange ? { onReturnChange: opts.onReturnChange } : {})}
    />,
  );
}

/** The seeded line inputs, in seed order: [USD, LBP]. */
function lineInputs(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    ),
  );
}

function setLines(usd: string, lbp: string): void {
  const [usdInput, lbpInput] = lineInputs();
  fireEvent.change(usdInput, { target: { value: usd } });
  fireEvent.change(lbpInput, { target: { value: lbp } });
}

/** A summary row's figure, found through its visible label. */
function summaryRow(label: string) {
  const span = screen.getByText(label, { selector: "span" });
  const row = span.parentElement;
  if (!row) throw new Error(`${label} row not found`);
  const amount = row.querySelector<HTMLElement>(".font-mono");
  if (!amount) throw new Error(`${label} amount not found`);
  return {
    text: amount.textContent,
    tick: !!row.querySelector("svg.text-emerald-400"),
    warning: !!row.querySelector("svg.text-red-400"),
  };
}

describe("MultiPaymentInput — perCurrencyTotals (LIRA-322)", () => {
  it("shows Total Amount and Paid per currency; exact in both → tick, no Remaining, no change", () => {
    renderMpi({ perCurrencyTotals: true });

    expect(lineInputs()).toHaveLength(2);
    expect(summaryRow("Total Amount").text).toBe("$497.00 · 900,000 LBP");
    const paid = summaryRow("Paid");
    expect(paid.text).toBe("$497.00 · 900,000 LBP");
    expect(paid.tick).toBe(true);
    expect(paid.warning).toBe(false);
    expect(screen.queryByTestId("remaining-row")).toBeNull();
    expect(screen.queryByTestId("return-change")).toBeNull();
  });

  it("$300 + 900,000 LBP: Remaining to pay shows only the short USD, with the warning icon", () => {
    renderMpi({ perCurrencyTotals: true });
    setLines("300", "900000");

    const paid = summaryRow("Paid");
    expect(paid.text).toBe("$300.00 · 900,000 LBP");
    expect(paid.warning).toBe(true);
    expect(paid.tick).toBe(false);
    expect(screen.getByTestId("remaining-row")).toHaveTextContent(
      "Remaining to pay",
    );
    expect(screen.getByTestId("remaining-amount").textContent).toBe("$197.00");
    expect(screen.queryByTestId("return-change")).toBeNull();
  });

  it("both short: Remaining lists each currency in its own currency", () => {
    renderMpi({ perCurrencyTotals: true });
    setLines("400", "800000");

    expect(screen.getByTestId("remaining-amount").textContent).toBe(
      "$97.00 · 100,000 LBP",
    );
  });

  it("$600 + 0 LBP: Remaining is 900,000 LBP and the change box shows the $103 USD overpay (not $92.89)", () => {
    renderMpi({ perCurrencyTotals: true });
    setLines("600", "0");

    expect(summaryRow("Paid").text).toBe("$600.00 · 0 LBP");
    expect(screen.getByTestId("remaining-amount").textContent).toBe(
      "900,000 LBP",
    );
    const changeDue = screen.getByTestId("change-due").textContent ?? "";
    expect(changeDue).toContain("$103.00");
    expect(changeDue).toContain("9,167,000 LBP");
    expect(changeDue).not.toContain("$92.89");
    expect((screen.getByTestId("return-usd") as HTMLInputElement).value).toBe(
      "103.00",
    );
  });

  it("LBP overpaid only: change seeds the LBP field with the LBP extra", () => {
    renderMpi({ perCurrencyTotals: true });
    setLines("497", "1000000");

    expect(screen.queryByTestId("remaining-row")).toBeNull();
    expect(screen.getByTestId("change-due").textContent).toContain(
      "100,000 LBP",
    );
    expect((screen.getByTestId("return-lbp") as HTMLInputElement).value).toBe(
      "100000",
    );
    expect((screen.getByTestId("return-usd") as HTMLInputElement).value).toBe(
      "",
    );
  });

  it("both overpaid: change due is the sum, each field seeded with its own currency's extra", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    renderMpi({ perCurrencyTotals: true, onReturnChange });
    setLines("500", "989000");

    // $3 + 89,000 LBP ($1) = $4.00
    expect(screen.getByTestId("change-due").textContent).toContain("$4.00");
    expect((screen.getByTestId("return-usd") as HTMLInputElement).value).toBe(
      "3.00",
    );
    expect((screen.getByTestId("return-lbp") as HTMLInputElement).value).toBe(
      "89000",
    );
    const legs = onReturnChange.mock.calls.at(-1)?.[0] ?? [];
    expect(legs.map((l) => [l.currencyCode, l.amount, l.direction])).toEqual([
      ["USD", 3, "OUT"],
      ["LBP", 89000, "OUT"],
    ]);
  });

  it("+ Add line fills only its own currency's remaining, never a converted figure", () => {
    renderMpi({ perCurrencyTotals: true });
    setLines("497", "0");
    fireEvent.click(screen.getByTestId("add-payment-line"));

    // The new line is USD (the box's currency): USD is fully paid, so it
    // starts at 0 — the unpaid LBP is not converted into it.
    const added = lineInputs()[2];
    expect(added.value === "" || added.value === "0").toBe(true);
  });

  it("off (default): the same entry still reads as one converted overpay — behaviour unchanged", () => {
    renderMpi({});
    setLines("600", "0");

    expect(screen.getByTestId("change-due").textContent).toContain("$92.89");
    expect(screen.queryByTestId("remaining-row")).toBeNull();
  });
});

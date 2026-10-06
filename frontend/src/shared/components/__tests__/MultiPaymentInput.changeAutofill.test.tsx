/** @jest-environment jsdom */
/**
 * MultiPaymentInput — "All in $" / "All in LBP" change autofill (LIRA-264,
 * owner 2026-10-06).
 *
 * Under each CASH change field of the Return/Change block sits a one-tap
 * button: the USD one puts the WHOLE change due in dollars and zeroes LBP;
 * the LBP one puts the whole change in LBP (converted at the form's
 * effective rate) and zeroes USD. Rounding follows the change seed's own
 * helpers — USD to cents; LBP converted from a USD change rounded UP to the
 * smallest LBP note (`roundLBPUp`, the smart-split remainder rule); an
 * LBP-denominated change stays exact (`Math.round`, the LBP seed rule).
 *
 * Shown only while there is change due in payment mode with a CASH return;
 * hidden in payout mode (no Return/Change block there) and while keep-change
 * is active (the fields are then the operator's partial-return input).
 *
 * Rule 17: written BEFORE the component change and run against the unfixed
 * component first — see the LIRA-264 report for the recorded failure.
 */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";

type Kept = {
  usd: number;
  lbp: number;
  exactUsd: number;
  exactLbp: number;
} | null;

const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];
const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];
const RATE = 90_000;

function renderMpi(opts: {
  total: number;
  currency: "USD" | "LBP";
  direction?: "payment" | "payout";
  smartSplitOverpay?: boolean;
  onReturnChange?: jest.Mock<void, [PaymentLine[]]>;
  onKeptChange?: jest.Mock<void, [Kept]>;
}) {
  return render(
    <MultiPaymentInput
      totals={[{ amount: opts.total, currency: opts.currency }]}
      currency={opts.currency}
      totalAmountCurrency={opts.currency}
      paymentMethods={PAYMENT_METHODS}
      currencies={CURRENCIES}
      exchangeRate={RATE}
      showDiscount={false}
      cashOnlyReturn={true}
      onChange={jest.fn()}
      {...(opts.direction ? { direction: opts.direction } : {})}
      {...(opts.smartSplitOverpay ? { smartSplitOverpay: true } : {})}
      {...(opts.onReturnChange ? { onReturnChange: opts.onReturnChange } : {})}
      {...(opts.onKeptChange ? { onKeptChange: opts.onKeptChange } : {})}
    />,
  );
}

function type(value: string): void {
  const input = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!input) throw new Error("no payment-amount input rendered");
  fireEvent.change(input, { target: { value } });
}

/** The last OUT-leg set emitted, reduced to the money-relevant fields. */
function lastLegs(
  onReturnChange: jest.Mock<void, [PaymentLine[]]>,
): Array<{
  method: string;
  currencyCode: string;
  amount: number;
  direction: PaymentLine["direction"];
}> {
  const calls = onReturnChange.mock.calls;
  const legs = calls[calls.length - 1]?.[0] ?? [];
  return legs.map(({ method, currencyCode, amount, direction }) => ({
    method,
    currencyCode,
    amount,
    direction,
  }));
}

describe("MultiPaymentInput — change autofill (All in $ / All in LBP)", () => {
  it("USD job, $4.73 change: All in $ → $4.73 / 0 LBP; All in LBP → 430,000 LBP / $0; OUT legs follow", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    renderMpi({ total: 100, currency: "USD", onReturnChange });
    type("104.73");

    fireEvent.click(screen.getByTestId("return-all-usd"));
    expect(screen.getByTestId("return-usd")).toHaveValue("4.73");
    expect(screen.getByTestId("return-lbp")).toHaveValue("0");
    expect(lastLegs(onReturnChange)).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 4.73, direction: "OUT" },
    ]);
    expect(
      screen.queryByTestId("return-mismatch-warning"),
    ).not.toBeInTheDocument();

    // 4.73 × 90,000 = 425,700 → rounded up to the 5,000 note → 430,000.
    fireEvent.click(screen.getByTestId("return-all-lbp"));
    expect(screen.getByTestId("return-lbp")).toHaveValue("430000");
    expect(screen.getByTestId("return-usd")).toHaveValue("0");
    expect(lastLegs(onReturnChange)).toEqual([
      { method: "CASH", currencyCode: "LBP", amount: 430_000, direction: "OUT" },
    ]);
    expect(
      screen.queryByTestId("return-mismatch-warning"),
    ).not.toBeInTheDocument();
  });

  it("overrides a smart-split seed (4 $ + 70,000 LBP) with the whole change in one currency", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    renderMpi({
      total: 100,
      currency: "USD",
      smartSplitOverpay: true,
      onReturnChange,
    });
    type("104.73");
    expect(screen.getByTestId("return-usd")).toHaveValue("4");
    expect(screen.getByTestId("return-lbp")).toHaveValue("70000");
    expect(
      screen.queryByTestId("return-mismatch-warning"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("return-all-usd"));
    expect(screen.getByTestId("return-usd")).toHaveValue("4.73");
    expect(screen.getByTestId("return-lbp")).toHaveValue("0");
    expect(lastLegs(onReturnChange)).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 4.73, direction: "OUT" },
    ]);
  });

  it("LBP job, 50,000 LBP change: All in $ → $0.56; All in LBP → exact 50,000", () => {
    const onReturnChange = jest.fn<void, [PaymentLine[]]>();
    renderMpi({ total: 900_000, currency: "LBP", onReturnChange });
    type("950000");

    // 50,000 / 90,000 = 0.5555… → 0.56 (cents).
    fireEvent.click(screen.getByTestId("return-all-usd"));
    expect(screen.getByTestId("return-usd")).toHaveValue("0.56");
    expect(screen.getByTestId("return-lbp")).toHaveValue("0");
    expect(lastLegs(onReturnChange)).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 0.56, direction: "OUT" },
    ]);
    expect(
      screen.queryByTestId("return-mismatch-warning"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("return-all-lbp"));
    expect(screen.getByTestId("return-lbp")).toHaveValue("50000");
    expect(screen.getByTestId("return-usd")).toHaveValue("0");
    expect(lastLegs(onReturnChange)).toEqual([
      { method: "CASH", currencyCode: "LBP", amount: 50_000, direction: "OUT" },
    ]);
    expect(
      screen.queryByTestId("return-mismatch-warning"),
    ).not.toBeInTheDocument();
  });

  it("rounding-only over-return is not flagged, but a real over-return still is", () => {
    renderMpi({ total: 100, currency: "USD" });
    type("104.73");
    fireEvent.click(screen.getByTestId("return-all-lbp"));
    // 430,000 vs exact 425,700: under one 5,000 note over → rounding, no flag.
    expect(
      screen.queryByTestId("return-mismatch-warning"),
    ).not.toBeInTheDocument();
    // 435,000: more than a note over → the operator is over-returning.
    fireEvent.change(screen.getByTestId("return-lbp"), {
      target: { value: "435000" },
    });
    expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
      /more than the customer overpaid/,
    );
  });

  it("no buttons without change due", () => {
    renderMpi({ total: 100, currency: "USD" });
    // Auto-filled exact payment.
    expect(screen.queryByTestId("return-all-usd")).not.toBeInTheDocument();
    expect(screen.queryByTestId("return-all-lbp")).not.toBeInTheDocument();
    type("80");
    expect(screen.queryByTestId("return-all-usd")).not.toBeInTheDocument();
  });

  it("no buttons in payout mode, even when the lines exceed the total", () => {
    renderMpi({ total: 100, currency: "USD", direction: "payout" });
    type("150");
    expect(screen.queryByTestId("return-all-usd")).not.toBeInTheDocument();
    expect(screen.queryByTestId("return-all-lbp")).not.toBeInTheDocument();
  });

  it("buttons are hidden while keep-change is active and return when it is turned off", () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    renderMpi({ total: 100, currency: "USD", onKeptChange });
    type("104.73");
    expect(screen.getByTestId("return-all-usd")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("keep-change"));
    expect(screen.queryByTestId("return-all-usd")).not.toBeInTheDocument();
    expect(screen.queryByTestId("return-all-lbp")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("keep-change"));
    expect(screen.getByTestId("return-all-usd")).toBeInTheDocument();
    expect(screen.getByTestId("return-all-lbp")).toBeInTheDocument();
  });
});

describe("MultiPaymentInput — remaining and change due in both currencies (LIRA-264)", () => {
  // Owner example: total $22, paid $18 at 90,000 → "$4.00 | 360,000 LBP".
  // USD first, then the LBP equivalent at the form's rate, comma-grouped.
  it("owner example: remaining on a $22 bill paid $18 shows $4.00 and 360,000 LBP", () => {
    renderMpi({ total: 22, currency: "USD" });
    type("18");
    const row = screen.getByTestId("remaining-row");
    expect(within(row).getByText("$4.00")).toBeInTheDocument();
    expect(within(row).getByText("360,000 LBP")).toBeInTheDocument();
    // USD first.
    expect(row.textContent ?? "").toMatch(/\$4\.00\s*\|\s*360,000 LBP/);
  });

  it("LBP-denominated bill still lists USD first: 450,000 LBP remaining → $5.00 | 450,000 LBP", () => {
    renderMpi({ total: 900_000, currency: "LBP" });
    type("450000");
    const row = screen.getByTestId("remaining-row");
    expect(row.textContent ?? "").toMatch(/\$5\.00\s*\|\s*450,000 LBP/);
  });

  it("change due shows both currencies: $4.73 change → $4.73 | 425,700 LBP", () => {
    renderMpi({ total: 100, currency: "USD" });
    type("104.73");
    const due = screen.getByTestId("change-due");
    expect(within(due).getByText("$4.73")).toBeInTheDocument();
    expect(within(due).getByText("425,700 LBP")).toBeInTheDocument();
    expect(due.textContent ?? "").toMatch(/\$4\.73\s*\|\s*425,700 LBP/);
  });
});

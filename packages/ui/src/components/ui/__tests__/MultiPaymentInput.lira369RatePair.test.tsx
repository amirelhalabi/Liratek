/** @jest-environment jsdom */
/**
 * LIRA-369 US4 (T019) — one rate box for any currency.
 *
 * An Exchange that pays out euros can put some or all of them on the
 * client's account, which is kept in USD. The cashier types the rate as
 * "1 EUR = … USD" in its own box (`payment-account-rate`), shown only when
 * an Account line in that currency exists. The same prop on `counterFlow`
 * does the same for the "Customer pays" side (`counter-flow-account-rate`).
 *
 * Without the prop — or without such a line — the "1 USD = … LBP" box is
 * exactly as before and no second box appears.
 *
 * Also (T012): the sheet works with one non-USD/LBP currency (EUR, "€"):
 * Total Amount, Paid and Remaining read in euros with 2 decimals.
 *
 * Rule 17: seen failing before the prop existed.
 */
import { render, fireEvent, screen, act } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import MultiPaymentInput, {
  type AccountRateProp,
  type MultiPaymentInputProps,
} from "../MultiPaymentInput";

const USD_LBP = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];
const EUR_ONLY = [{ code: "EUR", symbol: "€" }];
const METHODS = [
  { code: "CASH", label: "Cash" },
  { code: "CUSTOMER_ACCOUNT", label: "Account" },
];

const type = (el: Element, value: string) =>
  fireEvent.change(el, { target: { value } });

const mainAmount = (): HTMLInputElement =>
  document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  ) as HTMLInputElement;
const mainMethod = (): HTMLSelectElement =>
  document.querySelector<HTMLSelectElement>(
    '[data-testid^="payment-method-"]',
  ) as HTMLSelectElement;

function renderEurPayout(
  overrides: Partial<MultiPaymentInputProps> = {},
): void {
  render(
    <MultiPaymentInput
      payer="payout"
      totals={[{ amount: 100, currency: "EUR" }]}
      currency="EUR"
      totalAmountCurrency="EUR"
      paymentMethods={METHODS}
      currencies={EUR_ONLY}
      hasClient
      showDiscount={false}
      onChange={() => {}}
      {...overrides}
    />,
  );
}

beforeAll(async () => {
  await loadLanguage("en");
  await i18n.changeLanguage("en");
});

describe("LIRA-369 — the account rate box (main section)", () => {
  it("shows '1 EUR = 1.1 USD' when the payout line is Account in EUR", () => {
    const rate: AccountRateProp = {
      currency: "EUR",
      value: 1.1,
      onChange: jest.fn(),
    };
    renderEurPayout({ initialMethod: "CUSTOMER_ACCOUNT", accountRate: rate });
    const box = screen.getByTestId("payment-account-rate") as HTMLInputElement;
    expect(box.value).toBe("1.1");
    const row = screen.getByTestId("payment-account-rate-row");
    expect(row.textContent).toContain("1 EUR =");
    expect(row.textContent).toContain("USD");
  });

  it("typing fires onChange with the number; emptying fires 0", () => {
    const onChange = jest.fn();
    renderEurPayout({
      initialMethod: "CUSTOMER_ACCOUNT",
      accountRate: { currency: "EUR", value: 1.1, onChange },
    });
    const box = screen.getByTestId("payment-account-rate") as HTMLInputElement;
    act(() => type(box, "1.12"));
    expect(onChange).toHaveBeenLastCalledWith(1.12);
    expect(box.value).toBe("1.12");
    act(() => type(box, ""));
    expect(onChange).toHaveBeenLastCalledWith(0);
    expect(box.value).toBe("");
  });

  it("hidden with a Cash line; appears when the line becomes Account", () => {
    renderEurPayout({
      accountRate: { currency: "EUR", value: 1.1, onChange: jest.fn() },
    });
    expect(screen.queryByTestId("payment-account-rate")).toBeNull();
    act(() => {
      fireEvent.change(mainMethod(), {
        target: { value: "CUSTOMER_ACCOUNT" },
      });
    });
    expect(screen.getByTestId("payment-account-rate")).toBeTruthy();
  });

  it("without the prop the '1 USD = … LBP' box shows once LBP enters, no second box", () => {
    render(
      <MultiPaymentInput
        payer="payout"
        totals={[{ amount: 100, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={METHODS}
        currencies={USD_LBP}
        exchangeRate={90_000}
        hasClient
        initialMethod="CUSTOMER_ACCOUNT"
        onChange={() => {}}
      />,
    );
    // Owner 2026-11-01: USD owed and paid in USD — no USD↔LBP box.
    expect(screen.queryByTestId("payment-exchange-rate")).toBeNull();
    const cur = document.querySelector<HTMLSelectElement>(
      '[data-testid^="payment-currency-"]',
    ) as HTMLSelectElement;
    act(() => {
      fireEvent.change(cur, { target: { value: "LBP" } });
    });
    const fx = screen.getByTestId("payment-exchange-rate") as HTMLInputElement;
    expect(fx.value).toBe("90,000");
    expect(fx.parentElement?.textContent).toContain("1 USD =");
    expect(fx.parentElement?.textContent).toContain("LBP");
    expect(screen.queryByTestId("payment-account-rate")).toBeNull();
    expect(screen.queryByTestId("payment-account-rate-row")).toBeNull();
  });
});

describe("LIRA-369 — a sheet in one non-USD/LBP currency (EUR)", () => {
  it("Total Amount and Paid read in euros with 2 decimals", () => {
    renderEurPayout();
    const summary = screen.getByTestId("payment-summary");
    expect(summary.textContent).toContain("€100.00");
    expect(summary.textContent).not.toContain("$");
    const options = Array.from(
      document.querySelectorAll<HTMLOptionElement>(
        '[data-testid^="payment-currency-"] option',
      ),
    ).map((o) => o.value);
    // One currency: either a single option or no picker at all.
    expect(options.every((v) => v === "EUR")).toBe(true);
  });

  it("a short EUR line shows the remaining in euros only, no USD/LBP pair", () => {
    renderEurPayout();
    act(() => type(mainAmount(), "80"));
    const remaining = screen.getByTestId("remaining-amount");
    expect(remaining.textContent).toContain("€20.00");
    expect(remaining.textContent).not.toContain("LBP");
    expect(remaining.textContent).not.toContain("$");
  });

  it("no keep-change / round-up / added-change controls when not wired", () => {
    renderEurPayout();
    act(() => type(mainAmount(), "99.5"));
    const text = screen.getByTestId("multi-payment-input").textContent ?? "";
    expect(text).not.toContain("Change kept");
    expect(text).not.toContain("Rounded up");
    expect(screen.queryByTestId("counter-flow-add-change")).toBeNull();
  });
});

describe("LIRA-369 — the account rate box in Customer pays", () => {
  it("shows '1 EUR = … USD' for an EUR Account line in the counter-flow", () => {
    const onChange = jest.fn();
    render(
      <MultiPaymentInput
        payer="payout"
        totals={[{ amount: 110, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={METHODS}
        currencies={USD_LBP}
        exchangeRate={90_000}
        showDiscount={false}
        onChange={() => {}}
        counterFlow={{
          label: "Customer pays",
          totalAmount: 100,
          currency: "EUR",
          lockCurrency: true,
          currencies: EUR_ONLY,
          hasClient: true,
          seedLines: [
            { method: "CUSTOMER_ACCOUNT", currencyCode: "EUR", amount: 100 },
          ],
          onChange: () => {},
          accountRate: { currency: "EUR", value: 1.1, onChange },
        }}
      />,
    );
    const section = screen.getByTestId("counter-flow-section");
    const box = screen.getByTestId(
      "counter-flow-account-rate",
    ) as HTMLInputElement;
    expect(section.contains(box)).toBe(true);
    expect(box.value).toBe("1.1");
    expect(
      screen.getByTestId("counter-flow-account-rate-row").textContent,
    ).toContain("1 EUR =");
    act(() => type(box, "1.08"));
    expect(onChange).toHaveBeenLastCalledWith(1.08);
    // The main section has no EUR Account line: no main box.
    expect(screen.queryByTestId("payment-account-rate")).toBeNull();
    // Owner 2026-11-01: USD owed against EUR paid never meets LBP, so the
    // USD/LBP header box is not shown.
    expect(screen.queryByTestId("payment-exchange-rate")).toBeNull();
  });
});

/**
 * MultiPaymentInput — 6 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 6).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import {
  render,
  fireEvent,
  screen,
  act,
  cleanup,
} from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import MultiPaymentInput, {
  type AccountRateProp,
  type MultiPaymentInputProps,
  type PaymentLine,
} from "../MultiPaymentInput";
import { type LinesSectionState } from "../useLinesSection";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("MultiPaymentInput.amountSymbol", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Owner 2026-11-01: the "$" inside a payment line's amount field shows only
   * when that line is in USD. LBP, EUR and every other currency show no sign
   * (the currency is already named next to it) — an EUR "Customer pays" line
   * used to read "$ 100".
   */

  const USD_LBP = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];
  const METHODS = [{ code: "CASH", label: "Cash" }];

  beforeAll(async () => {
    await loadLanguage("en");
    await i18n.changeLanguage("en");
  });

  /** The sign drawn inside a line's amount field, or null. */
  function signOf(prefix: "payment" | "counter-flow"): string | null {
    const input = document.querySelector<HTMLInputElement>(
      `[data-testid^="${prefix}-amount-"]`,
    );
    const sign = input?.parentElement?.querySelector("span");
    return sign ? (sign.textContent ?? "").trim() : null;
  }

  describe("amount field sign", () => {
    it("USD payout line shows $, EUR Customer pays line shows no sign", () => {
      render(
        <MultiPaymentInput
          payer="payout"
          totals={[{ amount: 114, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={USD_LBP}
          showDiscount={false}
          onChange={() => {}}
          counterFlow={{
            label: "Customer pays",
            totalAmount: 100,
            currency: "EUR",
            lockCurrency: true,
            seedLines: [{ method: "CASH", currencyCode: "EUR", amount: 100 }],
            onChange: () => {},
          }}
        />,
      );
      expect(signOf("payment")).toBe("$");
      expect(signOf("counter-flow")).toBeNull();
    });

    it("an EUR payout line shows no sign, even with € in the currency list", () => {
      render(
        <MultiPaymentInput
          payer="payout"
          totals={[{ amount: 100, currency: "EUR" }]}
          currency="EUR"
          totalAmountCurrency="EUR"
          paymentMethods={METHODS}
          currencies={[{ code: "EUR", symbol: "€" }]}
          showDiscount={false}
          onChange={() => {}}
        />,
      );
      expect(signOf("payment")).toBeNull();
    });
  });
});

describe("MultiPaymentInput.binanceDollarLine", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Cornertech 2026-11-06: a Binance payment line is paid in dollars and the
   * server books it into the Binance drawer as USDT (1 USDT = $1); LBP is
   * refused there. So a Binance line's currency is locked to USD, and picking
   * Binance on an LBP line switches it to USD.
   */

  const USD_LBP = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];
  const METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "BINANCE", label: "Binance" },
  ];

  beforeAll(async () => {
    await loadLanguage("en");
    await i18n.changeLanguage("en");
  });

  function currencyField(): HTMLInputElement | HTMLSelectElement {
    return document.querySelector<HTMLInputElement | HTMLSelectElement>(
      '[data-testid^="payment-currency-"]',
    )!;
  }

  describe("Binance payment line", () => {
    it("picking Binance on an LBP line locks it to USD with the USDT hint", () => {
      const onChange = jest.fn();
      render(
        <MultiPaymentInput
          totals={[{ amount: 27_000_000, currency: "LBP" }]}
          currency="LBP"
          totalAmountCurrency="LBP"
          paymentMethods={METHODS}
          currencies={USD_LBP}
          showDiscount={false}
          onChange={onChange}
        />,
      );
      expect(currencyField().tagName).toBe("SELECT");

      const method = document.querySelector<HTMLSelectElement>(
        '[data-testid^="payment-method-"]',
      )!;
      fireEvent.change(method, { target: { value: "BINANCE" } });

      const field = currencyField();
      expect(field.tagName).toBe("INPUT");
      expect(field.value).toBe("USD");
      expect(
        screen.getByTitle(
          "Binance takes dollars — booked into Binance as USDT",
        ),
      ).toBeTruthy();
      const lastLines = onChange.mock.calls.at(-1)?.[0] as Array<{
        method: string;
        currencyCode: string;
      }>;
      expect(lastLines.map((l) => [l.method, l.currencyCode])).toEqual([
        ["BINANCE", "USD"],
      ]);
    });

    it("on a sheet that offers USDT (Binance cash-out), picking Binance switches the line to USDT", () => {
      const onChange = jest.fn();
      render(
        <MultiPaymentInput
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={[...USD_LBP, { code: "USDT", symbol: "USDT" }]}
          showDiscount={false}
          onChange={onChange}
        />,
      );
      const method = document.querySelector<HTMLSelectElement>(
        '[data-testid^="payment-method-"]',
      )!;
      fireEvent.change(method, { target: { value: "BINANCE" } });

      expect(currencyField().value).toBe("USDT");
      const lastLines = onChange.mock.calls.at(-1)?.[0] as Array<{
        method: string;
        currencyCode: string;
      }>;
      expect(lastLines.map((l) => [l.method, l.currencyCode])).toEqual([
        ["BINANCE", "USDT"],
      ]);
    });
  });
});

describe("MultiPaymentInput.lira365CounterFlowDiscount (LIRA-365)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-365 US2 (T018) — the "Customer pays" box shows the same Discount as
   * every other payment form (owner 2026-11-01): "Total Amount", the Discount
   * line, then "After Discount". The old "Forgive" button and any Waive
   * button of its own are gone; there is no Extra switch.
   *
   * The typed discount is reported as `forgiven` (the page sends it as
   * `customer_waived_amount`, booked as before), held at `maxForgive`. The
   * box's single line follows the discounted total, and editing a line keeps
   * the discount.
   *
   * Example: an exchange where the customer owes 9,000,000 LBP for $100.
   * Rule 17: seen failing before the box was changed.
   */

  const CURRENCIES = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];
  const METHODS = [{ code: "CASH", label: "Cash" }];

  const type = (el: Element, value: string) =>
    fireEvent.change(el, { target: { value } });

  const cfAmounts = (): HTMLInputElement[] =>
    Array.from(
      document.querySelectorAll<HTMLInputElement>(
        '[data-testid^="counter-flow-amount-"]',
      ),
    );
  const digits = (s: string | null | undefined) =>
    Number((s ?? "").replace(/[^\d.]/g, ""));

  function renderExchange() {
    const states: LinesSectionState[] = [];
    render(
      <MultiPaymentInput
        payer="payout"
        totals={[{ amount: 100, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={METHODS}
        currencies={CURRENCIES}
        exchangeRate={90_000}
        showDiscount={false}
        onChange={() => {}}
        counterFlow={{
          label: "Customer pays",
          totalAmount: 9_000_000,
          currency: "LBP",
          lockCurrency: true,
          seedLines: [
            { method: "CASH", currencyCode: "LBP", amount: 9_000_000 },
          ],
          maxForgive: 450_000,
          onChange: () => {},
          onStateChange: (s) => states.push(s),
        }}
      />,
    );
    return { last: () => states[states.length - 1] };
  }

  const discountInput = () =>
    screen.getByTestId("counter-flow-discount-input") as HTMLInputElement;

  beforeAll(async () => {
    await loadLanguage("en");
    await i18n.changeLanguage("en");
  });

  describe("LIRA-365 US2 — Discount line in the Customer pays box", () => {
    it("shows Total Amount and a Discount line; no Forgive, no Waive, no Extra", () => {
      renderExchange();
      const section = screen.getByTestId("counter-flow-section");
      expect(screen.queryByTestId("counter-flow-forgive")).toBeNull();
      expect(
        section.querySelector('[data-testid="waive-remaining"]'),
      ).toBeNull();
      expect(screen.queryByTestId("discount-mode-extra")).toBeNull();
      expect(digits(screen.getByTestId("counter-flow-total").textContent)).toBe(
        9_000_000,
      );
      expect(screen.getByTestId("counter-flow-discount")).toBeTruthy();
      expect(screen.queryByTestId("counter-flow-after-discount")).toBeNull();
    });

    it("50,000 discount → line follows to 8,950,000, reported as forgiven, balanced", () => {
      const { last } = renderExchange();
      act(() => type(discountInput(), "50000"));
      expect(cfAmounts()).toHaveLength(1);
      expect(digits(cfAmounts()[0].value)).toBe(8_950_000);
      expect(
        digits(screen.getByTestId("counter-flow-after-discount").textContent),
      ).toBe(8_950_000);
      expect(last()).toMatchObject({
        paid: 8_950_000,
        forgiven: 50_000,
        unaccounted: 0,
        balanced: true,
        overpaid: false,
      });
    });

    it("over the cap → held at 450,000 with the Capped to max note", () => {
      const { last } = renderExchange();
      act(() => type(discountInput(), "600000"));
      expect(screen.getByTestId("discount-cap-note")).toBeTruthy();
      expect(digits(cfAmounts()[0].value)).toBe(8_550_000);
      expect(last()).toMatchObject({ forgiven: 450_000, balanced: true });
    });

    it("editing the line keeps the discount", () => {
      const { last } = renderExchange();
      act(() => type(discountInput(), "50000"));
      act(() => type(cfAmounts()[0], "8000000"));
      expect(discountInput().value.replace(/,/g, "")).toBe("50000");
      expect(last()).toMatchObject({
        paid: 8_000_000,
        forgiven: 50_000,
        unaccounted: 950_000,
        balanced: false,
      });
    });

    it("line typed lower first, then the discount → balanced", () => {
      const { last } = renderExchange();
      act(() => type(cfAmounts()[0], "8950000"));
      expect(last()).toMatchObject({ unaccounted: 50_000, balanced: false });
      act(() => type(discountInput(), "50000"));
      expect(last()).toMatchObject({
        paid: 8_950_000,
        forgiven: 50_000,
        unaccounted: 0,
        balanced: true,
      });
    });
  });
});

describe("MultiPaymentInput.lira369RatePair (LIRA-369)", () => {
  beforeAll(resetBetweenFiles);

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
      const box = screen.getByTestId(
        "payment-account-rate",
      ) as HTMLInputElement;
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
      const box = screen.getByTestId(
        "payment-account-rate",
      ) as HTMLInputElement;
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
      const fx = screen.getByTestId(
        "payment-exchange-rate",
      ) as HTMLInputElement;
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
});

describe("MultiPaymentInput.payloadLanguage (LIRA-331)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-331 T025 — the payment box emits the SAME money whatever the UI
   * language is (rule 28d: a variant test, every mode, not one happy path).
   *
   * Each scenario renders the real MultiPaymentInput, drives it ONLY through
   * data-testids / structural selectors (never visible text, which differs per
   * language), and records every value it hands its caller, in order:
   * onChange (payment legs), onReturnChange (change / OUT legs), onKeptChange,
   * onPmFeesChange, onDiscountChange, onExtraChange, onExchangeRateChange and
   * the counter-flow onChange / onStateChange. Line ids are random UUIDs, so
   * each is replaced by its order of first appearance before comparing. The English and Arabic recordings
   * must be deep-equal, and must not be empty.
   *
   * Rule 17: not failing-first (guard against future drift) — it passed on the
   * unconverted component, and must keep passing once the labels are t().
   */

  const RATE = 90_000;
  const CURRENCIES = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];
  const METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "WHISH", label: "Whish" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
  ];

  type Event = [string, unknown];

  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

  function recorder() {
    const log: Event[] = [];
    // Line ids are random UUIDs: each one becomes its order of first
    // appearance ("L1", "L2", …), in values AND object keys (the PM-fee map is
    // keyed by line id), so the two runs compare position for position.
    const seen = new Map<string, string>();
    const norm = (s: string) =>
      s.replace(UUID, (u) => {
        if (!seen.has(u)) seen.set(u, `L${seen.size + 1}`);
        return seen.get(u)!;
      });
    const normalize = (v: unknown): unknown => {
      if (typeof v === "string") return norm(v);
      if (Array.isArray(v)) return v.map(normalize);
      if (v && typeof v === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          out[norm(k)] = normalize(val);
        }
        return out;
      }
      return v;
    };
    const rec =
      (name: string) =>
      (...args: unknown[]) => {
        log.push([name, normalize(args.length === 1 ? args[0] : args)]);
      };
    const props = {
      onChange: rec("onChange") as (p: PaymentLine[]) => void,
      onReturnChange: rec("onReturnChange") as (p: PaymentLine[]) => void,
      onKeptChange: rec("onKeptChange") as NonNullable<
        MultiPaymentInputProps["onKeptChange"]
      >,
      onPmFeesChange: rec("onPmFeesChange") as (
        f: Record<string, number>,
      ) => void,
      onExchangeRateChange: rec("onExchangeRateChange") as (r: number) => void,
    };
    return { log, rec, props };
  }

  const amountInputs = (): HTMLInputElement[] =>
    Array.from(
      document.querySelectorAll<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      ),
    );
  const methodSelects = (): HTMLSelectElement[] =>
    Array.from(
      document.querySelectorAll<HTMLSelectElement>(
        '[data-testid^="payment-method-"]',
      ),
    );
  const currencySelects = (): HTMLSelectElement[] =>
    Array.from(
      document.querySelectorAll<HTMLSelectElement>(
        '[data-testid^="payment-currency-"]',
      ),
    );
  const type = (el: Element, value: string) =>
    fireEvent.change(el, { target: { value } });
  /** The built-in discount / extra field — the only decimal text input in the
   *  summary before anything is overpaid. */
  const discountInput = (): HTMLInputElement =>
    screen
      .getByTestId("payment-summary")
      .querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;

  /** The wallet (PM) fee field under a split line paid by a wallet. */
  const pmFeeInput = (): HTMLInputElement =>
    document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-line-"] input[placeholder="0.00"]',
    )!;

  type Scenario = (r: ReturnType<typeof recorder>) => void | Promise<void>;

  const SCENARIOS: Record<string, Scenario> = {
    "customer: split USD+LBP overpay, under-return kept, then all change in LBP":
      ({ props }) => {
        render(
          <MultiPaymentInput
            {...props}
            totals={[{ amount: 90, currency: "USD" }]}
            currency="USD"
            totalAmountCurrency="USD"
            paymentMethods={METHODS}
            currencies={CURRENCIES}
            exchangeRate={RATE}
            showDiscount={false}
            smartSplitOverpay
            initialLines={[
              { method: "CASH", currencyCode: "USD", amount: 50 },
              { method: "CASH", currencyCode: "LBP", amount: 4_550_000 },
            ]}
          />,
        );
        type(screen.getByTestId("return-usd"), "4");
        type(screen.getByTestId("return-lbp"), "0");
        fireEvent.click(screen.getByTestId("return-all-lbp"));
        fireEvent.click(screen.getByTestId("return-all-usd"));
      },

    "customer: change to the customer's account (Account button, then part cash)":
      ({ props }) => {
        render(
          <MultiPaymentInput
            {...props}
            totals={[{ amount: 14, currency: "USD" }]}
            currency="USD"
            totalAmountCurrency="USD"
            paymentMethods={METHODS}
            currencies={CURRENCIES}
            exchangeRate={RATE}
            showDiscount={false}
            hasClient
            unreturnedChangeTo="CUSTOMER_ACCOUNT"
          />,
        );
        type(amountInputs()[0], "30");
        fireEvent.click(screen.getByTestId("change-destination-account"));
        type(screen.getByTestId("return-usd"), "5");
      },

    "customer: change handed back by wallet (non-cash return method)": ({
      props,
    }) => {
      render(
        <MultiPaymentInput
          {...props}
          totals={[{ amount: 20, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={CURRENCIES}
          exchangeRate={RATE}
          showDiscount={false}
        />,
      );
      type(amountInputs()[0], "25");
      type(screen.getByTestId("return-method"), "WHISH");
      type(screen.getByTestId("return-currency"), "LBP");
    },

    "customer: auto debt remainder on a short single line": ({ props }) => {
      render(
        <MultiPaymentInput
          {...props}
          totals={[{ amount: 90, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={CURRENCIES}
          exchangeRate={RATE}
          showDiscount={false}
          hasClient
          autoDebtRemainder
        />,
      );
      type(amountInputs()[0], "60");
    },

    "customer: wallet fee, discount, rate edit, split add line": ({
      props,
      rec,
    }) => {
      render(
        <MultiPaymentInput
          {...props}
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={CURRENCIES}
          exchangeRate={RATE}
          showPmFee
          pmFeeRate={0.01}
          maxDiscount={10}
          onDiscountChange={rec("onDiscountChange")}
        />,
      );
      type(methodSelects()[0], "WHISH");
      type(discountInput(), "5");
      fireEvent.click(screen.getByTestId("split-toggle"));
      type(amountInputs()[0], "40");
      fireEvent.click(screen.getByTestId("add-payment-line"));
      const selects = methodSelects();
      type(selects[selects.length - 1], "CASH");
      // The rate box shows only once USD and LBP mix (owner 2026-11-01): the
      // added cash line is paid in LBP, then the rate is edited.
      const curs = currencySelects();
      type(curs[curs.length - 1], "LBP");
      type(screen.getByTestId("payment-exchange-rate"), "89,500");
      type(pmFeeInput(), "1.25");
      type(pmFeeInput(), "1.2x"); // not a number: ignored, as a number field would
    },

    "customer: extra mode on the built-in line": ({ props, rec }) => {
      render(
        <MultiPaymentInput
          {...props}
          totals={[{ amount: 50, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={CURRENCIES}
          exchangeRate={RATE}
          onDiscountChange={rec("onDiscountChange")}
          onExtraChange={rec("onExtraChange")}
        />,
      );
      fireEvent.click(screen.getByTestId("discount-mode-extra"));
      type(discountInput(), "3");
    },

    "customer: shortfall waived (built-in Waive)": ({ props, rec }) => {
      render(
        <MultiPaymentInput
          {...props}
          totals={[{ amount: 50, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={CURRENCIES}
          exchangeRate={RATE}
          maxDiscount={50}
          onDiscountChange={rec("onDiscountChange")}
        />,
      );
      type(amountInputs()[0], "48");
      fireEvent.click(screen.getByTestId("waive-remaining"));
    },

    "shop payer: overpay, the outsider hands part back": ({ props }) => {
      render(
        <MultiPaymentInput
          {...props}
          payer="shop"
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={CURRENCIES}
          exchangeRate={RATE}
          showDiscount={false}
        />,
      );
      type(amountInputs()[0], "120");
      type(screen.getByTestId("return-usd"), "15");
      type(screen.getByTestId("return-lbp"), "0");
    },

    "payout: small shortfall kept as profit": ({ props }) => {
      render(
        <MultiPaymentInput
          {...props}
          payer="payout"
          totals={[{ amount: 101.12, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={CURRENCIES}
          exchangeRate={RATE}
          showDiscount={false}
        />,
      );
      type(amountInputs()[0], "101");
    },

    "payout with counter-flow: customer pays part, a Discount covers the rest":
      ({ props, rec }) => {
        render(
          <MultiPaymentInput
            {...props}
            payer="payout"
            totals={[{ amount: 200, currency: "USD" }]}
            currency="USD"
            totalAmountCurrency="USD"
            paymentMethods={METHODS}
            currencies={CURRENCIES}
            exchangeRate={RATE}
            showDiscount={false}
            counterFlow={{
              label: "Customer pays — fee",
              totalAmount: 5,
              currency: "USD",
              lockCurrency: true,
              maxForgive: 5,
              onChange: rec("counterFlow.onChange"),
              onStateChange: rec("counterFlow.onStateChange"),
            }}
          />,
        );
        const cfAmount = document.querySelector<HTMLInputElement>(
          '[data-testid^="counter-flow-amount-"]',
        )!;
        type(cfAmount, "3");
        // LIRA-365 US2: the Discount line replaces the Forgive button.
        type(screen.getByTestId("counter-flow-discount-input"), "2");
      },

    "per-currency totals (OMT settle): LBP overpaid, USD short": ({
      props,
    }) => {
      render(
        <MultiPaymentInput
          {...props}
          perCurrencyTotals
          totals={[
            { amount: 100, currency: "USD" },
            { amount: 900_000, currency: "LBP" },
          ]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={CURRENCIES}
          exchangeRate={RATE}
          showDiscount={false}
          waiveDisabled
          initialLines={[
            { method: "CASH", currencyCode: "USD", amount: 80 },
            { method: "CASH", currencyCode: "LBP", amount: 1_000_000 },
          ]}
        />,
      );
      type(amountInputs()[0], "100");
    },
  };

  async function recordIn(lang: "en" | "ar", scenario: Scenario) {
    if (lang === "ar") await loadLanguage("ar");
    await act(async () => {
      await i18n.changeLanguage(lang);
    });
    const r = recorder();
    await scenario(r);
    cleanup();
    return r.log;
  }

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  describe("MultiPaymentInput emits identical money in English and Arabic", () => {
    it.each(Object.entries(SCENARIOS))("%s", async (_name, scenario) => {
      const en = await recordIn("en", scenario);
      const ar = await recordIn("ar", scenario);
      expect(en.length).toBeGreaterThan(0);
      expect(ar).toEqual(en);
    });
  });

  function accountChangeSheet() {
    return (
      <MultiPaymentInput
        totals={[{ amount: 14, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={METHODS}
        currencies={CURRENCIES}
        exchangeRate={RATE}
        showDiscount={false}
        hasClient
        unreturnedChangeTo="CUSTOMER_ACCOUNT"
        onChange={jest.fn()}
        onReturnChange={jest.fn()}
      />
    );
  }

  describe("MultiPaymentInput renders its own words in Arabic", () => {
    it("header, summary and the change note are Arabic; amounts stay LTR", async () => {
      await loadLanguage("ar");
      await act(async () => {
        await i18n.changeLanguage("ar");
      });
      render(accountChangeSheet());
      expect(screen.getByText("الدفع")).toBeInTheDocument();
      expect(screen.getByText("المبلغ الإجمالي")).toBeInTheDocument();
      expect(screen.getByText("المدفوع")).toBeInTheDocument();
      type(amountInputs()[0], "30");
      fireEvent.click(screen.getByTestId("change-destination-account"));
      const note = screen.getByTestId("change-to-account-summary");
      expect(note.textContent).toBe(
        "$16.00 غير المُرجَع يذهب إلى حساب الزبون كرصيد.",
      );
      expect(note.querySelector('bdi[dir="ltr"]')?.textContent).toBe("$16.00");
    });

    it("the wallet fee field takes Arabic-Indic digits as the same fee", () => {
      const feesFor = (typed: string) => {
        const onPmFeesChange = jest.fn<void, [Record<string, number>]>();
        render(
          <MultiPaymentInput
            totals={[{ amount: 100, currency: "USD" }]}
            currency="USD"
            totalAmountCurrency="USD"
            paymentMethods={METHODS}
            currencies={CURRENCIES}
            exchangeRate={RATE}
            showDiscount={false}
            showPmFee
            initialLines={[
              { method: "WHISH", currencyCode: "USD", amount: 60 },
              { method: "CASH", currencyCode: "USD", amount: 40 },
            ]}
            onChange={jest.fn()}
            onPmFeesChange={onPmFeesChange}
          />,
        );
        type(pmFeeInput(), typed);
        const value = pmFeeInput().value;
        const fees = Object.values(onPmFeesChange.mock.calls.at(-1)?.[0] ?? {});
        cleanup();
        return { value, fees };
      };
      expect(feesFor("١٫٢٥")).toEqual({ value: "1.25", fees: [1.25] });
      expect(feesFor("1.25")).toEqual({ value: "1.25", fees: [1.25] });
    });

    it("English text is unchanged", () => {
      render(accountChangeSheet());
      expect(screen.getByText("Payment")).toBeInTheDocument();
      expect(screen.getByText("Paid")).toBeInTheDocument();
      type(amountInputs()[0], "30");
      fireEvent.click(screen.getByTestId("change-destination-account"));
      expect(screen.getByTestId("change-to-account-summary").textContent).toBe(
        "$16.00 not returned goes to the customer's account as credit.",
      );
    });
  });
});

describe("MultiPaymentInput.usdLbpRateVisibility", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Owner 2026-11-01: the "1 USD = … LBP" box shows only when the payment
   * window actually mixes USD and LBP — in what is owed or in any line, on
   * either side. A USD payout against a customer paying EUR never converts
   * USD↔LBP, so the box is noise there.
   */

  const USD_LBP = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];
  const METHODS = [{ code: "CASH", label: "Cash" }];
  const RATE = "payment-exchange-rate";

  beforeAll(async () => {
    await loadLanguage("en");
    await i18n.changeLanguage("en");
  });

  describe("USD ↔ LBP rate box visibility", () => {
    it("hidden: USD owed, USD line, customer pays in EUR", () => {
      render(
        <MultiPaymentInput
          payer="payout"
          totals={[{ amount: 114, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={USD_LBP}
          showDiscount={false}
          onChange={() => {}}
          counterFlow={{
            label: "Customer pays",
            totalAmount: 100,
            currency: "EUR",
            lockCurrency: true,
            currencies: [{ code: "EUR", symbol: "€" }],
            seedLines: [{ method: "CASH", currencyCode: "EUR", amount: 100 }],
            onChange: () => {},
          }}
        />,
      );
      expect(screen.queryByTestId(RATE)).toBeNull();
    });

    it("hidden: USD owed and paid in USD only", () => {
      render(
        <MultiPaymentInput
          totals={[{ amount: 50, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={USD_LBP}
          showDiscount={false}
          onChange={() => {}}
        />,
      );
      expect(screen.queryByTestId(RATE)).toBeNull();
    });

    it("shown once a line switches to LBP against a USD total", () => {
      render(
        <MultiPaymentInput
          totals={[{ amount: 50, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={USD_LBP}
          showDiscount={false}
          onChange={() => {}}
        />,
      );
      const cur = document.querySelector<HTMLSelectElement>(
        '[data-testid^="payment-currency-"]',
      ) as HTMLSelectElement;
      fireEvent.change(cur, { target: { value: "LBP" } });
      expect(screen.getByTestId(RATE)).toBeTruthy();
    });

    it("shown: LBP owed, customer pays in USD", () => {
      render(
        <MultiPaymentInput
          payer="payout"
          totals={[{ amount: 8_900_000, currency: "LBP" }]}
          currency="LBP"
          totalAmountCurrency="LBP"
          paymentMethods={METHODS}
          currencies={USD_LBP}
          showDiscount={false}
          onChange={() => {}}
          counterFlow={{
            label: "Customer pays",
            totalAmount: 100,
            currency: "USD",
            lockCurrency: true,
            seedLines: [{ method: "CASH", currencyCode: "USD", amount: 100 }],
            onChange: () => {},
          }}
        />,
      );
      expect(screen.getByTestId(RATE)).toBeTruthy();
    });
  });
});

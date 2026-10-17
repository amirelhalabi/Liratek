/** @jest-environment jsdom */
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
import { render, fireEvent, screen, cleanup, act } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import MultiPaymentInput, {
  type MultiPaymentInputProps,
  type PaymentLine,
} from "../MultiPaymentInput";

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
    onPmFeesChange: rec("onPmFeesChange") as (f: Record<string, number>) => void,
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

type Scenario =(r: ReturnType<typeof recorder>) => void | Promise<void>;

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
    type(screen.getByTestId("payment-exchange-rate"), "89,500");
    fireEvent.click(screen.getByTestId("split-toggle"));
    type(amountInputs()[0], "40");
    fireEvent.click(screen.getByTestId("add-payment-line"));
    const selects = methodSelects();
    type(selects[selects.length - 1], "CASH");
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

  "payout with counter-flow: customer pays part, forgives the rest": ({
    props,
    rec,
  }) => {
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
    const forgive = screen.queryByTestId("counter-flow-forgive");
    if (forgive) fireEvent.click(forgive);
  },

  "per-currency totals (OMT settle): LBP overpaid, USD short": ({ props }) => {
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

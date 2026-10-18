/** @jest-environment jsdom */
/**
 * MultiPaymentInput — customer adds change on payouts (LIRA-336, research R7).
 *
 * Owner example: the shop owes a customer $197, the cashier asks the customer
 * for $3 (or 268,500 LBP at 89,500) and hands out $200. The "Customer gives
 * change" section (optional, closed by default) or an existing customer
 * section with `allowAddedChange` takes the money above its own target; that
 * amount raises what "Shop pays" must pay out by the same value, so round-up
 * and kept change measure against the raised target. `onAddedChange` reports
 * it in the payout currency; over the $5 / 450,000 LBP cap it is refused.
 *
 * Rule 17: written before the component change and run against it first —
 * see the task report for the recorded failures.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { MultiPaymentInput } from "@liratek/ui";

type Added = { usd: number; lbp: number } | null;
type RoundUp = { usd: number; lbp: number } | null;

const CASH_ONLY = [{ code: "CASH", label: "Cash" }];
const WITH_ACCOUNT = [
  { code: "CASH", label: "Cash" },
  { code: "CUSTOMER_ACCOUNT", label: "Customer account" },
];
const CURRENCIES = [
  { code: "USD", symbol: "$" },
  { code: "LBP", symbol: "LBP" },
];

interface Opts {
  total?: number;
  /** Optional "Customer gives change" section (default true). */
  optional?: boolean;
  cfTotal?: number;
  cfMethods?: Array<{ code: string; label: string }>;
  hasClient?: boolean;
  allowAddedChange?: boolean;
  onAddedChange?: jest.Mock<void, [Added]>;
  onRoundUpChange?: jest.Mock<void, [RoundUp]>;
  onKeptChange?: jest.Mock;
  onCfChange?: jest.Mock;
  onMainChange?: jest.Mock;
}

function mpi(o: Opts) {
  const optional = o.optional ?? true;
  return (
    <MultiPaymentInput
      totals={[{ amount: o.total ?? 197, currency: "USD" }]}
      currency="USD"
      totalAmountCurrency="USD"
      paymentMethods={CASH_ONLY}
      currencies={CURRENCIES}
      exchangeRate={89_500}
      showDiscount={false}
      cashOnlyReturn={true}
      onChange={o.onMainChange ?? jest.fn()}
      payer="payout"
      onRoundUpChange={o.onRoundUpChange ?? jest.fn()}
      onKeptChange={o.onKeptChange ?? jest.fn()}
      {...(o.onAddedChange ? { onAddedChange: o.onAddedChange } : {})}
      counterFlow={{
        label: "Customer pays",
        totalAmount: o.cfTotal ?? 0,
        currency: "USD",
        onChange: o.onCfChange ?? jest.fn(),
        paymentMethods: o.cfMethods ?? CASH_ONLY,
        hasClient: o.hasClient ?? false,
        allowAddedChange: o.allowAddedChange ?? true,
        ...(optional ? { optional: true } : {}),
      }}
    />
  );
}

const mainInput = (): HTMLInputElement => {
  const el = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!el) throw new Error("no main amount input");
  return el;
};
const cfInputs = (): HTMLInputElement[] =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>(
      '[data-testid^="counter-flow-amount-"]',
    ),
  );
const typeMain = (v: string) =>
  fireEvent.change(mainInput(), { target: { value: v } });
const typeCf = (v: string) =>
  fireEvent.change(cfInputs()[0], { target: { value: v } });
const openSection = () =>
  fireEvent.click(screen.getByTestId("counter-flow-add-change"));

/** The amount the main ("Shop pays") single line last reported. */
const lastMainAmount = (m: jest.Mock): number => {
  const lines = m.mock.calls.at(-1)?.[0] as Array<{ amount: number }>;
  return lines[0].amount;
};

function paidIsRed(): boolean {
  const label = screen.getByText("Paid", { selector: "span" });
  const row = label.parentElement;
  if (!row) throw new Error("Paid row not found");
  const amount = row.querySelector<HTMLElement>(".font-mono");
  if (!amount) throw new Error("Paid amount not found");
  return (
    amount.className.includes("text-red-400") ||
    !!row.querySelector("svg.text-red-400")
  );
}

describe("MultiPaymentInput — customer adds change on payouts (LIRA-336)", () => {
  it("the optional section is closed by default: no customer section, a '+ Customer gives change' link", () => {
    render(mpi({}));
    expect(
      screen.queryByTestId("counter-flow-section"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("direction-chip-customer-pays"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("counter-flow-add-change")).toHaveTextContent(
      /Customer gives change/,
    );
  });

  it("the link opens the section, titled 'Customer gives change'", () => {
    render(mpi({}));
    openSection();
    const section = screen.getByTestId("counter-flow-section");
    expect(section).toHaveTextContent(/Customer gives change/);
    expect(cfInputs()).toHaveLength(1);
    expect(
      screen.queryByTestId("counter-flow-add-change"),
    ).not.toBeInTheDocument();
  });

  it("Cash USD 3 → Shop pays target $200, the summary row and onAddedChange({usd:3, lbp:0})", () => {
    const onAddedChange = jest.fn<void, [Added]>();
    const onMainChange = jest.fn();
    render(mpi({ onAddedChange, onMainChange }));
    expect(lastMainAmount(onMainChange)).toBe(197);
    openSection();
    typeCf("3");
    // The untouched Shop pays line follows the raised target.
    expect(lastMainAmount(onMainChange)).toBe(200);
    expect(onAddedChange).toHaveBeenLastCalledWith({ usd: 3, lbp: 0 });
    const row = screen.getByTestId("payout-added-change-summary");
    expect(row).toHaveTextContent(/Owed\s*\$197\.00/);
    expect(row).toHaveTextContent(/customer gave\s*\$3\.00/);
    expect(row).toHaveTextContent(/=\s*\$200\.00/);
    expect(
      screen.queryByTestId("counter-flow-overpaid"),
    ).not.toBeInTheDocument();
  });

  it("$200 paid out → no round-up, nothing remaining, Paid not red", () => {
    const onRoundUpChange = jest.fn<void, [RoundUp]>();
    render(mpi({ onRoundUpChange }));
    openSection();
    typeCf("3");
    typeMain("200");
    expect(onRoundUpChange).toHaveBeenLastCalledWith(null);
    expect(
      screen.queryByTestId("payout-roundup-summary"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("remaining-row")).not.toBeInTheDocument();
    expect(paidIsRed()).toBe(false);
  });

  it("$201 paid out → round-up of $1 above the raised target", () => {
    const onRoundUpChange = jest.fn<void, [RoundUp]>();
    render(mpi({ onRoundUpChange }));
    openSection();
    typeCf("3");
    typeMain("201");
    expect(onRoundUpChange).toHaveBeenLastCalledWith({ usd: 1, lbp: 0 });
  });

  it("$199.90 paid out → $0.10 kept, measured against the raised target", () => {
    const onKeptChange = jest.fn();
    render(mpi({ onKeptChange }));
    openSection();
    typeCf("3");
    typeMain("199.9");
    expect(onKeptChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ usd: 0.1, lbp: 0 }),
    );
  });

  it("LBP 268,500 at 89,500 → added $3, target $200", () => {
    const onAddedChange = jest.fn<void, [Added]>();
    const onMainChange = jest.fn();
    render(mpi({ onAddedChange, onMainChange }));
    openSection();
    const cur = document.querySelector<HTMLSelectElement>(
      '[data-testid^="counter-flow-currency-"]',
    );
    if (!cur) throw new Error("no currency select");
    expect(cur).not.toBeDisabled();
    fireEvent.change(cur, { target: { value: "LBP" } });
    typeCf("268500");
    expect(onAddedChange).toHaveBeenLastCalledWith({ usd: 3, lbp: 0 });
    expect(lastMainAmount(onMainChange)).toBe(200);
  });

  it("over the cap ($6) → the section is overpaid, onAddedChange(null), target stays $197", () => {
    const onAddedChange = jest.fn<void, [Added]>();
    const onMainChange = jest.fn();
    render(mpi({ onAddedChange, onMainChange }));
    openSection();
    typeCf("6");
    expect(onAddedChange).toHaveBeenLastCalledWith(null);
    expect(onAddedChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ usd: 6 }),
    );
    expect(screen.getByTestId("counter-flow-overpaid")).toBeInTheDocument();
    expect(screen.getByTestId("counter-flow-section")).toHaveTextContent(
      /Exchange page/,
    );
    expect(lastMainAmount(onMainChange)).toBe(197);
    expect(
      screen.queryByTestId("payout-added-change-summary"),
    ).not.toBeInTheDocument();
  });

  it("× closes the section, clears its lines and reports null", () => {
    const onAddedChange = jest.fn<void, [Added]>();
    const onCfChange = jest.fn();
    const onMainChange = jest.fn();
    render(mpi({ onAddedChange, onCfChange, onMainChange }));
    openSection();
    typeCf("3");
    expect(onAddedChange).toHaveBeenLastCalledWith({ usd: 3, lbp: 0 });
    fireEvent.click(screen.getByTestId("counter-flow-remove-change"));
    expect(
      screen.queryByTestId("counter-flow-section"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("counter-flow-add-change")).toBeInTheDocument();
    expect(onCfChange).toHaveBeenLastCalledWith([]);
    expect(onAddedChange).toHaveBeenLastCalledWith(null);
    expect(lastMainAmount(onMainChange)).toBe(197);
    // Re-opening starts fresh at 0.
    openSection();
    expect(cfInputs()[0].value).toMatch(/^0?$/);
  });

  it("a page that drops counterFlow and passes it again gets the section back closed", () => {
    const { rerender } = render(mpi({}));
    openSection();
    expect(screen.getByTestId("counter-flow-section")).toBeInTheDocument();
    rerender(
      <MultiPaymentInput
        totals={[{ amount: 197, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={CASH_ONLY}
        currencies={CURRENCIES}
        exchangeRate={89_500}
        showDiscount={false}
        onChange={jest.fn()}
        payer="payout"
      />,
    );
    expect(
      screen.queryByTestId("counter-flow-add-change"),
    ).not.toBeInTheDocument();
    rerender(mpi({}));
    expect(
      screen.queryByTestId("counter-flow-section"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("counter-flow-add-change")).toBeInTheDocument();
  });

  it("LBP payout (Exchange USD→LBP): $1 added → target +89,500 LBP, reports {usd:0, lbp:89500}", () => {
    const onAddedChange = jest.fn<void, [Added]>();
    const onMainChange = jest.fn();
    render(
      <MultiPaymentInput
        totals={[{ amount: 8_950_000, currency: "LBP" }]}
        currency="LBP"
        totalAmountCurrency="LBP"
        paymentMethods={CASH_ONLY}
        currencies={CURRENCIES}
        exchangeRate={89_500}
        showDiscount={false}
        onChange={onMainChange}
        payer="payout"
        onRoundUpChange={jest.fn()}
        onKeptChange={jest.fn()}
        onAddedChange={onAddedChange}
        counterFlow={{
          label: "Customer pays",
          totalAmount: 100,
          currency: "USD",
          onChange: jest.fn(),
          paymentMethods: CASH_ONLY,
          allowAddedChange: true,
        }}
      />,
    );
    expect(onAddedChange).toHaveBeenLastCalledWith(null);
    typeCf("101");
    expect(onAddedChange).toHaveBeenLastCalledWith({ usd: 0, lbp: 89_500 });
    expect(lastMainAmount(onMainChange)).toBe(9_039_500);
  });

  it("an existing customer section with allowAddedChange: money above its target counts", () => {
    // Whish App receive: customer sends $100 (target), is owed $97 cash.
    const onAddedChange = jest.fn<void, [Added]>();
    const onMainChange = jest.fn();
    render(
      mpi({
        total: 97,
        optional: false,
        cfTotal: 100,
        onAddedChange,
        onMainChange,
      }),
    );
    // Not optional → shown from the start, no link.
    expect(screen.getByTestId("counter-flow-section")).toBeInTheDocument();
    expect(
      screen.queryByTestId("counter-flow-add-change"),
    ).not.toBeInTheDocument();
    expect(onAddedChange).toHaveBeenLastCalledWith(null);
    typeCf("103");
    expect(onAddedChange).toHaveBeenLastCalledWith({ usd: 3, lbp: 0 });
    expect(lastMainAmount(onMainChange)).toBe(100);
    expect(
      screen.queryByTestId("counter-flow-overpaid"),
    ).not.toBeInTheDocument();
  });

  it("an account line never counts as added change", () => {
    const onAddedChange = jest.fn<void, [Added]>();
    const onMainChange = jest.fn();
    render(
      mpi({
        cfMethods: WITH_ACCOUNT,
        hasClient: true,
        onAddedChange,
        onMainChange,
      }),
    );
    openSection();
    const method = document.querySelector<HTMLSelectElement>(
      '[data-testid^="counter-flow-method-"]',
    );
    if (!method) throw new Error("no method select");
    fireEvent.change(method, { target: { value: "CUSTOMER_ACCOUNT" } });
    typeCf("3");
    expect(onAddedChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ usd: 3 }),
    );
    expect(lastMainAmount(onMainChange)).toBe(197);
    expect(screen.getByTestId("counter-flow-overpaid")).toBeInTheDocument();
  });

  it("OPT-IN: an existing section without allowAddedChange is unchanged (above its target = overpaid)", () => {
    const onAddedChange = jest.fn<void, [Added]>();
    const onMainChange = jest.fn();
    render(
      mpi({
        total: 97,
        optional: false,
        cfTotal: 100,
        allowAddedChange: false,
        onAddedChange,
        onMainChange,
      }),
    );
    typeCf("103");
    expect(screen.getByTestId("counter-flow-overpaid")).toBeInTheDocument();
    expect(lastMainAmount(onMainChange)).toBe(97);
    expect(onAddedChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ usd: 3 }),
    );
  });
});

/**
 * MultiPaymentInput — 25 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 25).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, fireEvent, within, act } from "@testing-library/react";
import {
  MultiPaymentInput,
  type PaymentLine,
  DiscountLine,
  discountFieldClass,
  type MultiPaymentPayer,
  type PaymentMethod,
  type Currency,
} from "@liratek/ui";
import { type ComponentProps, useState, StrictMode } from "react";
import { PaymentSheet } from "@/features/recharge/components/PaymentSheet";
import {
  setPayoutLine,
  payoutLineValue,
  payoutLegAmounts,
} from "@/shared/testing/payoutExtraLess";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("MultiPaymentInput.addedChange (LIRA-336)", () => {
  beforeAll(resetBetweenFiles);

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
});

describe("MultiPaymentInput.autoExtra (LIRA-334)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — customer-pays round-up autofill (LIRA-334, research R7,
   * spec User Story 3).
   *
   * Owner example: a sale totals $102.90, the customer hands over $103 and says
   * keep the change. With `onExtraChange` (Extra allowed), the built-in line
   * switches to "+ Extra" with 0.10 filled in, so the total matches what was
   * paid and no change box opens. Clearing it (or switching back to
   * Discount) opens the change box as today and does not refill it until the
   * payment amounts change. A typed discount, an overpay above the cap and a
   * payout never autofill.
   *
   * Rule 17: written before the component change and run against it first —
   * see the task report for the recorded failures.
   */

  const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];
  const CURRENCIES = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];

  function renderBox(
    props: Partial<ComponentProps<typeof MultiPaymentInput>> = {},
  ) {
    const onExtra = jest.fn<void, [number]>();
    const onLines = jest.fn<void, [PaymentLine[]]>();
    const onReturn = jest.fn<void, [PaymentLine[]]>();
    render(
      <MultiPaymentInput
        totals={[{ amount: 102.9, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={89_000}
        onChange={onLines}
        onReturnChange={onReturn}
        onDiscountChange={jest.fn()}
        onExtraChange={onExtra}
        {...props}
      />,
    );
    return { onExtra, onLines, onReturn };
  }

  /** The last reported return legs, and whether the last lines carry an OUT
   *  leg — an autofilled extra must leave NO change leg behind, or the page
   *  would book the 0.10 twice (as extra AND as change, rule 16). */
  function lastReturnLegs(onReturn: jest.Mock<void, [PaymentLine[]]>) {
    return onReturn.mock.calls.at(-1)?.[0] ?? [];
  }
  function lastLinesHaveOut(onLines: jest.Mock<void, [PaymentLine[]]>) {
    const lines = (onLines.mock.calls.at(-1)?.[0] ?? []) as Array<
      PaymentLine & { direction?: string }
    >;
    return lines.some((l) => l.direction === "OUT");
  }

  function pay(value: string): void {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    if (!input) throw new Error("no payment-amount input rendered");
    fireEvent.change(input, { target: { value } });
  }

  const field = (name: "Discount" | "Extra") =>
    screen.getByLabelText(name, { selector: "input" }) as HTMLInputElement;

  const HINT = "Rounded up — clear it to give change";

  describe("MultiPaymentInput — round-up autofill of the built-in Extra (LIRA-334)", () => {
    it("$103 on $102.90 → the line switches to Extra 0.10, onExtraChange(0.1), no change box", () => {
      const { onExtra, onLines, onReturn } = renderBox();
      pay("103");
      expect(lastReturnLegs(onReturn)).toEqual([]);
      expect(lastLinesHaveOut(onLines)).toBe(false);
      expect(onLines.mock.calls.at(-1)?.[0]).toEqual([
        expect.objectContaining({ currencyCode: "USD", amount: 103 }),
      ]);
      expect(screen.getByTestId("discount-mode-extra")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(field("Extra").value).toBe("0.1");
      expect(onExtra).toHaveBeenLastCalledWith(0.1);
      expect(screen.getByTestId("after-page-extra")).toHaveTextContent(
        "$103.00",
      );
      expect(screen.queryByTestId("return-change")).not.toBeInTheDocument();
      expect(screen.getByText(HINT)).toBeInTheDocument();
    });

    it("clearing it opens the change box and does not refill it", () => {
      const { onExtra, onReturn } = renderBox();
      pay("103");
      expect(onExtra).toHaveBeenLastCalledWith(0.1);
      fireEvent.change(field("Extra"), { target: { value: "" } });
      expect(field("Extra").value).toBe("");
      // The change comes back as a return leg once the extra is cleared.
      expect(lastReturnLegs(onReturn)).toEqual([
        expect.objectContaining({ currencyCode: "USD", amount: 0.1 }),
      ]);
      expect(onExtra).toHaveBeenLastCalledWith(0);
      expect(screen.getByTestId("return-change")).toBeInTheDocument();
      expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    });

    it("switching back to Discount opens the change box and does not refill it", () => {
      const { onExtra } = renderBox();
      pay("103");
      fireEvent.click(screen.getByTestId("discount-mode-discount"));
      expect(field("Discount").value).toBe("");
      expect(onExtra).toHaveBeenLastCalledWith(0);
      expect(screen.getByTestId("return-change")).toBeInTheDocument();
    });

    it("after clearing, a change of the total alone does not refill it (only the payment lines re-arm it)", () => {
      // Not proven failing-first (rule 17): written after the implementation
      // to exercise the dismiss ref, which the clear/switch cases above do not.
      const props = {
        totals: [{ amount: 102.9, currency: "USD" as const }],
        currency: "USD",
        totalAmountCurrency: "USD",
        paymentMethods: PAYMENT_METHODS,
        currencies: CURRENCIES,
        exchangeRate: 89_000,
        onChange: jest.fn(),
        onDiscountChange: jest.fn(),
      };
      const onExtra = jest.fn<void, [number]>();
      const { rerender } = render(
        <MultiPaymentInput {...props} onExtraChange={onExtra} />,
      );
      pay("103");
      fireEvent.change(field("Extra"), { target: { value: "" } });
      expect(onExtra).toHaveBeenLastCalledWith(0);
      rerender(
        <MultiPaymentInput
          {...props}
          totals={[{ amount: 102.8, currency: "USD" }]}
          onExtraChange={onExtra}
        />,
      );
      expect(field("Extra").value).toBe("");
      expect(onExtra).toHaveBeenLastCalledWith(0);
      expect(screen.getByTestId("return-change")).toBeInTheDocument();
    });

    it("after clearing, changing the payment amount fills it again", () => {
      const { onExtra } = renderBox();
      pay("103");
      fireEvent.change(field("Extra"), { target: { value: "" } });
      expect(screen.getByTestId("return-change")).toBeInTheDocument();
      pay("104");
      expect(field("Extra").value).toBe("1.1");
      expect(onExtra).toHaveBeenLastCalledWith(1.1);
      expect(screen.queryByTestId("return-change")).not.toBeInTheDocument();
    });

    it("correcting the payment back to the exact total removes the autofilled extra (no stale extra)", () => {
      const { onExtra } = renderBox();
      pay("103");
      expect(onExtra).toHaveBeenLastCalledWith(0.1);
      pay("102.9");
      expect(onExtra).toHaveBeenLastCalledWith(0);
      expect(screen.getByTestId("discount-mode-discount")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(field("Discount").value).toBe("");
      expect(screen.queryByTestId("remaining-row")).not.toBeInTheDocument();
    });

    it("a typed discount is never replaced", () => {
      const { onExtra } = renderBox();
      fireEvent.change(field("Discount"), { target: { value: "1" } });
      pay("103");
      expect(screen.getByTestId("discount-mode-discount")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(field("Discount").value).toBe("1");
      expect(onExtra).not.toHaveBeenCalledWith(0.1);
      expect(onExtra).toHaveBeenLastCalledWith(0);
      expect(screen.getByTestId("return-change")).toBeInTheDocument();
    });

    it("an overpay above the $5 cap ($6) fills nothing and opens the change box", () => {
      const { onExtra } = renderBox();
      pay("108.9");
      expect(field("Discount").value).toBe("");
      expect(onExtra).toHaveBeenLastCalledWith(0);
      expect(screen.getByTestId("return-change")).toBeInTheDocument();
    });

    it("a payout never autofills", () => {
      const { onExtra } = renderBox({ payer: "payout" });
      pay("103");
      expect(
        screen.queryByLabelText("Extra", { selector: "input" }),
      ).not.toBeInTheDocument();
      expect(onExtra).not.toHaveBeenCalledWith(0.1);
    });

    it("without onExtraChange nothing is filled (today's change box)", () => {
      render(
        <MultiPaymentInput
          totals={[{ amount: 102.9, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={89_000}
          onChange={jest.fn()}
          onDiscountChange={jest.fn()}
        />,
      );
      pay("103");
      expect(field("Discount").value).toBe("");
      expect(screen.getByTestId("return-change")).toBeInTheDocument();
    });
  });
});

describe("MultiPaymentInput.autoKeepChange", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — kept change is AUTOMATIC (owner decision 2026-10-06,
   * after reviewing mock-ups): "The keep-change pill blocks the payment but
   * sits far from the Pay button — bad UX. Remove the Keep change button.
   * Always show 'Keeping X as profit' when the returned amount does not match
   * the change due."
   *
   *   (a) payment mode: handing back LESS than the change due keeps the gap as
   *       profit — no pill anywhere, the green "Keeping … as profit" note, and
   *       `onKeptChange` reports the gap. Clearing both fields keeps it all.
   *   (b) handing back MORE than the change due is still the red warning, and
   *       nothing is kept.
   *   (c) payout mode (Exchange): a small shortfall under the cap is kept
   *       automatically with the green note; at/over the cap it is "Remaining
   *       to pay out" (red) and nothing is kept.
   *   Guards: an untouched, freshly seeded return keeps NOTHING (otherwise any
   *   seed that lands a hair under the change due would silently book profit
   *   on every page), and a page that never wired `onKeptChange` (its backend
   *   cannot book kept change) still gets the red "not covered" warning.
   *
   * Rule 17: (a), (b) and (c) were run against the pre-change component (pill
   * present, keep only on tap / behind the `keepUnreturnedChange` opt-in) and
   * failed first — see the task report. The two guards pass on both versions
   * by design (they pin behaviour that must NOT change).
   */

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

  function amountInput(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    if (!input) throw new Error("no payment-amount input rendered");
    return input;
  }

  function pay(value: string): void {
    fireEvent.change(amountInput(), { target: { value } });
  }

  function lastKept(onKeptChange: jest.Mock<void, [Kept]>): Kept {
    return onKeptChange.mock.calls.at(-1)?.[0] ?? null;
  }

  function lastLegs(onReturnChange: jest.Mock<void, [PaymentLine[]]>) {
    const legs = onReturnChange.mock.calls.at(-1)?.[0] ?? [];
    return legs.map(({ method, currencyCode, amount, direction }) => ({
      method,
      currencyCode,
      amount,
      direction,
    }));
  }

  /** Owner's Katsh scenario: a 450,000 LBP card paid with $6 at 80,000 — the
   *  change due is 30,000 LBP ($0.375). */
  function renderLbpCardPaidInDollars(opts: {
    onReturnChange?: jest.Mock<void, [PaymentLine[]]>;
    onKeptChange?: jest.Mock<void, [Kept]>;
  }) {
    render(
      <MultiPaymentInput
        totals={[{ amount: 450_000, currency: "LBP" }]}
        totalAmountCurrency="LBP"
        currency="USD"
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={80_000}
        showDiscount={false}
        onChange={jest.fn()}
        {...(opts.onReturnChange
          ? { onReturnChange: opts.onReturnChange }
          : {})}
        {...(opts.onKeptChange ? { onKeptChange: opts.onKeptChange } : {})}
      />,
    );
    pay("6");
  }

  describe("MultiPaymentInput — automatic kept change (payment mode)", () => {
    it("(a) under-return: no Keep change button, the gap is kept and the green note says so", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      const onKeptChange = jest.fn<void, [Kept]>();
      renderLbpCardPaidInDollars({ onReturnChange, onKeptChange });

      // The pill is gone for good — not even while overpaid.
      expect(screen.getByTestId("return-change")).toBeInTheDocument();
      expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();

      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "0" },
      });
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "10000" },
      });

      expect(lastLegs(onReturnChange)).toEqual([
        {
          method: "CASH",
          currencyCode: "LBP",
          amount: 10_000,
          direction: "OUT",
        },
      ]);
      const kept = lastKept(onKeptChange);
      expect(kept?.usd).toBe(0.25);
      expect(kept?.lbp).toBe(0);
      expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
        "Keeping $0.25 | 20,000 LBP as profit — the rest is returned above.",
      );
      expect(
        screen.queryByTestId("return-mismatch-warning"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
    });

    it("(a) clearing both fields keeps the whole change — no OUT legs, 'Change kept (profit)'", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      const onKeptChange = jest.fn<void, [Kept]>();
      render(
        <MultiPaymentInput
          totals={[{ amount: 45, currency: "USD" }]}
          totalAmountCurrency="USD"
          currency="USD"
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={89_000}
          showDiscount={false}
          onChange={jest.fn()}
          onReturnChange={onReturnChange}
          onKeptChange={onKeptChange}
        />,
      );
      pay("50");
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "" },
      });
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "" },
      });

      expect(lastLegs(onReturnChange)).toEqual([]);
      expect(lastKept(onKeptChange)).toEqual(
        expect.objectContaining({ usd: 5, lbp: 0 }),
      );
      expect(screen.getByText("Change kept (profit)")).toBeInTheDocument();
      expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
        /^Keeping \$5\.00 \| 445,000 LBP as profit\.$/,
      );
    });

    it("(b) over-return is still the red warning, nothing is kept, and there is no pill", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      renderLbpCardPaidInDollars({ onKeptChange });

      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "0" },
      });
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "50000" },
      });

      expect(lastKept(onKeptChange)).toBeNull();
      expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
        "more than the customer overpaid",
      );
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
    });

    describe("guard: an untouched seeded return keeps nothing", () => {
      it.each([
        {
          name: "plain USD",
          total: 4.27,
          currency: "USD" as const,
          tender: "10",
          smart: false,
        },
        {
          name: "USD smart split",
          total: 4.27,
          currency: "USD" as const,
          tender: "10",
          smart: true,
        },
        {
          name: "LBP total",
          total: 425_000,
          currency: "LBP" as const,
          tender: "500000",
          smart: false,
        },
      ])("$name", ({ total, currency, tender, smart }) => {
        const onKeptChange = jest.fn<void, [Kept]>();
        render(
          <MultiPaymentInput
            totals={[{ amount: total, currency }]}
            totalAmountCurrency={currency}
            currency={currency}
            paymentMethods={PAYMENT_METHODS}
            currencies={CURRENCIES}
            exchangeRate={89_000}
            showDiscount={false}
            smartSplitOverpay={smart}
            onChange={jest.fn()}
            onKeptChange={onKeptChange}
          />,
        );
        pay(tender);

        expect(screen.getByTestId("return-change")).toBeInTheDocument();
        expect(lastKept(onKeptChange)).toBeNull();
        expect(
          screen.queryByTestId("keep-change-summary"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("return-mismatch-warning"),
        ).not.toBeInTheDocument();
      });
    });

    it("guard: a page that does not wire onKeptChange still flags an under-return as not covered", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      renderLbpCardPaidInDollars({ onReturnChange });

      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "0" },
      });
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "10000" },
      });

      expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
        "$0.25 of the change is not covered",
      );
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
    });
  });

  describe("MultiPaymentInput — automatic kept change (payout mode)", () => {
    function renderPayout(onKeptChange: jest.Mock<void, [Kept]>) {
      render(
        <MultiPaymentInput
          totals={[{ amount: 101.12, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={89_000}
          showDiscount={false}
          cashOnlyReturn={true}
          direction="payout"
          onChange={jest.fn()}
          onKeptChange={onKeptChange}
        />,
      );
    }

    it("(c) a shortfall under the cap is kept automatically — no tap, no pill, green remaining row", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      renderPayout(onKeptChange);

      pay("101");

      const kept = lastKept(onKeptChange);
      expect(kept?.usd).toBe(0.12);
      expect(kept?.lbp).toBe(0);
      expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
      const row = screen.getByTestId("remaining-row");
      expect(within(row).getByText("Change kept (profit)")).toBeInTheDocument();
      // 2026-10-13 (owner): the payout "Keeping X as profit." note under the
      // green row is gone — the green "Change kept (profit)" row says it.
      // Updated after the fix: not proven failing-first (rule 17).
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
      expect(within(row).getByTestId("remaining-amount")).toHaveTextContent(
        /\$0\.12/,
      );
    });

    // LIRA-310: the cap is $5 / 450,000 LBP, inclusive.
    it("(c) a shortfall over the cap is 'Remaining to pay out' and nothing is kept", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      renderPayout(onKeptChange);

      pay("101");
      expect(lastKept(onKeptChange)?.usd).toBe(0.12);

      pay("96.11");
      expect(lastKept(onKeptChange)).toBeNull();
      expect(
        within(screen.getByTestId("remaining-row")).getByText(
          "Remaining to pay out",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("MultiPaymentInput.changeAutofill (LIRA-264)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — "All in $" / "All in LBP" change autofill (LIRA-264,
   * owner 2026-10-06). Since the 2026-10-13 compact change box the buttons
   * read "$" and "LBP" (same testids) and sit on the fields' line.
   *
   * Next to the CASH change fields of the Return/Change block sits a one-tap
   * button: the USD one puts the WHOLE change due in dollars and zeroes LBP;
   * the LBP one puts the whole change in LBP (converted at the form's
   * effective rate) and zeroes USD. Rounding follows the change seed's own
   * helpers — USD to cents; LBP converted from a USD change rounded UP to the
   * smallest LBP note (`roundLBPUp`, the smart-split remainder rule); an
   * LBP-denominated change stays exact (`Math.round`, the LBP seed rule).
   *
   * Shown only while there is change due in payment mode with a CASH return;
   * hidden in payout mode (no Return/Change block there). Since the owner
   * decision of 2026-10-06 removed the "Keep change" button, they stay visible
   * while the cashier is keeping part of the change — one tap returns it all.
   *
   * Rule 17: written BEFORE the component change and run against the unfixed
   * component first — see the LIRA-264 report for the recorded failure.
   */

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
        {...(opts.onReturnChange
          ? { onReturnChange: opts.onReturnChange }
          : {})}
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
  function lastLegs(onReturnChange: jest.Mock<void, [PaymentLine[]]>): Array<{
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
        {
          method: "CASH",
          currencyCode: "LBP",
          amount: 430_000,
          direction: "OUT",
        },
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
        {
          method: "CASH",
          currencyCode: "LBP",
          amount: 50_000,
          direction: "OUT",
        },
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

    it("buttons stay visible while part of the change is kept, and one tap returns it all (no Keep change button)", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      renderMpi({ total: 100, currency: "USD", onKeptChange });
      type("104.73");
      expect(screen.getByTestId("return-all-usd")).toBeInTheDocument();
      expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();

      // Hand back nothing → the whole change is kept, buttons still there.
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "" },
      });
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "" },
      });
      expect(onKeptChange.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({ usd: 4.73 }),
      );
      expect(screen.getByTestId("return-all-usd")).toBeInTheDocument();
      expect(screen.getByTestId("return-all-lbp")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("return-all-usd"));
      expect(screen.getByTestId("return-usd")).toHaveValue("4.73");
      expect(onKeptChange).toHaveBeenLastCalledWith(null);
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
});

describe("MultiPaymentInput.compactChangeBox", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — compact change box (owner decisions 2026-10-13).
   *
   *  1. With `unreturnedChangeTo="CUSTOMER_ACCOUNT"` and a client, the
   *     "Account" button empties the CASH return fields and the whole change
   *     becomes ONE CUSTOMER_ACCOUNT OUT leg; a partial cash return splits
   *     into a CASH OUT leg + a CUSTOMER_ACCOUNT OUT leg for the rest.
   *  2. Without an account to credit but with `onKeptChange`, the same slot is
   *     a "Keep" button: it empties the fields and the change is kept.
   *  3. Customer Account is never offered as a "Hand back by" method.
   *  4. Payout mode says "Change kept" once (the green remaining row) — the
   *     separate "Keeping X as profit." note is gone.
   *  5. A wallet fee is folded into ONE "Grand Total … wallet fee" row; the
   *     separate "Wallet Surcharge" row is gone.
   *
   * Rule 17: written AFTER the production change — not proven failing-first.
   * The production code was not re-broken to prove these.
   */

  const CURRENCIES = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];
  const RATE = 90_000;

  type Kept = {
    usd: number;
    lbp: number;
    exactUsd: number;
    exactLbp: number;
  } | null;

  const amountInput = (): HTMLInputElement =>
    document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    )!;

  const last = <T,>(m: jest.Mock<void, [T]>): T | undefined =>
    m.mock.calls.at(-1)?.[0];

  const shape = (lines: PaymentLine[] | undefined) =>
    (lines ?? [])
      .filter((l) => l.amount > 0)
      .map((l) => ({
        method: l.method,
        currencyCode: l.currencyCode,
        amount: l.amount,
        direction: l.direction,
      }));

  function posSale(o: {
    hasClient: boolean;
    onReturnChange: jest.Mock<void, [PaymentLine[]]>;
    onKeptChange?: jest.Mock<void, [Kept]>;
  }) {
    return (
      <MultiPaymentInput
        totals={[{ amount: 14, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={[
          { code: "CASH", label: "Cash" },
          { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
        ]}
        currencies={CURRENCIES}
        exchangeRate={RATE}
        showDiscount={false}
        hasClient={o.hasClient}
        unreturnedChangeTo="CUSTOMER_ACCOUNT"
        onChange={jest.fn()}
        onReturnChange={o.onReturnChange}
        {...(o.onKeptChange ? { onKeptChange: o.onKeptChange } : {})}
      />
    );
  }

  describe("compact change box — Account button (client selected)", () => {
    it("$30 paid on $14: Account empties the fields → ONE CUSTOMER_ACCOUNT OUT leg of $16, no CASH leg", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      render(posSale({ hasClient: true, onReturnChange }));
      fireEvent.change(amountInput(), { target: { value: "30" } });

      // Starts handed back in full, as cash.
      expect(shape(last(onReturnChange))).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 16, direction: "OUT" },
      ]);
      expect(screen.queryByTestId("change-keep-all")).toBeNull();

      fireEvent.click(screen.getByTestId("change-destination-account"));
      expect(screen.getByTestId<HTMLInputElement>("return-usd").value).toBe("");
      expect(screen.getByTestId<HTMLInputElement>("return-lbp").value).toBe("");
      expect(shape(last(onReturnChange))).toEqual([
        {
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 16,
          direction: "OUT",
        },
      ]);
      // Raw legs (no zero filter): exactly one leg, and no CASH leg of any size.
      const raw = last(onReturnChange) ?? [];
      expect(raw).toHaveLength(1);
      expect(raw.some((l) => l.method === "CASH")).toBe(false);
      expect(
        screen.getByTestId("change-to-account-summary").textContent,
      ).toMatch(/\$16\.00 not returned goes to the customer's account/);
    });

    it("typing $10 handed back after Account → CASH OUT $10 + CUSTOMER_ACCOUNT OUT $6", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      render(posSale({ hasClient: true, onReturnChange }));
      fireEvent.change(amountInput(), { target: { value: "30" } });
      fireEvent.click(screen.getByTestId("change-destination-account"));
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "10" },
      });
      const legs = shape(last(onReturnChange));
      expect(legs).toHaveLength(2);
      expect(legs).toEqual(
        expect.arrayContaining([
          { method: "CASH", currencyCode: "USD", amount: 10, direction: "OUT" },
          {
            method: "CUSTOMER_ACCOUNT",
            currencyCode: "USD",
            amount: 6,
            direction: "OUT",
          },
        ]),
      );
    });
  });

  describe("compact change box — Keep button (no account to credit)", () => {
    it("no client + onKeptChange: Keep is shown (not Account); it clears the fields and keeps $16", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      const onKeptChange = jest.fn<void, [Kept]>();
      render(posSale({ hasClient: false, onReturnChange, onKeptChange }));
      fireEvent.change(amountInput(), { target: { value: "30" } });

      expect(screen.queryByTestId("change-destination-account")).toBeNull();
      const keep = screen.getByTestId("change-keep-all");
      expect(keep.textContent).toBe("Keep");
      expect(last(onKeptChange)).toBeNull();

      fireEvent.click(keep);
      expect(screen.getByTestId<HTMLInputElement>("return-usd").value).toBe("");
      expect(last(onKeptChange)).toMatchObject({ usd: 16, lbp: 0 });
      expect(last(onReturnChange) ?? []).toEqual([]);
      expect(screen.getByTestId("keep-change-summary").textContent).toMatch(
        /Keeping \$16\.00.*as profit/,
      );
    });

    it("no client and no onKeptChange: neither Account nor Keep is offered", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      render(posSale({ hasClient: false, onReturnChange }));
      fireEvent.change(amountInput(), { target: { value: "30" } });
      expect(screen.queryByTestId("change-destination-account")).toBeNull();
      expect(screen.queryByTestId("change-keep-all")).toBeNull();
    });
  });

  describe("compact change box — Customer Account is not a return method", () => {
    it("the 'Hand back by' list never contains CUSTOMER_ACCOUNT, even when paymentMethods offers it", () => {
      render(
        <MultiPaymentInput
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={[
            { code: "CASH", label: "Cash" },
            { code: "OMT", label: "OMT" },
            { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
          ]}
          currencies={CURRENCIES}
          exchangeRate={RATE}
          showDiscount={false}
          hasClient={true}
          onChange={jest.fn()}
        />,
      );
      fireEvent.change(amountInput(), { target: { value: "150" } });
      const select = screen.getByTestId<HTMLSelectElement>("return-method");
      const values = Array.from(select.options).map((o) => o.value);
      expect(values).toEqual(["CASH", "OMT"]);
    });

    it("with only Cash + Customer Account there is no 'Hand back by' select at all", () => {
      render(
        <MultiPaymentInput
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={[
            { code: "CASH", label: "Cash" },
            { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
          ]}
          currencies={CURRENCIES}
          exchangeRate={RATE}
          showDiscount={false}
          hasClient={true}
          onChange={jest.fn()}
        />,
      );
      fireEvent.change(amountInput(), { target: { value: "150" } });
      expect(screen.getByTestId("return-change")).toBeInTheDocument();
      expect(screen.queryByTestId("return-method")).toBeNull();
    });
  });

  describe("compact change box — payout keep is said once", () => {
    it("$101 paid out on $101.12: exactly one 'Change kept' and no keep-change-summary note", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      render(
        <MultiPaymentInput
          totals={[{ amount: 101.12, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={[{ code: "CASH", label: "Cash" }]}
          currencies={CURRENCIES}
          exchangeRate={89_000}
          showDiscount={false}
          cashOnlyReturn={true}
          payer="payout"
          onChange={jest.fn()}
          onKeptChange={onKeptChange}
        />,
      );
      fireEvent.change(amountInput(), { target: { value: "101" } });
      expect(last(onKeptChange)).toMatchObject({ usd: 0.12 });
      expect(screen.getAllByText(/Change kept/)).toHaveLength(1);
      expect(screen.queryByTestId("keep-change-summary")).toBeNull();
      expect(screen.queryByText(/Keeping .*as profit/)).toBeNull();
    });
  });

  describe("compact change box — wallet fee in the Grand Total row", () => {
    it("one Grand Total row that names the wallet fee; no 'Wallet Surcharge' row", () => {
      render(
        <MultiPaymentInput
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={[
            { code: "CASH", label: "Cash" },
            { code: "WHISH", label: "Whish" },
          ]}
          currencies={CURRENCIES}
          exchangeRate={RATE}
          showDiscount={false}
          showPmFee={true}
          pmFeeRate={0.01}
          initialLines={[{ method: "WHISH", currencyCode: "USD", amount: 100 }]}
          onChange={jest.fn()}
        />,
      );
      expect(screen.queryByText(/Wallet Surcharge/)).toBeNull();
      const grand = screen.getAllByText("Grand Total");
      expect(grand).toHaveLength(1);
      const row = grand[0].parentElement!;
      expect(row.textContent).toMatch(/wallet fee/);
      expect(row.textContent).toMatch(/101/);
      expect(row.textContent).toMatch(/incl\..*1\.00.*wallet fee/);
    });
  });
});

describe("MultiPaymentInput.discountRow (LIRA-318)", () => {
  beforeAll(resetBetweenFiles);

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
    document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    )!;

  const lastLines = (m: jest.Mock<void, [PaymentLine[]]>): PaymentLine[] =>
    m.mock.calls.at(-1)?.[0] ?? [];

  const pageForgiveRow = (
    <DiscountLine label="Forgive (no cash)" testId="page-forgive">
      <input
        aria-label="Forgive amount"
        className={discountFieldClass(false)}
      />
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
});

describe("MultiPaymentInput.extraCurrencyLabel", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — the currency picker beside the Extra amount is named
   * "Extra currency" for screen readers (shop-day test 2026-10-16).
   *
   * In the session checkout (an extra-only line, split payment) the picker
   * next to the Extra amount was announced as "Discount currency", although
   * the line is the Extra. It is named after the side that is showing.
   */

  const CURRENCIES = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];

  function renderSplitBox(showDiscount: boolean) {
    render(
      <MultiPaymentInput
        totals={[{ amount: 35, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={[{ code: "CASH", label: "Cash" }]}
        currencies={CURRENCIES}
        exchangeRate={89_000}
        initialLines={[
          { method: "CASH", currencyCode: "USD", amount: 26 },
          { method: "CASH", currencyCode: "LBP", amount: 801_000 },
        ]}
        onChange={jest.fn()}
        onDiscountChange={jest.fn()}
        onExtraChange={jest.fn()}
        showDiscount={showDiscount}
      />,
    );
  }

  describe("MultiPaymentInput — Extra currency label", () => {
    it("extra-only line (session checkout): the picker is 'Extra currency'", () => {
      renderSplitBox(false);
      expect(
        screen.getByLabelText("Extra", { selector: "input" }),
      ).toBeTruthy();
      expect(screen.getByLabelText("Extra currency")).toBeTruthy();
      expect(screen.queryByLabelText("Discount currency")).toBeNull();
    });

    it("Discount side stays 'Discount currency'; switching to Extra renames it", () => {
      renderSplitBox(true);
      expect(screen.getByLabelText("Discount currency")).toBeTruthy();
      fireEvent.click(screen.getByTestId("discount-mode-extra"));
      expect(screen.getByLabelText("Extra currency")).toBeTruthy();
      expect(screen.queryByLabelText("Discount currency")).toBeNull();
    });
  });
});

describe("MultiPaymentInput.extraMode (LIRA-319)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — built-in "− Discount | + Extra" line (LIRA-319).
   *
   * Owner 2026-10-13: the payment box's Discount line can instead ADD a small
   * extra charge. With `onExtraChange` the line gets a switch; in extra mode
   * the amount is added to what is owed, the row below reads "After Extra",
   * the payment line follows the new total, and the extra is capped to the
   * total before it ("Capped to max (…)"). A payout never offers it.
   *
   * Not proven failing-first: these props are new (rule 17) — there was no
   * earlier code to run the test against.
   */

  const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];
  const CURRENCIES = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];

  function lineAmount(): number {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    if (!input) throw new Error("no payment-amount input rendered");
    return parseFloat(input.value.replace(/,/g, ""));
  }

  function renderBox(
    props: Partial<ComponentProps<typeof MultiPaymentInput>> = {},
    withExtra = true,
  ) {
    const onExtra = jest.fn<void, [number]>();
    const onDiscount = jest.fn<void, [number]>();
    const onLines = jest.fn<void, [PaymentLine[]]>();
    render(
      <MultiPaymentInput
        totals={[{ amount: 14, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={89_000}
        onChange={onLines}
        onDiscountChange={onDiscount}
        {...(withExtra ? { onExtraChange: onExtra } : {})}
        {...props}
      />,
    );
    return { onExtra, onDiscount, onLines };
  }

  const field = (name: "Discount" | "Extra") =>
    screen.getByLabelText(name, { selector: "input" }) as HTMLInputElement;

  describe("MultiPaymentInput — extra mode (LIRA-319)", () => {
    it("the switch flips the line's label between Discount and Extra", () => {
      renderBox();
      expect(screen.getByTestId("discount-mode-discount")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(field("Discount")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("discount-mode-extra"));
      expect(screen.getByTestId("discount-mode-extra")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(field("Extra")).toBeInTheDocument();
      expect(screen.getByText("Extra")).toBeInTheDocument();
    });

    it("extra 1 on 14 → After Extra $15.00, the payment fills 15, the extra is reported and the discount stays 0", () => {
      const { onExtra, onDiscount, onLines } = renderBox();
      expect(lineAmount()).toBe(14);
      fireEvent.click(screen.getByTestId("discount-mode-extra"));
      fireEvent.change(field("Extra"), { target: { value: "1" } });
      expect(screen.getByTestId("after-page-extra")).toHaveTextContent(
        "$15.00",
      );
      expect(lineAmount()).toBe(15);
      expect(onLines.mock.calls.at(-1)?.[0]).toEqual([
        expect.objectContaining({ currencyCode: "USD", amount: 15 }),
      ]);
      expect(onExtra).toHaveBeenLastCalledWith(1);
      expect(onDiscount).toHaveBeenLastCalledWith(0);
      // No "After Discount" row in extra mode.
      expect(screen.queryByText("After Discount")).not.toBeInTheDocument();
    });

    it("switching back to Discount clears the extra (never both)", () => {
      const { onExtra } = renderBox();
      fireEvent.click(screen.getByTestId("discount-mode-extra"));
      fireEvent.change(field("Extra"), { target: { value: "2" } });
      expect(onExtra).toHaveBeenLastCalledWith(2);
      fireEvent.click(screen.getByTestId("discount-mode-discount"));
      expect(field("Discount").value).toBe("");
      expect(onExtra).toHaveBeenLastCalledWith(0);
      expect(screen.queryByTestId("after-page-extra")).not.toBeInTheDocument();
      expect(lineAmount()).toBe(14);
    });

    it("an extra above the total before it is capped and says so", () => {
      const { onExtra } = renderBox();
      fireEvent.click(screen.getByTestId("discount-mode-extra"));
      fireEvent.change(field("Extra"), { target: { value: "20" } });
      expect(screen.getByText("Capped to max ($14.00)")).toBeInTheDocument();
      expect(onExtra).toHaveBeenLastCalledWith(14);
      expect(lineAmount()).toBe(28);
    });

    it("maxExtra overrides the default cap", () => {
      const { onExtra } = renderBox({ maxExtra: 3 });
      fireEvent.click(screen.getByTestId("discount-mode-extra"));
      fireEvent.change(field("Extra"), { target: { value: "5" } });
      expect(screen.getByText("Capped to max ($3.00)")).toBeInTheDocument();
      expect(onExtra).toHaveBeenLastCalledWith(3);
    });

    it("with the discount hidden the line is extra-only (no switch)", () => {
      const { onExtra } = renderBox({ showDiscount: false });
      expect(
        screen.queryByTestId("discount-mode-extra"),
      ).not.toBeInTheDocument();
      fireEvent.change(field("Extra"), { target: { value: "1" } });
      expect(onExtra).toHaveBeenLastCalledWith(1);
      expect(lineAmount()).toBe(15);
    });

    it("a payout never offers the switch or an extra", () => {
      renderBox({ payer: "payout" });
      expect(
        screen.queryByTestId("discount-mode-extra"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText("Extra", { selector: "input" }),
      ).not.toBeInTheDocument();
    });

    it("without onExtraChange the line is today's plain Discount (no switch)", () => {
      renderBox({}, false);
      expect(
        screen.queryByTestId("discount-mode-discount"),
      ).not.toBeInTheDocument();
      expect(field("Discount")).toBeInTheDocument();
    });
  });
});

describe("MultiPaymentInput.fillTotals (LIRA-308)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — LIRA-308 (owner decisions 2026-10-11): the Debts
   * repayment sheet pre-fills the amount with the TICKED items' sum while
   * `totals` stays the whole debt, so an amount above the ticked sum is a
   * normal payment (it pays more items), not an overpay to hand back.
   *
   *  - `fillTotals`: what the amount fills to (defaults to `totals`);
   *  - `fillKey`: changing it resets the amount to `fillTotals` even after the
   *    cashier typed one (decision 2: a tick change always resets the amount),
   *    keeping the cashier's lines (owner answer 3 — the last line absorbs);
   *  - `defaultReturnMethod`: an amount above the whole debt goes to the
   *    customer's account by default (decision 6), through the existing
   *    CUSTOMER_ACCOUNT change leg.
   *
   * Consumers that pass none of these are unchanged (every other MPI test).
   *
   * 2026-10-13 (owner, compact change box): Customer Account is no longer a
   * return METHOD, so `defaultReturnMethod="CUSTOMER_ACCOUNT"` now falls back
   * to Cash (the guard below). Change goes to the account through
   * `unreturnedChangeTo="CUSTOMER_ACCOUNT"` + the change box's "Account"
   * button instead; the two account-credit cases were rewritten to that path
   * (not proven failing-first — rule 17).
   */

  const METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
  ];
  const CURRENCIES = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];

  type Money = { amount: number; currency: string };

  function element(o: {
    totals: Money[];
    fillTotals?: Money[];
    fillKey?: number;
    onChange: jest.Mock<void, [PaymentLine[]]>;
    onReturnChange?: jest.Mock<void, [PaymentLine[]]>;
    defaultReturnMethod?: string;
    unreturnedToAccount?: boolean;
  }) {
    return (
      <MultiPaymentInput
        totals={o.totals}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={METHODS}
        currencies={CURRENCIES}
        exchangeRate={90_000}
        showDiscount={false}
        hasClient={true}
        onChange={o.onChange}
        onReturnChange={o.onReturnChange ?? jest.fn()}
        {...(o.fillTotals ? { fillTotals: o.fillTotals } : {})}
        {...(o.fillKey !== undefined ? { fillKey: o.fillKey } : {})}
        {...(o.defaultReturnMethod
          ? { defaultReturnMethod: o.defaultReturnMethod }
          : {})}
        {...(o.unreturnedToAccount
          ? { unreturnedChangeTo: "CUSTOMER_ACCOUNT" as const }
          : {})}
      />
    );
  }

  const amountInputs = (): HTMLInputElement[] =>
    Array.from(
      document.querySelectorAll<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      ),
    );

  const lastLines = (m: jest.Mock<void, [PaymentLine[]]>): PaymentLine[] =>
    m.mock.calls.at(-1)?.[0] ?? [];

  const usd = (amount: number): Money[] => [{ amount, currency: "USD" }];

  describe("MultiPaymentInput — fillTotals / fillKey (LIRA-308)", () => {
    it("fills the amount to fillTotals, not to totals", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      render(
        element({
          totals: usd(115),
          fillTotals: usd(50),
          fillKey: 1,
          onChange,
        }),
      );
      expect(lastLines(onChange)).toEqual([
        expect.objectContaining({ currencyCode: "USD", amount: 50 }),
      ]);
    });

    it("an amount above fillTotals but within totals is no overpay (no change block)", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      render(
        element({
          totals: usd(115),
          fillTotals: usd(50),
          fillKey: 1,
          onChange,
        }),
      );
      fireEvent.change(amountInputs()[0], { target: { value: "80" } });
      expect(lastLines(onChange)[0].amount).toBe(80);
      expect(screen.queryByTestId("change-due")).toBeNull();
    });

    it("a new fillKey resets a typed amount to the new fillTotals", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const { rerender } = render(
        element({
          totals: usd(115),
          fillTotals: usd(50),
          fillKey: 1,
          onChange,
        }),
      );
      fireEvent.change(amountInputs()[0], { target: { value: "80" } });
      rerender(
        element({
          totals: usd(115),
          fillTotals: usd(30),
          fillKey: 2,
          onChange,
        }),
      );
      expect(lastLines(onChange)).toEqual([
        expect.objectContaining({ currencyCode: "USD", amount: 30 }),
      ]);
      // Same fill again with a new key still resets a typed amount.
      fireEvent.change(amountInputs()[0], { target: { value: "70" } });
      rerender(
        element({
          totals: usd(115),
          fillTotals: usd(30),
          fillKey: 3,
          onChange,
        }),
      );
      expect(lastLines(onChange)[0].amount).toBe(30);
    });

    it("the same fillKey keeps a typed amount", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const { rerender } = render(
        element({
          totals: usd(115),
          fillTotals: usd(50),
          fillKey: 1,
          onChange,
        }),
      );
      fireEvent.change(amountInputs()[0], { target: { value: "80" } });
      rerender(
        element({
          totals: usd(115),
          fillTotals: usd(50),
          fillKey: 1,
          onChange,
        }),
      );
      expect(lastLines(onChange)[0].amount).toBe(80);
    });

    // Owner answer 3 (2026-10-11) replaced "one line per currency": a tick
    // change keeps the cashier's lines and the last one absorbs the
    // difference — here the single USD line takes the LBP item at the rate.
    // (Line-keeping cases: MultiPaymentInput.lira308OwnerAnswers.test.tsx.)
    it("a mixed fill keeps the single line; it absorbs the LBP part at the rate (answer 3)", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const { rerender } = render(
        element({
          totals: usd(115),
          fillTotals: usd(50),
          fillKey: 1,
          onChange,
        }),
      );
      rerender(
        element({
          totals: [
            { amount: 115, currency: "USD" },
            { amount: 900_000, currency: "LBP" },
          ],
          fillTotals: [
            { amount: 14, currency: "USD" },
            { amount: 900_000, currency: "LBP" },
          ],
          fillKey: 2,
          onChange,
        }),
      );
      const lines = lastLines(onChange);
      expect(lines).toHaveLength(1);
      expect(lines).toEqual([
        expect.objectContaining({ currencyCode: "USD", amount: 24 }),
      ]);
    });

    it("an empty fill (nothing ticked) sets the amount to 0", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const { rerender } = render(
        element({
          totals: usd(115),
          fillTotals: usd(50),
          fillKey: 1,
          onChange,
        }),
      );
      rerender(
        element({ totals: usd(115), fillTotals: [], fillKey: 2, onChange }),
      );
      expect(lastLines(onChange)[0].amount).toBe(0);
    });

    it("guard: defaultReturnMethod CUSTOMER_ACCOUNT is no longer a return method — the extra defaults to a CASH change leg", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      render(
        element({
          totals: usd(115),
          fillTotals: usd(115),
          fillKey: 1,
          onChange,
          onReturnChange,
          defaultReturnMethod: "CUSTOMER_ACCOUNT",
        }),
      );
      fireEvent.change(amountInputs()[0], { target: { value: "131" } });
      expect(lastLines(onReturnChange)).toEqual([
        expect.objectContaining({
          method: "CASH",
          currencyCode: "USD",
          amount: 16,
          direction: "OUT",
        }),
      ]);
      expect(
        lastLines(onReturnChange).some((l) => l.method === "CUSTOMER_ACCOUNT"),
      ).toBe(false);
    });

    it("above the whole debt with unreturnedChangeTo + Account: the extra is a CUSTOMER_ACCOUNT change leg", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      render(
        element({
          totals: usd(115),
          fillTotals: usd(115),
          fillKey: 1,
          onChange,
          onReturnChange,
          unreturnedToAccount: true,
        }),
      );
      fireEvent.change(amountInputs()[0], { target: { value: "131" } });
      fireEvent.click(screen.getByTestId("change-destination-account"));
      expect(lastLines(onReturnChange)).toEqual([
        expect.objectContaining({
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 16,
          direction: "OUT",
        }),
      ]);
    });

    it("returnCurrencyFollowsTender: an LBP overpay goes to the account in LBP", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      render(
        <MultiPaymentInput
          totals={[{ amount: 600_000, currency: "LBP" }]}
          initialLines={[{ currencyCode: "LBP", amount: 600_000 }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={CURRENCIES}
          exchangeRate={89_000}
          showDiscount={false}
          hasClient={true}
          unreturnedChangeTo="CUSTOMER_ACCOUNT"
          returnCurrencyFollowsTender={true}
          onChange={onChange}
          onReturnChange={onReturnChange}
        />,
      );
      fireEvent.change(amountInputs()[0], { target: { value: "700000" } });
      fireEvent.click(screen.getByTestId("change-destination-account"));
      expect(lastLines(onReturnChange)).toEqual([
        expect.objectContaining({
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "LBP",
          amount: 100_000,
          direction: "OUT",
        }),
      ]);
    });
  });
});

describe("MultiPaymentInput.keepAccountReset (LIRA-318)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — Keep / Account never silently swap (LIRA-318 review,
   * owner 2026-10-13).
   *
   * With no client, "Keep" empties the change fields (the change is kept as
   * profit). If a client is then picked, the same empty fields would mean
   * "put the whole change on the account" — a different booking the cashier
   * never chose. The reverse (Account, then the client removed) would turn a
   * credit into kept profit. When the account option appears or disappears,
   * the change goes back to "hand it all back" so the cashier chooses again.
   *
   * Rule 17: written before the fix and run against the unfixed code first.
   */

  const CURRENCIES = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];

  const amountInput = (): HTMLInputElement =>
    document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    )!;

  const shape = (lines: PaymentLine[] | undefined) =>
    (lines ?? [])
      .filter((l) => l.amount > 0)
      .map((l) => ({ method: l.method, amount: l.amount }));

  function box(
    hasClient: boolean,
    onReturnChange: jest.Mock,
    onKeptChange: jest.Mock,
  ) {
    return (
      <MultiPaymentInput
        totals={[{ amount: 14, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={[
          { code: "CASH", label: "Cash" },
          { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
        ]}
        currencies={CURRENCIES}
        exchangeRate={90_000}
        showDiscount={false}
        hasClient={hasClient}
        unreturnedChangeTo="CUSTOMER_ACCOUNT"
        onChange={jest.fn()}
        onReturnChange={onReturnChange}
        onKeptChange={onKeptChange}
      />
    );
  }

  it("Keep with no client, then a client is picked → change goes back to 'hand it all back', not to the account", () => {
    const onReturn = jest.fn();
    const onKept = jest.fn();
    const { rerender } = render(box(false, onReturn, onKept));
    fireEvent.change(amountInput(), { target: { value: "30" } });
    fireEvent.click(screen.getByTestId("change-keep-all"));
    rerender(box(true, onReturn, onKept));
    expect(shape(onReturn.mock.calls.at(-1)?.[0])).toEqual([
      { method: "CASH", amount: 16 },
    ]);
    expect(
      screen
        .getByTestId("change-destination-account")
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("Account with a client, then the client is removed → change goes back to 'hand it all back', nothing kept", () => {
    const onReturn = jest.fn();
    const onKept = jest.fn();
    const { rerender } = render(box(true, onReturn, onKept));
    fireEvent.change(amountInput(), { target: { value: "30" } });
    fireEvent.click(screen.getByTestId("change-destination-account"));
    rerender(box(false, onReturn, onKept));
    expect(shape(onReturn.mock.calls.at(-1)?.[0])).toEqual([
      { method: "CASH", amount: 16 },
    ]);
    expect(onKept.mock.calls.at(-1)?.[0] ?? null).toBeNull();
  });
});

describe("MultiPaymentInput.keepOrAccount", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — "Keep" beside "Account" (owner 2026-10-24).
   *
   * On a page that books unreturned change to the customer's account
   * (`unreturnedChangeTo`) AND can book kept change (`onKeptChange`), the
   * cashier chooses where change the customer leaves goes:
   * - "Account" (the default): one CUSTOMER_ACCOUNT OUT leg, nothing kept.
   * - "Keep": no account leg; the change is reported as kept (shop profit).
   * A page without `onKeptChange` shows no Keep button.
   *
   * Rule 17: written after the fix — not proven failing-first.
   */

  const METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
  ];
  const BOTH = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];

  type Kept = { usd: number; lbp: number } | null;

  function sheet(o: {
    onReturnChange: jest.Mock<void, [PaymentLine[]]>;
    onKeptChange?: jest.Mock<void, [Kept]>;
  }) {
    return (
      <MultiPaymentInput
        totals={[{ amount: 31.96, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={METHODS}
        currencies={BOTH}
        exchangeRate={89_000}
        showDiscount={false}
        hasClient={true}
        onChange={jest.fn()}
        onReturnChange={o.onReturnChange}
        returnCurrencyFollowsTender={true}
        unreturnedChangeTo="CUSTOMER_ACCOUNT"
        {...(o.onKeptChange ? { onKeptChange: o.onKeptChange } : {})}
      />
    );
  }

  const pay = (v: string) =>
    fireEvent.change(
      document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      )!,
      { target: { value: v } },
    );

  const accountLegs = (m: jest.Mock<void, [PaymentLine[]]>) =>
    (m.mock.calls.at(-1)?.[0] ?? []).filter(
      (l) => l.method === "CUSTOMER_ACCOUNT",
    );

  describe("Keep or Account for change the customer leaves", () => {
    it("Keep reports the $1.04 as kept and emits no account leg", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      const onKeptChange = jest.fn<void, [Kept]>();
      render(sheet({ onReturnChange, onKeptChange }));
      pay("33");

      fireEvent.click(screen.getByTestId("change-keep-all"));

      expect(onKeptChange.mock.calls.at(-1)?.[0]?.usd).toBeCloseTo(1.04, 2);
      expect(accountLegs(onReturnChange)).toEqual([]);
      expect(screen.getByTestId("change-keep-all")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("Account after Keep books the $1.04 to the account and keeps nothing", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      const onKeptChange = jest.fn<void, [Kept]>();
      render(sheet({ onReturnChange, onKeptChange }));
      pay("33");

      fireEvent.click(screen.getByTestId("change-keep-all"));
      fireEvent.click(screen.getByTestId("change-destination-account"));

      expect(onKeptChange.mock.calls.at(-1)?.[0]).toBeNull();
      const legs = accountLegs(onReturnChange);
      expect(legs).toHaveLength(1);
      expect(legs[0].amount).toBeCloseTo(1.04, 2);
      expect(legs[0].direction).toBe("OUT");
    });

    it("no Keep button on a page that cannot book kept change", () => {
      render(sheet({ onReturnChange: jest.fn() }));
      pay("33");
      expect(screen.getByTestId("change-destination-account")).toBeTruthy();
      expect(screen.queryByTestId("change-keep-all")).toBeNull();
    });
  });
});

describe("MultiPaymentInput.lira308OwnerAnswers (LIRA-308)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — LIRA-308 owner answers (2026-10-11, binding).
   *
   * Answer 3 — a tick change (new `fillKey`) KEEPS the cashier's payment
   * lines: only the total changes, and the LAST line absorbs the difference.
   * A last line that would drop to zero or below is removed and the line
   * before it absorbs the rest (never below zero); with no line left, one
   * default line is created. Replaces the LIRA-308 first cut, which rebuilt
   * one line per currency and so lost a second method (Cash $50 + Whish $34).
   *
   * Answer 1 — "if the customer pays 85, and we didn't set $1 in the returned
   * amount, then $1 is account credit": with `unreturnedChangeTo=
   * "CUSTOMER_ACCOUNT"` what the cashier types in the return fields is handed
   * back (as cash), and whatever is NOT entered becomes a CUSTOMER_ACCOUNT
   * change leg (the existing path the server books as account credit).
   * Nothing is kept as profit.
   *
   * LIRA-313 (owner decisions 2026-10-12) changed ONE thing here: the return
   * fields now start FULL ("Return change" is the default) instead of empty,
   * and a "To account" button empties them so the whole change is credited.
   * Rule 24 — the cases below that relied on the empty start now press "To
   * account" first; the account-credit behaviour itself is unchanged.
   *
   * 2026-10-13 (compact change box): "To account" is now the "Account" button
   * (same testid); the return fields stay visible after it, just empty.
   *
   * Both are opt-in props; other forms are unaffected.
   */

  const METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "WHISH", label: "Whish" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
  ];
  const CURRENCIES = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];
  const RATE = 90_000;

  type Money = { amount: number; currency: string };
  type Lines = Array<{ method?: string; currencyCode: string; amount: number }>;

  function sheet(o: {
    totals: Money[];
    fillTotals: Money[];
    fillKey: number;
    initialLines?: Lines;
    onChange: jest.Mock<void, [PaymentLine[]]>;
    onReturnChange?: jest.Mock<void, [PaymentLine[]]>;
    onKeptChange?: jest.Mock;
    unreturned?: boolean;
  }) {
    return (
      <MultiPaymentInput
        totals={o.totals}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={METHODS}
        currencies={CURRENCIES}
        exchangeRate={RATE}
        showDiscount={false}
        hasClient={true}
        onChange={o.onChange}
        onReturnChange={o.onReturnChange ?? jest.fn()}
        fillTotals={o.fillTotals}
        fillKey={o.fillKey}
        returnCurrencyFollowsTender={true}
        {...(o.initialLines ? { initialLines: o.initialLines } : {})}
        {...(o.onKeptChange ? { onKeptChange: o.onKeptChange } : {})}
        {...(o.unreturned ? { unreturnedChangeTo: "CUSTOMER_ACCOUNT" } : {})}
      />
    );
  }

  const amountInputs = (): HTMLInputElement[] =>
    Array.from(
      document.querySelectorAll<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      ),
    );

  const last = <T,>(m: jest.Mock<void, [T]>): T | undefined =>
    m.mock.calls.at(-1)?.[0];

  const usd = (amount: number): Money[] => [{ amount, currency: "USD" }];
  const shape = (lines: PaymentLine[] | undefined) =>
    (lines ?? []).map((l) => ({
      method: l.method,
      currencyCode: l.currencyCode,
      amount: l.amount,
    }));

  describe("answer 3 — a tick change keeps the payment lines; the last one absorbs the difference", () => {
    const SPLIT: Lines = [
      { method: "CASH", currencyCode: "USD", amount: 50 },
      { method: "WHISH", currencyCode: "USD", amount: 34 },
    ];

    it("Cash $50 + Whish $34, ticked sum 84 → 100: Whish becomes $50, Cash stays $50", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const { rerender } = render(
        sheet({
          totals: usd(150),
          fillTotals: usd(84),
          fillKey: 1,
          initialLines: SPLIT,
          onChange,
        }),
      );
      rerender(
        sheet({
          totals: usd(150),
          fillTotals: usd(100),
          fillKey: 2,
          initialLines: SPLIT,
          onChange,
        }),
      );
      expect(shape(last(onChange))).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 50 },
        { method: "WHISH", currencyCode: "USD", amount: 50 },
      ]);
    });

    it("ticked sum 84 → 60: Whish shrinks to $10", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const { rerender } = render(
        sheet({
          totals: usd(150),
          fillTotals: usd(84),
          fillKey: 1,
          initialLines: SPLIT,
          onChange,
        }),
      );
      rerender(
        sheet({
          totals: usd(150),
          fillTotals: usd(60),
          fillKey: 2,
          initialLines: SPLIT,
          onChange,
        }),
      );
      expect(shape(last(onChange))).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 50 },
        { method: "WHISH", currencyCode: "USD", amount: 10 },
      ]);
    });

    it("ticked sum 84 → 40: the Whish line goes, Cash shrinks to $40 (never below zero)", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const { rerender } = render(
        sheet({
          totals: usd(150),
          fillTotals: usd(84),
          fillKey: 1,
          initialLines: SPLIT,
          onChange,
        }),
      );
      rerender(
        sheet({
          totals: usd(150),
          fillTotals: usd(40),
          fillKey: 2,
          initialLines: SPLIT,
          onChange,
        }),
      );
      expect(shape(last(onChange))).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 40 },
      ]);
    });

    it("nothing ticked (fill 0): one line of 0 is left, keeping the first line's method", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const { rerender } = render(
        sheet({
          totals: usd(150),
          fillTotals: usd(84),
          fillKey: 1,
          initialLines: SPLIT,
          onChange,
        }),
      );
      rerender(
        sheet({
          totals: usd(150),
          fillTotals: [],
          fillKey: 2,
          initialLines: SPLIT,
          onChange,
        }),
      );
      expect(shape(last(onChange))).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 0 },
      ]);
    });

    it("a typed amount on the last line is reset by the tick change (decision 2), the other line kept", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const { rerender } = render(
        sheet({
          totals: usd(150),
          fillTotals: usd(84),
          fillKey: 1,
          initialLines: SPLIT,
          onChange,
        }),
      );
      fireEvent.change(amountInputs()[1], { target: { value: "70" } });
      rerender(
        sheet({
          totals: usd(150),
          fillTotals: usd(90),
          fillKey: 2,
          initialLines: SPLIT,
          onChange,
        }),
      );
      expect(shape(last(onChange))).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 50 },
        { method: "WHISH", currencyCode: "USD", amount: 40 },
      ]);
    });
  });

  describe("answer 1 — change the cashier does not enter as returned is account credit", () => {
    it('$84 due, $85 paid: the $1 starts as change to return; "Account" makes it a $1 CUSTOMER_ACCOUNT change leg', () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      render(
        sheet({
          totals: usd(84),
          fillTotals: usd(84),
          fillKey: 1,
          onChange,
          onReturnChange,
          unreturned: true,
        }),
      );
      fireEvent.change(amountInputs()[0], { target: { value: "85" } });
      // LIRA-313 — default "Return change": the field starts with the full $1.
      expect((screen.getByTestId("return-usd") as HTMLInputElement).value).toBe(
        "1.00",
      );
      expect(shape(last(onReturnChange))).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 1 },
      ]);
      fireEvent.click(screen.getByTestId("change-destination-account"));
      // 2026-10-13 compact change box — the fields stay on screen, just empty.
      expect((screen.getByTestId("return-usd") as HTMLInputElement).value).toBe(
        "",
      );
      expect(shape(last(onReturnChange))).toEqual([
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 1 },
      ]);
      expect(
        screen.getByTestId("change-to-account-summary").textContent,
      ).toMatch(/\$1(\.00)? .*account/i);
    });

    it("$10 over, $4 typed as returned → $4 cash back and $6 account credit; nothing kept as profit", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      const onKeptChange = jest.fn();
      render(
        sheet({
          totals: usd(84),
          fillTotals: usd(84),
          fillKey: 1,
          onChange,
          onReturnChange,
          onKeptChange,
          unreturned: true,
        }),
      );
      fireEvent.change(amountInputs()[0], { target: { value: "94" } });
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "4" },
      });
      expect(shape(last(onReturnChange))).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 4 },
        { method: "CUSTOMER_ACCOUNT", currencyCode: "USD", amount: 6 },
      ]);
      expect(screen.queryByTestId("keep-change-summary")).toBeNull();
      expect(screen.queryByTestId("return-mismatch-warning")).toBeNull();
      for (const [kept] of onKeptChange.mock.calls) expect(kept).toBeNull();
    });

    it("the whole change typed as returned → cash only, no credit", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      render(
        sheet({
          totals: usd(84),
          fillTotals: usd(84),
          fillKey: 1,
          onChange,
          onReturnChange,
          unreturned: true,
        }),
      );
      fireEvent.change(amountInputs()[0], { target: { value: "94" } });
      fireEvent.click(screen.getByTestId("return-all-usd"));
      expect(shape(last(onReturnChange))).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 10 },
      ]);
    });

    it("a small rounding overpay ($10 due paid with 910,000 LBP) is LBP account credit", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      render(
        sheet({
          totals: usd(10),
          fillTotals: usd(10),
          fillKey: 1,
          initialLines: [
            { method: "CASH", currencyCode: "LBP", amount: 910_000 },
          ],
          onChange,
          onReturnChange,
          unreturned: true,
        }),
      );
      fireEvent.change(amountInputs()[0], { target: { value: "910000" } });
      // LIRA-313 — the change starts as cash to return; "To account" credits it.
      fireEvent.click(screen.getByTestId("change-destination-account"));
      expect(shape(last(onReturnChange))).toEqual([
        { method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: 10_000 },
      ]);
    });
  });
});

describe("MultiPaymentInput.lira313AccountToggle (LIRA-313)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — LIRA-313 (owner decisions 2026-10-12).
   *
   * "In any mode, the extra amount paid goes into the account", plus a
   * "return remaining" control: the change is either handed back or put on the
   * account, and "Return change" is the default.
   *
   * - `unreturnedChangeTo="ACCOUNT_BALANCE"` (Suppliers, Partners): change NOT
   *   handed back emits NO leg — the server books the net, so it stays on the
   *   counterparty's balance by itself. Only real cash change is an OUT leg.
   *   Works for the shop payer too, with no `hasClient`.
   * - The fields start full (the change is handed back). 2026-10-13 compact
   *   change box: the "Return change" / "To account" toggle is gone — the
   *   "Account" button empties the fields (whole change to the account) and
   *   the "$" button (return-all-usd) refills them.
   * - `returnCurrencies` limits the cash return fields (a partner settlement's
   *   legs must all be in its currency).
   * - `payoutExcessToAccount` (Debts → Cash Out): paying out more than the
   *   total is not flagged as a problem; a note says it becomes debt.
   *
   * Rule 17: written after the fix — not proven failing-first. The
   * 2026-10-13 updates (toggle → Account / "$" buttons) are likewise not
   * proven failing-first.
   */

  const METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "OMT", label: "OMT" },
  ];
  const BOTH = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];
  const RATE = 90_000;

  const amountInput = (): HTMLInputElement =>
    document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    )!;

  const last = <T,>(m: jest.Mock<void, [T]>): T | undefined =>
    m.mock.calls.at(-1)?.[0];

  const shape = (lines: PaymentLine[] | undefined) =>
    (lines ?? []).map((l) => ({
      method: l.method,
      currencyCode: l.currencyCode,
      amount: l.amount,
      direction: l.direction,
    }));

  describe("LIRA-313 — ACCOUNT_BALANCE (supplier / partner pages)", () => {
    function supplierPay(onReturnChange: jest.Mock<void, [PaymentLine[]]>) {
      return (
        <MultiPaymentInput
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={BOTH}
          exchangeRate={RATE}
          showDiscount={false}
          onChange={jest.fn()}
          onReturnChange={onReturnChange}
          unreturnedChangeTo="ACCOUNT_BALANCE"
          accountLabel="the supplier's account"
          cashOnlyReturn={true}
          payer="shop"
        />
      );
    }

    it("default is to hand the change back: the full $50 is a cash OUT leg", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      render(supplierPay(onReturnChange));
      fireEvent.change(amountInput(), { target: { value: "150" } });
      // 2026-10-13 — the Return/To-account toggle is gone; the Account button
      // is not pressed by default and the fields hold the full change.
      expect(screen.queryByTestId("change-destination")).toBeNull();
      expect(screen.queryByTestId("change-destination-return")).toBeNull();
      expect(
        screen
          .getByTestId("change-destination-account")
          .getAttribute("aria-pressed"),
      ).toBe("false");
      expect(screen.getByTestId<HTMLInputElement>("return-usd").value).toBe(
        "50.00",
      );
      expect(shape(last(onReturnChange))).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 50, direction: "OUT" },
      ]);
    });

    it("'Account' emits NO leg at all and says the $50 stays on the supplier's account", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      render(supplierPay(onReturnChange));
      fireEvent.change(amountInput(), { target: { value: "150" } });
      fireEvent.click(screen.getByTestId("change-destination-account"));
      expect(shape(last(onReturnChange))).toEqual([]);
      expect(
        screen.getByTestId("change-to-account-summary").textContent,
      ).toMatch(/\$50\.00 not given back stays on the supplier's account/);
      expect(screen.queryByTestId("return-mismatch-warning")).toBeNull();
      expect(screen.queryByTestId("keep-change-summary")).toBeNull();
    });

    it("a partial return: $20 cash back, the other $30 stays on the account with no leg", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      render(supplierPay(onReturnChange));
      fireEvent.change(amountInput(), { target: { value: "150" } });
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "20" },
      });
      expect(shape(last(onReturnChange))).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 20, direction: "OUT" },
      ]);
      expect(
        screen.getByTestId("change-to-account-summary").textContent,
      ).toMatch(/\$30\.00/);
    });

    it("'$' after 'Account' refills the full change in dollars", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      render(supplierPay(onReturnChange));
      fireEvent.change(amountInput(), { target: { value: "150" } });
      fireEvent.click(screen.getByTestId("change-destination-account"));
      // The fields stay on screen (just empty) after Account.
      expect(screen.getByTestId<HTMLInputElement>("return-usd").value).toBe("");
      fireEvent.click(screen.getByTestId("return-all-usd"));
      expect(
        screen
          .getByTestId("change-destination-account")
          .getAttribute("aria-pressed"),
      ).toBe("false");
      expect(shape(last(onReturnChange))).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 50, direction: "OUT" },
      ]);
    });

    it("nothing owed in this direction (total 0): the whole payment is extra", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      render(
        <MultiPaymentInput
          totals={[{ amount: 0, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={BOTH}
          exchangeRate={RATE}
          showDiscount={false}
          onChange={jest.fn()}
          onReturnChange={onReturnChange}
          unreturnedChangeTo="ACCOUNT_BALANCE"
          accountLabel="the supplier's account"
          cashOnlyReturn={true}
          payer="shop"
        />,
      );
      fireEvent.change(amountInput(), { target: { value: "80" } });
      fireEvent.click(screen.getByTestId("change-destination-account"));
      expect(shape(last(onReturnChange))).toEqual([]);
      expect(
        screen.getByTestId("change-to-account-summary").textContent,
      ).toMatch(/\$80\.00/);
    });
  });

  describe("LIRA-313 — returnCurrencies", () => {
    it("a USD-only settlement shows no LBP return field and returns the change in USD", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      render(
        <MultiPaymentInput
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={[{ code: "USD", symbol: "$" }]}
          exchangeRate={RATE}
          showDiscount={false}
          onChange={jest.fn()}
          onReturnChange={onReturnChange}
          unreturnedChangeTo="ACCOUNT_BALANCE"
          cashOnlyReturn={true}
          returnCurrencies={["USD"]}
          smartSplitOverpay={true}
        />,
      );
      fireEvent.change(amountInput(), { target: { value: "150.50" } });
      expect(screen.queryByTestId("return-lbp")).toBeNull();
      expect(screen.queryByTestId("return-all-lbp")).toBeNull();
      expect(shape(last(onReturnChange))).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 50.5, direction: "OUT" },
      ]);
    });
  });

  describe("LIRA-313 — payoutExcessToAccount (Debts → Cash Out)", () => {
    function cashOut(excess: boolean) {
      return (
        <MultiPaymentInput
          totals={[{ amount: 50, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={METHODS}
          currencies={BOTH}
          exchangeRate={RATE}
          showDiscount={false}
          onChange={jest.fn()}
          payer="payout"
          payoutExcessToAccount={excess}
          accountLabel="the client's credit"
        />
      );
    }

    it("paying out $80 on $50 credit is not red and says $30 becomes debt", () => {
      render(cashOut(true));
      fireEvent.change(amountInput(), { target: { value: "80" } });
      expect(screen.getByTestId("payout-excess-summary").textContent).toMatch(
        /\$30\.00.* more than the client's credit/,
      );
    });

    it("without the prop an over-payout shows no debt note (unchanged)", () => {
      render(cashOut(false));
      fireEvent.change(amountInput(), { target: { value: "80" } });
      expect(screen.queryByTestId("payout-excess-summary")).toBeNull();
    });
  });
});

describe("MultiPaymentInput.lira372PerCurrencyFollow (LIRA-372)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-372 (T035) — a two-currency settle box (`perCurrencyTotals`, one
   * seeded line per currency) follows the discount per currency. Owner answer
   * 2026-11-05 (option B): "the discount always wins" — when the page's
   * `fillKey` changes (it carries the discount), each currency whose
   * `fillTotals` changed re-fills its LAST line, even one the cashier typed by
   * hand. A currency whose total did not change keeps its lines.
   */

  const METHODS = [{ code: "CASH", label: "Cash" }];
  const CURRENCIES = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];

  type Money = { amount: number; currency: string };

  const SEED = [
    { method: "CASH", currencyCode: "USD", amount: 412.5 },
    { method: "CASH", currencyCode: "LBP", amount: 900_000 },
  ];

  function box(
    fillTotals: Money[],
    fillKey: string,
    onChange: jest.Mock<void, [PaymentLine[]]>,
  ) {
    return (
      <MultiPaymentInput
        totals={fillTotals}
        perCurrencyTotals={true}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={METHODS}
        currencies={CURRENCIES}
        exchangeRate={90_000}
        showDiscount={false}
        hasClient={false}
        payer="shop"
        onChange={onChange}
        initialLines={SEED}
        fillTotals={fillTotals}
        fillKey={fillKey}
      />
    );
  }

  const amounts = (lines: PaymentLine[] | undefined) =>
    (lines ?? []).map((l) => [l.currencyCode, l.amount]);
  const last = (m: jest.Mock<void, [PaymentLine[]]>) =>
    m.mock.calls.at(-1)?.[0];

  const GROSS: Money[] = [
    { amount: 412.5, currency: "USD" },
    { amount: 900_000, currency: "LBP" },
  ];
  const NET_USD: Money[] = [
    { amount: 410, currency: "USD" },
    { amount: 900_000, currency: "LBP" },
  ];

  describe("MultiPaymentInput — per-currency follow of the discount (LIRA-372)", () => {
    it("USD discount 2.50: the USD line reads 410.00, the LBP line stays", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const { rerender } = render(box(GROSS, "d:0", onChange));
      rerender(box(NET_USD, "d:2.5", onChange));
      expect(amounts(last(onChange))).toEqual([
        ["USD", 410],
        ["LBP", 900_000],
      ]);
    });

    it("a USD line typed by hand is lowered too (option B); a typed LBP line stays", () => {
      const onChange = jest.fn<void, [PaymentLine[]]>();
      const { rerender, container } = render(box(GROSS, "d:0", onChange));
      const inputs = container.querySelectorAll<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      );
      fireEvent.change(inputs[0], { target: { value: "412.5" } });
      fireEvent.change(inputs[1], { target: { value: "800000" } });
      rerender(box(NET_USD, "d:2.5", onChange));
      expect(amounts(last(onChange))).toEqual([
        ["USD", 410],
        ["LBP", 800_000],
      ]);
    });
  });
});

describe("MultiPaymentInput.paidToneAndChangeCopy", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — production testing 2026-10-07:
   *
   * 1. The change warnings read "Returning 0.53$ more…" with the dollar sign
   *    AFTER the number. They must use the form's own money formatting
   *    ("$0.53"), like every other figure on the sheet.
   * 2. The "Paid" figure turned red with a warning icon whenever change was due
   *    or kept — normal states that looked like an error to the cashier. Red
   *    (and the warning icon) is kept for real problems only: underpaid with no
   *    kept change, or a change return that does not add up.
   *
   * The Paid figure is located through its visible "Paid" label (not a test id
   * added with the fix) so these cases can fail on the pre-fix component.
   */

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

  function renderMpi(opts: {
    total: number;
    direction?: "payment" | "payout";
    payer?: "customer" | "shop";
    onKeptChange?: jest.Mock<void, [Kept]>;
  }) {
    return render(
      <MultiPaymentInput
        totals={[{ amount: opts.total, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={89_000}
        showDiscount={false}
        cashOnlyReturn={true}
        onChange={jest.fn()}
        {...(opts.direction ? { direction: opts.direction } : {})}
        {...(opts.payer ? { payer: opts.payer } : {})}
        {...(opts.onKeptChange ? { onKeptChange: opts.onKeptChange } : {})}
      />,
    );
  }

  function pay(value: string): void {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    if (!input) throw new Error("no payment-amount input rendered");
    fireEvent.change(input, { target: { value } });
  }

  /** The "Paid" summary row: its amount span and whether it shows red / a
   *  warning icon. */
  function paidRow() {
    const label = screen.getByText("Paid", { selector: "span" });
    const row = label.parentElement;
    if (!row) throw new Error("Paid row not found");
    const amount = row.querySelector<HTMLElement>(".font-mono");
    if (!amount) throw new Error("Paid amount not found");
    return {
      amount,
      isRed: amount.className.includes("text-red-400"),
      hasWarningIcon: !!row.querySelector("svg.text-red-400"),
    };
  }

  describe("MultiPaymentInput — change warning money format", () => {
    it("over-return reads '$0.53', not '0.53$'", () => {
      renderMpi({ total: 9.47, onKeptChange: jest.fn() });
      pay("10");
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "1.06" },
      });
      const warning = screen.getByTestId("return-mismatch-warning");
      expect(warning).toHaveTextContent(
        "Returning $0.53 more than the customer overpaid.",
      );
      expect(warning.textContent).not.toMatch(/\d\$/);
    });

    it("under-return on a page that cannot keep change reads '$0.53 of the change…'", () => {
      renderMpi({ total: 9.47 });
      pay("10");
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "0" },
      });
      expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
        "$0.53 of the change is not covered by these fields yet.",
      );
    });

    it("shop payer over-return reads 'Getting back $0.53 more…'", () => {
      renderMpi({ total: 9.47, payer: "shop", onKeptChange: jest.fn() });
      pay("10");
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "1.06" },
      });
      expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
        "Getting back $0.53 more than was overpaid.",
      );
    });
  });

  describe("MultiPaymentInput — Paid figure is red only for a real problem", () => {
    it("exact payment: not red, no warning", () => {
      renderMpi({ total: 10 });
      pay("10");
      const row = paidRow();
      expect(row.isRed).toBe(false);
      expect(row.hasWarningIcon).toBe(false);
    });

    it("change due, returned in full: not red, no warning icon", () => {
      renderMpi({ total: 9.47, onKeptChange: jest.fn() });
      pay("10");
      expect(screen.getByTestId("return-change")).toBeInTheDocument();
      expect(
        screen.queryByTestId("return-mismatch-warning"),
      ).not.toBeInTheDocument();
      const row = paidRow();
      expect(row.amount).toHaveTextContent("$10.00");
      expect(row.isRed).toBe(false);
      expect(row.hasWarningIcon).toBe(false);
    });

    it("change kept (under-return kept as profit): not red, no warning icon", () => {
      renderMpi({ total: 9.47, onKeptChange: jest.fn() });
      pay("10");
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "0" },
      });
      expect(screen.getByTestId("keep-change-summary")).toBeInTheDocument();
      const row = paidRow();
      expect(row.isRed).toBe(false);
      expect(row.hasWarningIcon).toBe(false);
    });

    it("payout short by a few cents, kept automatically: not red, no warning icon", () => {
      renderMpi({
        total: 101.12,
        direction: "payout",
        onKeptChange: jest.fn(),
      });
      pay("101");
      // 2026-10-13 — the payout keep is said by the green remaining row only
      // (the separate note was removed). Not proven failing-first (rule 17).
      expect(screen.getByTestId("remaining-row")).toHaveTextContent(
        "Change kept (profit)",
      );
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
      const row = paidRow();
      expect(row.isRed).toBe(false);
      expect(row.hasWarningIcon).toBe(false);
    });

    it("over-return (handing back more than the change due): red with warning", () => {
      renderMpi({ total: 9.47, onKeptChange: jest.fn() });
      pay("10");
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "1.06" },
      });
      const row = paidRow();
      expect(row.isRed).toBe(true);
      expect(row.hasWarningIcon).toBe(true);
    });

    it("under-return on a page that cannot keep change: red with warning", () => {
      renderMpi({ total: 9.47 });
      pay("10");
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "0" },
      });
      const row = paidRow();
      expect(row.isRed).toBe(true);
      expect(row.hasWarningIcon).toBe(true);
    });

    it("underpaid with no debt line: red with warning", () => {
      renderMpi({ total: 10 });
      pay("5");
      const row = paidRow();
      expect(row.isRed).toBe(true);
      expect(row.hasWarningIcon).toBe(true);
    });

    it("payout overpaid (handing out more than owed): red with warning", () => {
      renderMpi({ total: 50, direction: "payout", onKeptChange: jest.fn() });
      pay("60");
      const row = paidRow();
      expect(row.isRed).toBe(true);
      expect(row.hasWarningIcon).toBe(true);
    });
  });
});

describe("MultiPaymentInput.payer", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — the ONE `payer` prop (owner decisions 2026-10-07).
   *
   * From a single declaration of who pays, the component decides: whether the
   * change (OUT) fields show, the kept-change math, the note copy, what
   * `onKeptChange` reports, and that a payout never emits OUT legs.
   *
   *   customer (default) — customer pays the shop; under-returned change is
   *                        shop profit ("Change kept (profit)", "Keeping X as
   *                        profit").
   *   payout             — shop hands money to a customer; a small shortfall
   *                        (under PAYOUT_KEEP_CHANGE_MAX) is profit; no change
   *                        fields, never an OUT leg.
   *   shop               — shop pays an outsider (Expenses); change the
   *                        outsider did not return is ADDED TO THE COST
   *                        ("Not returned: X — added to the cost"), never
   *                        profit.
   *
   * Rule 17: run against the pre-change component (which ignored `payer`):
   * 6 of 10 failed — the two payout cases, the precedence case, the two shop
   * "not returned" cases, and the PaymentSheet pass-through. Four pass
   * pre-change BY DESIGN and are regression guards, not failing-first proofs:
   * the two `customer` default cases, the `direction="payout"` alias, and the
   * shop "full change back → nothing reported" case (identical in every mode).
   */

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
    payer?: "customer" | "payout" | "shop";
    direction?: "payment" | "payout";
    onKeptChange: jest.Mock<void, [Kept]>;
    onReturnChange: jest.Mock<void, [PaymentLine[]]>;
  }) {
    return render(
      <MultiPaymentInput
        totals={[{ amount: opts.total, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={RATE}
        showDiscount={false}
        cashOnlyReturn={true}
        onChange={jest.fn()}
        onReturnChange={opts.onReturnChange}
        onKeptChange={opts.onKeptChange}
        {...(opts.payer ? { payer: opts.payer } : {})}
        {...(opts.direction ? { direction: opts.direction } : {})}
      />,
    );
  }

  function pay(value: string): void {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    if (!input) throw new Error("no payment-amount input rendered");
    fireEvent.change(input, { target: { value } });
  }

  function setReturn(usd: string, lbp: string): void {
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: usd },
    });
    fireEvent.change(screen.getByTestId("return-lbp"), {
      target: { value: lbp },
    });
  }

  const lastKept = (m: jest.Mock<void, [Kept]>): Kept =>
    m.mock.calls.at(-1)?.[0] ?? null;
  const allOutLegs = (m: jest.Mock<void, [PaymentLine[]]>) =>
    m.mock.calls.flatMap((c) => c[0]).filter((l) => l.direction === "OUT");

  describe('MultiPaymentInput payer="customer" (default) — regression guard', () => {
    it.each([
      ["explicit", "customer" as const],
      ["default", undefined],
    ])(
      "%s: $7 due, $10 paid, $2 returned → $1 kept as profit with the existing copy",
      (_label, payer) => {
        const onKeptChange = jest.fn<void, [Kept]>();
        const onReturnChange = jest.fn<void, [PaymentLine[]]>();
        renderMpi({
          total: 7,
          ...(payer ? { payer } : {}),
          onKeptChange,
          onReturnChange,
        });
        pay("10");
        expect(screen.getByTestId("return-change")).toBeInTheDocument();
        setReturn("2", "");
        expect(lastKept(onKeptChange)).toMatchObject({ usd: 1, lbp: 0 });
        expect(onReturnChange.mock.calls.at(-1)?.[0]).toEqual([
          expect.objectContaining({
            currencyCode: "USD",
            amount: 2,
            direction: "OUT",
          }),
        ]);
        expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
          "Keeping $1.00 | 90,000 LBP as profit — the rest is returned above.",
        );
        // Clearing both fields keeps everything — lira-107 asserts this label.
        setReturn("", "");
        expect(screen.getByText("Change kept (profit)")).toBeInTheDocument();
        expect(lastKept(onKeptChange)).toMatchObject({ usd: 3, lbp: 0 });
      },
    );
  });

  describe('MultiPaymentInput payer="payout"', () => {
    it("a small shortfall is kept as profit and reported", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      renderMpi({
        total: 101.12,
        payer: "payout",
        onKeptChange,
        onReturnChange,
      });
      pay("101");
      expect(lastKept(onKeptChange)).toMatchObject({ usd: 0.12, lbp: 0 });
      expect(screen.getByText("Change kept (profit)")).toBeInTheDocument();
      // 2026-10-13 (owner): the payout "Keeping X as profit." note under the
      // green row is gone — the green "Change kept (profit)" row says it.
      // Updated after the fix: not proven failing-first (rule 17).
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("remaining-amount")).toHaveTextContent(
        /\$0\.12/,
      );
      expect(screen.getByTestId("remaining-amount")).toHaveTextContent(
        /10,800 LBP/,
      );
    });

    it("an overpaid payout shows no change fields and never emits an OUT leg", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      renderMpi({ total: 50, payer: "payout", onKeptChange, onReturnChange });
      pay("60");
      expect(screen.queryByTestId("return-change")).not.toBeInTheDocument();
      expect(screen.queryByTestId("return-usd")).not.toBeInTheDocument();
      expect(allOutLegs(onReturnChange)).toEqual([]);
      expect(lastKept(onKeptChange)).toBeNull();
    });

    it('direction="payout" stays a working alias — regression guard', () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      renderMpi({
        total: 101.12,
        direction: "payout",
        onKeptChange,
        onReturnChange,
      });
      pay("101");
      expect(lastKept(onKeptChange)).toMatchObject({ usd: 0.12 });
    });

    it("payer wins over a conflicting direction", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      renderMpi({
        total: 50,
        payer: "payout",
        direction: "payment",
        onKeptChange,
        onReturnChange,
      });
      pay("60");
      expect(screen.queryByTestId("return-change")).not.toBeInTheDocument();
    });
  });

  describe('MultiPaymentInput payer="shop" (Expenses — the shop pays an outsider)', () => {
    it("$7 bill, $10 handed, $2 back → $1 not returned, reported, and said to be added to the cost — never profit", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      renderMpi({ total: 7, payer: "shop", onKeptChange, onReturnChange });
      pay("10");
      // The change fields show: the outsider owes the shop change.
      expect(screen.getByTestId("return-change")).toBeInTheDocument();
      setReturn("2", "");
      expect(lastKept(onKeptChange)).toMatchObject({ usd: 1, lbp: 0 });
      // The change the outsider hands back is still an opposite-direction leg.
      expect(onReturnChange.mock.calls.at(-1)?.[0]).toEqual([
        expect.objectContaining({
          currencyCode: "USD",
          amount: 2,
          direction: "OUT",
        }),
      ]);
      expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
        "Not returned: $1.00 | 90,000 LBP — added to the cost.",
      );
      expect(screen.queryByText(/profit/i)).not.toBeInTheDocument();
    });

    it("nothing returned at all → the whole $3 is cost, no profit label", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      renderMpi({ total: 7, payer: "shop", onKeptChange, onReturnChange });
      pay("10");
      setReturn("", "");
      expect(lastKept(onKeptChange)).toMatchObject({ usd: 3, lbp: 0 });
      expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
        "Not returned: $3.00 | 270,000 LBP — added to the cost.",
      );
      expect(screen.queryByText(/profit/i)).not.toBeInTheDocument();
    });

    it("full change back → nothing reported", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      renderMpi({ total: 7, payer: "shop", onKeptChange, onReturnChange });
      pay("10");
      setReturn("3", "");
      expect(lastKept(onKeptChange)).toBeNull();
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
    });
  });

  describe("PaymentSheet forwards payer", () => {
    it('payer="payout" reaches MultiPaymentInput (the short leftover is kept)', () => {
      const onKeptChange = jest.fn();
      render(
        <PaymentSheet
          open
          onClose={jest.fn()}
          onConfirm={jest.fn()}
          totalAmount={101.12}
          totalAmountCurrency="USD"
          currency="USD"
          paymentMethods={PAYMENT_METHODS}
          onPaymentChange={jest.fn()}
          payer="payout"
          onKeptChange={onKeptChange}
        />,
      );
      pay("101");
      expect(onKeptChange.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({ usd: 0.12, lbp: 0 }),
      );
    });
  });
});

describe("MultiPaymentInput.payerSwitch", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — switching `payer` (or the `direction` alias) WITHOUT a
   * remount must not leak the previous mode's kept change.
   *
   * Before the fix, each kept-change effect only re-fired when its own key
   * changed. Both keys sit at "off" while their mode is inactive, so after a
   * switch the newly active effect never ran and the parent kept the OLD
   * mode's kept figure (a customer-mode profit carried into a payout, or a
   * payout shortfall carried into a customer sale). Consumers worked around it
   * with mode tags (Recharge); the component now resets on its own: the
   * change-return fields are re-seeded to the full change due and the active
   * mode re-reports (null when nothing is kept).
   */

  type Kept = {
    usd: number;
    lbp: number;
    exactUsd: number;
    exactLbp: number;
  } | null;
  type Payer = "customer" | "payout" | "shop";

  const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];
  const CURRENCIES = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];

  function element(opts: {
    total: number;
    payer?: Payer;
    direction?: "payment" | "payout";
    onKeptChange: jest.Mock<void, [Kept]>;
    onReturnChange?: jest.Mock<void, [PaymentLine[]]>;
  }) {
    return (
      <MultiPaymentInput
        totals={[{ amount: opts.total, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={90_000}
        showDiscount={false}
        cashOnlyReturn={true}
        onChange={jest.fn()}
        onReturnChange={opts.onReturnChange ?? jest.fn()}
        onKeptChange={opts.onKeptChange}
        {...(opts.payer ? { payer: opts.payer } : {})}
        {...(opts.direction ? { direction: opts.direction } : {})}
      />
    );
  }

  function pay(value: string): void {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    if (!input) throw new Error("no payment-amount input rendered");
    fireEvent.change(input, { target: { value } });
  }

  const lastKept = (m: jest.Mock<void, [Kept]>): Kept =>
    m.mock.calls.at(-1)?.[0] ?? null;

  describe("MultiPaymentInput — payer switch without remount resets kept change", () => {
    it("customer → payout: the customer-mode kept profit is withdrawn (null)", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      const { rerender } = render(
        element({ total: 7, payer: "customer", onKeptChange, onReturnChange }),
      );
      pay("10");
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "2" },
      });
      expect(lastKept(onKeptChange)).toMatchObject({ usd: 1, lbp: 0 });

      rerender(
        element({ total: 7, payer: "payout", onKeptChange, onReturnChange }),
      );
      // $10 handed out against $7 owed: no shortfall → nothing kept.
      expect(lastKept(onKeptChange)).toBeNull();
      // Regression guard (not failing-first): the re-seed must not make a
      // payout emit change (OUT) legs — the server refuses those.
      expect(
        (onReturnChange.mock.calls.at(-1)?.[0] ?? []).filter(
          (l) => l.direction === "OUT",
        ),
      ).toEqual([]);
    });

    it("payout → customer: the payout shortfall kept is withdrawn (null)", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      const { rerender } = render(
        element({ total: 10, payer: "payout", onKeptChange }),
      );
      pay("9.5");
      expect(lastKept(onKeptChange)).toMatchObject({ usd: 0.5, lbp: 0 });

      rerender(element({ total: 10, payer: "customer", onKeptChange }));
      // $9.50 against $10 due is an underpay — there is no change to keep.
      expect(lastKept(onKeptChange)).toBeNull();
    });

    it('direction alias "payout" → "payment" behaves the same', () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      const { rerender } = render(
        element({ total: 10, direction: "payout", onKeptChange }),
      );
      pay("9.5");
      expect(lastKept(onKeptChange)).toMatchObject({ usd: 0.5 });

      rerender(element({ total: 10, direction: "payment", onKeptChange }));
      expect(lastKept(onKeptChange)).toBeNull();
    });

    it("customer → shop: an under-return typed as profit is not carried over as cost — the return is re-seeded to the full change", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      const { rerender } = render(
        element({ total: 7, payer: "customer", onKeptChange, onReturnChange }),
      );
      pay("10");
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "2" },
      });
      expect(lastKept(onKeptChange)).toMatchObject({ usd: 1 });

      rerender(
        element({ total: 7, payer: "shop", onKeptChange, onReturnChange }),
      );
      expect(lastKept(onKeptChange)).toBeNull();
      expect(onReturnChange.mock.calls.at(-1)?.[0]).toEqual([
        expect.objectContaining({
          currencyCode: "USD",
          amount: 3,
          direction: "OUT",
        }),
      ]);
    });

    it("re-rendering with the SAME payer keeps the typed under-return (no spurious reset)", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      const { rerender } = render(
        element({ total: 7, payer: "customer", onKeptChange }),
      );
      pay("10");
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "2" },
      });
      rerender(element({ total: 7, payer: "customer", onKeptChange }));
      expect(lastKept(onKeptChange)).toMatchObject({ usd: 1 });
    });
  });
});

describe("MultiPaymentInput.payoutDiscount (LIRA-269)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — the discount on a PAYOUT sheet (LIRA-269).
   *
   * On a payout (shop → customer) the discount is the shop giving up part of
   * its fee, so the customer receives MORE. The amount the customer receives
   * depends on the module's fee model, so the page computes it (one helper,
   * shared with the server — `walletReceiveAmounts` in @liratek/core) and
   * passes it as the total. The input therefore REPORTS the discount on a
   * payout but never subtracts it from the total itself; and with nobody
   * listening (`onDiscountChange` absent) it hides the field, since a discount
   * nobody books would only move the target.
   *
   * Customer-paid sheets are unchanged: the discount still lowers the total.
   */

  type Kept = { usd: number; lbp: number } | null;

  const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];
  const CURRENCIES = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];

  function discountInput(): HTMLInputElement | null {
    const label = screen.queryByText("Discount");
    return label?.parentElement?.querySelector("input") ?? null;
  }

  function lineAmount(): number {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    if (!input) throw new Error("no payment-amount input rendered");
    return parseFloat(input.value.replace(/,/g, ""));
  }

  /** Mirrors a payout page: the total the page passes is base + discount. */
  function PayoutHarness(props: {
    base: number;
    feedBack: boolean;
    onDiscount: jest.Mock<void, [number]>;
    onKept: jest.Mock<void, [Kept]>;
    onLines: jest.Mock<void, [PaymentLine[]]>;
  }) {
    const [discount, setDiscount] = useState(0);
    const total = props.feedBack ? props.base + discount : props.base;
    return (
      <MultiPaymentInput
        totals={[{ amount: total, currency: "USD" }]}
        currency="USD"
        totalAmountCurrency="USD"
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={89_000}
        payer="payout"
        maxDiscount={2}
        onChange={props.onLines}
        onKeptChange={props.onKept}
        onDiscountChange={(d) => {
          props.onDiscount(d);
          setDiscount(d);
        }}
      />
    );
  }

  describe("MultiPaymentInput — discount on a payout sheet", () => {
    it("reports the discount but does not lower the payout target", () => {
      const onDiscount = jest.fn<void, [number]>();
      const onKept = jest.fn<void, [Kept]>();
      render(
        <PayoutHarness
          base={100}
          feedBack={false}
          onDiscount={onDiscount}
          onKept={onKept}
          onLines={jest.fn()}
        />,
      );
      expect(lineAmount()).toBe(100);
      fireEvent.change(discountInput()!, { target: { value: "0.5" } });
      expect(onDiscount).toHaveBeenLastCalledWith(0.5);
      // The line stays on the total the page passed — nothing short, nothing kept.
      expect(lineAmount()).toBe(100);
      expect(onKept).toHaveBeenLastCalledWith(null);
    });

    it("when the page raises the total by the discount, the untouched line follows and nothing is kept", () => {
      const onKept = jest.fn<void, [Kept]>();
      const onLines = jest.fn<void, [PaymentLine[]]>();
      render(
        <PayoutHarness
          base={100}
          feedBack={true}
          onDiscount={jest.fn()}
          onKept={onKept}
          onLines={onLines}
        />,
      );
      fireEvent.change(discountInput()!, { target: { value: "0.5" } });
      expect(lineAmount()).toBe(100.5);
      expect(onLines.mock.calls.at(-1)?.[0]).toEqual([
        expect.objectContaining({ currencyCode: "USD", amount: 100.5 }),
      ]);
      expect(onKept).toHaveBeenLastCalledWith(null);
    });

    it("hides the discount on a payout nobody books it for (no onDiscountChange)", () => {
      render(
        <MultiPaymentInput
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={89_000}
          payer="payout"
          onChange={jest.fn()}
        />,
      );
      expect(discountInput()).toBeNull();
    });

    it("customer-paid sheet: the discount still lowers the total (unchanged)", () => {
      render(
        <MultiPaymentInput
          totals={[{ amount: 100, currency: "USD" }]}
          currency="USD"
          totalAmountCurrency="USD"
          paymentMethods={PAYMENT_METHODS}
          currencies={CURRENCIES}
          exchangeRate={89_000}
          maxDiscount={10}
          onChange={jest.fn()}
          onDiscountChange={jest.fn()}
        />,
      );
      fireEvent.change(discountInput()!, { target: { value: "5" } });
      expect(lineAmount()).toBe(95);
    });
  });
});

describe("MultiPaymentInput.payoutExtraLess (LIRA-382)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — the "− Less | + Extra" line on a payout (LIRA-382).
   *
   * Owner 2026-11-11: "Visible line, same booking." A payout that wires the
   * LIRA-334 round-up (`onRoundUpChange`) shows the same line pay-in screens
   * show under the total. "+ Extra" makes the payment line hand out more (the
   * difference is reported through `onRoundUpChange`, booked as change
   * rounding); "− Less" makes it hand out less (reported through
   * `onKeptChange`, booked as change kept). Same cap: $5 / 450,000 LBP.
   * The line never computes a value of its own: it moves what the payment
   * line fills to, and what it shows is read back from the lines.
   *
   * Rule 17: written before the component change and run against it first —
   * see the task report for the recorded failure.
   */

  type Pair = { usd: number; lbp: number } | null;

  const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];
  const CURRENCIES = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];

  function mpi(opts: {
    total: number;
    currency: "USD" | "LBP";
    onRoundUpChange?: jest.Mock;
    onKeptChange?: jest.Mock;
    payoutExcessToAccount?: boolean;
  }) {
    return (
      <MultiPaymentInput
        totals={[{ amount: opts.total, currency: opts.currency }]}
        currency={opts.currency}
        totalAmountCurrency={opts.currency}
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={89_000}
        showDiscount={false}
        cashOnlyReturn={true}
        onChange={jest.fn()}
        payer="payout"
        {...(opts.onRoundUpChange
          ? { onRoundUpChange: opts.onRoundUpChange }
          : {})}
        {...(opts.onKeptChange ? { onKeptChange: opts.onKeptChange } : {})}
        {...(opts.payoutExcessToAccount ? { payoutExcessToAccount: true } : {})}
      />
    );
  }

  function typeLeg(value: string): void {
    const input = document.querySelector<HTMLInputElement>(
      'input[data-testid^="payment-amount-"]',
    );
    if (!input) throw new Error("no payment-amount input rendered");
    fireEvent.change(input, { target: { value } });
  }

  describe("MultiPaymentInput — payout '− Less | + Extra' line (LIRA-382)", () => {
    it("shows the line, empty, on a payout that wires the round-up", () => {
      render(
        mpi({
          total: 102.9,
          currency: "USD",
          onRoundUpChange: jest.fn(),
          onKeptChange: jest.fn(),
        }),
      );
      const line = screen.getByTestId("payout-extra-less");
      expect(within(line).getByText("+ Extra")).toBeInTheDocument();
      expect(within(line).getByText("− Less")).toBeInTheDocument();
      expect(payoutLineValue()).toBe("");
    });

    it("no line without the round-up wired, nor when the excess goes to the account", () => {
      const { unmount } = render(
        mpi({ total: 102.9, currency: "USD", onKeptChange: jest.fn() }),
      );
      expect(screen.queryByTestId("payout-extra-less")).not.toBeInTheDocument();
      unmount();
      render(
        mpi({
          total: 102.9,
          currency: "USD",
          onRoundUpChange: jest.fn(),
          payoutExcessToAccount: true,
        }),
      );
      expect(screen.queryByTestId("payout-extra-less")).not.toBeInTheDocument();
    });

    it("owner example: + Extra 0.10 on $102.90 → the line pays $103.00 and reports {usd: 0.1}", () => {
      const onRoundUpChange = jest.fn<void, [Pair]>();
      render(
        mpi({
          total: 102.9,
          currency: "USD",
          onRoundUpChange,
          onKeptChange: jest.fn(),
        }),
      );
      setPayoutLine("extra", "0.10");
      expect(payoutLegAmounts()).toEqual([103]);
      expect(onRoundUpChange).toHaveBeenLastCalledWith({ usd: 0.1, lbp: 0 });
      expect(screen.getByTestId("payout-you-pay")).toHaveTextContent("103.00");
      expect(screen.getByTestId("payout-roundup-summary")).toBeInTheDocument();
    });

    it("− Less 5,000 on 1,345,000 LBP → the line pays 1,340,000 and reports kept {lbp: 5000}", () => {
      const onKeptChange = jest.fn();
      render(
        mpi({
          total: 1_345_000,
          currency: "LBP",
          onRoundUpChange: jest.fn(),
          onKeptChange,
        }),
      );
      setPayoutLine("less", "5000");
      expect(payoutLegAmounts()).toEqual([1_340_000]);
      expect(onKeptChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ usd: 0, lbp: 5_000 }),
      );
    });

    it("6 is held at the $5 cap, with the message", () => {
      const onRoundUpChange = jest.fn<void, [Pair]>();
      render(
        mpi({
          total: 102.9,
          currency: "USD",
          onRoundUpChange,
          onKeptChange: jest.fn(),
        }),
      );
      setPayoutLine("extra", "6");
      expect(payoutLineValue()).toBe("5.00");
      expect(payoutLegAmounts()).toEqual([107.9]);
      expect(onRoundUpChange).toHaveBeenLastCalledWith({ usd: 5, lbp: 0 });
      expect(
        within(screen.getByTestId("payout-extra-less")).getByTestId(
          "discount-cap-note",
        ),
      ).toHaveTextContent(/5\.00/);
    });

    it("switching sides clears the other: Extra 0.10 then Less → empty, back to $102.90", () => {
      const onRoundUpChange = jest.fn<void, [Pair]>();
      render(
        mpi({
          total: 102.9,
          currency: "USD",
          onRoundUpChange,
          onKeptChange: jest.fn(),
        }),
      );
      setPayoutLine("extra", "0.10");
      expect(payoutLegAmounts()).toEqual([103]);
      fireEvent.click(
        within(screen.getByTestId("payout-extra-less")).getByTestId(
          "discount-mode-discount",
        ),
      );
      expect(payoutLineValue()).toBe("");
      expect(payoutLegAmounts()).toEqual([102.9]);
      expect(onRoundUpChange).toHaveBeenLastCalledWith(null);
    });

    it("typing $103 in the payment line fills + Extra with 0.10; clearing the line restores $102.90", () => {
      const onRoundUpChange = jest.fn<void, [Pair]>();
      render(
        mpi({
          total: 102.9,
          currency: "USD",
          onRoundUpChange,
          onKeptChange: jest.fn(),
        }),
      );
      typeLeg("103");
      expect(payoutLineValue()).toBe("0.10");
      expect(
        within(screen.getByTestId("payout-extra-less")).getByTestId(
          "discount-mode-extra",
        ),
      ).toHaveAttribute("aria-pressed", "true");

      setPayoutLine("extra", "");
      expect(payoutLegAmounts()).toEqual([102.9]);
      expect(onRoundUpChange).toHaveBeenLastCalledWith(null);
    });

    it("typing less in the payment line fills − Less", () => {
      render(
        mpi({
          total: 102.9,
          currency: "USD",
          onRoundUpChange: jest.fn(),
          onKeptChange: jest.fn(),
        }),
      );
      typeLeg("102");
      expect(payoutLineValue()).toBe("0.90");
      expect(
        within(screen.getByTestId("payout-extra-less")).getByTestId(
          "discount-mode-discount",
        ),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("without kept change wired the line is + Extra only", () => {
      render(
        mpi({ total: 102.9, currency: "USD", onRoundUpChange: jest.fn() }),
      );
      const line = screen.getByTestId("payout-extra-less");
      expect(within(line).queryByText("− Less")).not.toBeInTheDocument();
      setPayoutLine("extra", "0.1");
      expect(payoutLegAmounts()).toEqual([103]);
    });

    it("a line hidden and shown again (e.g. a cash payout switched away and back) starts empty — no extra carried over", () => {
      const onRoundUpChange = jest.fn<void, [Pair]>();
      const onKeptChange = jest.fn();
      const { rerender } = render(
        mpi({ total: 102.9, currency: "USD", onRoundUpChange, onKeptChange }),
      );
      setPayoutLine("extra", "0.10");
      expect(payoutLegAmounts()).toEqual([103]);
      rerender(mpi({ total: 102.9, currency: "USD", onKeptChange }));
      expect(screen.queryByTestId("payout-extra-less")).not.toBeInTheDocument();
      rerender(
        mpi({ total: 102.9, currency: "USD", onRoundUpChange, onKeptChange }),
      );
      expect(payoutLineValue()).toBe("");
      expect(payoutLegAmounts()).toEqual([102.9]);
      expect(
        screen.queryByTestId("payout-roundup-summary"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("MultiPaymentInput.payoutKeepChange", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — payout-mode kept change (owner decision 2026-10-06,
   * D9 refined; automatic since the later 2026-10-06 decision that removed the
   * "Keep change" button).
   *
   * On a PAYOUT sheet (Exchange: each line is cash the shop hands out) keeping
   * runs opposite to T3: when the lines are SHORT of the total by a small
   * leftover (up to and including $5 / 450,000 LBP — the shared core PAYOUT_KEEP_CHANGE_MAX)
   * the leftover is kept automatically and `onKeptChange` reports it, with a
   * green note. Owner example: $101.12 owed, $101 handed over → kept $0.12.
   *
   * Rule 17 disclosure: originally written after the component change — NOT
   * proven failing-first. Rewritten from the button-tap version (rule 24); the
   * automatic behaviour's failing-first guard is
   * MultiPaymentInput.autoKeepChange.test.tsx (case c).
   */

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

  function renderMpi(opts: {
    total: number;
    currency: "USD" | "LBP";
    direction?: "payment" | "payout";
    onKeptChange?: jest.Mock<void, [Kept]>;
  }) {
    return render(
      <MultiPaymentInput
        totals={[{ amount: opts.total, currency: opts.currency }]}
        currency={opts.currency}
        totalAmountCurrency={opts.currency}
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={89_000}
        showDiscount={false}
        cashOnlyReturn={true}
        onChange={jest.fn()}
        {...(opts.direction ? { direction: opts.direction } : {})}
        {...(opts.onKeptChange ? { onKeptChange: opts.onKeptChange } : {})}
      />,
    );
  }

  function amountInput(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    if (!input) throw new Error("no payment-amount input rendered");
    return input;
  }

  function type(value: string): void {
    fireEvent.change(amountInput(), { target: { value } });
  }

  describe("MultiPaymentInput — payout kept change (automatic)", () => {
    it("owner example: $101 paid against $101.12 owed → the $0.12 shortfall is kept with no tap and no button", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      renderMpi({
        total: 101.12,
        currency: "USD",
        direction: "payout",
        onKeptChange,
      });

      // Auto-filled with the full amount → nothing short, nothing kept.
      expect(onKeptChange).toHaveBeenLastCalledWith(null);
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();

      type("101");
      const kept = onKeptChange.mock.calls.at(-1)?.[0];
      expect(kept?.usd).toBe(0.12);
      expect(kept?.lbp).toBe(0);
      expect(kept?.exactUsd).toBeCloseTo(0.12, 9);
      expect(kept?.exactLbp).toBe(0);
      expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
      expect(
        within(screen.getByTestId("remaining-row")).getByText(
          "Change kept (profit)",
        ),
      ).toBeInTheDocument();
      // 2026-10-13 (owner): the payout "Keeping X as profit." note under the
      // green row is gone — the green "Change kept (profit)" row says it.
      // Updated after the fix: not proven failing-first (rule 17).
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("remaining-amount")).toHaveTextContent(
        /\$0\.12/,
      );
      expect(screen.getByTestId("remaining-amount")).toHaveTextContent(
        /10,680 LBP/,
      );
    });

    it("clears the kept amount when the shortfall disappears (no stale 0.12 rides into the payload)", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      renderMpi({
        total: 101.12,
        currency: "USD",
        direction: "payout",
        onKeptChange,
      });
      type("101");
      expect(onKeptChange.mock.calls.at(-1)?.[0]?.usd).toBe(0.12);

      type("101.12");
      expect(onKeptChange).toHaveBeenLastCalledWith(null);
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();

      // The shortfall comes back → kept again, automatically.
      type("101");
      expect(onKeptChange.mock.calls.at(-1)?.[0]?.usd).toBe(0.12);
    });

    it("follows the shortfall live", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      renderMpi({
        total: 101.12,
        currency: "USD",
        direction: "payout",
        onKeptChange,
      });
      type("101");
      type("100.5");
      expect(onKeptChange.mock.calls.at(-1)?.[0]?.usd).toBe(0.62);
    });

    // LIRA-310 (owner decision 2026-10-11): the cap rose from $1 / 100,000 LBP
    // to $5 / 450,000 LBP, up to and including.
    it("keeps a shortfall of exactly $5.00 (the cap is inclusive)", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      renderMpi({
        total: 101.12,
        currency: "USD",
        direction: "payout",
        onKeptChange,
      });
      type("96.12");
      expect(onKeptChange.mock.calls.at(-1)?.[0]?.usd).toBe(5);
    });

    it("nothing kept when the shortfall is over $5 (a real shortchange, not change) — 'Remaining to pay out'", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      renderMpi({
        total: 101.12,
        currency: "USD",
        direction: "payout",
        onKeptChange,
      });
      type("96.11");
      expect(onKeptChange).not.toHaveBeenCalledWith(
        expect.objectContaining({ usd: expect.any(Number) }),
      );
      expect(
        within(screen.getByTestId("remaining-row")).getByText(
          "Remaining to pay out",
        ),
      ).toBeInTheDocument();
    });

    it("an OVERPAID payout keeps nothing and shows no Return/Change block", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      renderMpi({
        total: 101.12,
        currency: "USD",
        direction: "payout",
        onKeptChange,
      });
      type("101.5");
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("return-change")).not.toBeInTheDocument();
      expect(onKeptChange).not.toHaveBeenCalledWith(
        expect.objectContaining({ usd: expect.any(Number) }),
      );
    });

    it("LBP payout: reports the LBP leftover (within 450,000 LBP)", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      renderMpi({
        total: 8_912_345,
        currency: "LBP",
        direction: "payout",
        onKeptChange,
      });
      type("8900000");
      expect(onKeptChange).toHaveBeenLastCalledWith({
        usd: 0,
        lbp: 12_345,
        exactUsd: 0,
        exactLbp: 12_345,
      });
    });

    it("LBP payout: keeps exactly 450,000 LBP (the cap is inclusive)", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      renderMpi({
        total: 8_912_345,
        currency: "LBP",
        direction: "payout",
        onKeptChange,
      });
      type("8462345");
      expect(onKeptChange.mock.calls.at(-1)?.[0]?.lbp).toBe(450_000);
    });

    it("LBP payout: nothing kept over 450,000 LBP short", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      renderMpi({
        total: 8_912_345,
        currency: "LBP",
        direction: "payout",
        onKeptChange,
      });
      type("8462344");
      expect(onKeptChange).not.toHaveBeenCalledWith(
        expect.objectContaining({ lbp: expect.any(Number) }),
      );
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
    });

    it("OPT-IN: payout mode without onKeptChange keeps nothing — 'Remaining to pay out'", () => {
      renderMpi({ total: 101.12, currency: "USD", direction: "payout" });
      type("101");
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
      expect(
        within(screen.getByTestId("remaining-row")).getByText(
          "Remaining to pay out",
        ),
      ).toBeInTheDocument();
    });

    it("default (payment) mode is unchanged: an UNDERPAID payment keeps nothing and still reads as debt", () => {
      const onKeptChange = jest.fn<void, [Kept]>();
      renderMpi({ total: 101.12, currency: "USD", onKeptChange });
      type("101");
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
      expect(onKeptChange).toHaveBeenLastCalledWith(null);
      expect(screen.getByText("Remaining (Debt)")).toBeInTheDocument();
    });
  });

  describe("PaymentSheet — direction pass-through", () => {
    it('forwards direction="payout" to the real MultiPaymentInput (the short leftover is kept)', () => {
      const onKeptChange = jest.fn();
      render(
        <PaymentSheet
          open
          onClose={jest.fn()}
          onConfirm={jest.fn()}
          totalAmount={101.12}
          totalAmountCurrency="USD"
          currency="USD"
          paymentMethods={PAYMENT_METHODS}
          onPaymentChange={jest.fn()}
          direction="payout"
          onKeptChange={onKeptChange}
        />,
      );
      type("101");
      expect(onKeptChange.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({ usd: 0.12, lbp: 0 }),
      );
    });

    it("without direction, an underpaid sheet keeps nothing (other pages unchanged)", () => {
      const onKeptChange = jest.fn();
      render(
        <PaymentSheet
          open
          onClose={jest.fn()}
          onConfirm={jest.fn()}
          totalAmount={101.12}
          totalAmountCurrency="USD"
          currency="USD"
          paymentMethods={PAYMENT_METHODS}
          onPaymentChange={jest.fn()}
          onKeptChange={onKeptChange}
        />,
      );
      type("101");
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
      expect(onKeptChange).not.toHaveBeenCalledWith(
        expect.objectContaining({ usd: expect.any(Number) }),
      );
    });
  });
});

describe("MultiPaymentInput.payoutRoundUp (LIRA-334)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — payout round-up (LIRA-334, research R6).
   *
   * The mirror of payout kept change: when the shop hands out a little MORE
   * than it owes (owner example: $102.90 owed, $103 handed over), a consumer
   * that passes `onRoundUpChange` accepts the overpay up to the shared core cap
   * (`isWithinShortfallMax`, $5 / 450,000 LBP) as a round-up the shop books as
   * a change-rounding expense. The Paid figure is not red, an emerald note
   * says so, and `onRoundUpChange` reports `{usd, lbp}` in the total's
   * currency. Without the prop an overpaid payout is still a problem (red).
   *
   * Rule 17: written before the component change and run against it first —
   * see the task report for the recorded failures.
   */

  type RoundUp = { usd: number; lbp: number } | null;

  const PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];
  const CURRENCIES = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];

  function mpi(opts: {
    total: number;
    currency: "USD" | "LBP";
    payer?: MultiPaymentPayer;
    onRoundUpChange?: jest.Mock<void, [RoundUp]>;
    payoutExcessToAccount?: boolean;
  }) {
    return (
      <MultiPaymentInput
        totals={[{ amount: opts.total, currency: opts.currency }]}
        currency={opts.currency}
        totalAmountCurrency={opts.currency}
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={89_000}
        showDiscount={false}
        cashOnlyReturn={true}
        onChange={jest.fn()}
        payer={opts.payer ?? "payout"}
        {...(opts.onRoundUpChange
          ? { onRoundUpChange: opts.onRoundUpChange }
          : {})}
        {...(opts.payoutExcessToAccount ? { payoutExcessToAccount: true } : {})}
      />
    );
  }

  function type(value: string): void {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    if (!input) throw new Error("no payment-amount input rendered");
    fireEvent.change(input, { target: { value } });
  }

  /** The "Paid" summary row — same reading as paidToneAndChangeCopy.test. */
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

  describe("MultiPaymentInput — payout round-up (LIRA-334)", () => {
    it("owner example: $103 handed out on $102.90 owed → note, not red, reports {usd: 0.1, lbp: 0}", () => {
      const onRoundUpChange = jest.fn<void, [RoundUp]>();
      render(mpi({ total: 102.9, currency: "USD", onRoundUpChange }));
      // Auto-filled with the exact amount → nothing to round.
      expect(onRoundUpChange).toHaveBeenLastCalledWith(null);
      expect(
        screen.queryByTestId("payout-roundup-summary"),
      ).not.toBeInTheDocument();

      type("103");
      expect(onRoundUpChange).toHaveBeenLastCalledWith({ usd: 0.1, lbp: 0 });
      const note = screen.getByTestId("payout-roundup-summary");
      expect(note).toHaveTextContent(/\$0\.10/);
      expect(note.className).toContain("text-emerald-400");
      expect(paidIsRed()).toBe(false);
    });

    it("goes back to null when the overpay disappears", () => {
      const onRoundUpChange = jest.fn<void, [RoundUp]>();
      render(mpi({ total: 102.9, currency: "USD", onRoundUpChange }));
      type("103");
      expect(onRoundUpChange).toHaveBeenLastCalledWith({ usd: 0.1, lbp: 0 });
      type("102.9");
      expect(onRoundUpChange).toHaveBeenLastCalledWith(null);
      expect(
        screen.queryByTestId("payout-roundup-summary"),
      ).not.toBeInTheDocument();
    });

    it("accepts exactly $5 (the cap is inclusive)", () => {
      const onRoundUpChange = jest.fn<void, [RoundUp]>();
      render(mpi({ total: 102.9, currency: "USD", onRoundUpChange }));
      type("107.9");
      expect(onRoundUpChange).toHaveBeenLastCalledWith({ usd: 5, lbp: 0 });
      expect(paidIsRed()).toBe(false);
    });

    it("LBP payout: 5,000 LBP over → reports {usd: 0, lbp: 5000}", () => {
      const onRoundUpChange = jest.fn<void, [RoundUp]>();
      render(mpi({ total: 8_995_000, currency: "LBP", onRoundUpChange }));
      type("9000000");
      expect(onRoundUpChange).toHaveBeenLastCalledWith({ usd: 0, lbp: 5_000 });
      expect(screen.getByTestId("payout-roundup-summary")).toBeInTheDocument();
      expect(paidIsRed()).toBe(false);
    });

    it("over the cap → null, no note, and the Paid figure is red", () => {
      const onRoundUpChange = jest.fn<void, [RoundUp]>();
      render(mpi({ total: 102.9, currency: "USD", onRoundUpChange }));
      type("108");
      expect(onRoundUpChange).toHaveBeenLastCalledWith(null);
      expect(onRoundUpChange).not.toHaveBeenCalledWith(
        expect.objectContaining({ usd: expect.any(Number) }),
      );
      expect(
        screen.queryByTestId("payout-roundup-summary"),
      ).not.toBeInTheDocument();
      expect(paidIsRed()).toBe(true);
    });

    it("OPT-IN: without the prop an overpaid payout is unchanged (red, no note)", () => {
      render(mpi({ total: 102.9, currency: "USD" }));
      type("103");
      expect(
        screen.queryByTestId("payout-roundup-summary"),
      ).not.toBeInTheDocument();
      expect(paidIsRed()).toBe(true);
    });

    it("payoutExcessToAccount wins: the round-up never fires", () => {
      const onRoundUpChange = jest.fn<void, [RoundUp]>();
      render(
        mpi({
          total: 102.9,
          currency: "USD",
          onRoundUpChange,
          payoutExcessToAccount: true,
        }),
      );
      type("103");
      expect(onRoundUpChange).not.toHaveBeenCalledWith(
        expect.objectContaining({ usd: expect.any(Number) }),
      );
      expect(
        screen.queryByTestId("payout-roundup-summary"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("payout-excess-summary")).toBeInTheDocument();
    });

    it("switching the payer away from payout reports null (no stale round-up)", () => {
      const onRoundUpChange = jest.fn<void, [RoundUp]>();
      const { rerender } = render(
        mpi({ total: 102.9, currency: "USD", onRoundUpChange }),
      );
      type("103");
      expect(onRoundUpChange).toHaveBeenLastCalledWith({ usd: 0.1, lbp: 0 });
      rerender(
        mpi({
          total: 102.9,
          currency: "USD",
          onRoundUpChange,
          payer: "customer",
        }),
      );
      expect(onRoundUpChange).toHaveBeenLastCalledWith(null);
      expect(
        screen.queryByTestId("payout-roundup-summary"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("MultiPaymentInput.perCurrencyTotals (LIRA-322)", () => {
  beforeAll(resetBetweenFiles);

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
        {...(opts.onReturnChange
          ? { onReturnChange: opts.onReturnChange }
          : {})}
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
      expect(screen.getByTestId("remaining-amount").textContent).toBe(
        "$197.00",
      );
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
});

describe("MultiPaymentInput", () => {
  beforeAll(resetBetweenFiles);

  /**
   * RTL render tests for MultiPaymentInput (re-exported from @liratek/ui).
   *
   * Replaces the previous logic-only test (which asserted on inline arrays and
   * never rendered the component) and captures the intent of the heavy Electron
   * e2e spec (MultiPaymentInput.spec.ts, S1–S8 across 6 modules / 75 hard waits).
   *
   * Covered here by actually rendering + interacting with the component:
   *   - renders a single initial payment line, summary and split toggle
   *   - the initial line auto-fills with the full total (per-currency `totals`)
   *   - method options come from the paymentMethods prop
   *   - CUSTOMER_ACCOUNT selection surfaces the "client required" debt warning
   *   - the exchange-rate field renders in both modes; split reveals the
   *     add-line button
   *   - adding a line creates a second payment line auto-filled with the remainder
   *   - removing a line returns to a single line
   *   - switching a split line's currency (USD → LBP) converts the amount by rate
   *   - the summary reflects remaining / overpaid / exact totals
   *   - onChange is invoked with the typed PaymentLine[] payload
   *
   * Note: the component is the canonical implementation in
   * packages/ui/src/components/ui/MultiPaymentInput.tsx — imported here exactly
   * as feature pages consume it. jest.config maps "@liratek/ui" → that package's
   * source. crypto.randomUUID (used for line ids) is available in the jest jsdom
   * environment, so no polyfill is required.
   *
   * jest-dom matchers are registered globally via jest.setup.ts.
   */

  // ── Typed fixtures (no `any`) ───────────────────────────────────────────────

  const PAYMENT_METHODS: PaymentMethod[] = [
    { code: "CASH", label: "Cash" },
    { code: "OMT", label: "OMT" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account (Debt)" },
  ];

  const CURRENCIES: Currency[] = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];

  const EXCHANGE_RATE = 90000;

  type ChangeMock = jest.Mock<void, [PaymentLine[]]>;
  type RateMock = jest.Mock<void, [number]>;

  interface RenderOptions {
    /** Shorthand: becomes totals=[{amount, currency: totalAmountCurrency}]. */
    totalAmount?: number;
    currency?: string;
    totalAmountCurrency?: string;
    hasClient?: boolean;
    requiresClientForDebt?: boolean;
    autoDebtRemainder?: boolean;
    onChange?: ChangeMock;
    exchangeRate?: number;
    initialLines?: Array<{
      method?: string;
      currencyCode: string;
      amount: number;
    }>;
    onExchangeRateChange?: RateMock;
    totals?: Array<{ amount: number; currency: string }>;
  }

  function renderMpi(opts: RenderOptions = {}) {
    const onChange: ChangeMock = opts.onChange ?? jest.fn();
    const totals = opts.totals ?? [
      {
        amount: opts.totalAmount ?? 100,
        currency: opts.totalAmountCurrency ?? "USD",
      },
    ];
    const utils = render(
      <MultiPaymentInput
        totals={totals}
        currency={opts.currency ?? "USD"}
        totalAmountCurrency={opts.totalAmountCurrency ?? "USD"}
        hasClient={opts.hasClient ?? false}
        requiresClientForDebt={opts.requiresClientForDebt ?? true}
        autoDebtRemainder={opts.autoDebtRemainder ?? false}
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={opts.exchangeRate ?? EXCHANGE_RATE}
        {...(opts.initialLines ? { initialLines: opts.initialLines } : {})}
        {...(opts.onExchangeRateChange
          ? { onExchangeRateChange: opts.onExchangeRateChange }
          : {})}
        // Hide the discount field so the summary stays focused on totals.
        showDiscount={false}
        onChange={onChange}
      />,
    );
    return { ...utils, onChange };
  }

  /** Read the first payment line's generated id from its data-testid. */
  function firstLineId(): string {
    const line = document.querySelector('[data-testid^="payment-line-"]');
    const testId = line?.getAttribute("data-testid") ?? "";
    return testId.replace("payment-line-", "");
  }

  /** All rendered payment-line root elements. */
  function allLines(): Element[] {
    return Array.from(
      document.querySelectorAll('[data-testid^="payment-line-"]'),
    );
  }

  /** The first payment line's amount input. */
  function firstAmountInput(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    if (!input) throw new Error("no payment-amount input rendered");
    return input;
  }

  /** Type a new value into the header exchange-rate field (commas allowed). */
  function setRate(value: string): void {
    fireEvent.change(screen.getByTestId("payment-exchange-rate"), {
      target: { value },
    });
  }

  /**
   * Switch the first payment line's currency, the way a cashier does. Owner
   * 2026-11-01: the "1 USD = … LBP" box shows only once the window mixes USD
   * and LBP, so tests that edit the rate first bring LBP in this way.
   */
  function switchFirstLineTo(code: string): void {
    fireEvent.change(screen.getByTestId(`payment-currency-${firstLineId()}`), {
      target: { value: code },
    });
  }

  describe("MultiPaymentInput", () => {
    describe("initial render", () => {
      it("renders the root, a single payment line, summary and split toggle", () => {
        renderMpi();

        expect(screen.getByTestId("multi-payment-input")).toBeInTheDocument();
        expect(screen.getByTestId("payment-summary")).toBeInTheDocument();
        expect(screen.getByTestId("split-toggle")).toBeInTheDocument();
        expect(allLines()).toHaveLength(1);
      });

      it("auto-fills the single line's amount with the full total", () => {
        renderMpi({ totalAmount: 75 });

        const amount = document.querySelector<HTMLInputElement>(
          '[data-testid^="payment-amount-"]',
        );
        expect(amount).not.toBeNull();
        // fmtNum formats with commas; 75 → "75".
        expect(amount?.value).toBe("75");
      });

      it("exposes every paymentMethods entry as an <option>", () => {
        renderMpi();

        const id = firstLineId();
        const method = screen.getByTestId(`payment-method-${id}`);
        const optionValues = within(method)
          .getAllByRole("option")
          .map((o) => (o as HTMLOptionElement).value);

        expect(optionValues).toEqual(["CASH", "OMT", "CUSTOMER_ACCOUNT"]);
      });

      it("emits the edited line through onChange when the amount changes", () => {
        // On mount the initial line already equals totalAmount, so the auto-sync
        // effect is a no-op; the first emit is driven by a user edit. We assert
        // the payload shape the parent receives.
        const { onChange } = renderMpi({ totalAmount: 100 });

        const amount = document.querySelector<HTMLInputElement>(
          '[data-testid^="payment-amount-"]',
        )!;
        fireEvent.change(amount, { target: { value: "42" } });

        expect(onChange).toHaveBeenCalled();
        const lastCall = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        expect(lastCall).toHaveLength(1);
        expect(lastCall[0].method).toBe("CASH");
        expect(lastCall[0].currencyCode).toBe("USD");
        expect(lastCall[0].amount).toBe(42);
      });
    });

    describe("CUSTOMER_ACCOUNT / debt detection", () => {
      it("shows the debt warning when CUSTOMER_ACCOUNT is picked without a client", () => {
        renderMpi({ hasClient: false });

        const id = firstLineId();
        fireEvent.change(screen.getByTestId(`payment-method-${id}`), {
          target: { value: "CUSTOMER_ACCOUNT" },
        });

        expect(
          screen.getByText(
            /Client is required when using DEBT payment method/i,
          ),
        ).toBeInTheDocument();
      });

      it("hides the debt warning when a client is attached", () => {
        renderMpi({ hasClient: true });

        const id = firstLineId();
        fireEvent.change(screen.getByTestId(`payment-method-${id}`), {
          target: { value: "CUSTOMER_ACCOUNT" },
        });

        expect(
          screen.queryByText(
            /Client is required when using DEBT payment method/i,
          ),
        ).not.toBeInTheDocument();
      });

      it("reports CUSTOMER_ACCOUNT to the parent via onChange", () => {
        const { onChange } = renderMpi({ hasClient: true });

        const id = firstLineId();
        fireEvent.change(screen.getByTestId(`payment-method-${id}`), {
          target: { value: "CUSTOMER_ACCOUNT" },
        });

        const lastLines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        expect(lastLines.some((l) => l.method === "CUSTOMER_ACCOUNT")).toBe(
          true,
        );
      });
    });

    describe("split mode — add / remove / currency", () => {
      it("shows the exchange-rate field in both modes once LBP is in play; split reveals the add-line button", () => {
        renderMpi();

        // Owner 2026-11-01: a USD-only window has no "1 USD = … LBP" box.
        expect(screen.queryByText(/1 USD =/)).not.toBeInTheDocument();
        expect(
          screen.queryByRole("button", { name: /Add .*Line/i }),
        ).not.toBeInTheDocument();

        // Once a line is paid in LBP the row renders in single mode too — the
        // rate drives USD↔LBP conversion regardless of mode.
        switchFirstLineTo("LBP");
        expect(screen.getByText(/1 USD =/)).toBeInTheDocument();

        fireEvent.click(screen.getByTestId("split-toggle"));

        expect(screen.getByText(/1 USD =/)).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: /Add .*Line/i }),
        ).toBeInTheDocument();
      });

      it("adds a second payment line auto-filled with the remaining amount", () => {
        renderMpi({ totalAmount: 100 });

        fireEvent.click(screen.getByTestId("split-toggle"));
        expect(allLines()).toHaveLength(1);

        fireEvent.click(screen.getByRole("button", { name: /Add .*Line/i }));
        expect(allLines()).toHaveLength(2);

        // First line keeps the full amount; the second auto-fills the remainder
        // (effectiveTotalAmount - totalPaid). With a fully-paid first line that
        // remainder is 0 → the new line starts empty.
        const amounts = Array.from(
          document.querySelectorAll<HTMLInputElement>(
            '[data-testid^="payment-amount-"]',
          ),
        ).map((i) => i.value);
        expect(amounts[0]).toBe("100");
        expect(amounts[1]).toBe(""); // 0 renders as empty via fmtNum
      });

      it("auto-fills the new line with the outstanding remainder when underpaid", () => {
        renderMpi({ totalAmount: 100 });

        fireEvent.click(screen.getByTestId("split-toggle"));

        // Reduce the first line so there's an outstanding balance.
        const firstAmount = document.querySelector<HTMLInputElement>(
          '[data-testid^="payment-amount-"]',
        )!;
        fireEvent.change(firstAmount, { target: { value: "60" } });

        fireEvent.click(screen.getByRole("button", { name: /Add .*Line/i }));

        const amounts = Array.from(
          document.querySelectorAll<HTMLInputElement>(
            '[data-testid^="payment-amount-"]',
          ),
        ).map((i) => i.value);
        expect(amounts[0]).toBe("60");
        // remaining = 100 - 60 = 40 (USD line, same currency as total).
        expect(amounts[1]).toBe("40");
      });

      it("removes a payment line, returning to a single line", () => {
        renderMpi({ totalAmount: 100 });

        fireEvent.click(screen.getByTestId("split-toggle"));
        fireEvent.click(screen.getByRole("button", { name: /Add .*Line/i }));
        expect(allLines()).toHaveLength(2);

        // The second line's remove button (the first line's is disabled).
        const secondLine = allLines()[1];
        const removeBtn = within(secondLine as HTMLElement).getByTitle(
          "Remove",
        );
        fireEvent.click(removeBtn);

        expect(allLines()).toHaveLength(1);
      });

      it("keeps the lone remove button disabled in single-line split mode", () => {
        renderMpi();

        fireEvent.click(screen.getByTestId("split-toggle"));
        const line = allLines()[0];
        const removeBtn = within(line as HTMLElement).getByTitle("Remove");
        expect(removeBtn).toBeDisabled();
      });

      it("converts a line's amount when its currency switches USD → LBP", () => {
        renderMpi({ totalAmount: 100 });

        fireEvent.click(screen.getByTestId("split-toggle"));

        const line = allLines()[0] as HTMLElement;
        // The currency <select> is the one whose option values are USD/LBP.
        const selects = within(line).getAllByRole("combobox");
        const currencySelect = selects.find((s) =>
          Array.from((s as HTMLSelectElement).options).some(
            (o) => o.value === "LBP",
          ),
        ) as HTMLSelectElement;

        fireEvent.change(currencySelect, { target: { value: "LBP" } });

        const amount = within(line).getByDisplayValue(
          (100 * EXCHANGE_RATE).toLocaleString("en-US"),
        );
        // 100 USD * 90000 = 9,000,000 LBP.
        expect((amount as HTMLInputElement).value).toBe("9,000,000");
      });
    });

    describe("summary totals", () => {
      it("shows a remaining (debt) row when the line underpays the total", () => {
        renderMpi({ totalAmount: 100 });

        fireEvent.click(screen.getByTestId("split-toggle"));
        const firstAmount = document.querySelector<HTMLInputElement>(
          '[data-testid^="payment-amount-"]',
        )!;
        fireEvent.change(firstAmount, { target: { value: "60" } });

        const summary = screen.getByTestId("payment-summary");
        expect(
          within(summary).getByText(/Remaining \(Debt\)/i),
        ).toBeInTheDocument();
        // |100 - 60| = 40 → "$40.00".
        expect(within(summary).getByText("$40.00")).toBeInTheDocument();
      });

      it("shows a return/change block when the line pays more than the total", () => {
        renderMpi({ totalAmount: 100 });

        fireEvent.click(screen.getByTestId("split-toggle"));
        const firstAmount = document.querySelector<HTMLInputElement>(
          '[data-testid^="payment-amount-"]',
        )!;
        fireEvent.change(firstAmount, { target: { value: "150" } });

        const summary = screen.getByTestId("payment-summary");
        expect(
          within(summary).getByTestId("return-change"),
        ).toBeInTheDocument();
        expect(
          within(summary).getByText(/Return \/ Change/i),
        ).toBeInTheDocument();
        // |100 - 150| = 50 → CASH return auto-fills the USD field with "50.00".
        expect(screen.getByTestId("return-usd")).toHaveValue("50.00");
      });

      it("shows neither remaining nor return/change when the amount matches exactly", () => {
        renderMpi({ totalAmount: 100 });

        // Single mode auto-fills the exact total; no warning rows render.
        const summary = screen.getByTestId("payment-summary");
        expect(
          within(summary).queryByText(/Remaining \(Debt\)/i),
        ).not.toBeInTheDocument();
        expect(
          within(summary).queryByTestId("return-change"),
        ).not.toBeInTheDocument();
      });
    });

    describe("CASH return fields — independent (owner note, 2026-09-24)", () => {
      // NOT RUN — proven at the end-of-batch gate (owner process rule,
      // 2026-09-24 batch: build first, verify once at the end).
      //
      // Rule 17 (failing-first): before this fix, `handleReturnUSDChange` /
      // `handleReturnLBPChange` each recomputed the OTHER field from the
      // remaining overpay. Reverting to that pre-fix pair (temporarily
      // restoring the removed remainder-recompute logic in
      // packages/ui/src/components/ui/MultiPaymentInput.tsx) makes the second
      // assertion below fail: typing "10000" into LBP after "45" into USD
      // rewrote USD to "49.89" (50 - 10000/90000, rounded) — the operator's
      // own second keystroke silently undid the first, exactly the "40$ +
      // 10,000 LBP cannot be entered" bug the owner reported.
      it("typing into one CASH return field never rewrites the other", () => {
        renderMpi({ totalAmount: 100 });

        fireEvent.click(screen.getByTestId("split-toggle"));
        const firstAmount = document.querySelector<HTMLInputElement>(
          '[data-testid^="payment-amount-"]',
        )!;
        // Overpay $150 on $100 -> $50 suggested change.
        fireEvent.change(firstAmount, { target: { value: "150" } });
        expect(screen.getByTestId("return-usd")).toHaveValue("50.00");

        fireEvent.change(screen.getByTestId("return-usd"), {
          target: { value: "45" },
        });
        expect(screen.getByTestId("return-usd")).toHaveValue("45");
        // The LBP field is untouched by editing USD — it stays whatever it
        // already was (the auto-init effect leaves it empty for a USD total).
        expect(screen.getByTestId("return-lbp")).toHaveValue("");

        fireEvent.change(screen.getByTestId("return-lbp"), {
          target: { value: "10000" },
        });
        expect(screen.getByTestId("return-lbp")).toHaveValue("10000");
        // The operator's "45" in USD survives — editing LBP never rewrites it.
        expect(screen.getByTestId("return-usd")).toHaveValue("45");
      });

      it("both fields can be set to an arbitrary combination — '40 + 10,000 LBP' is enterable", () => {
        renderMpi({ totalAmount: 100 });

        fireEvent.click(screen.getByTestId("split-toggle"));
        const firstAmount = document.querySelector<HTMLInputElement>(
          '[data-testid^="payment-amount-"]',
        )!;
        fireEvent.change(firstAmount, { target: { value: "150" } });

        fireEvent.change(screen.getByTestId("return-usd"), {
          target: { value: "40" },
        });
        fireEvent.change(screen.getByTestId("return-lbp"), {
          target: { value: "10000" },
        });

        expect(screen.getByTestId("return-usd")).toHaveValue("40");
        expect(screen.getByTestId("return-lbp")).toHaveValue("10000");
      });

      // Fix-round finding #4: field independence (above) drops the only
      // mechanism that kept sum(return legs) == overpaid — this is the
      // restored invariant check, as a visible flag instead of a silent
      // auto-fill (which the two tests above prove is gone for good).
      it("flags a return that under-covers the overpaid amount", () => {
        renderMpi({ totalAmount: 100 });

        fireEvent.click(screen.getByTestId("split-toggle"));
        const firstAmount = document.querySelector<HTMLInputElement>(
          '[data-testid^="payment-amount-"]',
        )!;
        // Overpay $150 on $100 -> $50 suggested change, auto-seeded to USD.
        fireEvent.change(firstAmount, { target: { value: "150" } });
        expect(
          screen.queryByTestId("return-mismatch-warning"),
        ).not.toBeInTheDocument();

        // Edit USD down to $45 — LBP stays at its auto-seeded "" (0), so only
        // $45 of the $50 owed is covered.
        fireEvent.change(screen.getByTestId("return-usd"), {
          target: { value: "45" },
        });
        expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
          "$5.00",
        );
      });

      it("shows no mismatch warning once both fields correctly sum to the overpaid amount", () => {
        renderMpi({ totalAmount: 100 });

        fireEvent.click(screen.getByTestId("split-toggle"));
        const firstAmount = document.querySelector<HTMLInputElement>(
          '[data-testid^="payment-amount-"]',
        )!;
        // Overpay $150 on $100 -> $50 owed. $45 + 450,000 LBP (@ 90,000) == $50.
        fireEvent.change(firstAmount, { target: { value: "150" } });
        fireEvent.change(screen.getByTestId("return-usd"), {
          target: { value: "45" },
        });
        fireEvent.change(screen.getByTestId("return-lbp"), {
          target: { value: "450000" },
        });

        expect(
          screen.queryByTestId("return-mismatch-warning"),
        ).not.toBeInTheDocument();
      });
    });

    describe("waive-remaining button (opt-in)", () => {
      it("does not render a Waive button when onWaiveRemaining is not provided", () => {
        renderMpi({ totalAmount: 100 });

        fireEvent.click(screen.getByTestId("split-toggle"));
        const firstAmount = document.querySelector<HTMLInputElement>(
          '[data-testid^="payment-amount-"]',
        )!;
        fireEvent.change(firstAmount, { target: { value: "99.50" } });

        expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
      });

      // LIRA-310: the callback also receives the per-currency remainder.
      it("renders a Waive button for a small shortfall and calls back with the shortfall", () => {
        const onWaiveRemaining = jest.fn();
        render(
          <MultiPaymentInput
            totals={[{ amount: 100, currency: "USD" }]}
            currency="USD"
            totalAmountCurrency="USD"
            hasClient={false}
            requiresClientForDebt={true}
            paymentMethods={PAYMENT_METHODS}
            currencies={CURRENCIES}
            exchangeRate={EXCHANGE_RATE}
            showDiscount={false}
            onChange={jest.fn()}
            onWaiveRemaining={onWaiveRemaining}
          />,
        );

        fireEvent.click(screen.getByTestId("split-toggle"));
        const firstAmount = document.querySelector<HTMLInputElement>(
          '[data-testid^="payment-amount-"]',
        )!;
        fireEvent.change(firstAmount, { target: { value: "99.50" } });

        const waiveBtn = screen.getByTestId("waive-remaining");
        expect(waiveBtn).toBeInTheDocument();
        fireEvent.click(waiveBtn);
        expect(onWaiveRemaining).toHaveBeenCalledWith(0.5, [
          { currency: "USD", amount: 0.5 },
        ]);
      });

      it("does not render a Waive button when the shortfall is over the $5 cap", () => {
        const onWaiveRemaining = jest.fn();
        render(
          <MultiPaymentInput
            totals={[{ amount: 100, currency: "USD" }]}
            currency="USD"
            totalAmountCurrency="USD"
            hasClient={false}
            requiresClientForDebt={true}
            paymentMethods={PAYMENT_METHODS}
            currencies={CURRENCIES}
            exchangeRate={EXCHANGE_RATE}
            showDiscount={false}
            onChange={jest.fn()}
            onWaiveRemaining={onWaiveRemaining}
          />,
        );

        fireEvent.click(screen.getByTestId("split-toggle"));
        const firstAmount = document.querySelector<HTMLInputElement>(
          '[data-testid^="payment-amount-"]',
        )!;
        fireEvent.change(firstAmount, { target: { value: "60" } });

        expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
      });
    });

    describe("cashOnlyReturn (opt-in)", () => {
      it("forces the CASH return fields even with multiple payment methods available", () => {
        render(
          <MultiPaymentInput
            totals={[{ amount: 100, currency: "USD" }]}
            currency="USD"
            totalAmountCurrency="USD"
            hasClient={false}
            requiresClientForDebt={true}
            paymentMethods={PAYMENT_METHODS}
            currencies={CURRENCIES}
            exchangeRate={EXCHANGE_RATE}
            showDiscount={false}
            onChange={jest.fn()}
            cashOnlyReturn={true}
          />,
        );

        const firstAmount = document.querySelector<HTMLInputElement>(
          '[data-testid^="payment-amount-"]',
        )!;
        fireEvent.change(firstAmount, { target: { value: "150" } });

        // Multiple non-CASH methods exist (OMT, CUSTOMER_ACCOUNT), so without
        // cashOnlyReturn the method selector would render — it must not here.
        expect(screen.queryByTestId("return-method")).not.toBeInTheDocument();
        expect(screen.getByTestId("return-usd")).toBeInTheDocument();
        expect(screen.getByTestId("return-lbp")).toBeInTheDocument();
      });
    });

    describe("smartSplitOverpay (opt-in)", () => {
      it("splits an overpaid USD amount into integer USD notes + LBP remainder", () => {
        render(
          <MultiPaymentInput
            totals={[{ amount: 100, currency: "USD" }]}
            currency="USD"
            totalAmountCurrency="USD"
            hasClient={false}
            requiresClientForDebt={true}
            paymentMethods={PAYMENT_METHODS}
            currencies={CURRENCIES}
            exchangeRate={EXCHANGE_RATE}
            showDiscount={false}
            onChange={jest.fn()}
            smartSplitOverpay={true}
          />,
        );

        const firstAmount = document.querySelector<HTMLInputElement>(
          '[data-testid^="payment-amount-"]',
        )!;
        // Overpay by $4.73 — without smartSplitOverpay this would seed a single
        // "4.73" USD lump; with it, integer USD + LBP-bill-rounded remainder.
        fireEvent.change(firstAmount, { target: { value: "104.73" } });

        // 0.73 * 90000 = 65,700 → rounds up to nearest 5,000 → 70,000.
        expect(screen.getByTestId("return-usd")).toHaveValue("4");
        expect(screen.getByTestId("return-lbp")).toHaveValue("70000");
      });
    });

    describe("retained business-logic assertions", () => {
      // Lightweight derivations kept from the original logic-only test — they
      // mirror the component's internal calculations and read well as a spec.
      it("sums payment line amounts into a total paid", () => {
        const lines: PaymentLine[] = [
          { id: "1", method: "CASH", currencyCode: "USD", amount: 50 },
          { id: "2", method: "OMT", currencyCode: "USD", amount: 30 },
        ];
        const totalPaid = lines.reduce((sum, l) => sum + (l.amount || 0), 0);
        expect(totalPaid).toBe(80);
      });

      it("detects a CUSTOMER_ACCOUNT line in a payment set", () => {
        const lines: PaymentLine[] = [
          {
            id: "1",
            method: "CUSTOMER_ACCOUNT",
            currencyCode: "USD",
            amount: 100,
          },
        ];
        expect(lines.some((l) => l.method === "CUSTOMER_ACCOUNT")).toBe(true);
      });
    });

    describe("characterization — rate-driven conversion (current contract)", () => {
      // These pin the CURRENT cross-currency math so the engine rewire (MCP-2,
      // docs/plans/done_plans/MULTI_CURRENCY_PAYMENT_PLAN.md) can prove zero behavior
      // change. For a genuinely single-currency total (e.g. a POS sale
      // denominated in USD), re-deriving the other currency's amount from the
      // rate IS correct — these tests must stay green through every phase.

      it("converts a single-mode currency switch at the edited rate, not the prop rate", () => {
        renderMpi({ totalAmount: 100 });

        // The rate box shows only once LBP is in play (owner 2026-11-01):
        // bring LBP in, edit the rate, and go back to USD before the switch
        // under test.
        switchFirstLineTo("LBP");
        setRate("100,000");
        switchFirstLineTo("USD");
        expect(firstAmountInput().value).toBe("100");

        switchFirstLineTo("LBP");

        // 100 USD × 100,000 (edited) — not × 90,000 (prop).
        expect(firstAmountInput().value).toBe("10,000,000");
      });

      it("re-syncs a cross-currency single line when the rate is edited", () => {
        renderMpi({ totalAmount: 100 });

        const id = firstLineId();
        fireEvent.change(screen.getByTestId(`payment-currency-${id}`), {
          target: { value: "LBP" },
        });
        expect(firstAmountInput().value).toBe("9,000,000"); // 100 × 90,000

        setRate("100,000");
        expect(firstAmountInput().value).toBe("10,000,000"); // 100 × 100,000
      });

      it("stops re-syncing once the amount was manually edited (overpayment preserved)", () => {
        renderMpi({ totalAmount: 100 });

        const id = firstLineId();
        fireEvent.change(screen.getByTestId(`payment-currency-${id}`), {
          target: { value: "LBP" },
        });
        fireEvent.change(firstAmountInput(), { target: { value: "8000000" } });
        expect(firstAmountInput().value).toBe("8,000,000");

        setRate("100,000");
        // Touched line is NOT re-derived to 10,000,000.
        expect(firstAmountInput().value).toBe("8,000,000");
      });

      it("emits the rate via onExchangeRateChange on mount and on every edit", () => {
        const onExchangeRateChange: RateMock = jest.fn();
        renderMpi({ onExchangeRateChange });

        // Mount effect reports the prop rate (Debts seeds repayModalRate off this).
        expect(onExchangeRateChange).toHaveBeenCalledWith(EXCHANGE_RATE);

        switchFirstLineTo("LBP"); // the box shows only once LBP is in play
        setRate("95,000");
        expect(onExchangeRateChange).toHaveBeenLastCalledWith(95000);
      });
    });

    describe("rate field manual-edit protection (async rate-fetch race)", () => {
      // Caller pages commonly seed the `exchangeRate` prop from an async
      // rate-fetch hook (e.g. useSellRate for Recharge forms) that starts at a
      // fallback and overwrites itself once its own fetch resolves. Before this
      // fix, the "sync custom rate from prop" effect had no touched-guard (unlike
      // the analogous singleAmountTouchedRef for the amount field) and re-fired
      // on every exchangeRate prop change — silently discarding an operator's
      // manually typed rate, and the value reported to the parent via
      // onExchangeRateChange, the instant the late fetch resolved.
      // Proven failing-first on the pre-fix code (rule 17).
      it("keeps the operator's manually-typed rate when exchangeRate changes afterward (late async resolve)", () => {
        const onExchangeRateChange: RateMock = jest.fn();
        const ui = (rate: number) => (
          <MultiPaymentInput
            totals={[{ amount: 100, currency: "USD" }]}
            currency="USD"
            totalAmountCurrency="USD"
            hasClient={false}
            requiresClientForDebt={true}
            paymentMethods={PAYMENT_METHODS}
            currencies={CURRENCIES}
            exchangeRate={rate}
            showDiscount={false}
            onChange={jest.fn()}
            onExchangeRateChange={onExchangeRateChange}
          />
        );
        const { rerender } = render(ui(90_000));

        // Operator pays in LBP and types a custom rate before the "live" rate
        // fetch resolves (the box shows only once LBP is in play).
        switchFirstLineTo("LBP");
        setRate("89,000");
        expect(onExchangeRateChange).toHaveBeenLastCalledWith(89000);

        // The caller's async rate-fetch hook resolves late with a slightly
        // different live rate — this is the trigger condition for the bug.
        rerender(ui(90_500));

        // The operator's edit must survive — not be clobbered by the new prop.
        expect(screen.getByTestId("payment-exchange-rate")).toHaveValue(
          "89,000",
        );
        expect(onExchangeRateChange).toHaveBeenLastCalledWith(89000);
      });

      it("still seeds the rate field from the prop on the FIRST render (mount-sync unaffected)", () => {
        const onExchangeRateChange: RateMock = jest.fn();
        // A USD + LBP debt, so the box is there on the first render.
        renderMpi({
          exchangeRate: 91_000,
          onExchangeRateChange,
          totals: [
            { amount: 50, currency: "USD" },
            { amount: 600_000, currency: "LBP" },
          ],
        });

        expect(screen.getByTestId("payment-exchange-rate")).toHaveValue(
          "91,000",
        );
        expect(onExchangeRateChange).toHaveBeenCalledWith(91000);
      });
    });

    describe("T2 — native-LBP total round-tripped through the USD scalar (bug proof)", () => {
      // Sprint task T2 (docs/tickets/CURRENT_SPRINT.md), owner repro 2026-07-12:
      // a 600,000 LBP debt opened at rate 89,000 showed 606,742 after editing
      // the rate to 90,000 — the native-LBP amount was re-derived from the USD
      // scalar (600000/89000 × 90000). Fixed in MCP-3 by feeding per-currency
      // `totals` (docs/plans/done_plans/MULTI_CURRENCY_PAYMENT_PLAN.md). The rule-17
      // failing-first proof lived here as an `it.failing` against the scalar
      // `totalAmount` prop until MCP-5 deleted that prop (its documented death;
      // see the plan for the recorded 600,000 → 606,742 failure output).

      // The PERMANENT regression guard — mirrors the fixed Debts modal wiring
      // (per-currency totals). Proven failing-first on the pre-fix code (rule 17).
      it("totals contract: keeps a pure-LBP debt prefill invariant under rate edits", () => {
        const { rerender } = renderMpi({
          totals: [{ amount: 600_000, currency: "LBP" }],
          exchangeRate: 89_000,
          initialLines: [{ currencyCode: "LBP", amount: 600_000 }],
        });

        expect(firstAmountInput().value).toBe("600,000");

        // Owner 2026-11-01: a pure-LBP window has no "1 USD = … LBP" box, so
        // the rate cannot be edited here; a changed shop rate must still leave
        // the debt alone.
        expect(screen.queryByTestId("payment-exchange-rate")).toBeNull();
        rerender(
          <MultiPaymentInput
            totals={[{ amount: 600_000, currency: "LBP" }]}
            currency="USD"
            totalAmountCurrency="USD"
            hasClient={false}
            requiresClientForDebt={true}
            autoDebtRemainder={false}
            paymentMethods={PAYMENT_METHODS}
            currencies={CURRENCIES}
            exchangeRate={90_000}
            initialLines={[{ currencyCode: "LBP", amount: 600_000 }]}
            showDiscount={false}
            onChange={jest.fn()}
          />,
        );

        // The debt is 600,000 LBP regardless of the rate — paying LBP against
        // an LBP debt involves no exchange.
        expect(firstAmountInput().value).toBe("600,000");
        expect(screen.getByTestId("payment-summary")).toBeInTheDocument();
      });

      it("totals contract: a mixed USD+LBP debt only re-derives the USD part on rate edits", () => {
        // $50 + 600,000 LBP, seeded per currency (split mode, like the modal).
        renderMpi({
          totals: [
            { amount: 50, currency: "USD" },
            { amount: 600_000, currency: "LBP" },
          ],
          exchangeRate: 89_000,
          initialLines: [
            { currencyCode: "USD", amount: 50 },
            { currencyCode: "LBP", amount: 600_000 },
          ],
        });

        const amounts = () =>
          Array.from(
            document.querySelectorAll<HTMLInputElement>(
              '[data-testid^="payment-amount-"]',
            ),
          ).map((i) => i.value);
        expect(amounts()).toEqual(["50", "600,000"]);

        setRate("90,000");

        // Split-mode seeded lines are never auto-rewritten; the native LBP
        // figure in particular must not budge.
        expect(amounts()).toEqual(["50", "600,000"]);
      });
    });

    describe("kept change (T3 — the shop keeps what it does not hand back)", () => {
      // docs/plans/done_plans/T3_KEEP_CHANGE_PLAN.md KC-0, as changed by the
      // owner decision of 2026-10-06: the "Keep change" button is gone. Handing
      // back LESS than the change due (down to nothing — both fields cleared)
      // keeps the gap as profit automatically. Rewritten from the button-tap
      // versions (rule 24); the new behaviour's failing-first guard is
      // MultiPaymentInput.autoKeepChange.test.tsx.
      function renderOverpaid(opts: {
        onKeptChange: jest.Mock;
        onReturnChange: jest.Mock;
        smartSplitOverpay?: boolean;
      }) {
        render(
          <MultiPaymentInput
            totals={[{ amount: 100, currency: "USD" }]}
            currency="USD"
            totalAmountCurrency="USD"
            hasClient={false}
            requiresClientForDebt={true}
            paymentMethods={PAYMENT_METHODS}
            currencies={CURRENCIES}
            exchangeRate={EXCHANGE_RATE}
            showDiscount={false}
            onChange={jest.fn()}
            onReturnChange={
              opts.onReturnChange as unknown as (legs: PaymentLine[]) => void
            }
            onKeptChange={
              opts.onKeptChange as unknown as (
                kept: {
                  usd: number;
                  lbp: number;
                  exactUsd: number;
                  exactLbp: number;
                } | null,
              ) => void
            }
            cashOnlyReturn={true}
            {...(opts.smartSplitOverpay ? { smartSplitOverpay: true } : {})}
          />,
        );
      }

      /** Hand back nothing: both change fields emptied. */
      function clearReturn() {
        fireEvent.change(screen.getByTestId("return-usd"), {
          target: { value: "" },
        });
        fireEvent.change(screen.getByTestId("return-lbp"), {
          target: { value: "" },
        });
      }

      it("never renders a Keep change button — not even once the customer overpays", () => {
        const onKeptChange = jest.fn();
        const onReturnChange = jest.fn();
        renderOverpaid({ onKeptChange, onReturnChange });

        // Exact payment (auto-filled) → no return block, no button.
        expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
        fireEvent.change(firstAmountInput(), { target: { value: "150" } });
        expect(screen.getByTestId("return-change")).toBeInTheDocument();
        expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
      });

      it("OPT-IN: without onKeptChange an under-return is flagged 'not covered' and nothing is kept", () => {
        // Consumers whose backend doesn't accept kept_change_* do not wire
        // onKeptChange — the server would reject the unbalanced legs, so the
        // cashier must still see the red warning there.
        renderMpi({ totalAmount: 100 });
        fireEvent.change(firstAmountInput(), { target: { value: "150" } });
        clearReturn();

        expect(screen.getByTestId("payment-summary")).toBeInTheDocument();
        expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
        expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
          "of the change is not covered",
        );
        expect(
          screen.queryByTestId("keep-change-summary"),
        ).not.toBeInTheDocument();
      });

      it("clearing the return drops the OUT legs and reports the kept amounts; returning the full change again clears it", () => {
        const onKeptChange = jest.fn();
        const onReturnChange = jest.fn();
        renderOverpaid({ onKeptChange, onReturnChange });

        // Overpay $150 on a $100 total → $50 suggested change.
        fireEvent.change(firstAmountInput(), { target: { value: "150" } });
        expect(screen.getByTestId("return-usd")).toHaveValue("50.00");
        // Untouched seed → nothing kept.
        expect(onKeptChange).toHaveBeenLastCalledWith(null);

        clearReturn();

        // No OUT legs — the drawer keeps the full tender…
        const lastLegs = onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        expect(lastLegs).toEqual([]);
        // …and the kept split is reported for the profit stamp: `usd`/`lbp`
        // are the rounded DISPLAY figure, `exactUsd`/`exactLbp` the unrounded
        // accounting figure a cross-currency consumer (e.g. debt reduction)
        // must use instead (owner note #8, 2026-09-23). $150 - $100 is exact
        // in both forms here — no float dust to speak of.
        expect(onKeptChange).toHaveBeenLastCalledWith({
          usd: 50,
          lbp: 0,
          exactUsd: 50,
          exactLbp: 0,
        });

        // Hand the full change back: OUT leg returns, kept cleared.
        fireEvent.change(screen.getByTestId("return-usd"), {
          target: { value: "50" },
        });
        expect(onKeptChange).toHaveBeenLastCalledWith(null);
        const restored = onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        expect(
          restored.some((l) => l.direction === "OUT" && l.amount === 50),
        ).toBe(true);
      });

      it("reports the kept amounts in the TENDER currency, not the smart-split return suggestion", () => {
        const onKeptChange = jest.fn();
        const onReturnChange = jest.fn();
        renderOverpaid({
          onKeptChange,
          onReturnChange,
          smartSplitOverpay: true,
        });

        // Overpay $104.73 on $100 → the RETURN suggestion smart-splits into
        // 4 USD notes + 70,000 LBP (drawer convenience)…
        fireEvent.change(firstAmountInput(), { target: { value: "104.73" } });
        expect(screen.getByTestId("return-usd")).toHaveValue("4");
        expect(screen.getByTestId("return-lbp")).toHaveValue("70000");

        clearReturn();

        // …but KEEPING is physical: the drawer holds the excess tender itself —
        // $4.73 USD (what the customer overpaid in), no LBP involved. A
        // cross-denominated kept split corrupts per-currency netting (lira-107).
        const lastKept = onKeptChange.mock.calls.at(-1)?.[0] as {
          usd: number;
          lbp: number;
          exactUsd: number;
          exactLbp: number;
        };
        expect(lastKept.usd).toBe(4.73);
        expect(lastKept.lbp).toBe(0);
        // Exact (unrounded) companion — float subtraction dust (104.73 - 100)
        // included, deliberately NOT snapped to 4.73: this is exactly the
        // figure a cross-currency accounting consumer must use instead of the
        // rounded `usd` above (owner note #8).
        expect(lastKept.exactUsd).toBeCloseTo(4.73, 9);
        expect(lastKept.exactLbp).toBe(0);
        expect(onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[]).toEqual(
          [],
        );
      });
    });

    // LIRA-084 (owner decision 2026-10-02) — keeping is PARTIAL, per currency,
    // instead of all-or-nothing; since 2026-10-06 it is automatic (no button):
    // what the fields hold goes back, the rest is kept. Rule 17 disclosure: the
    // original LIRA-084 guards were written AFTER that fix (not proven
    // failing-first); rewritten here for the automatic behaviour (rule 24).
    describe("partial kept change (LIRA-084, automatic since 2026-10-06)", () => {
      function renderOverpaid(opts: {
        onKeptChange: jest.Mock;
        onReturnChange: jest.Mock;
      }) {
        render(
          <MultiPaymentInput
            totals={[{ amount: 100, currency: "USD" }]}
            currency="USD"
            totalAmountCurrency="USD"
            hasClient={false}
            requiresClientForDebt={true}
            paymentMethods={PAYMENT_METHODS}
            currencies={CURRENCIES}
            exchangeRate={EXCHANGE_RATE}
            showDiscount={false}
            onChange={jest.fn()}
            onReturnChange={
              opts.onReturnChange as unknown as (legs: PaymentLine[]) => void
            }
            onKeptChange={
              opts.onKeptChange as unknown as (
                kept: {
                  usd: number;
                  lbp: number;
                  exactUsd: number;
                  exactLbp: number;
                } | null,
              ) => void
            }
            cashOnlyReturn={true}
          />,
        );
      }

      it("an untouched seed returns the whole change and keeps nothing; clearing it keeps everything", () => {
        const onKeptChange = jest.fn();
        const onReturnChange = jest.fn();
        renderOverpaid({ onKeptChange, onReturnChange });

        fireEvent.change(firstAmountInput(), { target: { value: "150" } });
        expect(screen.getByTestId("return-usd")).toHaveValue("50.00");
        expect(onKeptChange).toHaveBeenLastCalledWith(null);

        fireEvent.change(screen.getByTestId("return-usd"), {
          target: { value: "" },
        });
        expect(onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[]).toEqual(
          [],
        );
        expect(onKeptChange).toHaveBeenLastCalledWith({
          usd: 50,
          lbp: 0,
          exactUsd: 50,
          exactLbp: 0,
        });
      });

      // A FULL keep (nothing handed back) keeps the pre-LIRA-084 feedback the
      // operator relies on (lira-107's debt-repayment e2e asserts this exact
      // text), plus the green "Keeping … as profit." line.
      it("full keep (nothing handed back) shows 'Change kept (profit)' and the green note without the 'rest is returned' tail", () => {
        const onKeptChange = jest.fn();
        const onReturnChange = jest.fn();
        renderOverpaid({ onKeptChange, onReturnChange });

        fireEvent.change(firstAmountInput(), { target: { value: "150" } });
        fireEvent.change(screen.getByTestId("return-usd"), {
          target: { value: "" },
        });

        expect(screen.getByText("Change kept (profit)")).toBeInTheDocument();
        expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
          /^Keeping \$50\.00 \| 4,500,000 LBP as profit\.$/,
        );
      });

      it("owner's own example: 140,000 LBP change, return 100,000 and keep 40,000 — the OUT leg carries only the returned amount", () => {
        const onKeptChange = jest.fn();
        const onReturnChange = jest.fn();
        render(
          <MultiPaymentInput
            totals={[{ amount: 100000, currency: "LBP" }]}
            currency="LBP"
            totalAmountCurrency="LBP"
            hasClient={false}
            requiresClientForDebt={true}
            paymentMethods={PAYMENT_METHODS}
            currencies={CURRENCIES}
            exchangeRate={EXCHANGE_RATE}
            showDiscount={false}
            onChange={jest.fn()}
            onReturnChange={
              onReturnChange as unknown as (legs: PaymentLine[]) => void
            }
            onKeptChange={
              onKeptChange as unknown as (
                kept: {
                  usd: number;
                  lbp: number;
                  exactUsd: number;
                  exactLbp: number;
                } | null,
              ) => void
            }
            cashOnlyReturn={true}
          />,
        );

        // Tender 240,000 LBP against a 100,000 LBP total → 140,000 LBP change.
        fireEvent.change(firstAmountInput(), { target: { value: "240000" } });
        expect(screen.getByTestId("return-lbp")).toHaveValue("140000");

        // Operator lowers the return to what they actually hand back.
        fireEvent.change(screen.getByTestId("return-lbp"), {
          target: { value: "100000" },
        });

        const lastLegs = onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        expect(lastLegs).toEqual([
          expect.objectContaining({
            method: "CASH",
            currencyCode: "LBP",
            amount: 100000,
            direction: "OUT",
          }),
        ]);
        expect(onKeptChange).toHaveBeenLastCalledWith({
          usd: 0,
          lbp: 40000,
          exactUsd: 0,
          exactLbp: 40000,
        });
        expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
          "Keeping $0.44 | 40,000 LBP as profit — the rest is returned above.",
        );
      });

      it("returning the whole change keeps nothing — the OUT leg carries all of it", () => {
        const onKeptChange = jest.fn();
        const onReturnChange = jest.fn();
        renderOverpaid({ onKeptChange, onReturnChange });

        // $104.73 tendered on a $100 total; no smart-split prop here, so the
        // auto-seed puts the whole $4.73 on the USD field.
        fireEvent.change(firstAmountInput(), { target: { value: "104.73" } });
        fireEvent.change(screen.getByTestId("return-usd"), {
          target: { value: "4.73" },
        });

        const lastLegs = onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        expect(lastLegs).toEqual([
          expect.objectContaining({
            currencyCode: "USD",
            amount: 4.73,
            direction: "OUT",
          }),
        ]);
        expect(onKeptChange).toHaveBeenLastCalledWith(null);
        expect(
          screen.queryByTestId("keep-change-summary"),
        ).not.toBeInTheDocument();
      });

      it("a typed return bigger than the actual change is flagged red — it is never kept change", () => {
        const onKeptChange = jest.fn();
        const onReturnChange = jest.fn();
        renderOverpaid({ onKeptChange, onReturnChange });

        fireEvent.change(firstAmountInput(), { target: { value: "150" } });
        // Operator fat-fingers a return bigger than the $50 actually received.
        fireEvent.change(screen.getByTestId("return-usd"), {
          target: { value: "9999" },
        });

        expect(onKeptChange).toHaveBeenLastCalledWith(null);
        expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
          "more than the customer overpaid",
        );
        expect(
          screen.queryByTestId("keep-change-summary"),
        ).not.toBeInTheDocument();
      });

      it("'$' (return-all-usd) after a partial return restores the full return and clears the kept amount", () => {
        const onKeptChange = jest.fn();
        const onReturnChange = jest.fn();
        renderOverpaid({ onKeptChange, onReturnChange });

        fireEvent.change(firstAmountInput(), { target: { value: "150" } });
        fireEvent.change(screen.getByTestId("return-usd"), {
          target: { value: "20" },
        });
        expect(onKeptChange).toHaveBeenLastCalledWith(
          expect.objectContaining({ usd: 30 }),
        );
        fireEvent.click(screen.getByTestId("return-all-usd"));

        expect(screen.getByTestId("return-usd")).toHaveValue("50.00");
        expect(onKeptChange).toHaveBeenLastCalledWith(null);
        const restored = onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        expect(
          restored.some((l) => l.direction === "OUT" && l.amount === 50),
        ).toBe(true);
      });

      // Was a StrictMode guard on the toggle's updater side effects; the toggle
      // is gone, so it now pins that under StrictMode an under-return is
      // always reported as kept (green note), never as "not covered".
      it("under StrictMode, clearing and restoring the return twice flips cleanly between kept and returned, never 'not covered'", () => {
        const onKeptChange = jest.fn();
        render(
          <StrictMode>
            <MultiPaymentInput
              totals={[{ amount: 100, currency: "USD" }]}
              currency="USD"
              totalAmountCurrency="USD"
              hasClient={false}
              requiresClientForDebt={true}
              paymentMethods={PAYMENT_METHODS}
              currencies={CURRENCIES}
              exchangeRate={EXCHANGE_RATE}
              showDiscount={false}
              onChange={jest.fn()}
              onReturnChange={jest.fn()}
              onKeptChange={onKeptChange}
              cashOnlyReturn={true}
            />
          </StrictMode>,
        );
        fireEvent.change(firstAmountInput(), { target: { value: "151.01" } });
        expect(screen.getByTestId("return-usd")).toHaveValue("51.01");
        for (let i = 0; i < 2; i++) {
          fireEvent.change(screen.getByTestId("return-usd"), {
            target: { value: "" },
          });
          expect(screen.getByTestId("keep-change-summary")).toBeInTheDocument();
          expect(onKeptChange).toHaveBeenLastCalledWith(
            expect.objectContaining({ usd: 51.01 }),
          );
          fireEvent.click(screen.getByTestId("return-all-usd"));
          expect(screen.getByTestId("return-usd")).toHaveValue("51.01");
          expect(onKeptChange).toHaveBeenLastCalledWith(null);
          expect(
            screen.queryByText(/of the change is not covered/),
          ).not.toBeInTheDocument();
        }
      });

      // 2026-10-13 (owner, compact change box): Customer Account is no longer
      // a return METHOD (the change box's Account button does that job), so
      // this case now hands the change back by OMT — still a non-CASH method
      // whose full leg posts to it — and guards that CUSTOMER_ACCOUNT is not
      // offered. Rewritten after the fix: not proven failing-first (rule 17).
      it("keeping only applies to a CASH return — a non-CASH method (OMT) already routes its full leg to that method; CUSTOMER_ACCOUNT is not a return method", () => {
        const onKeptChange = jest.fn();
        const onReturnChange = jest.fn();
        render(
          <MultiPaymentInput
            totals={[{ amount: 100, currency: "USD" }]}
            currency="USD"
            totalAmountCurrency="USD"
            hasClient={true}
            requiresClientForDebt={true}
            paymentMethods={PAYMENT_METHODS}
            currencies={CURRENCIES}
            exchangeRate={EXCHANGE_RATE}
            showDiscount={false}
            onChange={jest.fn()}
            onReturnChange={
              onReturnChange as unknown as (legs: PaymentLine[]) => void
            }
            onKeptChange={
              onKeptChange as unknown as (
                kept: {
                  usd: number;
                  lbp: number;
                  exactUsd: number;
                  exactLbp: number;
                } | null,
              ) => void
            }
          />,
        );

        fireEvent.change(firstAmountInput(), { target: { value: "150" } });
        const methodSelect =
          screen.getByTestId<HTMLSelectElement>("return-method");
        expect(
          Array.from(methodSelect.options).map((o) => o.value),
        ).not.toContain("CUSTOMER_ACCOUNT");
        fireEvent.change(methodSelect, { target: { value: "OMT" } });

        expect(screen.queryByTestId("keep-change")).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("keep-change-summary"),
        ).not.toBeInTheDocument();
        expect(onKeptChange).toHaveBeenLastCalledWith(null);
        // The full $50 routes to the OMT leg — nothing kept.
        const lastLegs = onReturnChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        expect(
          lastLegs.some(
            (l) =>
              l.method === "OMT" && l.amount === 50 && l.direction === "OUT",
          ),
        ).toBe(true);
        expect(lastLegs.some((l) => l.method === "CUSTOMER_ACCOUNT")).toBe(
          false,
        );
      });
    });

    describe("EUR-readiness (MCP-5 acceptance)", () => {
      // The design's acceptance test: adding a currency is DATA — a registry/
      // rate-table entry — with zero component changes. A EUR total prefill is
      // native, and the USD↔LBP header rate field cannot touch it.
      it("a EUR total prefills natively and is invariant to the LBP header rate", () => {
        const ui = (rate: number) => (
          <MultiPaymentInput
            totals={[{ amount: 90, currency: "EUR" }]}
            rateTable={{
              base: "USD",
              rates: {
                LBP: { buy: 89_000, sell: 89_500 },
                EUR: { buy: 0.9, sell: 0.92 },
              },
            }}
            side="buy"
            currency="EUR"
            totalAmountCurrency="EUR"
            hasClient={false}
            requiresClientForDebt={true}
            paymentMethods={PAYMENT_METHODS}
            currencies={[...CURRENCIES, { code: "EUR", symbol: "€" }]}
            exchangeRate={rate}
            showDiscount={false}
            onChange={jest.fn()}
          />
        );
        const { rerender } = render(ui(89_000));

        expect(firstAmountInput().value).toBe("90");

        // Owner 2026-11-01: an EUR-only window has no "1 USD = … LBP" box. The
        // USD↔LBP rate still cannot touch EUR math when it changes.
        expect(screen.queryByTestId("payment-exchange-rate")).toBeNull();
        rerender(ui(100_000));
        expect(firstAmountInput().value).toBe("90");
      });
    });

    describe("auto-debt remainder (real incident: $315 WHISH send, $300 typed as cash)", () => {
      // Owner-reported 2026-07-15: a $315 send, operator typed "$300" intending
      // "$300 cash + $15 debt". Single-payment mode discarded the typed amount —
      // only the method + the FULL total ever reached the backend — so the
      // whole $315 was silently charged to CUSTOMER_ACCOUNT with zero cash
      // recorded. Fix: the instant an edit creates a shortfall, materialize a
      // live remainder leg — synchronously, so onChange is correct even before
      // any debounced reveal (a fast Enter/Pay must not race the visual
      // split-toggle animation, the same class of bug as the SearchBar A5 fix).
      //
      // OPT-IN (post-review hardening): the feature fires ONLY when the
      // consumer passes autoDebtRemainder={<its validated charge predicate>} —
      // hasClient alone proved polysemous across consumers (name-only in some,
      // cashout-credit semantics on RECEIVE flows) and produced sign inversions.
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      it("OPT-IN default: without autoDebtRemainder, underpayment never auto-splits even with a client", () => {
        const { onChange } = renderMpi({ totalAmount: 315, hasClient: true });

        fireEvent.change(firstAmountInput(), { target: { value: "300" } });
        act(() => {
          jest.advanceTimersByTime(1000);
        });

        expect(onChange.mock.calls.at(-1)?.[0] as PaymentLine[]).toHaveLength(
          1,
        );
        expect(allLines()).toHaveLength(1);
        expect(
          within(screen.getByTestId("payment-summary")).getByText(
            /Remaining \(Debt\)/i,
          ),
        ).toBeInTheDocument();
      });

      it("emits a 2-leg payload IMMEDIATELY on underpayment — no wait for the visual reveal", () => {
        const { onChange } = renderMpi({
          totalAmount: 315,
          hasClient: true,
          autoDebtRemainder: true,
        });

        fireEvent.change(firstAmountInput(), { target: { value: "300" } });

        // No jest.advanceTimersByTime — this is the exact moment a fast
        // confirm click would read the parent's state. Pre-fix this would be
        // [{ CASH, 300 }], silently dropping the $15 debt on submit.
        const lastLines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        expect(lastLines).toHaveLength(2);
        expect(lastLines[0]).toMatchObject({ method: "CASH", amount: 300 });
        expect(lastLines[1]).toMatchObject({
          method: "CUSTOMER_ACCOUNT",
          currencyCode: "USD",
          amount: 15,
        });
      });

      it("does NOT auto-split without a chargeable client — keeps the honest Remaining (Debt) warning", () => {
        const { onChange } = renderMpi({
          totalAmount: 315,
          hasClient: false,
          autoDebtRemainder: true,
        });

        fireEvent.change(firstAmountInput(), { target: { value: "300" } });

        const lastLines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        expect(lastLines).toHaveLength(1);
        expect(
          within(screen.getByTestId("payment-summary")).getByText(
            /Remaining \(Debt\)/i,
          ),
        ).toBeInTheDocument();
      });

      it("does NOT auto-split when CUSTOMER_ACCOUNT isn't an offered payment method (Settings toggle off)", () => {
        const onChange = jest.fn();
        render(
          <MultiPaymentInput
            totals={[{ amount: 315, currency: "USD" }]}
            currency="USD"
            totalAmountCurrency="USD"
            hasClient={true}
            requiresClientForDebt={true}
            autoDebtRemainder={true}
            paymentMethods={[
              { code: "CASH", label: "Cash" },
              { code: "OMT", label: "OMT" },
            ]}
            currencies={CURRENCIES}
            exchangeRate={EXCHANGE_RATE}
            showDiscount={false}
            onChange={onChange}
          />,
        );

        fireEvent.change(firstAmountInput(), { target: { value: "300" } });

        const lastLines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        expect(lastLines).toHaveLength(1);
      });

      it("leaves a lone CUSTOMER_ACCOUNT line's own reduced amount untouched (no second real-money method for the rest)", () => {
        const { onChange } = renderMpi({
          totalAmount: 315,
          hasClient: true,
          autoDebtRemainder: true,
        });

        const id = firstLineId();
        fireEvent.change(screen.getByTestId(`payment-method-${id}`), {
          target: { value: "CUSTOMER_ACCOUNT" },
        });
        fireEvent.change(firstAmountInput(), { target: { value: "300" } });

        const lastLines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        expect(lastLines).toHaveLength(1);
        expect(lastLines[0]).toMatchObject({
          method: "CUSTOMER_ACCOUNT",
          amount: 300,
        });
      });

      it("reveals the second row visually only ~500ms after the operator stops typing", () => {
        renderMpi({
          totalAmount: 315,
          hasClient: true,
          autoDebtRemainder: true,
        });

        fireEvent.change(firstAmountInput(), { target: { value: "300" } });
        // Data is already correct (previous test) but the UI hasn't flipped yet.
        expect(allLines()).toHaveLength(1);

        act(() => {
          jest.advanceTimersByTime(500);
        });

        expect(allLines()).toHaveLength(2);
      });

      it("keeps live-tracking the remainder as the first line keeps changing, until manually edited", () => {
        const { onChange } = renderMpi({
          totalAmount: 315,
          hasClient: true,
          autoDebtRemainder: true,
        });

        fireEvent.change(firstAmountInput(), { target: { value: "300" } });
        expect(
          (onChange.mock.calls.at(-1)?.[0] as PaymentLine[])[1],
        ).toMatchObject({ amount: 15 });

        fireEvent.change(firstAmountInput(), { target: { value: "280" } });
        expect(
          (onChange.mock.calls.at(-1)?.[0] as PaymentLine[])[1],
        ).toMatchObject({ amount: 35 });

        // Reveal, then edit the debt line directly — it detaches (frozen).
        act(() => {
          jest.advanceTimersByTime(500);
        });
        const debtLineEl = allLines()[1] as HTMLElement;
        const debtAmountInput =
          within(debtLineEl).getByTestId(/payment-amount-/);
        fireEvent.change(debtAmountInput, { target: { value: "50" } });

        fireEvent.change(firstAmountInput(), { target: { value: "200" } });
        const finalLines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        expect(finalLines[0]).toMatchObject({ amount: 200 });
        // Frozen at the manually-set 50 — NOT resized to 115.
        expect(finalLines[1]).toMatchObject({ amount: 50 });
      });

      it("removing the auto-added debt line clears tracking (no phantom resurrection)", () => {
        const { onChange } = renderMpi({
          totalAmount: 315,
          hasClient: true,
          autoDebtRemainder: true,
        });

        fireEvent.change(firstAmountInput(), { target: { value: "300" } });
        act(() => {
          jest.advanceTimersByTime(500);
        });
        expect(allLines()).toHaveLength(2);

        const secondLine = allLines()[1];
        const removeBtn = within(secondLine as HTMLElement).getByTitle(
          "Remove",
        );
        fireEvent.click(removeBtn);

        expect(allLines()).toHaveLength(1);
        const lastLines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        expect(lastLines).toHaveLength(1);
        expect(lastLines[0]).toMatchObject({ method: "CASH", amount: 300 });
      });

      // Review finding (code-review 2026-07-17): the withdraw branch used to
      // run BEFORE the touched-guard, silently deleting a manually edited debt
      // leg when the primary later covered the total. Fixed by detach-on-touch:
      // an edited auto leg becomes an ordinary manual line the effect never
      // deletes. Proven failing-first against the pre-fix effect ordering.
      it("a manually edited debt leg is NOT deleted when the primary later covers the total", () => {
        const { onChange } = renderMpi({
          totalAmount: 315,
          hasClient: true,
          autoDebtRemainder: true,
        });

        fireEvent.change(firstAmountInput(), { target: { value: "300" } });
        act(() => {
          jest.advanceTimersByTime(500);
        });

        // Operator takes ownership of the debt leg (deliberate $50 entry).
        const debtLineEl = allLines()[1] as HTMLElement;
        fireEvent.change(within(debtLineEl).getByTestId(/payment-amount-/), {
          target: { value: "50" },
        });

        // Primary now covers the whole total — the detached leg must survive.
        fireEvent.change(firstAmountInput(), { target: { value: "315" } });

        const lines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        expect(lines).toHaveLength(2);
        expect(lines[1]).toMatchObject({
          method: "CUSTOMER_ACCOUNT",
          amount: 50,
        });
        expect(allLines()).toHaveLength(2);
      });

      // Review finding: after an auto-reveal, covering the total removed the
      // debt leg but left the sheet stuck in a one-line "Split" UI. The
      // withdraw path now folds an AUTO-revealed split back to single mode
      // (a manually toggled split is never folded).
      it("auto-revealed split folds back to single mode when the primary covers the total", () => {
        renderMpi({
          totalAmount: 315,
          hasClient: true,
          autoDebtRemainder: true,
        });

        fireEvent.change(firstAmountInput(), { target: { value: "300" } });
        act(() => {
          jest.advanceTimersByTime(500);
        });
        expect(allLines()).toHaveLength(2);
        expect(screen.getByTestId("split-toggle")).toHaveTextContent(
          "Split Active",
        );

        fireEvent.change(firstAmountInput(), { target: { value: "315" } });

        expect(allLines()).toHaveLength(1);
        expect(screen.getByTestId("split-toggle")).not.toHaveTextContent(
          "Split Active",
        );
      });

      // Shop-day bug 13 (2026-10-17): picking a wallet on the OMT/Whish page
      // raises the total by the 1% payment-method fee (101 → 102). The
      // untouched single line must simply follow the new total. The auto-debt
      // effect ran in the same commit as the auto-sync, read the stale $101
      // line and pushed a $1 CUSTOMER_ACCOUNT leg on top — the page then saw
      // two lines, dropped its single-line method fee, and the server refused
      // the send ("expected $101.00 … got $102.00"). Failing-first.
      it("an untouched single line follows a raised total — no auto-debt leg (bug 13)", () => {
        const onChange: ChangeMock = jest.fn();
        const ui = (total: number) => (
          <MultiPaymentInput
            totals={[{ amount: total, currency: "USD" }]}
            currency="USD"
            totalAmountCurrency="USD"
            hasClient={true}
            requiresClientForDebt={true}
            autoDebtRemainder={true}
            paymentMethods={PAYMENT_METHODS}
            currencies={CURRENCIES}
            exchangeRate={EXCHANGE_RATE}
            showDiscount={false}
            onChange={onChange}
          />
        );
        const { rerender } = render(ui(101));
        fireEvent.change(
          screen.getByTestId(`payment-method-${firstLineId()}`),
          {
            target: { value: "OMT" },
          },
        );

        rerender(ui(102));
        act(() => {
          jest.advanceTimersByTime(1000);
        });

        const lines = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        expect(lines).toEqual([
          expect.objectContaining({ method: "OMT", amount: 102 }),
        ]);
        expect(allLines()).toHaveLength(1);
      });

      // Review finding: the effect's deps omitted the totals, so a total that
      // changed while the sheet was open left a stale debt-leg amount (an
      // underbooked shortfall). totalsKey is now a dependency.
      it("re-derives the debt leg when the totals prop changes mid-payment", () => {
        const onChange: ChangeMock = jest.fn();
        const ui = (total: number) => (
          <MultiPaymentInput
            totals={[{ amount: total, currency: "USD" }]}
            currency="USD"
            totalAmountCurrency="USD"
            hasClient={true}
            requiresClientForDebt={true}
            autoDebtRemainder={true}
            paymentMethods={PAYMENT_METHODS}
            currencies={CURRENCIES}
            exchangeRate={EXCHANGE_RATE}
            showDiscount={false}
            onChange={onChange}
          />
        );
        const { rerender } = render(ui(315));

        fireEvent.change(firstAmountInput(), { target: { value: "300" } });
        expect(
          (onChange.mock.calls.at(-1)?.[0] as PaymentLine[])[1],
        ).toMatchObject({ amount: 15 });

        rerender(ui(400));

        expect(
          (onChange.mock.calls.at(-1)?.[0] as PaymentLine[])[1],
        ).toMatchObject({ method: "CUSTOMER_ACCOUNT", amount: 100 });
      });
    });

    describe("counterFlow (opt-in, BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase C)", () => {
      // Owner decision #2: ONE payment form, a direction per line, never a
      // second form — a RECEIVE cashout's main lines are the shop's payout
      // ("You pay") while a counter-flow section collects a customer-paid fee
      // ("Customer pays"), in the SAME card. Proven failing-first (rule 17):
      // before the `counterFlow` prop existed, none of these testids/chips
      // rendered and the extra onChange was never called.
      interface CounterFlowRenderOpts {
        counterFlowOnChange: jest.Mock;
        totalAmount?: number;
        currency?: string;
        requiresClient?: boolean;
        hasClient?: boolean;
        // LIRA-321 additions
        payer?: "payout";
        label?: string;
        seedLines?: Array<{
          method: string;
          currencyCode: string;
          amount: number;
        }>;
        lockCurrency?: boolean;
        maxForgive?: number;
        onStateChange?: jest.Mock;
        /** Counter-flow method list (default PAYMENT_METHODS). */
        counterFlowMethods?: Array<{ code: string; label: string }>;
      }
      function counterFlowElement(
        opts: CounterFlowRenderOpts,
        mainOnChange: jest.Mock,
      ) {
        return (
          <MultiPaymentInput
            totals={[{ amount: 100, currency: "USD" }]}
            currency="USD"
            totalAmountCurrency="USD"
            hasClient={false}
            requiresClientForDebt={true}
            paymentMethods={PAYMENT_METHODS}
            currencies={CURRENCIES}
            exchangeRate={EXCHANGE_RATE}
            showDiscount={false}
            onChange={mainOnChange}
            {...(opts.payer ? { payer: opts.payer } : {})}
            {...(opts.label !== undefined ? { label: opts.label } : {})}
            counterFlow={{
              label: "Customer pays — OMT fee",
              totalAmount: opts.totalAmount ?? 5,
              currency: opts.currency ?? "USD",
              onChange: opts.counterFlowOnChange,
              paymentMethods: opts.counterFlowMethods ?? PAYMENT_METHODS,
              requiresClient: opts.requiresClient ?? true,
              hasClient: opts.hasClient ?? false,
              ...(opts.seedLines ? { seedLines: opts.seedLines } : {}),
              ...(opts.lockCurrency ? { lockCurrency: true } : {}),
              ...(opts.maxForgive !== undefined
                ? { maxForgive: opts.maxForgive }
                : {}),
              ...(opts.onStateChange
                ? { onStateChange: opts.onStateChange }
                : {}),
            }}
          />
        );
      }
      function renderWithCounterFlow(opts: CounterFlowRenderOpts) {
        const mainOnChange = jest.fn();
        const utils = render(counterFlowElement(opts, mainOnChange));
        const rerenderWith = (next: Partial<CounterFlowRenderOpts>) =>
          utils.rerender(
            counterFlowElement({ ...opts, ...next }, mainOnChange),
          );
        return { ...utils, mainOnChange, rerenderWith };
      }

      it("does not render the section or either chip when counterFlow is absent (regression)", () => {
        renderMpi();

        expect(
          screen.queryByTestId("counter-flow-section"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("direction-chip-you-pay"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("direction-chip-customer-pays"),
        ).not.toBeInTheDocument();
      });

      it("renders the section, both direction chips, and seeds one CASH line at totalAmount", () => {
        const counterFlowOnChange = jest.fn();
        // LIRA-321: payout screens read OUT / IN (testids unchanged).
        renderWithCounterFlow({
          counterFlowOnChange,
          totalAmount: 5,
          payer: "payout",
        });

        expect(screen.getByTestId("counter-flow-section")).toBeInTheDocument();
        expect(screen.getByTestId("direction-chip-you-pay")).toHaveTextContent(
          "OUT",
        );
        expect(
          screen.getByTestId("direction-chip-customer-pays"),
        ).toHaveTextContent("IN");
        expect(screen.getByText("Customer pays")).toBeInTheDocument();

        const amountInput = document.querySelector<HTMLInputElement>(
          '[data-testid^="counter-flow-amount-"]',
        );
        expect(amountInput?.value).toBe("5");

        const methodSelect = document.querySelector<HTMLSelectElement>(
          '[data-testid^="counter-flow-method-"]',
        );
        expect(methodSelect?.value).toBe("CASH");

        expect(counterFlowOnChange).toHaveBeenCalled();
        const lastLines = counterFlowOnChange.mock.calls.at(
          -1,
        )?.[0] as PaymentLine[];
        expect(lastLines).toEqual([
          expect.objectContaining({
            method: "CASH",
            currencyCode: "USD",
            amount: 5,
          }),
        ]);
      });

      it("emits counter-flow edits through counterFlow.onChange only — never contaminates the main onChange", () => {
        const counterFlowOnChange = jest.fn();
        const { mainOnChange } = renderWithCounterFlow({
          counterFlowOnChange,
          totalAmount: 5,
        });

        const mainCallsBefore = mainOnChange.mock.calls.length;

        const amountInput = document.querySelector<HTMLInputElement>(
          '[data-testid^="counter-flow-amount-"]',
        )!;
        fireEvent.change(amountInput, { target: { value: "3" } });

        const lastLines = counterFlowOnChange.mock.calls.at(
          -1,
        )?.[0] as PaymentLine[];
        expect(lastLines[0]).toMatchObject({ amount: 3 });

        // The main section's onChange must not have fired again from this edit.
        expect(mainOnChange.mock.calls.length).toBe(mainCallsBefore);
        // And the main line must still read the untouched payout amount (100),
        // proving the counter-flow edit never reached the main lines/totals.
        const mainAmountInput = document.querySelector<HTMLInputElement>(
          '[data-testid="payment-summary"]',
        );
        expect(mainAmountInput).toBeInTheDocument();
        const mainLastLines = mainOnChange.mock.calls.at(
          -1,
        )?.[0] as PaymentLine[];
        expect(mainLastLines).toHaveLength(1);
        expect(mainLastLines[0].amount).toBe(100);
      });

      it("does NOT add a CASH leftover by itself when less is typed and the account is not offered (LIRA-321 safety; was: auto CASH leftover)", () => {
        // Rule 24 rewrite: this used to assert an auto-added CASH leftover of 3.
        // That line booked cash the customer never handed over and let the
        // section balance — now nothing is added and the shortfall stays open.
        const counterFlowOnChange = jest.fn();
        renderWithCounterFlow({ counterFlowOnChange, totalAmount: 5 });

        const amountInput = document.querySelector<HTMLInputElement>(
          '[data-testid^="counter-flow-amount-"]',
        )!;
        fireEvent.change(amountInput, { target: { value: "2" } });

        const lines = document.querySelectorAll(
          '[data-testid^="counter-flow-line-"]',
        );
        expect(lines).toHaveLength(1);

        const lastLines = counterFlowOnChange.mock.calls.at(
          -1,
        )?.[0] as PaymentLine[];
        expect(lastLines).toHaveLength(1);
        expect(lastLines[0]).toMatchObject({ amount: 2 });
      });

      it("disables CUSTOMER_ACCOUNT in the counter-flow method list when requiresClient && !hasClient", () => {
        const counterFlowOnChange = jest.fn();
        renderWithCounterFlow({
          counterFlowOnChange,
          requiresClient: true,
          hasClient: false,
        });

        const methodSelect = document.querySelector<HTMLSelectElement>(
          '[data-testid^="counter-flow-method-"]',
        )!;
        const optionValues = Array.from(methodSelect.options).map(
          (o) => o.value,
        );
        expect(optionValues).not.toContain("CUSTOMER_ACCOUNT");
      });

      it("allows CUSTOMER_ACCOUNT in the counter-flow method list when hasClient is true", () => {
        const counterFlowOnChange = jest.fn();
        renderWithCounterFlow({
          counterFlowOnChange,
          requiresClient: true,
          hasClient: true,
        });

        const methodSelect = document.querySelector<HTMLSelectElement>(
          '[data-testid^="counter-flow-method-"]',
        )!;
        const optionValues = Array.from(methodSelect.options).map(
          (o) => o.value,
        );
        expect(optionValues).toContain("CUSTOMER_ACCOUNT");
      });

      // LIRA-321 step 1 — the leftover a customer did not pay goes on their
      // account by default. Before this, "+ Add line" always started the
      // leftover as CASH and the cashier had to switch it by hand.
      describe("leftover line method (LIRA-321 step 1)", () => {
        function addLeftoverAfterTyping(
          typed: string,
          opts: { requiresClient: boolean; hasClient: boolean },
        ): PaymentLine[] {
          const counterFlowOnChange = jest.fn();
          renderWithCounterFlow({
            counterFlowOnChange,
            totalAmount: 5,
            ...opts,
          });
          const amountInput = document.querySelector<HTMLInputElement>(
            '[data-testid^="counter-flow-amount-"]',
          )!;
          fireEvent.change(amountInput, { target: { value: typed } });
          // LIRA-321: a fully paid section stays in single mode, which has no
          // "+ Add line" — the cashier turns Split on first.
          if (!screen.queryByTestId("counter-flow-add-split")) {
            fireEvent.click(screen.getByTestId("counter-flow-split-toggle"));
          }
          fireEvent.click(screen.getByTestId("counter-flow-add-split"));
          return counterFlowOnChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        }

        it("starts the leftover as CUSTOMER_ACCOUNT when a client is linked", () => {
          const lines = addLeftoverAfterTyping("3", {
            requiresClient: true,
            hasClient: true,
          });
          expect(lines[1]).toMatchObject({
            method: "CUSTOMER_ACCOUNT",
            amount: 2,
          });
        });

        it("keeps the leftover as CASH when no client is linked", () => {
          const lines = addLeftoverAfterTyping("3", {
            requiresClient: true,
            hasClient: false,
          });
          expect(lines[1]).toMatchObject({ method: "CASH", amount: 2 });
        });

        it("keeps a new line as CASH when nothing is left over", () => {
          const lines = addLeftoverAfterTyping("5", {
            requiresClient: true,
            hasClient: true,
          });
          expect(lines[1]).toMatchObject({ method: "CASH", amount: 0 });
        });
      });

      // LIRA-321 (T008) — the "Customer pays" section becomes a real money-in
      // side: single vs split mode, its own Split button, a leftover line,
      // balance reporting, a currency lock, Forgive, and the payout layout.
      describe("Customer pays section — single/split, balance, payout layout (LIRA-321)", () => {
        type CfState = {
          paid: number;
          owedToAccount: number;
          forgiven: number;
          balanced: boolean;
          overpaid: boolean;
          needsClient: boolean;
          unaccounted: number;
        };
        const section = () => screen.getByTestId("counter-flow-section");
        const cfLines = () =>
          Array.from(
            document.querySelectorAll('[data-testid^="counter-flow-line-"]'),
          );
        const cfAmountInputs = () =>
          Array.from(
            document.querySelectorAll<HTMLInputElement>(
              '[data-testid^="counter-flow-amount-"]',
            ),
          );
        const cfMethodSelects = () =>
          Array.from(
            document.querySelectorAll<HTMLSelectElement>(
              '[data-testid^="counter-flow-method-"]',
            ),
          );
        const lastState = (m: jest.Mock): CfState =>
          m.mock.calls.at(-1)?.[0] as CfState;
        const typeFirst = (value: string) =>
          fireEvent.change(cfAmountInputs()[0], { target: { value } });

        it("(a) one seed line opens in single mode — no '+ Add line', no remove ×", () => {
          renderWithCounterFlow({ counterFlowOnChange: jest.fn() });
          expect(cfLines()).toHaveLength(1);
          expect(
            screen.queryByTestId("counter-flow-add-split"),
          ).not.toBeInTheDocument();
          expect(within(section()).queryByTitle("Remove")).toBeNull();
          expect(
            screen.getByTestId("counter-flow-split-toggle"),
          ).toHaveTextContent("Split");
        });

        it("(b) two seedLines open in split mode with both lines", () => {
          const counterFlowOnChange = jest.fn();
          renderWithCounterFlow({
            counterFlowOnChange,
            totalAmount: 105,
            seedLines: [
              { method: "OMT", currencyCode: "USD", amount: 100 },
              { method: "CASH", currencyCode: "USD", amount: 5 },
            ],
          });
          expect(cfLines()).toHaveLength(2);
          expect(
            screen.getByTestId("counter-flow-add-split"),
          ).toBeInTheDocument();
          expect(
            screen.getByTestId("counter-flow-split-toggle"),
          ).toHaveTextContent("Split Active");
          expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
            expect.objectContaining({ method: "OMT", amount: 100 }),
            expect.objectContaining({ method: "CASH", amount: 5 }),
          ]);
        });

        it("(c) typing less in single mode switches to split and adds the leftover as CUSTOMER_ACCOUNT when offered", () => {
          const counterFlowOnChange = jest.fn();
          renderWithCounterFlow({
            counterFlowOnChange,
            totalAmount: 50,
            hasClient: true,
          });
          typeFirst("30");
          expect(cfLines()).toHaveLength(2);
          expect(
            screen.getByTestId("counter-flow-add-split"),
          ).toBeInTheDocument();
          expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
            expect.objectContaining({ method: "CASH", amount: 30 }),
            expect.objectContaining({ method: "CUSTOMER_ACCOUNT", amount: 20 }),
          ]);
        });

        it("(c) the auto leftover keeps following the first line while untouched (account offered)", () => {
          const counterFlowOnChange = jest.fn();
          renderWithCounterFlow({
            counterFlowOnChange,
            totalAmount: 50,
            requiresClient: true,
            hasClient: true,
          });
          typeFirst("1"); // first keystroke
          typeFirst("12"); // second keystroke
          expect(cfLines()).toHaveLength(2);
          expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
            expect.objectContaining({ method: "CASH", amount: 12 }),
            expect.objectContaining({ method: "CUSTOMER_ACCOUNT", amount: 38 }),
          ]);
        });

        // LIRA-321 safety fix — with no client (CUSTOMER_ACCOUNT not offered)
        // the section used to auto-add a CASH leftover, balance itself, and
        // turn Confirm on: the drawer would book cash never handed over
        // (spec US1.3 / US2.6). Now nothing is added and the gap stays open.
        it("(l) no client: typing less stays single, adds NO cash line, and reports the gap", () => {
          const counterFlowOnChange = jest.fn();
          const onStateChange = jest.fn();
          renderWithCounterFlow({
            counterFlowOnChange,
            onStateChange,
            totalAmount: 50,
            requiresClient: true,
            hasClient: false,
            maxForgive: 5,
          });
          typeFirst("30");
          expect(cfLines()).toHaveLength(1);
          expect(
            screen.queryByTestId("counter-flow-add-split"),
          ).not.toBeInTheDocument();
          expect(
            screen.getByTestId("counter-flow-split-toggle"),
          ).not.toHaveTextContent("Split Active");
          expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
            expect.objectContaining({ method: "CASH", amount: 30 }),
          ]);
          expect(lastState(onStateChange)).toMatchObject({
            paid: 30,
            owedToAccount: 0,
            balanced: false,
            unaccounted: 20,
          });
          const hint = screen.getByTestId("counter-flow-unaccounted");
          expect(hint).toHaveTextContent(
            /Still to settle: 20(\.00)? USD — pick a client to put it on their account$/,
          );
          expect(hint).not.toHaveTextContent(/forgive/i);
        });

        it("(l) then picking a client adds the CUSTOMER_ACCOUNT leftover and balances", () => {
          const counterFlowOnChange = jest.fn();
          const onStateChange = jest.fn();
          const { rerenderWith } = renderWithCounterFlow({
            counterFlowOnChange,
            onStateChange,
            totalAmount: 50,
            requiresClient: true,
            hasClient: false,
          });
          typeFirst("30");
          rerenderWith({ hasClient: true });
          expect(cfLines()).toHaveLength(2);
          expect(
            screen.getByTestId("counter-flow-split-toggle"),
          ).toHaveTextContent("Split Active");
          expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
            expect.objectContaining({ method: "CASH", amount: 30 }),
            expect.objectContaining({ method: "CUSTOMER_ACCOUNT", amount: 20 }),
          ]);
          expect(lastState(onStateChange)).toMatchObject({
            paid: 30,
            owedToAccount: 20,
            balanced: true,
            unaccounted: 0,
          });
        });

        it("(l) unpicking the client drops the auto account line — never turns it into cash", () => {
          const counterFlowOnChange = jest.fn();
          const onStateChange = jest.fn();
          const { rerenderWith } = renderWithCounterFlow({
            counterFlowOnChange,
            onStateChange,
            totalAmount: 50,
            requiresClient: true,
            hasClient: true,
          });
          typeFirst("30");
          expect(cfLines()).toHaveLength(2);
          rerenderWith({ hasClient: false });
          expect(cfLines()).toHaveLength(1);
          expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
            expect.objectContaining({ method: "CASH", amount: 30 }),
          ]);
          expect(lastState(onStateChange)).toMatchObject({
            paid: 30,
            balanced: false,
            unaccounted: 20,
          });
        });

        // LIRA-365 US2 (owner 2026-11-01): Forgive is gone — the box has the
        // standard Discount line instead, so the hint only offers the client.
        it("(l) no client, shortfall within maxForgive: the hint offers the client; no Forgive, a Discount line", () => {
          renderWithCounterFlow({
            counterFlowOnChange: jest.fn(),
            totalAmount: 50,
            requiresClient: true,
            hasClient: false,
            maxForgive: 5,
          });
          typeFirst("47");
          expect(cfLines()).toHaveLength(1);
          expect(
            screen.getByTestId("counter-flow-unaccounted"),
          ).toHaveTextContent(
            /Still to settle: 3(\.00)? USD — pick a client to put it on their account$/,
          );
          expect(
            screen.queryByTestId("counter-flow-forgive"),
          ).not.toBeInTheDocument();
          expect(
            screen.getByTestId("counter-flow-discount"),
          ).toBeInTheDocument();
        });

        // Owner decision 2026-10-14: a caller that offers no account at all
        // (Exchange when the customer pays in EUR) must not tell the cashier
        // to pick a client — picking one would change nothing.
        it("(l) no account in the caller's methods: the hint never says 'pick a client'", () => {
          renderWithCounterFlow({
            counterFlowOnChange: jest.fn(),
            totalAmount: 50,
            requiresClient: true,
            hasClient: false,
            counterFlowMethods: PAYMENT_METHODS.filter(
              (m) => m.code !== "CUSTOMER_ACCOUNT",
            ),
          });
          typeFirst("30");
          const hint = screen.getByTestId("counter-flow-unaccounted");
          expect(hint).toHaveTextContent(/Still to settle: 20(\.00)? USD$/);
          expect(hint).not.toHaveTextContent(/pick a client/);
        });

        it("(l) with the account offered, the hint carries no 'pick a client' wording", () => {
          renderWithCounterFlow({
            counterFlowOnChange: jest.fn(),
            totalAmount: 50,
            requiresClient: true,
            hasClient: true,
          });
          typeFirst("30");
          // Rule 24 rewrite: this used to turn the auto account line into cash
          // and lower it — in split mode a gap with the account offered now
          // gets a new account leftover (LIRA-321 follow-up), so that edit no
          // longer leaves anything unsettled. Removing the account line does.
          const removes = within(section()).getAllByTitle("Remove");
          fireEvent.click(removes[1]);
          const hint = screen.getByTestId("counter-flow-unaccounted");
          expect(hint).toHaveTextContent(/Still to settle: 20(\.00)? USD$/);
        });

        it("(d) counter-flow-split-toggle switches single ↔ split; back to single re-seeds one full line", () => {
          const counterFlowOnChange = jest.fn();
          renderWithCounterFlow({ counterFlowOnChange, totalAmount: 5 });
          const toggle = () => screen.getByTestId("counter-flow-split-toggle");

          fireEvent.click(toggle());
          expect(toggle()).toHaveTextContent("Split Active");
          expect(
            screen.getByTestId("counter-flow-add-split"),
          ).toBeInTheDocument();
          typeFirst("2"); // in split mode: no auto-leftover, just one line of 2
          fireEvent.click(screen.getByTestId("counter-flow-add-split"));
          expect(cfLines()).toHaveLength(2);

          fireEvent.click(toggle());
          expect(toggle()).not.toHaveTextContent("Split Active");
          expect(cfLines()).toHaveLength(1);
          expect(
            screen.queryByTestId("counter-flow-add-split"),
          ).not.toBeInTheDocument();
          expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
            expect.objectContaining({ currencyCode: "USD", amount: 5 }),
          ]);
        });

        it("(e) onStateChange — exact amount is balanced", () => {
          const onStateChange = jest.fn();
          renderWithCounterFlow({
            counterFlowOnChange: jest.fn(),
            totalAmount: 5,
            onStateChange,
          });
          expect(lastState(onStateChange)).toEqual({
            paid: 5,
            owedToAccount: 0,
            forgiven: 0,
            balanced: true,
            overpaid: false,
            needsClient: false,
            unaccounted: 0,
          });
        });

        it("(e) onStateChange — short with an account line is balanced and reports owedToAccount", () => {
          const onStateChange = jest.fn();
          renderWithCounterFlow({
            counterFlowOnChange: jest.fn(),
            totalAmount: 50,
            hasClient: true,
            onStateChange,
          });
          typeFirst("30");
          expect(lastState(onStateChange)).toMatchObject({
            paid: 30,
            owedToAccount: 20,
            balanced: true,
            overpaid: false,
            needsClient: false,
            unaccounted: 0,
          });
        });

        it("(e) onStateChange — more than the total is overpaid, never auto-corrected", () => {
          const onStateChange = jest.fn();
          const counterFlowOnChange = jest.fn();
          renderWithCounterFlow({
            counterFlowOnChange,
            totalAmount: 5,
            onStateChange,
          });
          typeFirst("8");
          expect(lastState(onStateChange)).toMatchObject({
            paid: 8,
            balanced: false,
            overpaid: true,
          });
          expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
            expect.objectContaining({ amount: 8 }),
          ]);
        });

        it("(e) onStateChange — an account line with no client needs a client", () => {
          const onStateChange = jest.fn();
          renderWithCounterFlow({
            counterFlowOnChange: jest.fn(),
            totalAmount: 50,
            requiresClient: false, // CUSTOMER_ACCOUNT offered without a client
            hasClient: false,
            onStateChange,
          });
          typeFirst("30");
          expect(lastState(onStateChange)).toMatchObject({
            owedToAccount: 20,
            needsClient: true,
          });
        });

        it("(f) lockCurrency disables every currency select and new lines use the section currency", () => {
          renderWithCounterFlow({
            counterFlowOnChange: jest.fn(),
            totalAmount: 450000,
            currency: "LBP",
            lockCurrency: true,
          });
          fireEvent.click(screen.getByTestId("counter-flow-split-toggle"));
          fireEvent.click(screen.getByTestId("counter-flow-add-split"));
          const selects = Array.from(
            document.querySelectorAll<HTMLSelectElement>(
              '[data-testid^="counter-flow-currency-"]',
            ),
          );
          expect(selects).toHaveLength(2);
          for (const sel of selects) {
            expect(sel).toBeDisabled();
            expect(sel.value).toBe("LBP");
          }
          // Each locked select shows a small lock icon; unlocked rows do not.
          expect(
            document.querySelectorAll('[data-testid^="counter-flow-lock-"]'),
          ).toHaveLength(2);
          expect(
            document.querySelectorAll('[data-testid^="payment-lock-"]'),
          ).toHaveLength(0);
        });

        it("(g) payout: Customer pays sits above Shop pays, with OUT / IN chips and the plain title", () => {
          renderWithCounterFlow({
            counterFlowOnChange: jest.fn(),
            payer: "payout",
            label: "Cashout",
          });
          const youPay = screen.getByTestId("direction-chip-you-pay");
          expect(
            section().compareDocumentPosition(youPay) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ).toBeTruthy();
          expect(
            section().compareDocumentPosition(
              screen.getByTestId("payment-summary"),
            ) & Node.DOCUMENT_POSITION_FOLLOWING,
          ).toBeTruthy();
          expect(screen.getByText("Shop pays")).toBeInTheDocument();
          expect(screen.queryByText("Cashout")).not.toBeInTheDocument();
          expect(youPay).toHaveTextContent("OUT");
          expect(
            screen.getByTestId("direction-chip-customer-pays"),
          ).toHaveTextContent("IN");
          expect(
            within(section()).getByText("Customer pays"),
          ).toBeInTheDocument();
          expect(
            screen.queryByText("Customer pays — OMT fee"),
          ).not.toBeInTheDocument();
        });

        it("(g) payout + lockCurrency: title reads 'Customer pays — LBP'", () => {
          renderWithCounterFlow({
            counterFlowOnChange: jest.fn(),
            payer: "payout",
            totalAmount: 450000,
            currency: "LBP",
            lockCurrency: true,
          });
          expect(
            within(section()).getByText("Customer pays — LBP"),
          ).toBeInTheDocument();
        });

        it("(h) not a payout: header still reads 'Payment' and the section keeps its own label", () => {
          renderWithCounterFlow({ counterFlowOnChange: jest.fn() });
          expect(screen.getByText("Payment")).toBeInTheDocument();
          expect(screen.queryByText("Shop pays")).not.toBeInTheDocument();
          expect(
            screen.getByText("Customer pays — OMT fee"),
          ).toBeInTheDocument();
          expect(
            screen.getByTestId("direction-chip-you-pay"),
          ).toHaveTextContent("You pay");
          // Section stays below the main lines on money-in screens.
          expect(
            screen
              .getByTestId("direction-chip-you-pay")
              .compareDocumentPosition(section()) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ).toBeTruthy();
        });

        /** Short by 2 with nothing covering it: type 3 of 5 with no client
         *  (no account offered, so no leftover line is added). */
        function leaveShortfallOf2(opts: Partial<CounterFlowRenderOpts>) {
          const onStateChange = jest.fn();
          renderWithCounterFlow({
            counterFlowOnChange: jest.fn(),
            totalAmount: 5,
            onStateChange,
            ...opts,
          });
          typeFirst("3");
          expect(cfLines()).toHaveLength(1);
          return onStateChange;
        }

        // LIRA-365 US2: the Discount line replaces the Forgive button; the
        // typed discount is still reported as `forgiven`.
        it("(i) a Discount within maxForgive closes the shortfall and is reported in `forgiven`", () => {
          const onStateChange = leaveShortfallOf2({ maxForgive: 5 });
          expect(lastState(onStateChange)).toMatchObject({
            paid: 3,
            forgiven: 0,
            balanced: false,
            unaccounted: 2,
          });
          fireEvent.change(screen.getByTestId("counter-flow-discount-input"), {
            target: { value: "2" },
          });
          expect(lastState(onStateChange)).toMatchObject({
            paid: 3,
            forgiven: 2,
            balanced: true,
            unaccounted: 0,
          });
        });

        // A single line follows the discounted total, so the cashier's 3
        // becomes 4 (5 − the capped 1) and the box balances.
        it("(i) a Discount above maxForgive is held at the cap; the single line follows", () => {
          const onStateChange = leaveShortfallOf2({ maxForgive: 1 });
          fireEvent.change(screen.getByTestId("counter-flow-discount-input"), {
            target: { value: "2" },
          });
          expect(screen.getByTestId("discount-cap-note")).toBeInTheDocument();
          expect(lastState(onStateChange)).toMatchObject({
            paid: 4,
            forgiven: 1,
            balanced: true,
          });
        });

        it("(j) while short, 'Still to settle' shows the amount and onStateChange reports `unaccounted`", () => {
          const onStateChange = leaveShortfallOf2({});
          expect(
            screen.getByTestId("counter-flow-unaccounted"),
          ).toHaveTextContent(/Still to settle: 2(\.00)? USD/);
          expect(lastState(onStateChange).unaccounted).toBe(2);
        });

        it("(k) with the account offered from the start, typing less auto-adds the account leftover (unchanged)", () => {
          const counterFlowOnChange = jest.fn();
          const onStateChange = jest.fn();
          renderWithCounterFlow({
            counterFlowOnChange,
            onStateChange,
            totalAmount: 50,
            requiresClient: true,
            hasClient: true,
          });
          typeFirst("30");
          expect(cfMethodSelects()[1].value).toBe("CUSTOMER_ACCOUNT");
          expect(lastState(onStateChange)).toMatchObject({
            paid: 30,
            owedToAccount: 20,
            balanced: true,
          });
        });

        it("(k) a line the cashier added with '+ Add line' keeps its method when a client is picked (was: auto leftover CASH → account)", () => {
          // Rule 24 rewrite: the premise (an auto CASH leftover with no client)
          // no longer exists. A manual line is explicit — it keeps CASH, and no
          // extra account line appears because nothing is left unsettled.
          const counterFlowOnChange = jest.fn();
          const { rerenderWith } = renderWithCounterFlow({
            counterFlowOnChange,
            totalAmount: 50,
            requiresClient: true,
            hasClient: false,
          });
          typeFirst("30");
          fireEvent.click(screen.getByTestId("counter-flow-split-toggle"));
          fireEvent.click(screen.getByTestId("counter-flow-add-split"));
          expect(cfMethodSelects()[1].value).toBe("CASH");
          rerenderWith({ hasClient: true });
          expect(cfLines()).toHaveLength(2);
          expect(cfMethodSelects()[1].value).toBe("CASH");
          expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
            expect.objectContaining({ method: "CASH", amount: 30 }),
            expect.objectContaining({ method: "CASH", amount: 20 }),
          ]);
        });

        // ── LIRA-321 follow-up — four defects seen live on test.liratek.shop ──
        // Written before the fixes (rule 17); each failed on the unfixed code.

        it("(m) a locked currency shows the full code with the lock and no dropdown caret", () => {
          renderWithCounterFlow({
            counterFlowOnChange: jest.fn(),
            payer: "payout",
            totalAmount: 450000,
            currency: "LBP",
            lockCurrency: true,
            hasClient: true,
          });
          typeFirst("400000"); // auto account leftover → two locked rows
          const controls = Array.from(
            document.querySelectorAll<HTMLInputElement>(
              '[data-testid^="counter-flow-currency-"]',
            ),
          );
          expect(controls).toHaveLength(2);
          for (const c of controls) {
            // The app stylesheet paints a dropdown caret on EVERY <select>
            // (index.css, `select { background-image: … }`) and reserves
            // 2.5rem for it — that is what cut "LBP" down to "LE". A locked
            // currency is not a choice, so it is not a select at all.
            expect(c.tagName).not.toBe("SELECT");
            expect(c.value).toBe("LBP");
            expect(c).toBeDisabled();
          }
          expect(
            document.querySelectorAll('[data-testid^="counter-flow-lock-"]'),
          ).toHaveLength(2);
          // Unlocked rows (the shop's side) keep their dropdown.
          expect(
            document.querySelector('[data-testid^="payment-currency-"]')
              ?.tagName,
          ).toBe("SELECT");
        });

        it("(n) payout footer shows what the customer paid and what the client will owe", () => {
          renderWithCounterFlow({
            counterFlowOnChange: jest.fn(),
            payer: "payout",
            totalAmount: 50,
            requiresClient: true,
            hasClient: true,
          });
          typeFirst("30");
          const summary = screen.getByTestId("payment-summary");
          expect(
            within(summary).getByTestId("counter-flow-summary-paid"),
          ).toHaveTextContent(/^Customer paid:\s*30 USD$/);
          const owed = within(summary).getByTestId("counter-flow-summary-owed");
          expect(owed).toHaveTextContent(/^Client will owe:\s*20 USD$/);
          expect(owed.className).toMatch(/text-amber-/);
          expect(
            screen.queryByTestId("counter-flow-summary-forgiven"),
          ).not.toBeInTheDocument();
        });

        it("(n) payout footer: nothing owed → no owe line; a Discount → 'Discount' line", () => {
          renderWithCounterFlow({
            counterFlowOnChange: jest.fn(),
            payer: "payout",
            totalAmount: 50,
            requiresClient: true,
            hasClient: false,
            maxForgive: 5,
          });
          expect(
            screen.getByTestId("counter-flow-summary-paid"),
          ).toHaveTextContent(/^Customer paid:\s*50 USD$/);
          expect(
            screen.queryByTestId("counter-flow-summary-owed"),
          ).not.toBeInTheDocument();
          typeFirst("47");
          fireEvent.change(screen.getByTestId("counter-flow-discount-input"), {
            target: { value: "3" },
          });
          expect(
            screen.getByTestId("counter-flow-summary-forgiven"),
          ).toHaveTextContent(/^Discount:\s*3 USD$/);
        });

        it("(n) money-in screens: the footer is unchanged (no customer-side lines)", () => {
          renderWithCounterFlow({
            counterFlowOnChange: jest.fn(),
            totalAmount: 50,
            requiresClient: true,
            hasClient: true,
          });
          typeFirst("30");
          expect(
            screen.queryByTestId("counter-flow-summary-paid"),
          ).not.toBeInTheDocument();
          expect(
            screen.queryByTestId("counter-flow-summary-owed"),
          ).not.toBeInTheDocument();
        });

        /** Live case: Whish App receive, seeded Whish $100 + Cash $5. */
        const WHISH_SEED = [
          { method: "OMT", currencyCode: "USD", amount: 100 },
          { method: "CASH", currencyCode: "USD", amount: 5 },
        ];

        it("(o) split + client: lowering a line below what is owed adds a following Customer Account line", () => {
          const counterFlowOnChange = jest.fn();
          const onStateChange = jest.fn();
          renderWithCounterFlow({
            counterFlowOnChange,
            onStateChange,
            totalAmount: 105,
            requiresClient: true,
            hasClient: true,
            seedLines: WHISH_SEED,
          });
          typeFirst("90");
          expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
            expect.objectContaining({ method: "OMT", amount: 90 }),
            expect.objectContaining({ method: "CASH", amount: 5 }),
            expect.objectContaining({ method: "CUSTOMER_ACCOUNT", amount: 10 }),
          ]);
          expect(lastState(onStateChange)).toMatchObject({
            paid: 95,
            owedToAccount: 10,
            balanced: true,
          });
          // It follows later edits …
          typeFirst("97");
          expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
            expect.objectContaining({ method: "OMT", amount: 97 }),
            expect.objectContaining({ method: "CASH", amount: 5 }),
            expect.objectContaining({ method: "CUSTOMER_ACCOUNT", amount: 3 }),
          ]);
          // … and goes away when the gap closes.
          typeFirst("100");
          expect(cfLines()).toHaveLength(2);
          expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
            expect.objectContaining({ method: "OMT", amount: 100 }),
            expect.objectContaining({ method: "CASH", amount: 5 }),
          ]);
        });

        it("(o) split + client: unpicking the client drops the auto account line", () => {
          const counterFlowOnChange = jest.fn();
          const { rerenderWith } = renderWithCounterFlow({
            counterFlowOnChange,
            totalAmount: 105,
            requiresClient: true,
            hasClient: true,
            seedLines: WHISH_SEED,
          });
          typeFirst("90");
          expect(cfLines()).toHaveLength(3);
          rerenderWith({ hasClient: false });
          expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
            expect.objectContaining({ method: "OMT", amount: 90 }),
            expect.objectContaining({ method: "CASH", amount: 5 }),
          ]);
        });

        it("(o) split + client: an account line the cashier edited by hand is never touched", () => {
          const counterFlowOnChange = jest.fn();
          renderWithCounterFlow({
            counterFlowOnChange,
            totalAmount: 105,
            requiresClient: true,
            hasClient: true,
            seedLines: WHISH_SEED,
          });
          typeFirst("90");
          fireEvent.change(cfAmountInputs()[2], { target: { value: "4" } });
          typeFirst("80");
          expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
            expect.objectContaining({ method: "OMT", amount: 80 }),
            expect.objectContaining({ method: "CASH", amount: 5 }),
            expect.objectContaining({ method: "CUSTOMER_ACCOUNT", amount: 4 }),
          ]);
        });

        it("(o) split, no client: no auto line; the hint says to pick a client or press + Add line", () => {
          const counterFlowOnChange = jest.fn();
          renderWithCounterFlow({
            counterFlowOnChange,
            totalAmount: 105,
            requiresClient: true,
            hasClient: false,
            seedLines: WHISH_SEED,
          });
          typeFirst("90");
          expect(cfLines()).toHaveLength(2);
          expect(counterFlowOnChange.mock.calls.at(-1)?.[0]).toEqual([
            expect.objectContaining({ method: "OMT", amount: 90 }),
            expect.objectContaining({ method: "CASH", amount: 5 }),
          ]);
          expect(
            screen.getByTestId("counter-flow-unaccounted"),
          ).toHaveTextContent(
            /^Still to settle: 10(\.00)? USD — pick a client to put it on their account, or press \+ Add line$/,
          );
        });

        // LIRA-365 US2: no Forgive any more — the split hint is the same with
        // or without a cap.
        it("(o) split, no client, gap within maxForgive: the hint says pick a client or + Add line", () => {
          renderWithCounterFlow({
            counterFlowOnChange: jest.fn(),
            totalAmount: 105,
            requiresClient: true,
            hasClient: false,
            maxForgive: 20,
            seedLines: WHISH_SEED,
          });
          typeFirst("90");
          expect(
            screen.getByTestId("counter-flow-unaccounted"),
          ).toHaveTextContent(
            /^Still to settle: 10(\.00)? USD — pick a client to put it on their account, or press \+ Add line$/,
          );
        });
      });
    });

    // ── Tender-rate sanity warning (LIRA-240, owner decision 2026-09-28) ──
    // The ±15% band used to REFUSE a payment server-side; it now only drives
    // this non-blocking warning. `renderMpi`'s default exchangeRate is
    // EXCHANGE_RATE = 90000 — that is the "shop rate" the warning compares
    // the typed rate against.
    describe("tender-rate sanity warning (not proven failing-first — LIRA-223: written alongside the LIRA-240 fix, not independently ahead of it)", () => {
      it("shows no warning when the typed rate equals the shop rate", () => {
        renderMpi();
        expect(
          screen.queryByTestId("tender-rate-warning"),
        ).not.toBeInTheDocument();
      });

      it("shows no warning at exactly the +15% band boundary (103,500)", () => {
        renderMpi();
        switchFirstLineTo("LBP"); // the box shows only once LBP is in play
        setRate("103500");
        expect(
          screen.queryByTestId("tender-rate-warning"),
        ).not.toBeInTheDocument();
      });

      it("shows no warning at exactly the -15% band boundary (76,500)", () => {
        renderMpi();
        switchFirstLineTo("LBP"); // the box shows only once LBP is in play
        setRate("76500");
        expect(
          screen.queryByTestId("tender-rate-warning"),
        ).not.toBeInTheDocument();
      });

      it("shows a warning just past the +15% band (103,501)", () => {
        renderMpi();
        switchFirstLineTo("LBP"); // the box shows only once LBP is in play
        setRate("103501");
        expect(screen.getByTestId("tender-rate-warning")).toBeInTheDocument();
      });

      it("shows the owner's exact +16% example (104,400) with the shop rate named in the text", () => {
        renderMpi();
        switchFirstLineTo("LBP"); // the box shows only once LBP is in play
        setRate("104400");
        const warning = screen.getByTestId("tender-rate-warning");
        expect(warning).toHaveTextContent(/16% away/);
        expect(warning).toHaveTextContent(/90,000/);
        expect(warning).not.toHaveTextContent(/typo/i);
      });

      it("uses the stronger 'check for a typo' wording past 50% deviation", () => {
        renderMpi();
        switchFirstLineTo("LBP"); // the box shows only once LBP is in play
        setRate("135000"); // 90,000 * 1.5 = exactly +50% (not yet typo-level)
        expect(screen.getByTestId("tender-rate-warning")).not.toHaveTextContent(
          /typo/i,
        );

        setRate("135001"); // just past +50%
        expect(screen.getByTestId("tender-rate-warning")).toHaveTextContent(
          /typo/i,
        );
      });

      it("never disables the amount input, method select, or rate field — the warning is advisory only, never blocking", () => {
        renderMpi();
        switchFirstLineTo("LBP"); // the box shows only once LBP is in play
        setRate("300000"); // wildly off (~233% deviation)
        expect(screen.getByTestId("tender-rate-warning")).toBeInTheDocument();

        expect(firstAmountInput()).not.toBeDisabled();
        expect(screen.getByTestId("payment-exchange-rate")).not.toBeDisabled();
        const id = firstLineId();
        expect(screen.getByTestId(`payment-method-${id}`)).not.toBeDisabled();
      });

      it("keeps emitting onChange normally while the warning is showing — typing a payment amount is never suppressed", () => {
        const { onChange } = renderMpi();
        switchFirstLineTo("LBP"); // the box shows only once LBP is in play
        setRate("300000");
        onChange.mockClear();

        fireEvent.change(firstAmountInput(), { target: { value: "55" } });

        expect(onChange).toHaveBeenCalled();
        const lastCall = onChange.mock.calls.at(-1)?.[0] as PaymentLine[];
        expect(lastCall[0].amount).toBe(55);
      });
    });
  });
});

describe("MultiPaymentInput.underReturnKept (LIRA-259)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — handing back LESS change than due (LIRA-259, owner
   * 2026-10-06, Katsh page).
   *
   * Owner's scenario: a 450,000 LBP card, customer pays $6 cash. The change
   * due (at the till's 80,000 rate) is 30,000 LBP ($0.375); the cashier hands
   * back only 10,000 LBP and keeps the rest. The legs the till must emit are
   * IN $6 / OUT 10,000 LBP, and the un-returned part ($0.25 — reported in the
   * TENDER currency, the customer paid dollars) must reach the parent as kept
   * change so the server's leg reconciliation balances and the profit is
   * booked.
   *
   * The cashier just types 10,000 into the LBP change field. Originally this
   * was opt-in (`keepUnreturnedChange`, Katsh/iPick only) next to a "Keep
   * change" button (path B: tap, then type — the LBP return used to be clamped
   * against the LBP change, 0, so the OUT leg vanished). The owner decision of
   * 2026-10-06 removed the button and made the under-return keep the DEFAULT
   * for every consumer that wires `onKeptChange`; the path-B cases below are
   * rewritten to type directly (rule 24) and still guard the cross-currency
   * arithmetic.
   *
   * Rule 17: the original path-B and full-return cases were run against the
   * pre-LIRA-259 component first (see the LIRA-259 report). The automatic
   * behaviour's failing-first guard is MultiPaymentInput.autoKeepChange.test.tsx.
   */

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
  const RATE = 80_000;
  const PRICE_LBP = 450_000;

  function renderOwnerScenario(opts: {
    onReturnChange: jest.Mock<void, [PaymentLine[]]>;
    onKeptChange?: jest.Mock<void, [Kept]>;
  }) {
    render(
      <MultiPaymentInput
        totals={[{ amount: PRICE_LBP, currency: "LBP" }]}
        totalAmountCurrency="LBP"
        currency="USD"
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={RATE}
        showDiscount={false}
        onChange={jest.fn()}
        onReturnChange={opts.onReturnChange}
        {...(opts.onKeptChange ? { onKeptChange: opts.onKeptChange } : {})}
      />,
    );
    const amount = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    if (!amount) throw new Error("no payment-amount input rendered");
    // The customer hands over $6.
    fireEvent.change(amount, { target: { value: "6" } });
  }

  function lastLegs(onReturnChange: jest.Mock<void, [PaymentLine[]]>) {
    const legs = onReturnChange.mock.calls.at(-1)?.[0] ?? [];
    return legs.map(({ method, currencyCode, amount, direction }) => ({
      method,
      currencyCode,
      amount,
      direction,
    }));
  }

  function lastKept(onKeptChange: jest.Mock<void, [Kept]>): Kept {
    return onKeptChange.mock.calls.at(-1)?.[0] ?? null;
  }

  describe("MultiPaymentInput — handing back less change than due (LIRA-259)", () => {
    it("control: returning the full 30,000 LBP keeps nothing and shows no warning", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      const onKeptChange = jest.fn<void, [Kept]>();
      renderOwnerScenario({ onReturnChange, onKeptChange });

      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "0" },
      });
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "30000" },
      });

      expect(lastLegs(onReturnChange)).toEqual([
        {
          method: "CASH",
          currencyCode: "LBP",
          amount: 30_000,
          direction: "OUT",
        },
      ]);
      expect(lastKept(onKeptChange)).toBeNull();
      expect(
        screen.queryByTestId("return-mismatch-warning"),
      ).not.toBeInTheDocument();
    });

    it("returning only 10,000 LBP of a dollar tender (USD field emptied) — the LBP OUT leg survives and $0.25 is kept", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      const onKeptChange = jest.fn<void, [Kept]>();
      renderOwnerScenario({ onReturnChange, onKeptChange });

      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "" },
      });
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "10000" },
      });

      expect(lastLegs(onReturnChange)).toEqual([
        {
          method: "CASH",
          currencyCode: "LBP",
          amount: 10_000,
          direction: "OUT",
        },
      ]);
      const kept = lastKept(onKeptChange);
      expect(kept?.usd).toBe(0.25);
      expect(kept?.lbp).toBe(0);
      expect(kept?.exactUsd).toBeCloseTo(0.25, 9);
      expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
        "Keeping $0.25 | 20,000 LBP as profit",
      );
    });

    it("a cross-currency return larger than the whole change is flagged red — never kept change, never a negative kept amount", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      const onKeptChange = jest.fn<void, [Kept]>();
      renderOwnerScenario({ onReturnChange, onKeptChange });

      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "" },
      });
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "999999" },
      });

      expect(lastKept(onKeptChange)).toBeNull();
      expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
        "more than the customer overpaid",
      );
    });

    it("typing 10,000 into the LBP field keeps the un-returned $0.25 — no red warning, a 'Keeping' summary instead", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      const onKeptChange = jest.fn<void, [Kept]>();
      renderOwnerScenario({ onReturnChange, onKeptChange });

      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "0" },
      });
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "10000" },
      });

      expect(lastLegs(onReturnChange)).toEqual([
        {
          method: "CASH",
          currencyCode: "LBP",
          amount: 10_000,
          direction: "OUT",
        },
      ]);
      const kept = lastKept(onKeptChange);
      expect(kept?.usd).toBe(0.25);
      expect(kept?.lbp).toBe(0);
      expect(
        screen.queryByTestId("return-mismatch-warning"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
        "Keeping $0.25 | 20,000 LBP as profit — the rest is returned above.",
      );
    });

    it("an OVER-return is still flagged and nothing is kept", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      const onKeptChange = jest.fn<void, [Kept]>();
      renderOwnerScenario({ onReturnChange, onKeptChange });

      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "0" },
      });
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "50000" },
      });

      expect(lastKept(onKeptChange)).toBeNull();
      expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
        "more than the customer overpaid",
      );
    });

    it("a page that does not wire onKeptChange still only flags an under-return (its backend cannot book kept change)", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      renderOwnerScenario({ onReturnChange });

      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "0" },
      });
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "10000" },
      });

      expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
        "$0.25 of the change is not covered",
      );
      expect(
        screen.queryByTestId("keep-change-summary"),
      ).not.toBeInTheDocument();
    });

    it("the full change typed in BOTH fields is an over-return — flagged red, nothing kept", () => {
      const onReturnChange = jest.fn<void, [PaymentLine[]]>();
      const onKeptChange = jest.fn<void, [Kept]>();
      renderOwnerScenario({ onReturnChange, onKeptChange });

      // $0.375 change: the cashier types the full change in BOTH fields.
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "0.38" },
      });
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "30000" },
      });

      expect(lastKept(onKeptChange)).toBeNull();
      expect(screen.getByTestId("return-mismatch-warning")).toHaveTextContent(
        "more than the customer overpaid",
      );
    });
  });
});

describe("MultiPaymentInput.waive (LIRA-310)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * MultiPaymentInput — the Waive button (LIRA-310, owner decisions 2026-10-11).
   *
   * - Limit: $5 for a USD total, 450,000 LBP for an LBP total, UP TO AND
   *   INCLUDING, compared in the total's own currency (SHORTFALL_MAX).
   * - Waive follows Remaining: it lives in the Remaining row, so whenever that
   *   row is hidden (paid, overpaid, payout keep, auto-debt line) Waive is too.
   * - Never on a payout (automatic kept change covers that).
   * - External path (`onWaiveRemaining`): the page decides what waiving means;
   *   it receives the shortfall rounded to the total's currency plus the
   *   per-currency remainder.
   * - Built-in path (no `onWaiveRemaining`): the gap is added to the
   *   component's own discount — only when that discount is shown, lowers the
   *   total, is booked by the page (`onDiscountChange`) and fits `maxDiscount`.
   */

  const PAYMENT_METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer account" },
  ];
  const CURRENCIES = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];
  const RATE = 90_000;

  type Extra = Partial<React.ComponentProps<typeof MultiPaymentInput>>;

  function renderMpi(
    total: number,
    totalCurrency: "USD" | "LBP",
    extra: Extra = {},
  ) {
    return render(
      <MultiPaymentInput
        totals={[{ amount: total, currency: totalCurrency }]}
        currency={totalCurrency}
        totalAmountCurrency={totalCurrency}
        hasClient={false}
        requiresClientForDebt={true}
        paymentMethods={PAYMENT_METHODS}
        currencies={CURRENCIES}
        exchangeRate={RATE}
        showDiscount={false}
        onChange={jest.fn()}
        {...extra}
      />,
    );
  }

  /** Type the amount the customer handed over on the single line. */
  function pay(amount: string) {
    const input = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    if (!input) throw new Error("no payment-amount input rendered");
    fireEvent.change(input, { target: { value: amount } });
  }

  const waive = () => screen.queryByTestId("waive-remaining");

  describe("MultiPaymentInput — Waive (LIRA-310)", () => {
    describe("external path (onWaiveRemaining)", () => {
      it("shows for a $0.50 gap and calls back with the rounded amount and the per-currency remainder", () => {
        const onWaive = jest.fn();
        renderMpi(16.5, "USD", { onWaiveRemaining: onWaive });
        pay("16");
        fireEvent.click(waive()!);
        expect(onWaive).toHaveBeenCalledTimes(1);
        const [amount, byCurrency] = onWaive.mock.calls[0];
        expect(amount).toBe(0.5);
        expect(byCurrency).toEqual([{ currency: "USD", amount: 0.5 }]);
      });

      it("rounds the amount to cents on a USD total", () => {
        const onWaive = jest.fn();
        renderMpi(10.333, "USD", { onWaiveRemaining: onWaive });
        pay("10");
        fireEvent.click(waive()!);
        expect(onWaive.mock.calls[0][0]).toBe(0.33);
      });

      it("USD total: shows at exactly $5.00, hides at $5.01", () => {
        const { unmount } = renderMpi(105, "USD", {
          onWaiveRemaining: jest.fn(),
        });
        pay("100");
        expect(waive()).toBeInTheDocument();
        unmount();
        renderMpi(105.01, "USD", { onWaiveRemaining: jest.fn() });
        pay("100");
        expect(waive()).not.toBeInTheDocument();
      });

      it("LBP total: shows at exactly 450,000, hides at 450,001", () => {
        const { unmount } = renderMpi(1_450_000, "LBP", {
          onWaiveRemaining: jest.fn(),
        });
        pay("1000000");
        expect(waive()).toBeInTheDocument();
        unmount();
        renderMpi(1_450_001, "LBP", { onWaiveRemaining: jest.fn() });
        pay("1000000");
        expect(waive()).not.toBeInTheDocument();
      });

      it("hides when the gap is more than the room left (waiveRemainingMax)", () => {
        renderMpi(16.5, "USD", {
          onWaiveRemaining: jest.fn(),
          waiveRemainingMax: 0.3,
        });
        pay("16");
        expect(waive()).not.toBeInTheDocument();
      });

      it("never shows on a payout", () => {
        renderMpi(100.5, "USD", {
          onWaiveRemaining: jest.fn(),
          payer: "payout",
        });
        pay("100");
        expect(waive()).not.toBeInTheDocument();
      });

      it("follows Remaining: hidden when an automatic account line covers the gap", () => {
        renderMpi(16.5, "USD", {
          onWaiveRemaining: jest.fn(),
          hasClient: true,
          autoDebtRemainder: true,
        });
        pay("16");
        expect(screen.queryByTestId("remaining-row")).not.toBeInTheDocument();
        expect(waive()).not.toBeInTheDocument();
      });
    });

    describe("built-in path (the component's own discount)", () => {
      it("adds the gap to the discount and clears Remaining", () => {
        const onDiscount = jest.fn<void, [number]>();
        renderMpi(16.5, "USD", {
          showDiscount: true,
          maxDiscount: 2,
          onDiscountChange: onDiscount,
        });
        pay("16");
        fireEvent.click(waive()!);
        expect(onDiscount).toHaveBeenLastCalledWith(0.5);
        expect(screen.queryByTestId("remaining-row")).not.toBeInTheDocument();
      });

      it("hides when discount + gap would go over maxDiscount", () => {
        renderMpi(16.5, "USD", {
          showDiscount: true,
          maxDiscount: 0.3,
          onDiscountChange: jest.fn(),
        });
        pay("16");
        expect(waive()).not.toBeInTheDocument();
      });

      it("hides when the page does not book the discount (no onDiscountChange)", () => {
        renderMpi(16.5, "USD", { showDiscount: true });
        pay("16");
        expect(waive()).not.toBeInTheDocument();
      });

      it("LBP total paid in USD with a USD discount: clears Remaining without showing change", () => {
        const onDiscount = jest.fn<void, [number]>();
        render(
          <MultiPaymentInput
            totals={[{ amount: 1_000_000, currency: "LBP" }]}
            currency="USD"
            totalAmountCurrency="LBP"
            hasClient={false}
            requiresClientForDebt={true}
            paymentMethods={PAYMENT_METHODS}
            currencies={CURRENCIES}
            exchangeRate={RATE}
            showDiscount={true}
            maxDiscount={100_000}
            onDiscountChange={onDiscount}
            onChange={jest.fn()}
          />,
        );
        pay("11"); // 990,000 LBP — 10,000 LBP short
        fireEvent.click(waive()!);
        expect(screen.queryByTestId("remaining-row")).not.toBeInTheDocument();
        expect(screen.queryByTestId("return-usd")).not.toBeInTheDocument();
        const last = onDiscount.mock.calls.at(-1)![0];
        expect(Math.abs(last - 10_000)).toBeLessThanOrEqual(100);
      });
    });

    describe("waiveDisabled (owner decision 2026-10-12: no Waive on the Suppliers page)", () => {
      it("hides the external Waive", () => {
        renderMpi(16.5, "USD", {
          onWaiveRemaining: jest.fn(),
          waiveDisabled: true,
        });
        pay("16");
        expect(screen.getByTestId("remaining-row")).toBeInTheDocument();
        expect(waive()).not.toBeInTheDocument();
      });

      it("hides the built-in Waive but keeps the Discount field", () => {
        renderMpi(16.5, "USD", {
          showDiscount: true,
          maxDiscount: 2,
          onDiscountChange: jest.fn(),
          waiveDisabled: true,
        });
        pay("16");
        expect(waive()).not.toBeInTheDocument();
        expect(screen.getByText("Discount")).toBeInTheDocument();
      });
    });
  });

  /**
   * Owner decision 2026-10-12 (LIRA-310 follow-up) — `waiveTotals`: Waive
   * measures the gap against these totals (the Debts sheet passes the TICKED
   * items' sum, net of its discount) instead of the whole amount owed. The
   * gap is shown with its Waive, and the whole-debt figure is shown without one.
   * Owner example: $14 sale unticked + $20 Loto ticked, $18.50 paid →
   * Remaining $1.50 on ticked [Waive], $15.50 total.
   *
   * 2026-10-13 (owner): the separate "Remaining on ticked" row said the same
   * thing twice, so both figures now live in ONE remaining-row — the
   * `remaining-ticked-row` span (ticked amount + "on ticked" + Waive) above
   * the total (`remaining-amount` + "total"). Updated after the fix: not
   * proven failing-first (rule 17).
   */
  describe("MultiPaymentInput — Waive against waiveTotals (ticked items only)", () => {
    const ticked = (amount: number, currency: "USD" | "LBP" = "USD") => [
      { amount, currency },
    ];
    const tickedRow = () => screen.queryByTestId("remaining-ticked-row");

    it("owner example: gap measured against the ticked $20, Waive only in that line", () => {
      const onWaive = jest.fn();
      renderMpi(34, "USD", {
        onWaiveRemaining: onWaive,
        waiveTotals: ticked(20),
      });
      pay("18.5");
      // ONE Remaining row holds both figures: $1.50 on ticked [Waive] and
      // the whole-debt $15.50 total (with no Waive next to the total).
      expect(screen.getAllByTestId("remaining-row")).toHaveLength(1);
      const remainingRow = screen.getByTestId("remaining-row");
      const row = tickedRow()!;
      expect(row).toBeInTheDocument();
      expect(remainingRow.contains(row)).toBe(true);
      expect(screen.queryByText(/Remaining on ticked/)).toBeNull();
      expect(row.textContent).toContain("on ticked");
      expect(row.textContent).toContain("1.50");
      expect(
        row.querySelector('[data-testid="waive-remaining"]'),
      ).not.toBeNull();
      expect(
        remainingRow.querySelectorAll('[data-testid="waive-remaining"]'),
      ).toHaveLength(1);
      const total = screen.getByTestId("remaining-amount");
      expect(remainingRow.contains(total)).toBe(true);
      expect(row.contains(total)).toBe(false);
      expect(total.textContent).toContain("15.50");
      expect(total.parentElement!.textContent).toContain("total");
      fireEvent.click(waive()!);
      expect(onWaive).toHaveBeenCalledTimes(1);
      const [amount, byCurrency] = onWaive.mock.calls[0];
      expect(amount).toBe(1.5);
      expect(byCurrency).toEqual([{ currency: "USD", amount: 1.5 }]);
    });

    it("ticked items fully paid: no Waive even though the whole debt is short by $1", () => {
      renderMpi(21, "USD", {
        onWaiveRemaining: jest.fn(),
        waiveTotals: ticked(20),
      });
      pay("20");
      expect(screen.getByTestId("remaining-row")).toBeInTheDocument();
      expect(tickedRow()).not.toBeInTheDocument();
      expect(waive()).not.toBeInTheDocument();
    });

    it("cap is applied to the ticked gap: Waive at exactly $5.00, not at $5.01", () => {
      const { unmount } = renderMpi(100, "USD", {
        onWaiveRemaining: jest.fn(),
        waiveTotals: ticked(20),
      });
      pay("15");
      expect(waive()).toBeInTheDocument();
      unmount();
      renderMpi(100, "USD", {
        onWaiveRemaining: jest.fn(),
        waiveTotals: ticked(20.01),
      });
      pay("15");
      expect(tickedRow()).toBeInTheDocument();
      expect(waive()).not.toBeInTheDocument();
    });

    it("LBP cap on the ticked gap: 450,000 waivable, 450,001 not", () => {
      const { unmount } = renderMpi(5_000_000, "LBP", {
        onWaiveRemaining: jest.fn(),
        waiveTotals: ticked(1_450_000, "LBP"),
      });
      pay("1000000");
      expect(waive()).toBeInTheDocument();
      unmount();
      renderMpi(5_000_000, "LBP", {
        onWaiveRemaining: jest.fn(),
        waiveTotals: ticked(1_450_001, "LBP"),
      });
      pay("1000000");
      expect(waive()).not.toBeInTheDocument();
    });

    it("never on a payout", () => {
      renderMpi(34, "USD", {
        onWaiveRemaining: jest.fn(),
        waiveTotals: ticked(20),
        payer: "payout",
      });
      pay("18.5");
      expect(tickedRow()).not.toBeInTheDocument();
      expect(waive()).not.toBeInTheDocument();
    });

    it("waiveDisabled hides it", () => {
      renderMpi(34, "USD", {
        onWaiveRemaining: jest.fn(),
        waiveTotals: ticked(20),
        waiveDisabled: true,
      });
      pay("18.5");
      expect(waive()).not.toBeInTheDocument();
    });

    it("everything ticked (ticked gap = whole gap): one Remaining row with Waive, no duplicate line", () => {
      const onWaive = jest.fn();
      renderMpi(20, "USD", {
        onWaiveRemaining: onWaive,
        waiveTotals: ticked(20),
      });
      pay("18.5");
      expect(tickedRow()).not.toBeInTheDocument();
      const remainingRow = screen.getByTestId("remaining-row");
      expect(
        remainingRow.querySelector('[data-testid="waive-remaining"]'),
      ).not.toBeNull();
      fireEvent.click(waive()!);
      expect(onWaive.mock.calls[0][0]).toBe(1.5);
    });
  });
});

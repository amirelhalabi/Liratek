/**
 * RefundMethodModal — 6 per-ticket test files merged into one suite
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

import { fireEvent, render, screen } from "@testing-library/react";
import { refundAddedChangeSchema, refundKeptChangeSchema } from "@liratek/core";
import { RefundMethodModal } from "../RefundMethodModal";
import { type TransactionPaymentLeg } from "../../cashFlow";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("RefundMethodModal.crossCurrencyChange", () => {
  beforeAll(resetBetweenFiles);

  /**
   * CornerTech 2026-10-25 — a sale paid $55 cash with 250,000 LBP change at
   * 90,000 is a net $52.22 sale. The refund popup used to pre-fill $55 +
   * 250,000 LBP ($57.78) and keep Confirm disabled. It must now pre-fill the
   * net value as ONE line and let the operator confirm straight away.
   */

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
      expect(legs).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 55 },
      ]);
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
});

describe("RefundMethodModal.fromCustomer (LIRA-381)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-381 — the refund window in the "customer pays back" direction (a
   * basket payout being refunded: the customer hands the money back). Same
   * window, its own wording; kept change / "customer gives change" are never
   * offered on this side. Written with the change (not proven failing-first
   * by a run: before LIRA-381 the modal had no `direction` prop at all).
   */

  const PRIZE_LEG: TransactionPaymentLeg = {
    direction: "in",
    amount: 500000,
    signed_amount: 500000,
    currency_code: "LBP",
    method: "CASH",
  };

  const METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "WHISH", label: "Whish Wallet" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
  ];

  describe("RefundMethodModal — direction from_customer (LIRA-381)", () => {
    it("reads 'Customer pays back', pre-fills the payout, and offers no kept change", () => {
      render(
        <RefundMethodModal
          legs={[PRIZE_LEG]}
          paymentMethods={METHODS}
          exchangeRate={89000}
          direction="from_customer"
          allowKeptChange
          allowAddedChange
          onCancel={jest.fn()}
          onConfirm={jest.fn()}
        />,
      );
      expect(
        screen.getByText("Refund — Customer pays back"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("refund-subtitle")).toHaveTextContent(
        "The customer gives this payout back",
      );
      expect(screen.getByTestId("refund-return-summary")).toHaveTextContent(
        "Customer pays: 500,000 LBP via Cash",
      );
      expect(
        screen.queryByText(/Customer gives change/i),
      ).not.toBeInTheDocument();
    });

    it("the default direction is unchanged (money handed back)", () => {
      render(
        <RefundMethodModal
          legs={[PRIZE_LEG]}
          paymentMethods={METHODS}
          exchangeRate={89000}
          onCancel={jest.fn()}
          onConfirm={jest.fn()}
        />,
      );
      expect(
        screen.getByText("Refund — Choose Return Method"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("refund-return-summary")).toHaveTextContent(
        "Returning:",
      );
    });
  });
});

describe("RefundMethodModal.keptChange", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Refund kept change (owner decision 2026-10-07) through the real, unmocked
   * MultiPaymentInput: a $20.12 refund handed back as $20 keeps $0.12 as shop
   * profit — under $1, same currency, cash or wallet only, and only where the caller
   * says this refund can keep change (`allowKeptChange`, the server's
   * `REFUND_KEPT_CHANGE_TYPES`).
   *
   * The kept amount rides as onConfirm's FOURTH argument, named from the
   * shared core schema (`refundKeptChangeSchema`, rule 24).
   *
   * Rule 17: written before RefundMethodModal was changed; failure text is in
   * the change report.
   */

  const cashIn = (
    amount: number,
    currency_code = "USD",
  ): TransactionPaymentLeg => ({
    direction: "in",
    amount,
    signed_amount: amount,
    currency_code,
    method: "CASH",
  });

  const PAYMENT_METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "OMT", label: "OMT Wallet" },
    { code: "WHISH", label: "Whish Wallet" },
  ];

  function renderModal(
    legs: TransactionPaymentLeg[],
    allowKeptChange: boolean,
    onConfirm = jest.fn(),
  ) {
    render(
      <RefundMethodModal
        legs={legs}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89_000}
        allowKeptChange={allowKeptChange}
        onCancel={jest.fn()}
        onConfirm={onConfirm}
      />,
    );
    return onConfirm;
  }

  const confirmButton = () =>
    screen.getByRole("button", { name: "Confirm Refund" });

  describe("RefundMethodModal — refund kept change", () => {
    it("$20.12 handed back as $20: Confirm enabled and the $0.12 kept rides as the 4th argument", () => {
      const onConfirm = renderModal([cashIn(20.12)], true);
      fireEvent.change(screen.getByTestId(/payment-amount-/), {
        target: { value: "20" },
      });
      expect(
        screen.queryByTestId("refund-validation-error"),
      ).not.toBeInTheDocument();
      expect(confirmButton()).not.toBeDisabled();

      fireEvent.click(confirmButton());
      const expectedKept = refundKeptChangeSchema.parse({
        kept_change_usd: 0.12,
        kept_change_lbp: 0,
      });
      expect(onConfirm).toHaveBeenCalledWith(
        [{ method: "CASH", currencyCode: "USD", amount: 20 }],
        undefined,
        89_000,
        expectedKept,
      );
    });

    it("LIRA-272 guard: a session item refund's money-back legs (direction OUT, negative) still keep change", () => {
      // The session refund preview's `defaultLegs` are OUT legs with a
      // NEGATIVE signed_amount (TransactionRepository._defaultSessionRefundLegs)
      // — the opposite sign of a whole-transaction refund's original IN legs.
      // The money-direction gate for payout originals lives with the caller
      // (refundCanKeepChange, Transactions page), never in this popup, or
      // every session refund would silently lose kept change.
      const moneyBack: TransactionPaymentLeg = {
        direction: "out",
        amount: 20.12,
        signed_amount: -20.12,
        currency_code: "USD",
        method: "CASH",
      };
      const onConfirm = renderModal([moneyBack], true);
      fireEvent.change(screen.getByTestId(/payment-amount-/), {
        target: { value: "20" },
      });
      expect(
        screen.queryByTestId("refund-validation-error"),
      ).not.toBeInTheDocument();
      fireEvent.click(confirmButton());
      expect(onConfirm).toHaveBeenCalledWith(
        [{ method: "CASH", currencyCode: "USD", amount: 20 }],
        undefined,
        89_000,
        refundKeptChangeSchema.parse({
          kept_change_usd: 0.12,
          kept_change_lbp: 0,
        }),
      );
    });

    it("not allowed for this refund: handing back $20 of $20.12 stays blocked", () => {
      renderModal([cashIn(20.12)], false);
      fireEvent.change(screen.getByTestId(/payment-amount-/), {
        target: { value: "20" },
      });
      expect(screen.getByTestId("refund-validation-error")).toBeInTheDocument();
      expect(confirmButton()).toBeDisabled();
    });

    // Owner decision 2026-10-07: kept change may come from any drawer money —
    // cash OR wallet. This case used to assert a wallet line refuses (rule 24:
    // rewritten into the accepted case, not deleted). Account / gift-card
    // refusal is pinned in refundLegOverride.keptChange.test.ts (those methods
    // are never selectable in this popup).
    it("a WHISH return line handing back $20 of $20.12 keeps $0.12", () => {
      const onConfirm = renderModal([cashIn(20.12)], true);
      fireEvent.change(screen.getByTestId(/payment-method-/), {
        target: { value: "WHISH" },
      });
      fireEvent.change(screen.getByTestId(/payment-amount-/), {
        target: { value: "20" },
      });
      expect(
        screen.queryByTestId("refund-validation-error"),
      ).not.toBeInTheDocument();
      expect(confirmButton()).not.toBeDisabled();
      fireEvent.click(confirmButton());
      expect(onConfirm).toHaveBeenCalledWith(
        [{ method: "WHISH", currencyCode: "USD", amount: 20 }],
        undefined,
        89_000,
        refundKeptChangeSchema.parse({
          kept_change_usd: 0.12,
          kept_change_lbp: 0,
        }),
      );
    });

    // LIRA-310 owner decision 2026-10-11: the cap moved from "under $1" to
    // "up to and including $5" — $5 short is kept, more than $5 is blocked.
    it("exactly $5 short is kept change — confirms", () => {
      renderModal([cashIn(25)], true);
      fireEvent.change(screen.getByTestId(/payment-amount-/), {
        target: { value: "20" },
      });
      expect(
        screen.queryByTestId("refund-validation-error"),
      ).not.toBeInTheDocument();
      expect(confirmButton()).toBeEnabled();
    });

    it("more than $5 short is not kept change — stays blocked", () => {
      renderModal([cashIn(26)], true);
      fireEvent.change(screen.getByTestId(/payment-amount-/), {
        target: { value: "20" },
      });
      expect(screen.getByTestId("refund-validation-error")).toBeInTheDocument();
      expect(confirmButton()).toBeDisabled();
    });

    it("handing back MORE than the refund stays blocked", () => {
      renderModal([cashIn(20.12)], true);
      fireEvent.change(screen.getByTestId(/payment-amount-/), {
        target: { value: "20.5" },
      });
      expect(screen.getByTestId("refund-validation-error")).toBeInTheDocument();
      expect(confirmButton()).toBeDisabled();
    });

    it("cross-currency refund a cent or so short (inside the old value tolerance) still confirms, with no kept change", () => {
      // LIRA-236 regression guard: a USD sale refunded all in LBP, a little
      // short of the exact conversion ($20.12 × 89,000 = 1,790,680 LBP;
      // 1,789,500 is $0.013 short — over MPI's $0.01 match tolerance, under
      // the $0.02 refund value tolerance). Payout mode reports that as kept,
      // but it is not keepable (not in USD) — the plain value check must
      // still accept it, as before.
      const onConfirm = renderModal([cashIn(20.12)], true);
      fireEvent.change(screen.getByTestId(/payment-currency-/), {
        target: { value: "LBP" },
      });
      fireEvent.change(screen.getByTestId(/payment-amount-/), {
        target: { value: "1789500" },
      });
      expect(
        screen.queryByTestId("refund-validation-error"),
      ).not.toBeInTheDocument();
      expect(confirmButton()).not.toBeDisabled();
      fireEvent.click(confirmButton());
      expect(onConfirm).toHaveBeenCalledWith(
        [{ method: "CASH", currencyCode: "LBP", amount: 1_789_500 }],
        undefined,
        89_000,
      );
    });

    it("untouched exact refund still sends no override and no kept change", () => {
      const onConfirm = renderModal([cashIn(20.12)], true);
      fireEvent.click(confirmButton());
      expect(onConfirm).toHaveBeenCalledWith(undefined);
    });
  });
});

describe("RefundMethodModal.refundWording (LIRA-310)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Refund window wording (production test 2026-10-07), through the real,
   * unmocked MultiPaymentInput.
   *
   * The window said the total "must match what the customer originally paid"
   * and then accepted $4.00 against a $4.25 refund (refund kept change), and
   * its "Paid $4.00" line was really the amount the shop HANDS BACK. For a
   * refund:
   *   - the summary line reads "Hand back", never "Paid";
   *   - when kept change is allowed, the subtitle says the refund may be a
   *     little short (up to the server's own cap, SHORTFALL_MAX — $5 /
   *     450,000 LBP inclusive since LIRA-310 — in the refund's currency) and the rest is kept as profit;
   *   - the kept $0.25 is said exactly ONCE (no duplicate line). Since owner
   *     2026-10-13 the payment form's payout mode says it only in its green
   *     "Change kept (profit)" remaining row — the "Keeping $0.25 as profit."
   *     note is gone (updated after that change: not proven failing-first).
   * Validation behaviour is unchanged (the existing keptChange suite pins it).
   *
   * Rule 17: written before the fix; the red run is in the task report.
   */

  const cashIn = (
    amount: number,
    currency_code = "USD",
  ): TransactionPaymentLeg => ({
    direction: "in",
    amount,
    signed_amount: amount,
    currency_code,
    method: "CASH",
  });

  const PAYMENT_METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "WHISH", label: "Whish Wallet" },
  ];

  function renderModal(
    legs: TransactionPaymentLeg[],
    allowKeptChange: boolean,
  ) {
    render(
      <RefundMethodModal
        legs={legs}
        paymentMethods={PAYMENT_METHODS}
        exchangeRate={89_000}
        allowKeptChange={allowKeptChange}
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
  }

  describe("RefundMethodModal — refund wording", () => {
    it("labels the summary figure 'Hand back', not 'Paid'", () => {
      renderModal([cashIn(4.25)], false);
      expect(screen.getByText("Hand back")).toBeInTheDocument();
      expect(screen.queryByText("Paid")).not.toBeInTheDocument();
    });

    it("with kept change allowed: subtitle explains the short refund and the kept profit", () => {
      renderModal([cashIn(4.25)], true);
      const subtitle = screen.getByTestId("refund-subtitle");
      // LIRA-310 owner decision 2026-10-11: the cap is $5 / 450,000 LBP,
      // up to and including (was "less than $1 / 100,000 LBP").
      expect(subtitle).toHaveTextContent(/up to \$5\b/);
      expect(subtitle).toHaveTextContent(/kept as profit/);
      expect(subtitle).not.toHaveTextContent(/must match what the customer/);
    });

    it("an LBP refund states the LBP limit", () => {
      renderModal([cashIn(400_000, "LBP")], true);
      expect(screen.getByTestId("refund-subtitle")).toHaveTextContent(
        /up to 450,000 LBP/, // LIRA-310 owner decision 2026-10-11
      );
    });

    it("without kept change the subtitle keeps the exact-amount rule and never mentions profit", () => {
      renderModal([cashIn(4.25)], false);
      const subtitle = screen.getByTestId("refund-subtitle");
      expect(subtitle).toHaveTextContent(/must match what the customer/);
      expect(subtitle).not.toHaveTextContent(/profit/);
    });

    it("$4.25 handed back as $4.00 says the $0.25 is kept as profit exactly once", () => {
      renderModal([cashIn(4.25)], true);
      fireEvent.change(screen.getByTestId(/payment-amount-/), {
        target: { value: "4" },
      });
      expect(screen.getAllByText("Change kept (profit)")).toHaveLength(1);
      expect(screen.getByTestId("remaining-amount")).toHaveTextContent(
        /\$0\.25/,
      );
      expect(screen.queryByText(/Keeping .*as profit/)).not.toBeInTheDocument();
      expect(screen.getByText("Hand back")).toBeInTheDocument();
    });
  });
});

describe("RefundMethodModal.signedNetValue (LIRA-236)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-236 round-2/final review, finding F1 (BLOCKER, frontend half) —
   * `validateRefundValue` (refundLegOverride.ts) used to compare `Math.abs`'d
   * per-currency totals instead of the SIGNED net, which stacks an IN leg and
   * an OUT leg in different currencies instead of netting them against each
   * other. `refundLegOverride.test.ts` proves the pure function in isolation;
   * THIS file proves the same bug/fix through the real, unmocked
   * `MultiPaymentInput` — the reviewer's own note is that a mocked MPI hides
   * this class of bug, since it's the real per-line remove/edit interactions
   * (and RefundMethodModal's wiring of `overrideLines`/`originalNet`/
   * `currentRate` into `validateRefundValue`) that reproduce it, not the pure
   * function alone.
   *
   * Written failing-first: every scenario below was run against the pre-fix
   * (abs-based) `validateRefundValue` and confirmed failing before the
   * signed-net rewrite (see refundLegOverride.ts and the sibling
   * refundLegOverride.test.ts describe block for the exact numbers).
   */

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

  describe("RefundMethodModal — LIRA-236 F1 signed-net value matching (real MultiPaymentInput)", () => {
    it("a $90 sale (paid $100 cash, 895,000 LBP change given back): $90 enables Confirm, $110 (the old abs-sum) doesn't", () => {
      const onConfirm = jest.fn();
      render(
        <RefundMethodModal
          legs={[
            leg("in", 100, "USD", "CASH"),
            leg("out", 895_000, "LBP", "CASH"),
          ]}
          paymentMethods={PAYMENT_METHODS}
          exchangeRate={89_500}
          onCancel={jest.fn()}
          onConfirm={onConfirm}
        />,
      );

      // LIRA-342 (owner decision 2026-10-25): the pre-fill is now ONE line,
      // the net $90 in the currency paid (the LBP change folded in) — no
      // longer the two-line per-currency mirror this test used to remove a
      // line from. The value check below is unchanged.
      expect(screen.getAllByTestId(/payment-amount-/)).toHaveLength(1);

      const amountInput = screen.getByTestId(/payment-amount-/);
      fireEvent.change(amountInput, { target: { value: "90" } });
      expect(
        screen.queryByTestId("refund-validation-error"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Confirm Refund" }),
      ).not.toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
      expect(onConfirm).toHaveBeenCalledWith(
        [{ method: "CASH", currencyCode: "USD", amount: 90 }],
        undefined,
        89_500,
      );

      fireEvent.change(amountInput, { target: { value: "110" } });
      expect(screen.getByTestId("refund-validation-error")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Confirm Refund" }),
      ).toBeDisabled();
    });

    it("a fee-on-top payout (RECEIVE shape) refund switched to LBP validates with the CORRECT direction — the net $95, not the old abs-sum $105", () => {
      const onConfirm = jest.fn();
      render(
        <RefundMethodModal
          // $5 fee paid IN (USD), $100 payout OUT (as 8,900,000 LBP @ 89000).
          legs={[
            leg("in", 5, "USD", "CASH"),
            leg("out", 8_900_000, "LBP", "CASH"),
          ]}
          paymentMethods={PAYMENT_METHODS}
          exchangeRate={89_000}
          onCancel={jest.fn()}
          onConfirm={onConfirm}
        />,
      );

      // LIRA-342: the pre-fill is ONE LBP line (the USD fee folded in at the
      // rate). Type the net $95 the shop owes back (5 - 100 = -95) — NOT the
      // abs sum of both legs (5 + 100 = $105), which is what the pre-fix
      // per-currency-abs rule required.
      expect(screen.getAllByTestId(/payment-amount-/)).toHaveLength(1);

      const amountInput = screen.getByTestId(/payment-amount-/);
      fireEvent.change(amountInput, { target: { value: "8455000" } }); // $95 worth
      expect(
        screen.queryByTestId("refund-validation-error"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Confirm Refund" }),
      ).not.toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: "Confirm Refund" }));
      expect(onConfirm).toHaveBeenCalledWith(
        [{ method: "CASH", currencyCode: "LBP", amount: 8_455_000 }],
        undefined,
        89_000,
      );
    });

    it("a wash exchange ($100 USD in, 8,900,000 LBP out at the SAME rate — net value $0) rejects a $200 refund that merely sums the abs legs", () => {
      render(
        <RefundMethodModal
          legs={[
            leg("in", 100, "USD", "CASH"),
            leg("out", 8_900_000, "LBP", "CASH"),
          ]}
          paymentMethods={PAYMENT_METHODS}
          exchangeRate={89_000}
          onCancel={jest.fn()}
          onConfirm={jest.fn()}
        />,
      );

      // Net value $0 folds to nothing, so the modal keeps the two-line
      // mirror (LIRA-342). Drop the LBP line, leaving the USD line, then bump it from its default
      // $100 up to $200 — the abs-sum ($100 + 8,900,000/89000 = $200) the OLD
      // rule accepted even though the transaction's real net value is $0.
      const removeButtons = screen.getAllByTitle("Remove");
      expect(removeButtons).toHaveLength(2);
      fireEvent.click(removeButtons[1]); // the LBP line

      const amountInput = screen.getByTestId(/payment-amount-/);
      fireEvent.change(amountInput, { target: { value: "200" } });

      expect(screen.getByTestId("refund-validation-error")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Confirm Refund" }),
      ).toBeDisabled();
    });
  });
});

describe("RefundMethodModal (LIRA-078)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-078 — RefundMethodModal RTL tests.
   *
   * Covers the ticket's "modal test" requirement: prefill from the original
   * legs, method switch, and the payload shape sent to `onConfirm` —
   * including the "plain refund (no modal interaction) behaves exactly as
   * today" contract (`onConfirm(undefined)` when the operator changes
   * nothing, `onConfirm([...])` once they pick a different method).
   */

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
          legs={[
            leg("in", 60, "USD", "CASH"),
            leg("in", 900_000, "LBP", "CASH"),
          ]}
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
      const sentExtras = onConfirm.mock.calls[0][1] as Record<
        string,
        unknown
      >[];
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

      expect(
        screen.queryByTestId("multi-payment-input"),
      ).not.toBeInTheDocument();
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

    // Owner decision 2026-11-01: the rate box shows only when the window mixes
    // USD and LBP — here once the cashier switches the USD line to LBP.
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
      expect(
        screen.queryByTestId("payment-exchange-rate"),
      ).not.toBeInTheDocument();
      fireEvent.change(screen.getByTestId(/payment-currency-/), {
        target: { value: "LBP" },
      });
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

      // Switch the single line to LBP — the rate box appears (USD owed, LBP
      // paid; owner decision 2026-11-01) — then edit the rate. The LBP amount
      // follows the NEW effective rate (90,000), not the stale prop.
      fireEvent.change(screen.getByTestId(/payment-currency-/), {
        target: { value: "LBP" },
      });
      fireEvent.change(screen.getByTestId("payment-exchange-rate"), {
        target: { value: "90000" },
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

      // The box shows once the window mixes USD and LBP (owner 2026-11-01).
      fireEvent.change(screen.getByTestId(/payment-currency-/), {
        target: { value: "LBP" },
      });
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
      // Owner decision 2026-11-01: the rate box shows only when the window
      // mixes USD and LBP, so the scenario uses a USD + LBP refund (each line
      // already in its own currency — nothing to convert).
      render(
        <RefundMethodModal
          legs={[
            leg("in", 60, "USD", "CASH"),
            leg("in", 900_000, "LBP", "CASH"),
          ]}
          paymentMethods={PAYMENT_METHODS}
          exchangeRate={89000}
          onCancel={jest.fn()}
          onConfirm={onConfirm}
        />,
      );

      // Edit the rate only — each line stays in its own currency with its own
      // amount, so the line set still equals the default (`isDefault` stays
      // true). Before the F2 fix this made `handleConfirm` send NO override
      // and NO rate at all.
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
});

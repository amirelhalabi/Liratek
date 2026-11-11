/**
 * TopUpModal — 9 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 9).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { TopUpModal } from "@liratek/ui";
import { topUpFromClientSchema } from "@liratek/core";
import { useState } from "react";
import {
  setPayoutLine,
  payoutLegAmounts,
  type PayoutLineSide,
} from "@/shared/testing/payoutExtraLess";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("TopUpModal.addedChange (LIRA-336)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Whish App "From Client" top-up — customer adds change (LIRA-336, T018).
   *
   * The shop owes the client $99.00 (100 credits, fee included) and has no
   * single dollar: the client hands over $1 and the cashier pays out $100.
   * The payout box gets an optional "Customer gives change" section; the
   * modal sends the client's non-zero lines as `customerPayments` plus
   * `added_change_*` (payout currency) in the SAME payload as the legs
   * (rule 22). Field names come from `topUpFromClientSchema` (rule 24): the
   * payload is parsed through the real schema, so a field the schema does not
   * know is stripped and the assertion fails. Real MultiPaymentInput.
   *
   * Rule 17: run against the pre-change modal first — see the task report.
   */

  const ALL_DRAWERS = [
    { name: "General", usdBalance: 500, lbpBalance: 0 },
    { name: "Whish_App", usdBalance: 0, lbpBalance: 0 },
  ];
  const CLIENT_PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];

  function renderModal(onConfirmClient: jest.Mock) {
    render(
      <TopUpModal
        isOpen
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        onConfirmClient={onConfirmClient}
        clientPaymentMethods={CLIENT_PAYMENT_METHODS}
        provider="WHISH_APP"
        allDrawers={ALL_DRAWERS}
        destinationDrawer="Whish_App"
        defaultSourceDrawer="General"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /from client/i }));
    // $100 credits, fee included → the shop owes $99.00.
    fireEvent.change(screen.getAllByPlaceholderText("0.00")[0], {
      target: { value: "100" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /fee included in amount/i }),
    );
  }

  function typeCustomerGives(value: string) {
    const cf = document.querySelector<HTMLInputElement>(
      '[data-testid^="counter-flow-amount-"]',
    );
    expect(cf).not.toBeNull();
    fireEvent.change(cf as HTMLInputElement, { target: { value } });
  }

  function submit() {
    fireEvent.click(
      screen.getByRole("button", { name: /buy credits from client/i }),
    );
  }

  function sent(onConfirmClient: jest.Mock) {
    expect(onConfirmClient).toHaveBeenCalledTimes(1);
    return onConfirmClient.mock.calls[0][0] as Record<string, unknown>;
  }

  describe("TopUpModal — From Client, customer adds change (LIRA-336)", () => {
    it("shows '+ Customer gives change', closed by default", () => {
      renderModal(jest.fn());
      expect(screen.getByTestId("counter-flow-add-change")).toBeInTheDocument();
      expect(screen.queryByTestId("counter-flow-section")).toBeNull();
    });

    it("owes $99, client gives $1, $100 paid out: sends customerPayments [$1] and added_change_usd 1", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderModal(onConfirmClient);
      fireEvent.click(screen.getByTestId("counter-flow-add-change"));
      typeCustomerGives("1");
      expect(
        screen.getByTestId("payout-added-change-summary"),
      ).toBeInTheDocument();
      submit();

      const parsed = topUpFromClientSchema.parse(sent(onConfirmClient));
      expect(parsed.added_change_usd).toBe(1);
      expect(parsed.added_change_lbp ?? 0).toBe(0);
      expect(parsed.customerPayments).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 1 },
      ]);
      // The untouched payout line follows the raised target.
      expect(parsed.payments).toEqual([
        expect.objectContaining({ currencyCode: "USD", amount: 100 }),
      ]);
      expect(parsed.rounding_given_usd ?? 0).toBe(0);
      expect(parsed.kept_change_usd ?? 0).toBe(0);
    });

    it("section never opened: no customerPayments and no claim", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderModal(onConfirmClient);
      submit();
      const raw = sent(onConfirmClient);
      expect(raw).not.toHaveProperty("customerPayments");
      const parsed = topUpFromClientSchema.parse(raw);
      expect(parsed.added_change_usd).toBeUndefined();
      expect(parsed.added_change_lbp).toBeUndefined();
    });

    it("section opened but left at 0: the 0 line is dropped and no claim is sent", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderModal(onConfirmClient);
      fireEvent.click(screen.getByTestId("counter-flow-add-change"));
      submit();
      const raw = sent(onConfirmClient);
      expect(raw).not.toHaveProperty("customerPayments");
      const parsed = topUpFromClientSchema.parse(raw);
      expect(parsed.added_change_usd).toBeUndefined();
    });

    it("over the cap ($6): Confirm is disabled and nothing is sent", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderModal(onConfirmClient);
      fireEvent.click(screen.getByTestId("counter-flow-add-change"));
      typeCustomerGives("6");
      expect(screen.getByTestId("counter-flow-overpaid")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /buy credits from client/i }),
      ).toBeDisabled();
      submit();
      expect(onConfirmClient).not.toHaveBeenCalled();
    });

    // Written after the wiring — not proven failing-first (rule 17).
    it("LBP: owes 4,450,000, client gives 50,000 → added_change_lbp 50,000, 4,500,000 paid out", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderModal(onConfirmClient);
      fireEvent.click(screen.getByRole("button", { name: /^LBP$/ }));
      // The LBP amount box uses a "0" placeholder.
      fireEvent.change(screen.getAllByPlaceholderText("0")[0], {
        target: { value: "4450000" },
      });
      fireEvent.click(screen.getByTestId("counter-flow-add-change"));
      typeCustomerGives("50000");
      submit();
      const parsed = topUpFromClientSchema.parse(sent(onConfirmClient));
      expect(parsed.currency).toBe("LBP");
      expect(parsed.added_change_lbp).toBe(50_000);
      expect(parsed.added_change_usd ?? 0).toBe(0);
      expect(parsed.customerPayments).toEqual([
        { method: "CASH", currencyCode: "LBP", amount: 50_000 },
      ]);
      expect(parsed.payments).toEqual([
        expect.objectContaining({ currencyCode: "LBP", amount: 4_500_000 }),
      ]);
    });

    // Written after the wiring — not proven failing-first (rule 17).
    it("an over-cap section does not keep Confirm off after a currency switch remounts the box", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderModal(onConfirmClient);
      fireEvent.click(screen.getByTestId("counter-flow-add-change"));
      typeCustomerGives("6");
      const confirm = () =>
        screen.getByRole("button", { name: /buy credits from client/i });
      expect(confirm()).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: /^LBP$/ }));
      fireEvent.click(screen.getByRole("button", { name: /^USD$/ }));
      fireEvent.change(screen.getAllByPlaceholderText("0.00")[0], {
        target: { value: "100" },
      });
      expect(screen.queryByTestId("counter-flow-section")).toBeNull();
      expect(confirm()).toBeEnabled();
      submit();
      const raw = sent(onConfirmClient);
      expect(raw).not.toHaveProperty("customerPayments");
      expect(raw).not.toHaveProperty("added_change_usd");
    });

    it("opened, $1 typed, then closed with ×: nothing is sent", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderModal(onConfirmClient);
      fireEvent.click(screen.getByTestId("counter-flow-add-change"));
      typeCustomerGives("1");
      fireEvent.click(screen.getByTestId("counter-flow-remove-change"));
      submit();
      const raw = sent(onConfirmClient);
      expect(raw).not.toHaveProperty("customerPayments");
      const parsed = topUpFromClientSchema.parse(raw);
      expect(parsed.added_change_usd).toBeUndefined();
      expect(parsed.payments).toEqual([
        expect.objectContaining({ currencyCode: "USD", amount: 99 }),
      ]);
    });
  });
});

describe("TopUpModal.feeIncludedPayout", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Owner decision 2026-10-16 — Whish App top-up from a client: "Fee included
   * in amount" follows the usual RECEIVE rule (Whish receive, Binance
   * cash-out):
   *
   *   ticked   → the client sends the typed credits; the fee comes out of
   *              them: credits in = amount, payout = amount − fee.
   *   unticked → the client sends credits + fee; the shop pays out the full
   *              typed amount: credits in = amount + fee, payout = amount.
   *
   * The API's `amount` is the credits that arrive (the server books the
   * Whish_App wallet +amount and pays out amount − fee), so the modal folds
   * the choice into `amount` — the same fold every wallet RECEIVE form does.
   *
   * Field names come from the shared schema (rule 24): the payload is parsed
   * through `topUpFromClientSchema`. Rule 17: run against the unchanged modal
   * first and seen failing (unticked: amount 100 / payout 99).
   */

  const ALL_DRAWERS = [
    { name: "General", usdBalance: 500, lbpBalance: 0 },
    { name: "Whish_App", usdBalance: 0, lbpBalance: 0 },
  ];

  function renderAndType(onConfirmClient: jest.Mock, typed: string) {
    render(
      <TopUpModal
        isOpen
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        onConfirmClient={onConfirmClient}
        clientPaymentMethods={[{ code: "CASH", label: "Cash" }]}
        provider="WHISH_APP"
        allDrawers={ALL_DRAWERS}
        destinationDrawer="Whish_App"
        defaultSourceDrawer="General"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /from client/i }));
    fireEvent.change(screen.getAllByPlaceholderText("0.00")[0], {
      target: { value: typed },
    });
  }

  function submitAndParse(onConfirmClient: jest.Mock) {
    fireEvent.click(
      screen.getByRole("button", { name: /buy credits from client/i }),
    );
    expect(onConfirmClient).toHaveBeenCalledTimes(1);
    const parsed = topUpFromClientSchema.parse(
      onConfirmClient.mock.calls[0][0],
    );
    const payout = parsed.payments.reduce((sum, leg) => sum + leg.amount, 0);
    return { parsed, payout };
  }

  describe("TopUpModal — Whish App from client, fee included or not", () => {
    it("unticked (default): client sends $101, shop pays out the full $100, fee $1", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderAndType(onConfirmClient, "100");
      const { parsed, payout } = submitAndParse(onConfirmClient);

      expect(parsed.includingFees).toBe(false);
      expect(parsed.amount).toBeCloseTo(101, 6);
      expect(parsed.fee).toBe(1);
      expect(payout).toBeCloseTo(100, 6);
    });

    it("ticked: client sends $100, fee comes out of it, payout $99", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderAndType(onConfirmClient, "100");
      fireEvent.click(
        screen.getByRole("checkbox", { name: /fee included in amount/i }),
      );
      const { parsed, payout } = submitAndParse(onConfirmClient);

      expect(parsed.includingFees).toBe(true);
      expect(parsed.amount).toBe(100);
      expect(parsed.fee).toBe(1);
      expect(payout).toBeCloseTo(99, 6);
    });

    it("unticked shows what the client sends and the full payout", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderAndType(onConfirmClient, "100");
      expect(screen.getByText(/client sends:/i).textContent).toContain(
        "$101.00",
      );
      expect(screen.getByText(/cash paid to client:/i).textContent).toContain(
        "$100.00",
      );
    });
  });
});

describe("TopUpModal.fromClient (LIRA-195)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-195 rework — Whish App "From Client" top-up.
   *
   * Two changes landed together in TopUpModal.tsx (packages/ui, canonical
   * implementation; jest.config maps "@liratek/ui" to that package's source —
   * same convention as TopUpModal.omtAppFundingDefault.test.tsx, which is why
   * this test lives here rather than under packages/ui, which has no jest of
   * its own):
   *
   *  1. The bespoke cash-only payout field is replaced by `MultiPaymentInput`:
   *     the modal now emits `payments[]` (structured legs), never the retired
   *     `cashPaid` scalar, and never a `direction: "OUT"` leg (a payout has no
   *     customer tender to hand change back from — CLAUDE.md rule 16 / the
   *     repository hard-rejects it).
   *  2. The free-text "Client Name (optional)" field is replaced by a real
   *     client picker (`clientSelector`/`selectedClientId`, page-owned,
   *     mirrors `partnerSelector`) so `clientId` actually reaches the wire
   *     (CLAUDE.md rule 11) — previously every client top-up recorded a null
   *     `client_id` because the field was free text and the emitted payload
   *     never carried an id at all.
   *
   * Assertions are taken from the schema (rule 24): `topUpFromClientSchema`
   * (packages/core/src/validators/recharge.ts, re-exported from `@liratek/core`
   * via browser.ts) is parsed against the emitted payload instead of hand-typed
   * field names, so a drift between this test and the real contract fails loud.
   *
   * Rule 17 note: every test below was run against the pre-fix TopUpModal.tsx
   * (the version with a `cashPaid` field, a free-text `clientName` state and no
   * MultiPaymentInput) and observed to fail — see the PR/handover notes for the
   * captured failure output. Reverting TopUpModal.tsx to that shape reproduces
   * the failures (the pre-fix modal never renders `clientSelector`, has no
   * `split-toggle`/`payment-amount-*` testids, and calls `onConfirmClient` with
   * `{amount, cashPaid, currency, clientName?}` instead of `payments[]`).
   */

  const ALL_DRAWERS = [
    { name: "General", usdBalance: 500, lbpBalance: 0 },
    { name: "Whish_App", usdBalance: 0, lbpBalance: 0 },
  ];

  const CLIENT_PAYMENT_METHODS = [
    { code: "CASH", label: "Cash" },
    { code: "OMT", label: "OMT" },
  ];

  /** The main "Credits Received from Client" amount field. Both it and the fee
   *  input inside the Fee Breakdown card share the "0.00" placeholder while the
   *  amount is empty (the fee input's placeholder only turns into "X.XX
   *  (auto)" once an amount is typed) — the main field is always first in DOM
   *  order, so index 0 is unambiguous regardless of state. */
  function getAmountInput(): HTMLElement {
    return screen.getAllByPlaceholderText("0.00")[0];
  }

  /** The main amount field when the modal is in LBP mode, where its
   *  placeholder is "0" (not "0.00") and therefore doesn't collide with the
   *  manual-fee input's placeholder at all — unlike the USD case above, no
   *  index disambiguation is needed. */
  function getLbpAmountInput(): HTMLElement {
    return screen.getAllByPlaceholderText("0")[0];
  }

  /** The manual "Fee Amount (USD)" input inside the Fee Breakdown card,
   *  located via its label text rather than a hand-picked placeholder/index —
   *  robust regardless of whether the auto-fee placeholder has kicked in. */
  function getFeeInput(): HTMLInputElement {
    const label = screen.getByText("Fee Amount (USD)");
    const container = label.closest("div");
    const input = container?.querySelector("input");
    if (!input) throw new Error("Fee input not found");
    return input;
  }

  function switchToFromClient() {
    fireEvent.click(screen.getByRole("button", { name: /from client/i }));
  }

  function submit() {
    fireEvent.click(
      screen.getByRole("button", { name: /buy credits from client/i }),
    );
  }

  describe("TopUpModal — Whish App 'From Client' payout (LIRA-195)", () => {
    it("emits payments[] (not cashPaid), matching topUpFromClientSchema", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      render(
        <TopUpModal
          isOpen
          onClose={jest.fn()}
          onConfirm={jest.fn()}
          onConfirmClient={onConfirmClient}
          clientPaymentMethods={CLIENT_PAYMENT_METHODS}
          provider="WHISH_APP"
          allDrawers={ALL_DRAWERS}
          destinationDrawer="Whish_App"
          defaultSourceDrawer="General"
        />,
      );

      switchToFromClient();
      fireEvent.change(getAmountInput(), { target: { value: "100" } });
      submit();

      expect(onConfirmClient).toHaveBeenCalledTimes(1);
      const payload = onConfirmClient.mock.calls[0][0];

      expect(payload).not.toHaveProperty("cashPaid");
      expect(Array.isArray(payload.payments)).toBe(true);
      expect(payload.payments.length).toBeGreaterThan(0);
      // Parse against the real schema (rule 24) instead of hand-typed field
      // names — proves the payload is actually well-formed, not just "has a
      // payments key".
      expect(() => topUpFromClientSchema.parse(payload)).not.toThrow();
    });

    it("propagates clientId when a client is picked (rule 11)", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);

      function Harness() {
        const [selectedClientId, setSelectedClientId] = useState<number | null>(
          null,
        );
        return (
          <TopUpModal
            isOpen
            onClose={jest.fn()}
            onConfirm={jest.fn()}
            onConfirmClient={onConfirmClient}
            clientPaymentMethods={CLIENT_PAYMENT_METHODS}
            selectedClientId={selectedClientId}
            // Stands in for the page's real client picker
            // (ClientAutocompleteInput in Recharge/index.tsx) — the modal
            // itself only needs `selectedClientId` to reach the payload, which
            // is exactly the contract this test exercises.
            clientSelector={
              <button type="button" onClick={() => setSelectedClientId(42)}>
                Pick client 42
              </button>
            }
            provider="WHISH_APP"
            allDrawers={ALL_DRAWERS}
            destinationDrawer="Whish_App"
            defaultSourceDrawer="General"
          />
        );
      }

      render(<Harness />);
      switchToFromClient();
      fireEvent.click(screen.getByRole("button", { name: /pick client 42/i }));
      fireEvent.change(getAmountInput(), { target: { value: "50" } });
      submit();

      expect(onConfirmClient).toHaveBeenCalledTimes(1);
      const payload = onConfirmClient.mock.calls[0][0];
      expect(payload.clientId).toBe(42);
      expect(() => topUpFromClientSchema.parse(payload)).not.toThrow();
    });

    it("never emits a payout leg with direction OUT", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      render(
        <TopUpModal
          isOpen
          onClose={jest.fn()}
          onConfirm={jest.fn()}
          onConfirmClient={onConfirmClient}
          clientPaymentMethods={CLIENT_PAYMENT_METHODS}
          provider="WHISH_APP"
          allDrawers={ALL_DRAWERS}
          destinationDrawer="Whish_App"
          defaultSourceDrawer="General"
        />,
      );

      switchToFromClient();
      fireEvent.change(getAmountInput(), { target: { value: "100" } });
      // Overtype the single payout line above the target (target is $100 —
      // the fee is on top by default) — if onReturnChange were ever wired, this is exactly
      // the shape that would emit a change/return OUT leg.
      const amountLeg = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      );
      expect(amountLeg).not.toBeNull();
      fireEvent.change(amountLeg as HTMLInputElement, {
        target: { value: "150" },
      });
      submit();

      expect(onConfirmClient).toHaveBeenCalledTimes(1);
      const payload = onConfirmClient.mock.calls[0][0];
      expect(() => topUpFromClientSchema.parse(payload)).not.toThrow();
      for (const leg of payload.payments) {
        expect(leg.direction).not.toBe("OUT");
      }
    });

    it("a split payout across two methods sums to the payout target", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      render(
        <TopUpModal
          isOpen
          onClose={jest.fn()}
          onConfirm={jest.fn()}
          onConfirmClient={onConfirmClient}
          clientPaymentMethods={CLIENT_PAYMENT_METHODS}
          provider="WHISH_APP"
          allDrawers={ALL_DRAWERS}
          destinationDrawer="Whish_App"
          defaultSourceDrawer="General"
        />,
      );

      switchToFromClient();
      // 1% auto fee on $100 USD, "Fee included" left unticked (the default):
      // the client sends $101 and the payout target is the full $100.00
      // (owner decision 2026-10-16 — was $99 before the fee mode counted).
      fireEvent.change(getAmountInput(), { target: { value: "100" } });

      fireEvent.click(screen.getByTestId("split-toggle"));
      let amountInputs = document.querySelectorAll<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      );
      fireEvent.change(amountInputs[0], { target: { value: "60" } });

      fireEvent.click(screen.getByTestId("add-payment-line"));
      amountInputs = document.querySelectorAll<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      );
      expect(amountInputs).toHaveLength(2);

      submit();

      expect(onConfirmClient).toHaveBeenCalledTimes(1);
      const payload = onConfirmClient.mock.calls[0][0];
      expect(() => topUpFromClientSchema.parse(payload)).not.toThrow();
      expect(payload.payments).toHaveLength(2);
      const total = payload.payments.reduce(
        (sum: number, leg: { amount: number }) => sum + leg.amount,
        0,
      );
      // Owner-approved expectation change 2026-10-16: 99 → 100.
      expect(total).toBeCloseTo(100, 2);
      // The same $1 auto fee this split payout target (100 = 101 − 1) was
      // derived from must also travel on the wire (LIRA-195 fee follow-on).
      expect(payload.fee).toBe(1);
    });

    // --- LIRA-195 fee follow-on -------------------------------------------
    //
    // `topUpFromClientSchema` gains a REQUIRED `fee: z.number().nonnegative()`
    // field (packages/core/src/validators/recharge.ts) — the shop's cut, which
    // the server now reconciles `payments[]` against with EXACT equality
    // (`amount - fee`), replacing the old one-sided "at or under" tolerance.
    // TopUpModal already computes this value as `whishProviderFee`; these
    // tests prove it actually reaches the wire, including the `fee: 0` case a
    // truthiness check or `?? undefined` would silently drop (rule 22 — the
    // owner explicitly said the fee may be zero).
    describe("fee propagation (LIRA-195 follow-on)", () => {
      it("emits the auto-calculated 1% USD fee as `fee`, matching the schema", () => {
        const onConfirmClient = jest.fn().mockResolvedValue(undefined);
        render(
          <TopUpModal
            isOpen
            onClose={jest.fn()}
            onConfirm={jest.fn()}
            onConfirmClient={onConfirmClient}
            clientPaymentMethods={CLIENT_PAYMENT_METHODS}
            provider="WHISH_APP"
            allDrawers={ALL_DRAWERS}
            destinationDrawer="Whish_App"
            defaultSourceDrawer="General"
          />,
        );

        switchToFromClient();
        // 1% auto fee on $100 USD → fee = $1.00, payout target = $99.00
        fireEvent.change(getAmountInput(), { target: { value: "100" } });
        submit();

        expect(onConfirmClient).toHaveBeenCalledTimes(1);
        const payload = onConfirmClient.mock.calls[0][0];
        const parsed = topUpFromClientSchema.parse(payload);
        expect(parsed.fee).toBe(1);
        const total = parsed.payments.reduce((sum, leg) => sum + leg.amount, 0);
        expect(total).toBeCloseTo(parsed.amount - parsed.fee, 2);
      });

      it("emits a manually-entered fee, overriding the 1% auto calculation", () => {
        const onConfirmClient = jest.fn().mockResolvedValue(undefined);
        render(
          <TopUpModal
            isOpen
            onClose={jest.fn()}
            onConfirm={jest.fn()}
            onConfirmClient={onConfirmClient}
            clientPaymentMethods={CLIENT_PAYMENT_METHODS}
            provider="WHISH_APP"
            allDrawers={ALL_DRAWERS}
            destinationDrawer="Whish_App"
            defaultSourceDrawer="General"
          />,
        );

        switchToFromClient();
        fireEvent.change(getAmountInput(), { target: { value: "100" } });
        fireEvent.change(getFeeInput(), { target: { value: "5" } });
        submit();

        expect(onConfirmClient).toHaveBeenCalledTimes(1);
        const payload = onConfirmClient.mock.calls[0][0];
        const parsed = topUpFromClientSchema.parse(payload);
        expect(parsed.fee).toBe(5);
        const total = parsed.payments.reduce((sum, leg) => sum + leg.amount, 0);
        // Owner-approved expectation change 2026-10-16: 95 → 100. "Fee
        // included" is unticked, so the client sends $105 and is paid $100.
        expect(total).toBeCloseTo(100, 2);
        expect(parsed.amount).toBeCloseTo(105, 6);
      });

      it("emits fee: 0 literally — not omitted — when there is no fee", () => {
        const onConfirmClient = jest.fn().mockResolvedValue(undefined);
        render(
          <TopUpModal
            isOpen
            onClose={jest.fn()}
            onConfirm={jest.fn()}
            onConfirmClient={onConfirmClient}
            clientPaymentMethods={CLIENT_PAYMENT_METHODS}
            provider="WHISH_APP"
            allDrawers={ALL_DRAWERS}
            destinationDrawer="Whish_App"
            defaultSourceDrawer="General"
          />,
        );

        switchToFromClient();
        // LBP: no 1% auto fee (that only applies to USD amounts) and no manual
        // fee entered — the fee is genuinely, legitimately 0.
        fireEvent.click(screen.getByRole("button", { name: /^lbp$/i }));
        fireEvent.change(getLbpAmountInput(), { target: { value: "100000" } });
        submit();

        expect(onConfirmClient).toHaveBeenCalledTimes(1);
        const payload = onConfirmClient.mock.calls[0][0];
        // The literal-zero check itself (rule 22's exact concern): `fee` must
        // be a present, numeric 0 — not stripped by a `?? undefined`/
        // truthiness guard on the way to the wire.
        expect(payload).toHaveProperty("fee");
        expect(payload.fee).toBe(0);
        expect(typeof payload.fee).toBe("number");

        const parsed = topUpFromClientSchema.parse(payload);
        expect(parsed.fee).toBe(0);
        const total = parsed.payments.reduce((sum, leg) => sum + leg.amount, 0);
        expect(total).toBeCloseTo(100000, 2);
      });
    });
  });
});

describe("TopUpModal.includingFees (LIRA-329)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-329 T020 — a Whish App top-up from a client sends the "Fee included
   * in amount" choice, so the transaction keeps it in its details. Before
   * this, the checkbox changed only what the modal displayed and never left
   * the screen.
   *
   * Field names come from the shared schema (rule 24): the payload is parsed
   * through `topUpFromClientSchema`, which strips any key it does not declare.
   *
   * Rule 17: run against the unchanged modal first and seen failing
   * (`includingFees` absent from the parsed payload).
   */

  const ALL_DRAWERS = [
    { name: "General", usdBalance: 500, lbpBalance: 0 },
    { name: "Whish_App", usdBalance: 0, lbpBalance: 0 },
  ];

  function renderModal(onConfirmClient: jest.Mock) {
    render(
      <TopUpModal
        isOpen
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        onConfirmClient={onConfirmClient}
        clientPaymentMethods={[{ code: "CASH", label: "Cash" }]}
        provider="WHISH_APP"
        allDrawers={ALL_DRAWERS}
        destinationDrawer="Whish_App"
        defaultSourceDrawer="General"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /from client/i }));
    fireEvent.change(screen.getAllByPlaceholderText("0.00")[0], {
      target: { value: "100" },
    });
  }

  function submit() {
    fireEvent.click(
      screen.getByRole("button", { name: /buy credits from client/i }),
    );
  }

  describe("TopUpModal — LIRA-329 including-fees choice", () => {
    it("ticked: the payload says the fee was included", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderModal(onConfirmClient);
      fireEvent.click(
        screen.getByRole("checkbox", { name: /fee included in amount/i }),
      );
      submit();

      expect(onConfirmClient).toHaveBeenCalledTimes(1);
      const payload = topUpFromClientSchema.parse(
        onConfirmClient.mock.calls[0][0],
      );
      expect(payload.includingFees).toBe(true);
    });

    it("left unticked: the payload says so too", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderModal(onConfirmClient);
      submit();

      const payload = topUpFromClientSchema.parse(
        onConfirmClient.mock.calls[0][0],
      );
      expect(payload.includingFees).toBe(false);
    });
  });
});

describe("TopUpModal.omtAppFundingDefault (LIRA-190)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-190/D4 — the OMT App top-up modal gets a funding-source CHOICE that
   * iPick/Katsh never needed: "On OMT credit" (default) vs "Transfer from
   * drawer" (the pre-existing path). Canonical implementation lives at
   * packages/ui/src/components/ui/TopUpModal.tsx; jest.config maps
   * "@liratek/ui" to that package's source (same convention as
   * CounterpartySettleModal's own tests), so this test imports it from there
   * rather than duplicating it under packages/ui (which has no jest of its
   * own — frontend's `roots` never scans it).
   *
   * What's guarded:
   *  - the choice defaults to "On OMT credit" and submitting in that state
   *    calls onConfirmSupplier (the credit path), never onConfirm (the
   *    transfer path) — proving the D4 default.
   *  - switching to "Transfer from drawer" and submitting calls onConfirm
   *    with the selected source drawer, never onConfirmSupplier — proving the
   *    alternative still reaches the pre-existing topUpApp path.
   *  - iPick/Katsh render NO funding choice at all (they only ever had the
   *    credit path) — a regression guard that this change didn't leak into
   *    the two providers that never asked for a toggle.
   *
   * Rule 17 note for whoever proves this failing-first: reverting
   * TopUpModal's `isSupplierCredit` to its pre-fix form
   * (`(provider === "iPick" || provider === "Katsh") && !!onConfirmSupplier`)
   * makes the "defaults to credit" test below fail, because OMT App would
   * fall through to the transfer branch (onConfirm) even with nothing
   * clicked.
   */

  const ALL_DRAWERS = [
    { name: "General", usdBalance: 500, lbpBalance: 0 },
    { name: "OMT_App", usdBalance: 20, lbpBalance: 0 },
  ];

  describe("TopUpModal — OMT App funding choice (D4)", () => {
    it("defaults to 'On OMT credit' and submits via onConfirmSupplier", async () => {
      const onConfirm = jest.fn().mockResolvedValue(undefined);
      const onConfirmSupplier = jest.fn().mockResolvedValue(undefined);

      render(
        <TopUpModal
          isOpen
          onClose={jest.fn()}
          onConfirm={onConfirm}
          onConfirmSupplier={onConfirmSupplier}
          provider="OMT_APP"
          allDrawers={ALL_DRAWERS}
          destinationDrawer="OMT_App"
          defaultSourceDrawer="General"
        />,
      );

      const creditToggle = screen.getByTestId("topup-funding-credit");
      const transferToggle = screen.getByTestId("topup-funding-transfer");
      expect(creditToggle).toBeInTheDocument();
      expect(transferToggle).toBeInTheDocument();

      // No source-drawer selector while the (default) credit mode is active.
      expect(screen.queryByText("From Drawer")).not.toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText("0.00"), {
        target: { value: "100" },
      });
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

      expect(onConfirmSupplier).toHaveBeenCalledWith({
        amount: 100,
        currency: "USD",
      });
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it("'Transfer from drawer' submits via onConfirm, not onConfirmSupplier", async () => {
      const onConfirm = jest.fn().mockResolvedValue(undefined);
      const onConfirmSupplier = jest.fn().mockResolvedValue(undefined);

      render(
        <TopUpModal
          isOpen
          onClose={jest.fn()}
          onConfirm={onConfirm}
          onConfirmSupplier={onConfirmSupplier}
          provider="OMT_APP"
          allDrawers={ALL_DRAWERS}
          destinationDrawer="OMT_App"
          defaultSourceDrawer="General"
        />,
      );

      fireEvent.click(screen.getByTestId("topup-funding-transfer"));

      // Source-drawer selector reappears once "Transfer from drawer" is picked.
      expect(screen.getByText("From Drawer")).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText("0.00"), {
        target: { value: "50" },
      });
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

      expect(onConfirm).toHaveBeenCalledWith({
        amount: 50,
        currency: "USD",
        sourceDrawer: "General",
      });
      expect(onConfirmSupplier).not.toHaveBeenCalled();
    });

    it("renders no funding choice for iPick/Katsh (credit is their only path)", () => {
      render(
        <TopUpModal
          isOpen
          onClose={jest.fn()}
          onConfirm={jest.fn()}
          onConfirmSupplier={jest.fn()}
          provider="iPick"
          allDrawers={ALL_DRAWERS}
          destinationDrawer="iPick"
          defaultSourceDrawer="General"
        />,
      );

      expect(
        screen.queryByTestId("topup-funding-credit"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("topup-funding-transfer"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("TopUpModal.payoutExtraLess (LIRA-382)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Whish App "From Client" top-up — the "− Less | + Extra" line on the
   * payout (LIRA-382). Table-driven, the same cases as every other payout
   * screen; the shop owes $99.00. The payload is parsed through
   * `topUpFromClientSchema` before its fields are read (rule 24).
   * Rule 17: run against the box without the line first — see the task report.
   */

  const ALL_DRAWERS = [
    { name: "General", usdBalance: 500, lbpBalance: 0 },
    { name: "Whish_App", usdBalance: 0, lbpBalance: 0 },
  ];
  const CLIENT_PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];

  function renderModal(onConfirmClient: jest.Mock) {
    render(
      <TopUpModal
        isOpen
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        onConfirmClient={onConfirmClient}
        clientPaymentMethods={CLIENT_PAYMENT_METHODS}
        provider="WHISH_APP"
        allDrawers={ALL_DRAWERS}
        destinationDrawer="Whish_App"
        defaultSourceDrawer="General"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /from client/i }));
    // $100 credits, fee included → the shop owes $99.00.
    fireEvent.change(screen.getAllByPlaceholderText("0.00")[0], {
      target: { value: "100" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /fee included in amount/i }),
    );
  }

  type Parsed = ReturnType<typeof topUpFromClientSchema.parse>;
  const CASES: {
    name: string;
    side: PayoutLineSide;
    typed: string;
    leg: number;
    check: (p: Parsed) => void;
  }[] = [
    {
      name: "+ Extra 0.10 on $99.00 → pays $99.10, rounding_given_usd 0.1",
      side: "extra",
      typed: "0.10",
      leg: 99.1,
      check: (p) => {
        expect(p.rounding_given_usd).toBe(0.1);
        expect(p.kept_change_usd ?? 0).toBe(0);
      },
    },
    {
      name: "− Less 0.50 on $99.00 → pays $98.50, kept_change_usd 0.5",
      side: "less",
      typed: "0.50",
      leg: 98.5,
      check: (p) => {
        expect(p.kept_change_usd).toBe(0.5);
        expect(p.rounding_given_usd ?? 0).toBe(0);
      },
    },
  ];

  describe("TopUpModal — From Client payout '− Less | + Extra' line (LIRA-382)", () => {
    it.each(CASES)("$name", (c) => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderModal(onConfirmClient);
      setPayoutLine(c.side, c.typed);
      expect(payoutLegAmounts()).toEqual([c.leg]);
      fireEvent.click(
        screen.getByRole("button", { name: /buy credits from client/i }),
      );
      expect(onConfirmClient).toHaveBeenCalledTimes(1);
      const p = topUpFromClientSchema.parse(onConfirmClient.mock.calls[0][0]);
      expect(p.payments).toEqual([
        expect.objectContaining({ currencyCode: "USD", amount: c.leg }),
      ]);
      c.check(p);
    });
  });
});

describe("TopUpModal.payoutKeptChange", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Whish App "From Client" top-up is a PAYOUT: the client hands the shop
   * credits and the shop pays out amount − fee from its drawers. Owner
   * decisions 2026-10-07 (FEATURE_GUIDE §4.1 "Kept change"): on a payout the
   * shop may hand out a round figure a little SHORT of what it owes (under
   * $1 / 100,000 LBP) and keep the leftover as profit — the payment form runs
   * in `payer="payout"` mode and the kept amount rides the SAME payload
   * (`kept_change_*`), which the server verifies (resolveKeptChange).
   *
   * Renders the real MultiPaymentInput (jest maps @liratek/ui to source).
   * Field names come from `topUpFromClientSchema` (rule 24).
   * Rule 17: run against the pre-change modal first — see the task report.
   */

  const ALL_DRAWERS = [
    { name: "General", usdBalance: 500, lbpBalance: 0 },
    { name: "Whish_App", usdBalance: 0, lbpBalance: 0 },
  ];
  const CLIENT_PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];

  function renderModal(onConfirmClient: jest.Mock) {
    render(
      <TopUpModal
        isOpen
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        onConfirmClient={onConfirmClient}
        clientPaymentMethods={CLIENT_PAYMENT_METHODS}
        provider="WHISH_APP"
        allDrawers={ALL_DRAWERS}
        destinationDrawer="Whish_App"
        defaultSourceDrawer="General"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /from client/i }));
    // $100 credits → 1% auto fee → the shop owes $99.00. "Fee included" is
    // ticked so the fee comes out of the credits (owner decision 2026-10-16:
    // unticked, the client sends $101 and is owed the full $100).
    fireEvent.change(screen.getAllByPlaceholderText("0.00")[0], {
      target: { value: "100" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /fee included in amount/i }),
    );
  }

  function setPayout(value: string) {
    const leg = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    expect(leg).not.toBeNull();
    fireEvent.change(leg as HTMLInputElement, { target: { value } });
  }

  function submit() {
    fireEvent.click(
      screen.getByRole("button", { name: /buy credits from client/i }),
    );
  }

  describe("TopUpModal — From Client payout keeps a small leftover as profit", () => {
    it("owes $99, hands out $98.50: sends kept_change_usd 0.50 with the legs", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderModal(onConfirmClient);
      setPayout("98.5");
      submit();

      expect(onConfirmClient).toHaveBeenCalledTimes(1);
      const parsed = topUpFromClientSchema.parse(
        onConfirmClient.mock.calls[0][0],
      );
      expect(parsed.payments).toEqual([
        expect.objectContaining({ currencyCode: "USD", amount: 98.5 }),
      ]);
      expect(parsed.kept_change_usd).toBe(0.5);
      expect(parsed.kept_change_lbp ?? 0).toBe(0);
    });

    it("an exact payout sends no kept change", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderModal(onConfirmClient);
      submit();

      const parsed = topUpFromClientSchema.parse(
        onConfirmClient.mock.calls[0][0],
      );
      expect(parsed.kept_change_usd ?? 0).toBe(0);
      expect(parsed.kept_change_lbp ?? 0).toBe(0);
    });
  });
});

describe("TopUpModal.roundUp (LIRA-334)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Whish App "From Client" top-up — payout round-up (LIRA-334).
   *
   * The shop owes the client $99.00 and hands over $100: the $1.00 extra is
   * within the $5 cap, so it rides the SAME payload as the legs
   * (`rounding_given_*`) and the server books it as change rounding. Field
   * names come from `topUpFromClientSchema` (rule 24): the payload is parsed
   * through the real schema, so a field the schema does not know is stripped
   * and the assertion fails.
   *
   * Rule 17: run against the pre-change modal first — see the task report.
   */

  const ALL_DRAWERS = [
    { name: "General", usdBalance: 500, lbpBalance: 0 },
    { name: "Whish_App", usdBalance: 0, lbpBalance: 0 },
  ];
  const CLIENT_PAYMENT_METHODS = [{ code: "CASH", label: "Cash" }];

  function renderModal(onConfirmClient: jest.Mock) {
    render(
      <TopUpModal
        isOpen
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        onConfirmClient={onConfirmClient}
        clientPaymentMethods={CLIENT_PAYMENT_METHODS}
        provider="WHISH_APP"
        allDrawers={ALL_DRAWERS}
        destinationDrawer="Whish_App"
        defaultSourceDrawer="General"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /from client/i }));
    // $100 credits, fee included → the shop owes $99.00.
    fireEvent.change(screen.getAllByPlaceholderText("0.00")[0], {
      target: { value: "100" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /fee included in amount/i }),
    );
  }

  function setPayout(value: string) {
    const leg = document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    expect(leg).not.toBeNull();
    fireEvent.change(leg as HTMLInputElement, { target: { value } });
  }

  function submit() {
    fireEvent.click(
      screen.getByRole("button", { name: /buy credits from client/i }),
    );
  }

  describe("TopUpModal — From Client payout round-up (LIRA-334)", () => {
    it("owes $99, hands out $100: sends rounding_given_usd 1 with the legs and no kept change", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderModal(onConfirmClient);
      setPayout("100");
      expect(screen.getByTestId("payout-roundup-summary")).toBeInTheDocument();
      submit();

      expect(onConfirmClient).toHaveBeenCalledTimes(1);
      const parsed = topUpFromClientSchema.parse(
        onConfirmClient.mock.calls[0][0],
      );
      expect(parsed.payments).toEqual([
        expect.objectContaining({ currencyCode: "USD", amount: 100 }),
      ]);
      expect(parsed.rounding_given_usd).toBe(1);
      expect(parsed.rounding_given_lbp ?? 0).toBe(0);
      expect(parsed.kept_change_usd ?? 0).toBe(0);
    });

    it("an exact payout sends no rounding", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderModal(onConfirmClient);
      submit();

      const parsed = topUpFromClientSchema.parse(
        onConfirmClient.mock.calls[0][0],
      );
      expect(parsed.rounding_given_usd ?? 0).toBe(0);
      expect(parsed.rounding_given_lbp ?? 0).toBe(0);
    });

    it("a short payout keeps change and sends no rounding (never both)", () => {
      const onConfirmClient = jest.fn().mockResolvedValue(undefined);
      renderModal(onConfirmClient);
      setPayout("98.5");
      submit();

      const parsed = topUpFromClientSchema.parse(
        onConfirmClient.mock.calls[0][0],
      );
      expect(parsed.kept_change_usd).toBe(0.5);
      expect(parsed.rounding_given_usd ?? 0).toBe(0);
    });
  });
});

describe("TopUpModal.scrollLayout (LIRA-141)", () => {
  beforeAll(resetBetweenFiles);

  // NOT RUN — proven at the end-of-batch gate.
  //
  // LIRA-141 (scroll bug) — TopUpModal's panel used to have no max height and
  // the scrollable "Content" div had no overflow, so Cancel/Confirm — which
  // lived INSIDE that same unscrolled div (packages/ui/src/components/ui/
  // TopUpModal.tsx, pre-fix :839-879) — became unreachable whenever the modal
  // content (e.g. Whish App "From Client": mode toggle, fee breakdown, client
  // picker, MultiPaymentInput payout block, info box, footer) grew taller than
  // the viewport. Mouse-wheel scrolling did nothing (the overlay/panel had no
  // overflow of its own) and Playwright's scroll-into-view retried 58 times
  // and timed out (see OWNER_NOTES_REMAINING_BUILD.md #lira-141 evidence).
  //
  // The fix (CashReportModal's existing scrollable-modal pattern): the panel
  // gets `max-h-[90vh]` + `flex flex-col`; the header and the new dedicated
  // footer are `shrink-0`; only the body between them is
  // `flex-1 min-h-0 overflow-y-auto`. jsdom has no real layout engine, so this
  // test can only pin the STRUCTURE (the confirm/cancel buttons are outside
  // the scrolling container, and that container is marked overflow-y-auto) —
  // it cannot prove pixels actually scroll. The real proof is the lira-141 e2e
  // re-run (Case B), which the owner runs (CLAUDE.md: owner runs e2e/dev).
  //
  // Rule 17: this test is written to FAIL against the pre-fix markup (footer
  // buttons as the last children inside the same `p-6 space-y-5` div as the
  // rest of the content, no `overflow-y-auto` anywhere in the panel) — that
  // pre-fix shape has no element matching `[class*="overflow-y-auto"]` at
  // all, so the very first assertion (the scroll container must exist) fails
  // outright. Per the owner process rule for this batch, this has not been
  // executed yet; it is proven failing-then-passing at the end-of-batch gate,
  // not asserted here.

  const ALL_DRAWERS = [{ name: "General", usdBalance: 500, lbpBalance: 0 }];

  describe("TopUpModal — scrollable-modal layout (LIRA-141)", () => {
    it("keeps Cancel/Confirm outside the scrolling body, in a fixed footer", () => {
      render(
        <TopUpModal
          isOpen
          onClose={jest.fn()}
          onConfirm={jest.fn()}
          provider="MTC"
          allDrawers={ALL_DRAWERS}
          destinationDrawer="MTC"
          defaultSourceDrawer="General"
        />,
      );

      const scrollBody = document.querySelector('[class*="overflow-y-auto"]');
      expect(scrollBody).not.toBeNull();

      const cancelButton = screen.getByRole("button", { name: /cancel/i });
      const confirmButton = screen.getByRole("button", {
        name: /confirm top-up/i,
      });

      expect(scrollBody?.contains(cancelButton)).toBe(false);
      expect(scrollBody?.contains(confirmButton)).toBe(false);

      // The panel itself must cap its height so the flex layout has something
      // to overflow against — without a max-h, flex-1/overflow-y-auto on the
      // body never engages because the panel just grows to fit its content.
      const panel = confirmButton.closest('[class*="max-h-"]');
      expect(panel).not.toBeNull();
    });
  });
});

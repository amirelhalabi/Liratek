/** @jest-environment jsdom */

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

import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TopUpModal } from "@liratek/ui";
import { topUpFromClientSchema } from "@liratek/core";

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
    // Overtype the single payout line above the target (target is 99 after
    // the 1% auto fee) — if onReturnChange were ever wired, this is exactly
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
    // 1% auto fee on $100 USD → payout target = $99.00
    fireEvent.change(getAmountInput(), { target: { value: "100" } });

    fireEvent.click(screen.getByTestId("split-toggle"));
    let amountInputs = document.querySelectorAll<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );
    fireEvent.change(amountInputs[0], { target: { value: "60" } });

    fireEvent.click(
      screen.getByRole("button", { name: /add payout line/i }),
    );
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
    expect(total).toBeCloseTo(99, 2);
    // The same $1 auto fee this split payout target (99 = 100 - 1) was
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
      expect(total).toBeCloseTo(95, 2);
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

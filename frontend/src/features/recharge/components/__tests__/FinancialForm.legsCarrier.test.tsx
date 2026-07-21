/** @jest-environment jsdom */
/**
 * FinancialForm — split payment legs book against exactly ONE carrier txn.
 *
 * The form submits ONE addOMTTransaction call PER CART UNIT (quantity loop).
 * Pre-fix it attached the same whole-cart `payments[]` to EVERY unit call;
 * the backend multi-payment branch books each leg's full amount per call, so
 * an N-unit cart with a split payment overbooked the drawer inflow and any
 * CUSTOMER_ACCOUNT debt N×. KatchForm's bills loop already guards this exact
 * trap ("attaching the same legs to a second transaction would multiply the
 * drawer inflow") — this test pins the same carrier convention here:
 *
 *   unit #1 (carrier): carries the full legs array (+ kept change)
 *   units #2..N:       payments undefined + deferPayment true (cost +
 *                      commission only — the session-basket mechanism)
 *
 * Proven failing-first (rule 17) against the pre-fix loop: the second call
 * carried the same 2-leg array and no deferPayment.
 *
 * Exposure note: MultiPaymentInput's auto-debt remainder (same change set)
 * makes split payloads the COMMON case whenever a client underpays, so this
 * guard is load-bearing, not theoretical.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FinancialForm } from "../FinancialForm";
import type { ServiceItem } from "../../hooks/useMobileServiceItems";
import type { ProviderConfig } from "../../types";

// ── Capture addOMTTransaction payloads ──────────────────────────────────────
const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    addOMTTransaction: mockAddOMTTransaction,
    // useAutoPrintReceipt (LIRA-069 W1.d) pulls shop info via useShopInfo(),
    // which calls this on mount.
    getAllSettings: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ buyRate: 89000, sellRate: 90000 }),
}));

// Client resolution is not under test — always resolves.
jest.mock("../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: 411 }),
}));

// Heavy children with their own data needs — not under test.
jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: () => <input data-testid="stub-client-input" />,
}));
jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));
jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));
jest.mock("../HistoryModal", () => ({
  HistoryModal: () => null,
}));
jest.mock("@/shared/utils/clientVouchers", () => ({
  fetchClientVouchers: jest.fn().mockResolvedValue([]),
}));

// PaymentSheet stub: exposes the callbacks the test drives — inject a split
// (CASH + CUSTOMER_ACCOUNT), a SINGLE line, or a return/change (OUT) leg, and
// confirm. The real sheet's internals (MultiPaymentInput) are covered by
// MultiPaymentInput.test.tsx.
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    onPaymentChange: (lines: unknown[]) => void;
    onReturnChange?: (legs: unknown[]) => void;
    onConfirm: () => void;
  }) =>
    props.open ? (
      <div data-testid="stub-payment-sheet">
        <button
          data-testid="stub-inject-split"
          onClick={() =>
            props.onPaymentChange([
              { id: "L1", method: "CASH", currencyCode: "LBP", amount: 500000 },
              {
                id: "L2",
                method: "CUSTOMER_ACCOUNT",
                currencyCode: "LBP",
                amount: 100000,
              },
            ])
          }
        />
        <button
          data-testid="stub-inject-single"
          onClick={() =>
            props.onPaymentChange([
              { id: "L1", method: "CASH", currencyCode: "LBP", amount: 300000 },
            ])
          }
        />
        <button
          data-testid="stub-inject-return"
          onClick={() =>
            props.onReturnChange?.([
              {
                id: "R1",
                method: "CASH",
                currencyCode: "LBP",
                amount: 50000,
                direction: "OUT",
              },
            ])
          }
        />
        <button data-testid="stub-confirm" onClick={props.onConfirm} />
      </div>
    ) : null,
}));

// ── Fixtures ────────────────────────────────────────────────────────────────
const ITEM: ServiceItem = {
  key: "WHISH_APP/bills/Internet/DSL 300k",
  provider: "WHISH_APP",
  category: "bills",
  subcategory: "Internet",
  label: "DSL 300k",
  catalogCost: 250000,
  catalogSellPrice: 300000,
  sortOrder: 0,
};

const CONFIG: ProviderConfig = {
  key: "WHISH_APP",
  label: "Whish App",
  module: "ipec_katch",
  drawer: "Whish_App",
  formMode: "financial",
  color: "text-red-400",
  bgTint: "bg-red-400/10",
  activeBg: "bg-red-500",
  activeText: "text-white",
  badgeCls: "bg-red-400/10 text-red-400",
  iconKey: "Zap",
  hasSupplier: true,
};

function renderForm() {
  return render(
    <FinancialForm
      activeConfig={CONFIG}
      finTransactions={[]}
      activeProvider="WHISH_APP"
      getCategoriesForProvider={() => ["bills"]}
      getServiceItems={(_p, category) => (category === "bills" ? [ITEM] : [])}
      methods={[
        { code: "CASH", label: "Cash" },
        { code: "CUSTOMER_ACCOUNT", label: "Customer Account (Debt)" },
      ]}
      clientName="amir halabi"
      setClientName={jest.fn()}
      loadFinancialData={jest.fn()}
      formatAmount={(v) => v.toLocaleString()}
      showHistory={false}
      setShowHistory={jest.fn()}
    />,
  );
}

/** Add the fixture item with quantity 2, then open the payment sheet. */
async function cartTwoUnitsAndOpenSheet() {
  // First click on the card adds qty 1 and reveals the +/− stepper.
  fireEvent.click(screen.getByText("DSL 300k"));
  fireEvent.click(await screen.findByRole("button", { name: "+" }));
  fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
  await screen.findByTestId("stub-payment-sheet");
}

describe("FinancialForm — legs-carrier convention (split × multi-unit cart)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
  });

  it("books the split legs on the FIRST unit only; sibling units defer payment", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();

    fireEvent.click(screen.getByTestId("stub-inject-split"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(2));

    const [first, second] = mockAddOMTTransaction.mock.calls.map(
      (c: unknown[]) => c[0] as Record<string, unknown>,
    );

    // Carrier: full legs, no deferPayment.
    expect(first.payments).toEqual([
      expect.objectContaining({ method: "CASH", amount: 500000 }),
      expect.objectContaining({ method: "CUSTOMER_ACCOUNT", amount: 100000 }),
    ]);
    expect(first.deferPayment).toBeUndefined();
    expect(first.paidByMethod).toBe("MULTI");

    // Sibling: NO legs (would double-book drawer + debt), defers instead.
    expect(second.payments).toBeUndefined();
    expect(second.deferPayment).toBe(true);
  });

  it("single-payment submits (no legs array) keep per-unit booking on every call", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();

    // No split injected — paymentLines stays empty, paymentsPayload undefined.
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(2));

    for (const call of mockAddOMTTransaction.mock.calls) {
      const payload = call[0] as Record<string, unknown>;
      expect(payload.payments).toBeUndefined();
      expect(payload.deferPayment).toBeUndefined();
      expect(payload.paidByMethod).toBe("CASH");
    }
  });

  // S1 (PAYMENT_LEGS_INTEGRITY_PLAN wave 6) — never gate legs on split. A
  // SINGLE-line payment (the common case) must still carry the tender's own
  // amount/currency as a real `payments[]` leg, not just a bare
  // `paidByMethod` string. Pre-fix, the gate was `isSplitPayment ||
  // hasVoucherLeg` — a lone CASH line satisfied neither, so `paymentsPayload`
  // was `undefined` and the tender's amount/currency never reached the
  // backend (the owner-reported Whish App LBP-as-USD bug class).
  it("forwards a SINGLE-line payment as a real leg (S1 — no split gate)", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();

    fireEvent.click(screen.getByTestId("stub-inject-single"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(2));

    const [first, second] = mockAddOMTTransaction.mock.calls.map(
      (c: unknown[]) => c[0] as Record<string, unknown>,
    );

    // Carrier: the single line still reaches the backend as a real leg.
    expect(first.payments).toEqual([
      expect.objectContaining({
        method: "CASH",
        currencyCode: "LBP",
        amount: 300000,
      }),
    ]);
    expect(first.deferPayment).toBeUndefined();
    expect(first.paidByMethod).toBe("CASH");

    // Sibling still defers — the carrier convention is unaffected by S1.
    expect(second.payments).toBeUndefined();
    expect(second.deferPayment).toBe(true);
  });

  // S6 (PAYMENT_LEGS_INTEGRITY_PLAN wave 6) — this form never wired change
  // legs at all: no `returnLegs` state, no `onReturnChange` on PaymentSheet,
  // so overpayment change was never recorded (lira-088 rule). Prove a
  // single-line payment PLUS a return/change (OUT) leg both reach the
  // backend in one `payments[]` array.
  it("forwards the return/change (OUT) leg alongside the tender (S6 — wiring added)", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();

    fireEvent.click(screen.getByTestId("stub-inject-single"));
    fireEvent.click(screen.getByTestId("stub-inject-return"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(2));

    const [first] = mockAddOMTTransaction.mock.calls.map(
      (c: unknown[]) => c[0] as Record<string, unknown>,
    );

    expect(first.payments).toEqual([
      expect.objectContaining({
        method: "CASH",
        currencyCode: "LBP",
        amount: 300000,
      }),
      expect.objectContaining({
        method: "CASH",
        currencyCode: "LBP",
        amount: 50000,
        direction: "OUT",
      }),
    ]);
  });

  // Payment-Legs Integrity plan wave 8: the carrier's own `amount` is just
  // ONE unit's price (300000 here) — the payment legs it carries cover the
  // WHOLE cart (2 units x 300000 = 600000 LBP). checkoutTotal tells the
  // repository the real customer-owed total to reconcile the legs against,
  // instead of the one-unit `amount`. Must match the cart total the header
  // displays ("2 items — 600,000 LBP"), and must ride ONLY the carrier call.
  it("attaches checkoutTotal (whole-cart total) on the carrier only, matching the displayed cart total", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();

    fireEvent.click(screen.getByTestId("stub-inject-split"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(2));

    const [first, second] = mockAddOMTTransaction.mock.calls.map(
      (c: unknown[]) => c[0] as Record<string, unknown>,
    );

    // 2 units x 300,000 LBP catalog sell price, no discount injected here.
    expect(first.checkoutTotal).toEqual({ usd: 0, lbp: 600000 });
    // Sibling unit defers payment — it must NOT also carry the checkout total.
    expect(second.checkoutTotal).toBeUndefined();
  });

  it("checkoutTotal also rides a SINGLE-line (non-split) carrier — S1 applies to it too", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();

    fireEvent.click(screen.getByTestId("stub-inject-single"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(2));

    const [first] = mockAddOMTTransaction.mock.calls.map(
      (c: unknown[]) => c[0] as Record<string, unknown>,
    );

    expect(first.checkoutTotal).toEqual({ usd: 0, lbp: 600000 });
  });

  it("no legs at all (single payment, no split/return) → no checkoutTotal on any call", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();

    // No split/return injected — paymentsPayload stays undefined.
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(2));

    for (const call of mockAddOMTTransaction.mock.calls) {
      const payload = call[0] as Record<string, unknown>;
      expect(payload.checkoutTotal).toBeUndefined();
    }
  });

  // Payment-Legs Integrity plan (wave 9, lira-095): MultiPaymentInput
  // converts USD/LBP tender at whatever `exchangeRate` this form passes to
  // its PaymentSheet — `isMoneyIn ? sellRate : buyRate`, and `isMoneyIn`
  // stays false here because `serviceType` isn't supplied to this render
  // (the mocked useSellRate above returns buyRate=89000, sellRate=90000).
  // The repository's OWN stamped/live rate can be a DIFFERENT number (the
  // sell rate), so reconciling the carrier's legs at that rate instead of
  // the till's own buyRate false-rejects a legitimate cross-currency
  // checkout once the spread exceeds the $0.05 epsilon (lira-095's exact
  // bug). `tender_exchange_rate` tells the repository which rate to use.
  it("attaches tender_exchange_rate (the rate MPI actually used) alongside checkoutTotal, on the carrier only", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();

    fireEvent.click(screen.getByTestId("stub-inject-split"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(2));

    const [first, second] = mockAddOMTTransaction.mock.calls.map(
      (c: unknown[]) => c[0] as Record<string, unknown>,
    );

    expect(first.tender_exchange_rate).toBe(89000);
    // Sibling defers payment — it must not also carry a reconciliation rate.
    expect(second.tender_exchange_rate).toBeUndefined();
  });
});

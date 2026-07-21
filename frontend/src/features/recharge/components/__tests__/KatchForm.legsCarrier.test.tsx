/** @jest-environment jsdom */
/**
 * KatchForm — checkoutTotal on the legs-carrying transaction
 * (PAYMENT_LEGS_INTEGRITY_PLAN wave 8).
 *
 * KatchForm aggregates every cart-item unit into ONE addOMTTransaction call
 * (unlike FinancialForm's per-unit loop), and that aggregated call's own
 * `amount` is the DISCOUNTED cart total already — so on its own it looks like
 * `checkoutTotal` would be redundant here. It is not: once a bill is ALSO in
 * the checkout, the same legs-carrying call's `amount` covers only the cart
 * items, while the payment legs it carries cover items + bills together (see
 * the "Process pending bills" comment in KatchForm.tsx). `checkoutTotal` is
 * what tells the repository the real whole-checkout total to reconcile the
 * legs against, independent of which line happens to carry them.
 *
 * No existing test file exercised KatchForm's own submit flow before this
 * (Recharge.cryptoLegsGate.test.tsx mocks the whole `components` barrel to
 * test Recharge/index.tsx's Binance branch in isolation) — this is a new
 * file, not an extension.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { KatchForm } from "../KatchForm";
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

// Client resolution is not under test — always resolves.
jest.mock("../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: 411 }),
}));

// Brand SVGs (?react imports) have no jest transform configured — stub them.
jest.mock("@/assets/logos/alfa.svg?react", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/assets/logos/mtc.svg?react", () => ({
  __esModule: true,
  default: () => null,
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

// PaymentSheet stub: exposes the callbacks the test drives.
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
          data-testid="stub-inject-single"
          onClick={() =>
            props.onPaymentChange([
              { id: "L1", method: "CASH", currencyCode: "LBP", amount: 600000 },
            ])
          }
        />
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
        <button data-testid="stub-confirm" onClick={props.onConfirm} />
      </div>
    ) : null,
}));

// ── Fixtures ────────────────────────────────────────────────────────────────
const ITEM: ServiceItem = {
  key: "Katsh/games/PUBG/60UC",
  provider: "Katsh",
  category: "games",
  subcategory: "pubg",
  label: "60UC",
  catalogCost: 250000,
  catalogSellPrice: 300000,
  sortOrder: 0,
};

const CONFIG: ProviderConfig = {
  key: "Katsh",
  label: "Katsh",
  module: "ipec_katch",
  drawer: "Katsh",
  formMode: "financial",
  color: "text-orange-400",
  bgTint: "bg-orange-400/10",
  activeBg: "bg-orange-500",
  activeText: "text-white",
  badgeCls: "bg-orange-400/10 text-orange-400",
  iconKey: "Zap",
  hasSupplier: true,
};

function renderForm() {
  return render(
    <KatchForm
      activeConfig={CONFIG}
      activeProvider="Katsh"
      getCategoriesForProvider={() => ["games"]}
      getServiceItems={(_p, category) => (category === "games" ? [ITEM] : [])}
      methods={[
        { code: "CASH", label: "Cash" },
        { code: "CUSTOMER_ACCOUNT", label: "Customer Account (Debt)" },
      ]}
      loadFinancialData={jest.fn()}
      formatAmount={(v) => v.toLocaleString()}
      alfaCreditSellRate={1500}
      alfaCreditCostRate={1400}
      exchangeRate={90000}
      showHistory={false}
      setShowHistory={jest.fn()}
    />,
  );
}

/** Add the fixture item with quantity 2, then open the payment sheet. */
async function cartTwoUnitsAndOpenSheet() {
  await screen.findByText("60UC");
  // The whole card is clickable — first click adds qty 1 and reveals it.
  fireEvent.click(screen.getByText("60UC"));
  fireEvent.click(await screen.findByRole("button", { name: "+" }));
  fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
  await screen.findByTestId("stub-payment-sheet");
}

describe("KatchForm — checkoutTotal on the legs-carrying transaction", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
  });

  it("attaches checkoutTotal (whole-cart total) matching the displayed cart total, on a single-line payment", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();

    fireEvent.click(screen.getByTestId("stub-inject-single"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    // 2 units x 300,000 LBP catalog sell price, no discount injected here,
    // no bills in this checkout.
    expect(payload.checkoutTotal).toEqual({ usd: 0, lbp: 600000 });
    expect(payload.payments).toEqual([
      expect.objectContaining({ method: "CASH", amount: 600000 }),
    ]);
  });

  it("attaches checkoutTotal on a split payment too (S1 — never gated on split)", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();

    fireEvent.click(screen.getByTestId("stub-inject-split"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.checkoutTotal).toEqual({ usd: 0, lbp: 600000 });
  });

  it("no legs at all (no payment lines injected) → no checkoutTotal", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();

    // No injection — paymentLines stays empty, paymentsPayload undefined.
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.checkoutTotal).toBeUndefined();
    expect(payload.payments).toBeUndefined();
  });

  // Payment-Legs Integrity plan (wave 9, lira-095): the `exchangeRate` prop
  // this page passes is the BUY rate (Recharge/index.tsx: `const { buyRate:
  // exchangeRate } = useSellRate()`), which is what MultiPaymentInput
  // actually converts cross-currency tender/change at. The repository's own
  // stamped/live rate lookup can differ (sell-side), so checkoutTotal
  // reconciliation must compare at the SAME rate the till used — otherwise a
  // legitimate buy/sell-spread checkout false-rejects once the mismatch
  // exceeds the $0.05 epsilon.
  it("attaches tender_exchange_rate (the exchangeRate prop) alongside checkoutTotal", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();

    fireEvent.click(screen.getByTestId("stub-inject-single"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.tender_exchange_rate).toBe(90000);
  });

  it("no legs at all → no tender_exchange_rate either", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();

    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.tender_exchange_rate).toBeUndefined();
  });
});

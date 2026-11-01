/** @jest-environment jsdom */
/**
 * LIRA-366 T050 — the Katsh / iPick checkout has the optional Note box under
 * its payment box. What the cashier types is sent as `typedNote` on the
 * checkout's transaction; a blank box sends nothing. Harness copied from
 * KatshForm.legsCarrier (the stub PaymentSheet also renders its children so
 * the real Note box is on screen).
 *
 * Field names come from the core schema (rule 24).
 * Rule 17: run against the unchanged form first and seen failing.
 */

/**
 * KatshForm — checkoutTotal on the legs-carrying transaction
 * (PAYMENT_LEGS_INTEGRITY_PLAN wave 8).
 *
 * KatshForm aggregates every cart-item unit into ONE addOMTTransaction call
 * (unlike FinancialForm's per-unit loop), and that aggregated call's own
 * `amount` is the DISCOUNTED cart total already — so on its own it looks like
 * `checkoutTotal` would be redundant here. It is not: once a bill is ALSO in
 * the checkout, the same legs-carrying call's `amount` covers only the cart
 * items, while the payment legs it carries cover items + bills together (see
 * the "Process pending bills" comment in KatshForm.tsx). `checkoutTotal` is
 * what tells the repository the real whole-checkout total to reconcile the
 * legs against, independent of which line happens to carry them.
 *
 * No existing test file exercised KatshForm's own submit flow before this
 * (Recharge.cryptoLegsGate.test.tsx mocks the whole `components` barrel to
 * test Recharge/index.tsx's Binance branch in isolation) — this is a new
 * file, not an extension.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFinancialServiceSchema } from "@liratek/core";
import { KatshForm } from "../KatshForm";
import type { ServiceItem } from "../../hooks/useMobileServiceItems";
import type { ProviderConfig } from "../../types";

// ── Capture addOMTTransaction payloads ──────────────────────────────────────
const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });

// KatshForm imports pure helpers from @liratek/core. Load the REAL module:
// frontend/jest.config.ts maps @liratek/core to packages/core/src/browser.ts,
// so the Node-only DB chain the old hand-written mock existed to dodge is no
// longer in the graph. That mock re-implemented isTelecomSplitComplete and
// maxReturnableCredits in test code -- a rule-14 duplication that let this
// suite drift from production and broke the moment the component imported one
// more core function.
jest.mock("@liratek/core", () => jest.requireActual("@liratek/core"));

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    addOMTTransaction: mockAddOMTTransaction,
    // useAutoPrintReceipt (LIRA-069 W1.d) pulls shop info via useShopInfo(),
    // which calls this on mount.
    getAllSettings: jest.fn().mockResolvedValue([]),
    // Only-Days pricing model (2026-08-05): KatshForm fetches the catalog's
    // sell_days_lbp/sell_credit_lbp on mount. Empty here on purpose — none of
    // these fixtures carry a computed days price.
    getActiveMobileServiceItems: jest.fn().mockResolvedValue([]),
    // loadPrimaryLines (self-charge, D5) fires unconditionally on mount —
    // unmocked, it logs "api.getPrimaryCarrierLine is not a function" noise
    // even though the (caught) error doesn't fail these tests.
    getPrimaryCarrierLine: jest
      .fn()
      .mockResolvedValue({ success: true, data: null }),
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

// PaymentSheet stub: exposes the callbacks the test drives, including
// onExchangeRateChange — the operator-editable header rate field the real
// MultiPaymentInput exposes (packages/ui/src/components/ui/MultiPaymentInput.tsx).
// A "stub-edit-rate" button lets tests simulate the operator typing a
// different rate into the sheet, proving the EDITED value (not just the
// static exchangeRate prop) reaches the submit payload.
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    onPaymentChange: (lines: unknown[]) => void;
    onReturnChange?: (legs: unknown[]) => void;
    onExchangeRateChange?: (rate: number) => void;
    onConfirm: () => void;
    children?: React.ReactNode;
  }) =>
    props.open ? (
      <div data-testid="stub-payment-sheet">
        {props.children}
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
        <button
          data-testid="stub-edit-rate"
          onClick={() => props.onExchangeRateChange?.(89000)}
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
  // KatshForm now invalidates the Suppliers-page unsettled-bill query
  // (`useQueryClient()`) on a successful bill submission — needs a real
  // QueryClientProvider in the tree, same as every Suppliers-page test.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <KatshForm
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
      />
    </QueryClientProvider>,
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

describe("KatshForm — LIRA-366 typed note", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
  });

  it("the typed note rides the checkout as typedNote", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();
    fireEvent.change(screen.getByTestId("payment-note"), {
      target: { value: "rest on Monday" },
    });
    fireEvent.click(screen.getByTestId("stub-inject-split"));
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.typedNote).toBe("rest on Monday");
  });

  it("blank note: no typedNote is sent", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();
    fireEvent.click(screen.getByTestId("stub-confirm"));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    expect(
      createFinancialServiceSchema.parse(mockAddOMTTransaction.mock.calls[0][0])
        .typedNote,
    ).toBe(undefined);
  });
});

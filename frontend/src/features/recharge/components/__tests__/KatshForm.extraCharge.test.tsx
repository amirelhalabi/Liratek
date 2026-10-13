/** @jest-environment jsdom */
/**
 * LIRA-319 T047/T048 (financial-send part) — the Katsh cart sends the
 * payment box's extra as its OWN field on the checkout's carrier (the
 * aggregated items call), never folded into the cart price: `amount`,
 * `commission` and `checkoutTotal` (pre-extra — the repository adds the
 * extra) are exactly what they are without it. Payloads parsed through the
 * shared schema (rule 24). Harness copied from KatshForm.legsCarrier.test.
 *
 * Not proven failing-first: written after the form change (rule 17).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KatshForm } from "../KatshForm";
import type { ServiceItem } from "../../hooks/useMobileServiceItems";
import type { ProviderConfig } from "../../types";

import { createFinancialServiceSchema } from "@liratek/core";

const mockSheet: { extraWired?: boolean } = {};

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
    onExtraChange?: (extra: number) => void;
    onConfirm: () => void;
  }) => {
    mockSheet.extraWired = typeof props.onExtraChange === "function";
    return props.open ? (
      <div data-testid="stub-payment-sheet">
        <button
          data-testid="stub-extra"
          onClick={() => {
            props.onExtraChange?.(50000);
            props.onPaymentChange([
              { id: "L1", method: "CASH", currencyCode: "LBP", amount: 650000 },
            ]);
          }}
        />
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
    ) : null;
  },
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

describe("KatshForm — extra charge on the carrier", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
  });

  it("wires the sheet's extra and sends extra_lbp on the carrier; price, commission and checkoutTotal unchanged", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();
    expect(mockSheet.extraWired).toBe(true);

    fireEvent.click(screen.getByTestId("stub-extra"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const parsed = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(parsed.extra_lbp).toBe(50000);
    expect(parsed.extra_usd).toBeUndefined();
    // 2 × 300,000 sell, 2 × 250,000 cost — as without the extra.
    expect(parsed.amount).toBe(600000);
    expect(parsed.commission).toBe(100000);
    expect(parsed.checkoutTotal).toEqual({ usd: 0, lbp: 600000 });
    expect(parsed.payments).toEqual([
      expect.objectContaining({ method: "CASH", amount: 650000 }),
    ]);
  });

  it("no extra typed → no extra key sent", async () => {
    renderForm();
    await cartTwoUnitsAndOpenSheet();
    fireEvent.click(screen.getByTestId("stub-inject-single"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty("extra_lbp");
    expect(payload).not.toHaveProperty("extra_usd");
  });
});

/** @jest-environment jsdom */
/**
 * LIRA-302 T009 — the web's walk-in Katsh/iPick cart payload equals core's
 * `buildCatalogSalePayload` for the same cart (rule 22: one payload shape for
 * web and phone). Written BEFORE KatshForm was switched to the builder and run
 * against the old inline construction first, where it passed (characterization,
 * not failing-first): it is the guard for that refactor.
 *
 * The PaymentSheet is stubbed (it cannot be driven in jsdom with real legs):
 * the stub injects one LBP on-account leg. USD parity is covered by the core
 * money suite and the manual web-vs-phone check (specs/302 T012, T028).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildCatalogSalePayload } from "@liratek/core";
import { KatshForm } from "../KatshForm";
import type { ServiceItem } from "../../hooks/useMobileServiceItems";
import type { ProviderConfig } from "../../types";

const CARD: ServiceItem = {
  key: "Katsh/alfa/Prepaid/Card22",
  id: 201,
  provider: "Katsh",
  category: "alfa",
  subcategory: "Prepaid",
  label: "Card22",
  catalogCost: 1_900_000,
  catalogSellPrice: 2_000_000,
  sortOrder: 0,
};
const VOUCHER: ServiceItem = {
  key: "Katsh/PUBG//60 UC",
  id: 202,
  provider: "Katsh",
  category: "PUBG",
  subcategory: "",
  label: "60 UC",
  catalogCost: 80_000,
  catalogSellPrice: 100_000,
  sortOrder: 1,
};
// 2 × 2,000,000 + 100,000
const CART_TOTAL = 4_100_000;

jest.mock("@liratek/core", () => jest.requireActual("@liratek/core"));

// ── Capture addOMTTransaction payloads ──────────────────────────────────────
const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 42 });

// One stable api object (rule 25): useApi() must not return a new identity per render.
const mockApi = {
    addOMTTransaction: mockAddOMTTransaction,
    getAllSettings: jest.fn().mockResolvedValue([]),
    // createMobileServiceItem is also on useApi() — not called in these tests
    createMobileServiceItem: jest.fn().mockResolvedValue({ success: true }),
    // Only-Days pricing model (2026-08-05): KatshForm fetches the catalog's
    // sell_days_lbp/sell_credit_lbp on mount. Empty here on purpose — these
    // gross-cost tests are about the COST side, untouched by the pricing
    // model; the pricing panel stays hidden and the legacy price formula
    // governs (proved separately in KatshForm.onlyDaysPricing.test.tsx).
    getActiveMobileServiceItems: jest.fn().mockResolvedValue([]),
    // loadPrimaryLines (self-charge, D5) fires unconditionally on mount —
    // unmocked, it logs "api.getPrimaryCarrierLine is not a function" noise
    // even though the (caught) error doesn't fail these tests.
    getPrimaryCarrierLine: jest
      .fn()
      .mockResolvedValue({ success: true, data: null }),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: 7 }),
}));

jest.mock("@/assets/logos/alfa.svg?react", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/assets/logos/mtc.svg?react", () => ({
  __esModule: true,
  default: () => null,
}));

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

jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: {
    open: boolean;
    onPaymentChange: (lines: unknown[]) => void;
    onReturnChange?: (legs: unknown[]) => void;
    onExchangeRateChange?: (rate: number) => void;
    onConfirm: () => void;
  }) =>
    props.open ? (
      <div data-testid="stub-payment-sheet">
        <button
          data-testid="stub-inject-cash"
          onClick={() =>
            props.onPaymentChange([
              {
                id: "L1",
                method: "CUSTOMER_ACCOUNT",
                currencyCode: "LBP",
                amount: CART_TOTAL,
              },
            ])
          }
        />
        <button data-testid="stub-confirm" onClick={props.onConfirm} />
      </div>
    ) : null,
}));

const CONFIG_KATSH: ProviderConfig = {
  key: "Katsh",
  label: "Katsh",
  module: "ipec_katch",
  drawer: "Katsh",
  formMode: "financial",
  color: "text-sky-400",
  bgTint: "bg-sky-400/10",
  activeBg: "bg-sky-500",
  activeText: "text-white",
  badgeCls: "bg-sky-400/10 text-sky-400",
  iconKey: "Zap",
  hasSupplier: true,
};

function renderForm() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <KatshForm
        activeConfig={CONFIG_KATSH}
        activeProvider="Katsh"
        getCategoriesForProvider={() => ["alfa", "PUBG"]}
        getServiceItems={() => [CARD, VOUCHER]}
        methods={[
          { code: "CASH", label: "Cash" },
          { code: "CUSTOMER_ACCOUNT", label: "On account" },
        ]}
        loadFinancialData={jest.fn()}
        formatAmount={(v) => v.toLocaleString()}
        alfaCreditSellRate={100_000}
        exchangeRate={89_500}
        showHistory={false}
        setShowHistory={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("KatshForm walk-in cart = core buildCatalogSalePayload (LIRA-302)", () => {
  it("a two-item cart on account books the builder's payload", async () => {
    renderForm();
    // A card click adds one; the card's own "+" raises the quantity.
    fireEvent.click((await screen.findAllByText("Card22"))[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "+" })[0]);
    fireEvent.click((await screen.findAllByText("60 UC"))[0]);
    fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
    await screen.findByTestId("stub-payment-sheet");
    fireEvent.click(screen.getByTestId("stub-inject-cash"));
    fireEvent.click(screen.getByTestId("stub-confirm"));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const sent = mockAddOMTTransaction.mock.calls[0][0] as Record<string, unknown>;
    const expected = buildCatalogSalePayload({
      provider: "Katsh",
      lines: [
        { item: { category: "alfa", label: "Card22", subcategory: "Prepaid", cost_lbp: 1_900_000, sell_lbp: 2_000_000 }, quantity: 2 },
        { item: { category: "PUBG", label: "60 UC", subcategory: "", cost_lbp: 80_000, sell_lbp: 100_000 }, quantity: 1 },
      ],
      paidByMethod: "CUSTOMER_ACCOUNT",
      payments: [{ method: "CUSTOMER_ACCOUNT", currencyCode: "LBP", amount: CART_TOTAL }],
      // The web always sends the sheet's rate with legs (harmless for an LBP leg).
      tenderExchangeRate: 89_500,
      client: { id: 7 },
    });
    // The only web-only key on a plain cart is the optional backdating time.
    expect({ ...sent, transaction_time: undefined }).toEqual(expected);
  });
});

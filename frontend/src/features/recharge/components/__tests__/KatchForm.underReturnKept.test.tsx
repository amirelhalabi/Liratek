/** @jest-environment jsdom */
/**
 * KatchForm — handing back less change than due (LIRA-259, owner 2026-10-06).
 *
 * Owner's exact scenario through the REAL PaymentSheet + MultiPaymentInput:
 * a 450,000 LBP Katsh card, the till's rate 80,000 (so $5.625 owed). The
 * customer pays $6 cash; change due is 30,000 LBP; the cashier types 10,000
 * into the LBP change field (no "Keep change" tap) and confirms.
 *
 * Before the fix the payload carried IN $6 / OUT 10,000 LBP and NO kept
 * change, which the repository's leg reconciliation rejects ("payment legs
 * do not reconcile … diff $0.25") — the sale failed. After the fix the
 * un-returned $0.25 rides the same single payload as kept change (rule 22),
 * so the server books it as profit and the sale goes through.
 *
 * Rule 17: run against the unfixed code first — see the LIRA-259 report.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KatchForm } from "../KatchForm";
import type { ServiceItem } from "../../hooks/useMobileServiceItems";
import type { ProviderConfig } from "../../types";

// ── Capture addOMTTransaction payloads ──────────────────────────────────────
const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });

// KatchForm imports pure helpers from @liratek/core. Load the REAL module:
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
    // Only-Days pricing model (2026-08-05): KatchForm fetches the catalog's
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

// ── Fixtures ────────────────────────────────────────────────────────────────
const ITEM: ServiceItem = {
  key: "Katsh/games/PUBG/60UC",
  provider: "Katsh",
  category: "games",
  subcategory: "pubg",
  label: "60UC",
  catalogCost: 400000,
  catalogSellPrice: 450000,
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
  // KatchForm now invalidates the Suppliers-page unsettled-bill query
  // (`useQueryClient()`) on a successful bill submission — needs a real
  // QueryClientProvider in the tree, same as every Suppliers-page test.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
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
        exchangeRate={80000}
        showHistory={false}
        setShowHistory={jest.fn()}
      />
    </QueryClientProvider>,
  );
}


async function cartOneCardAndPay() {
  await screen.findByText("60UC");
  fireEvent.click(screen.getByText("60UC"));
  fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
  await screen.findByTestId("multi-payment-input");
  // Customer pays in dollars: switch the single line to USD, hand over $6.
  const currency = document.querySelector<HTMLSelectElement>(
    '[data-testid^="payment-currency-"]',
  );
  if (!currency) throw new Error("no payment-currency select rendered");
  fireEvent.change(currency, { target: { value: "USD" } });
  const amount = document.querySelector<HTMLInputElement>(
    '[data-testid^="payment-amount-"]',
  );
  if (!amount) throw new Error("no payment-amount input rendered");
  fireEvent.change(amount, { target: { value: "6" } });
  await screen.findByTestId("return-change");
}

function confirm() {
  fireEvent.click(screen.getByRole("button", { name: /^Pay / }));
}

function lastPayload(): Record<string, unknown> {
  return mockAddOMTTransaction.mock.calls.at(-1)?.[0] as Record<
    string,
    unknown
  >;
}

describe("KatchForm — handing back less change than due (LIRA-259)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
  });

  it("control: full change returned (30,000 LBP) — no kept change in the payload", async () => {
    renderForm();
    await cartOneCardAndPay();
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByTestId("return-lbp"), {
      target: { value: "30000" },
    });
    confirm();

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const payload = lastPayload();
    expect(payload.payments).toEqual([
      expect.objectContaining({ method: "CASH", currencyCode: "USD", amount: 6 }),
      expect.objectContaining({
        method: "CASH",
        currencyCode: "LBP",
        amount: 30000,
        direction: "OUT",
      }),
    ]);
    expect(payload.kept_change_usd).toBeUndefined();
    expect(payload.kept_change_lbp).toBeUndefined();
  });

  it("owner's case: returns 10,000 of 30,000 LBP — the un-returned $0.25 rides the same payload as kept change", async () => {
    renderForm();
    await cartOneCardAndPay();
    // The owner's exact keystrokes: the sheet seeds the change fields, the
    // cashier overwrites ONLY the LBP field with 10,000.
    expect(screen.getByTestId("return-usd")).toHaveValue("");
    expect(screen.getByTestId("return-lbp")).toHaveValue("30000");
    fireEvent.change(screen.getByTestId("return-lbp"), {
      target: { value: "10000" },
    });
    confirm();

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const payload = lastPayload();
    expect(payload.checkoutTotal).toEqual({ usd: 0, lbp: 450000 });
    expect(payload.tender_exchange_rate).toBe(80000);
    expect(payload.payments).toEqual([
      expect.objectContaining({ method: "CASH", currencyCode: "USD", amount: 6 }),
      expect.objectContaining({
        method: "CASH",
        currencyCode: "LBP",
        amount: 10000,
        direction: "OUT",
      }),
    ]);
    expect(payload.kept_change_usd).toBe(0.25);
    expect(payload.kept_change_lbp ?? 0).toBe(0);
  });
});

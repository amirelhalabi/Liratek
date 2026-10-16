/**
 * KatshForm brand colours (2026-10-16).
 *
 * iPick and Katsh share KatshForm. Their call-to-action used to be a fixed
 * orange for both; it now follows each provider's own brand, defined ONCE in
 * `PROVIDER_BRANDS` (rule 14). Expected classes are read from that module —
 * never hand-typed — so a brand change there cannot leave this test asserting
 * stale colours.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KatshForm } from "../KatshForm";
import type {
  ServiceItem,
  ProviderKey,
} from "../../hooks/useMobileServiceItems";
import type { ProviderConfig } from "../../types";
import {
  PROVIDER_BRANDS,
  type ProviderBrandKey,
} from "@/shared/brand/providerBrands";

jest.mock("@liratek/core", () => jest.requireActual("@liratek/core"));

// Rule 25: ONE module-level object, so useApi() returns a stable identity.
const mockApi = {
  getRates: jest
    .fn()
    .mockResolvedValue([
      { to_code: "LBP", market_rate: 89250, buy_rate: 89000, sell_rate: 89500 },
    ]),
  getAllSettings: jest.fn().mockResolvedValue([]),
  getActiveMobileServiceItems: jest.fn().mockResolvedValue([]),
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
    allActiveSessions: [],
    allTodaySessions: [],
    sessionTransactions: [],
    isFloatingWindowOpen: false,
    isFloatingWindowMinimized: true,
    startSession: jest.fn(),
    endSession: jest.fn(),
    addTransactionToSession: jest.fn(),
    toggleFloatingWindow: jest.fn(),
    toggleMinimize: jest.fn(),
    refreshActiveSessions: jest.fn(),
    refreshSessionTransactions: jest.fn(),
  }),
}));

jest.mock("@/assets/logos/alfa.svg?react", () => ({
  __esModule: true,
  default: () => <svg data-testid="alfa-logo" />,
}));

jest.mock("@/assets/logos/mtc.svg?react", () => ({
  __esModule: true,
  default: () => <svg data-testid="mtc-logo" />,
}));

/** The two providers that share KatshForm. */
type BillProvider = "Katsh" | "iPick";

const ITEM_LABEL = "60 UC";

function itemFor(provider: BillProvider): ServiceItem {
  return {
    key: `${provider}/Gaming/Pubg direct/60`,
    provider,
    category: "Gaming",
    subcategory: "Pubg direct",
    label: ITEM_LABEL,
    catalogCost: 82340,
    catalogSellPrice: 90000,
    sortOrder: 0,
  };
}

function configFor(provider: BillProvider): ProviderConfig {
  return {
    key: provider,
    label: provider,
    module: "ipec_katch",
    drawer: provider,
    formMode: "financial",
    color: "text-slate-400",
    bgTint: "bg-slate-400/10",
    activeBg: "bg-slate-500",
    activeText: "text-white",
    badgeCls: "bg-slate-400/10 text-slate-400",
    iconKey: "Zap",
    hasSupplier: true,
  };
}

function renderFor(provider: BillProvider) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <KatshForm
        activeConfig={configFor(provider)}
        activeProvider={provider}
        getCategoriesForProvider={() => ["Gaming"]}
        getServiceItems={(p: ProviderKey, category: string) =>
          p === provider && category === "Gaming" ? [itemFor(provider)] : []
        }
        methods={[{ code: "CASH", label: "Cash" }]}
        loadFinancialData={jest.fn()}
        formatAmount={(v: number) => v.toLocaleString()}
        alfaCreditSellRate={100}
        alfaCreditCostRate={0.0445}
        exchangeRate={89500}
        showHistory={false}
        setShowHistory={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

const CASES: Array<[BillProvider, ProviderBrandKey]> = [
  ["Katsh", "KATSH"],
  ["iPick", "IPICK"],
];

describe("KatshForm — Proceed to Pay follows the provider brand", () => {
  it.each(CASES)(
    "%s: the enabled Proceed to Pay button carries every class of PROVIDER_BRANDS.%s.button",
    async (provider, brandKey) => {
      renderFor(provider);
      await screen.findByText(ITEM_LABEL);
      fireEvent.click(screen.getByText(ITEM_LABEL));

      const button = screen.getByRole("button", { name: /Proceed to Pay/i });
      expect(button).toBeEnabled();
      const classes = button.className.split(/\s+/);
      for (const cls of PROVIDER_BRANDS[brandKey].button.split(/\s+/)) {
        expect(classes).toContain(cls);
      }
      // The old shared orange must be gone.
      expect(classes).not.toContain("bg-orange-500");
    },
  );

  it("disabled state stays the neutral slate (no brand fill)", async () => {
    renderFor("Katsh");
    await screen.findByText(ITEM_LABEL);
    const button = screen.getByRole("button", { name: /Proceed to Pay/i });
    expect(button).toBeDisabled();
    expect(button.className).toContain("bg-slate-700");
    expect(button.className).not.toContain(PROVIDER_BRANDS.KATSH.hex);
  });
});

/** @jest-environment jsdom */
/**
 * NOT RUN — proven at the end-of-batch gate.
 *
 * KatchForm self-charge confirm dialog — #28 (LIRA-218) M7 fix
 * (2026-09-24 adversarial review).
 *
 * Pre-fix, `selfChargeValidityProjection` called `projectValidityExpiry`
 * with only 2 args, omitting the line's current `days_owed` (4th arg) —
 * the preview always showed the FULL requested days landing on the real
 * expiry with `owedApplied` 0, disagreeing with the server, which pays
 * `days_owed` off FIRST (rule 14 — one shared rule; both callers must read
 * the SAME inputs, not just call the same function). Harness copied from
 * `KatchForm.validityCredits.test.tsx` with a self-charge-eligible item
 * (credits + validityDays + catalogCost, `isSelfChargeEligible`'s exact
 * gate) and a primary line carrying a `days_owed` balance.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KatchForm } from "../KatchForm";
import type {
  ServiceItem,
  ProviderKey,
} from "../../hooks/useMobileServiceItems";
import type {
  ProviderConfig,
  FinancialTransaction,
  ProviderAnalytics,
} from "../../types";

jest.mock("@liratek/core", () => jest.requireActual("@liratek/core"));

const mockGetPrimaryCarrierLine = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getRates: jest.fn().mockResolvedValue([]),
    getAllSettings: jest.fn().mockResolvedValue([]),
    getActiveMobileServiceItems: jest.fn().mockResolvedValue([]),
    getPrimaryCarrierLine: mockGetPrimaryCarrierLine,
  }),
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

// Self-charge eligible: id set, provider iPick, credits>0, validityDays>0,
// catalogCost>0 — the EXACT gate in isSelfChargeEligility.
const mockServiceItems: ServiceItem[] = [
  {
    id: 1,
    key: "iPick/mtc/Prepaid/365",
    provider: "iPick",
    category: "mtc",
    subcategory: "Prepaid",
    label: "365",
    catalogCost: 3_000_000,
    catalogSellPrice: 3_400_000,
    sortOrder: 0,
    validityDays: 365,
    credits: 30,
  },
];

const mockActiveConfig: ProviderConfig = {
  key: "iPick",
  label: "iPick",
  module: "ipec_katch",
  drawer: "iPick",
  formMode: "financial",
  color: "text-sky-400",
  bgTint: "bg-sky-400/10",
  activeBg: "bg-sky-500",
  activeText: "text-white",
  badgeCls: "bg-sky-400/10 text-sky-400",
  iconKey: "Zap",
  hasSupplier: true,
};

const mockProps = {
  activeConfig: mockActiveConfig,
  finTransactions: [] as FinancialTransaction[],
  activeProvider: "iPick" as ProviderKey,
  finAnalytics: {
    today: { commission: 0, count: 0 },
    byProvider: [],
  } as ProviderAnalytics,
  owedByProvider: {},
  getCategoriesForProvider: (provider: ProviderKey) =>
    provider === "iPick" ? ["mtc"] : [],
  getServiceItems: (provider: ProviderKey, category: string) => {
    if (provider !== "iPick") return [];
    return mockServiceItems.filter((item) => item.category === category);
  },
  methods: [{ code: "CASH", label: "Cash" }],
  loadFinancialData: jest.fn(),
  formatAmount: (val: number) => val.toLocaleString(),
  alfaCreditSellRate: 100,
  alfaCreditCostRate: 0.0445,
  exchangeRate: 89500,
  showHistory: false,
  setShowHistory: jest.fn(),
};

function renderKatchForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <KatchForm {...mockProps} />
    </QueryClientProvider>,
  );
}

/** Today (UTC) so the line reads VALID, not lapsed. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

describe("KatchForm self-charge dialog — sold-ahead payoff preview (#28/M7)", () => {
  beforeEach(() => {
    mockGetPrimaryCarrierLine.mockReset();
  });

  it("M7: shows the days_owed payoff split (owed applied vs. real days) instead of claiming the full card lands on the expiry", async () => {
    mockGetPrimaryCarrierLine.mockImplementation(async (carrier: string) => ({
      success: true,
      data:
        carrier === "mtc"
          ? {
              id: 1,
              carrier: "mtc",
              phone_number: "03999999",
              label: "Shop MTC",
              credits: 100,
              validity_expires_at: todayISO(),
              days_owed: 210,
              is_primary: 1,
              is_active: 1,
            }
          : null,
    }));

    renderKatchForm();

    const chargeButton = await screen.findByText("Charge to shop line");
    fireEvent.click(chargeButton);

    // Pre-fix: this testid never rendered at all (owedApplied was always 0
    // because days_owed was never passed to projectValidityExpiry).
    const notice = await screen.findByTestId("self-charge-owed-payoff-notice");
    expect(notice.textContent).toContain("210");
    expect(notice.textContent).toMatch(/already sold ahead/i);
    // 365 requested - 210 owed = 155 real days stay on the line.
    expect(notice.textContent).toContain("155");
  });

  it("shows no payoff notice for a primary line with no days_owed (control)", async () => {
    mockGetPrimaryCarrierLine.mockImplementation(async (carrier: string) => ({
      success: true,
      data:
        carrier === "mtc"
          ? {
              id: 1,
              carrier: "mtc",
              phone_number: "03999999",
              label: "Shop MTC",
              credits: 100,
              validity_expires_at: todayISO(),
              days_owed: 0,
              is_primary: 1,
              is_active: 1,
            }
          : null,
    }));

    renderKatchForm();

    const chargeButton = await screen.findByText("Charge to shop line");
    fireEvent.click(chargeButton);

    await waitFor(() => {
      expect(
        screen.queryByTestId("self-charge-owed-payoff-notice"),
      ).not.toBeInTheDocument();
    });
  });
});

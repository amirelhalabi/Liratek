/** @jest-environment jsdom */
/**
 * KatchForm — ItemCard shows structured validity/credits (LIRA W6.b) when
 * present on the catalog row, never at checkout/receipts (display-only,
 * card-grid level).
 */

import { render, screen } from "@testing-library/react";
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

// KatchForm now imports from @liratek/core — mock the Node-only DB modules.
// Load the REAL core module. frontend/jest.config.ts maps @liratek/core to
// packages/core/src/browser.ts, so the Node-only DB chain the old hand-written
// mock existed to dodge is not in the graph. Re-implementing core helpers in
// test code is a rule-14 duplication: it lets the suite drift from production
// and breaks whenever the component imports one more core function.
jest.mock("@liratek/core", () => jest.requireActual("@liratek/core"));

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getRates: jest.fn().mockResolvedValue([]),
    getAllSettings: jest.fn().mockResolvedValue([]),
    // Only-Days pricing model (2026-08-05): KatchForm fetches the catalog's
    // sell_days_lbp/sell_credit_lbp on mount. Empty here on purpose — none of
    // these fixtures carry a computed days price, so the pricing panel stays
    // hidden and the legacy formula governs (FALLBACK behaviour under test).
    getActiveMobileServiceItems: jest.fn().mockResolvedValue([]),
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

const mockServiceItems: ServiceItem[] = [
  {
    key: "iPick/mtc/Prepaid/3.79",
    provider: "iPick",
    category: "mtc",
    subcategory: "Prepaid",
    label: "3.79",
    catalogCost: 379000,
    catalogSellPrice: 430000,
    sortOrder: 0,
    validityDays: 10,
  },
  {
    key: "iPick/mtc/Prepaid/1",
    provider: "iPick",
    category: "mtc",
    subcategory: "Prepaid",
    label: "1",
    catalogCost: 120000,
    catalogSellPrice: 150000,
    sortOrder: 1,
    credits: 1,
  },
  {
    key: "iPick/mtc/Prepaid/start",
    provider: "iPick",
    category: "mtc",
    subcategory: "Prepaid",
    label: "start",
    catalogCost: 450000,
    catalogSellPrice: 520000,
    sortOrder: 2,
    // no validityDays/credits — nothing to show
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

describe("KatchForm ItemCard — validity/credits (LIRA W6.b)", () => {
  it("shows '10d validity' for a card with validityDays set", async () => {
    render(<KatchForm {...mockProps} />);
    expect(await screen.findByText("10d validity")).toBeInTheDocument();
  });

  it("shows the credit amount for a card with credits set", async () => {
    render(<KatchForm {...mockProps} />);
    expect(await screen.findByText("Credit only")).toBeInTheDocument();
    expect(await screen.findByText("$1")).toBeInTheDocument();
  });

  it("shows neither line for a card with no validity/credits", async () => {
    render(<KatchForm {...mockProps} />);
    // "start" card renders (label present) but carries no validity/credit chip
    expect(await screen.findByText("start")).toBeInTheDocument();
  });
});

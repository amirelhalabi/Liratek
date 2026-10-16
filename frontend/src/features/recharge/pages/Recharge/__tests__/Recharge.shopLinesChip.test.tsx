/** @jest-environment jsdom */

/**
 * Mobile Recharge top row — MTC/Alfa show the shop-lines chip between the
 * provider logos and the stats card. The chip shows the main line's number
 * only (no balance), and the stats card is unchanged: it keeps its wallet
 * (carrier drawer = all lines' total) segment. Every other provider keeps the
 * wallet segment and gets no chip.
 *
 * Harness from `Recharge.historyDrawerBalancesRest.test.tsx`. `CompactStats`
 * is stubbed to RECORD its `drawerBalance` prop; `ProviderTabs` is stubbed to
 * a button per provider; the real `CarrierLinesPanel` renders (imported by
 * path, so the barrel stub does not hide it).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MobileRecharge from "../index";

const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockGetActiveCarrierLines = jest.fn().mockResolvedValue([
  {
    id: 1,
    carrier: "mtc",
    phone_number: "03111875",
    label: null,
    credits: -15.8,
    validity_expires_at: null,
    days_owed: 0,
    notes: null,
    is_active: 1,
    is_primary: 1,
    created_at: "2026-10-01 00:00:00",
    updated_at: "2026-10-01 00:00:00",
  },
]);

const mockApi = {
  getAllSettings: mockGetAllSettings,
  getOMTHistory: jest.fn().mockResolvedValue([]),
  getOMTAnalytics: jest.fn().mockResolvedValue({
    today: { commission: 0, count: 0, byCurrency: [] },
    byProvider: [],
  }),
  getClients: jest.fn().mockResolvedValue([]),
  getActiveCarrierLines: mockGetActiveCarrierLines,
  getPendingCarrierLineOwedDeliveries: jest
    .fn()
    .mockResolvedValue({ success: true, data: [] }),
  getRechargeHistory: jest.fn().mockResolvedValue([]),
  getRechargeDrawerBalances: jest.fn().mockResolvedValue([
    { name: "MTC", usdBalance: -15.8, lbpBalance: 0, usdtBalance: 0 },
    { name: "OMT_App", usdBalance: 120, lbpBalance: 0, usdtBalance: 0 },
  ]),
  getRechargeTodayStats: jest.fn().mockResolvedValue({
    count: 0,
    profit_usd: 0,
    profit_lbp: 0,
    byCurrency: [],
  }),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const statsProps: Array<{ drawerBalance?: { usdBalance: number } }> = [];

jest.mock("../../../components", () => ({
  CompactStats: (props: { drawerBalance?: { usdBalance: number } }) => {
    statsProps.push(props);
    return (
      <div data-testid="stub-stats">
        {props.drawerBalance
          ? `wallet:${props.drawerBalance.usdBalance}`
          : "no-wallet"}
      </div>
    );
  },
  FinancialForm: () => null,
  KatshForm: () => null,
  OmtWhishAppTransferForm: () => null,
  OmtAppCashoutModal: () => null,
  CryptoForm: () => null,
  ProviderTabs: ({
    providers,
    onSelectProvider,
  }: {
    providers: Array<{ key: string }>;
    onSelectProvider: (k: string) => void;
  }) => (
    <div>
      {providers.map((p) => (
        <button
          key={p.key}
          data-testid={`tab-${p.key}`}
          onClick={() => onSelectProvider(p.key)}
        />
      ))}
    </div>
  ),
  TelecomForm: () => <div data-testid="stub-telecom-form" />,
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin" } }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [{ code: "CASH", label: "Cash" }],
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 91000, buyRate: 90000 }),
}));

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    formatAmount: (v: number, c: string) => `${v} ${c}`,
  }),
}));

jest.mock("../../../hooks/useMobileServiceItems", () => ({
  useMobileServiceItems: () => ({
    getCategoriesForProvider: () => [],
    getItems: () => [],
    refresh: jest.fn(),
  }),
  formatCatalogItemName: (item: { label: string }) => item.label,
}));

jest.mock("../../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: null }),
}));

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

async function renderPage() {
  render(<MobileRecharge />);
  await waitFor(() => expect(mockGetAllSettings).toHaveBeenCalled());
  await screen.findByTestId("stub-telecom-form");
}

const lastStats = () => statsProps[statsProps.length - 1]!;

describe("Recharge page — shop-lines chip in the top row", () => {
  beforeEach(() => {
    statsProps.length = 0;
  });

  it("MTC: renders the shop-lines chip (primary number, no balance) and keeps the wallet segment", async () => {
    await renderPage();

    const chip = await screen.findByTestId("carrier-lines-chip-mtc");
    expect(chip).toHaveTextContent("03111875");
    // LIRA-328: the chip shows the selected line's own credit.
    expect(chip).toHaveTextContent("$");
    // The stats card is unchanged: it still gets the carrier drawer (the
    // total of all lines) for its wallet segment.
    await waitFor(() =>
      expect(screen.getByTestId("stub-stats")).toHaveTextContent(
        "wallet:-15.8",
      ),
    );
    expect(lastStats().drawerBalance?.usdBalance).toBe(-15.8);

    // The line list itself is behind the chip, in a modal.
    expect(screen.queryByTestId("carrier-line-1")).not.toBeInTheDocument();
    fireEvent.click(chip);
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Record usage — MTC",
    );
  });

  it("OMT App: keeps the wallet segment and shows no chip", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("tab-OMT_APP"));

    await waitFor(() =>
      expect(screen.getByTestId("stub-stats")).toHaveTextContent("wallet:120"),
    );
    expect(
      screen.queryByTestId("carrier-lines-chip-mtc"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("carrier-lines-chip-alfa"),
    ).not.toBeInTheDocument();
  });

  it("Alfa: the chip follows the carrier", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("tab-Alfa"));
    expect(
      await screen.findByTestId("carrier-lines-chip-alfa"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(mockGetActiveCarrierLines).toHaveBeenCalledWith("alfa"),
    );
  });
});

/** @jest-environment jsdom */

/**
 * Recharge page — Whish App remembers its Transfer / Bills screen when the
 * cashier leaves the tab and comes back (owner request 2026-10-16). Before,
 * every provider switch reset Whish App to Transfer, so a cashier building a
 * basket across tabs had to press Bills again each time.
 *
 * Setup copied from Recharge.telecomPhoneNumberTabSwitch.test.tsx; the page's
 * subcomponents are stubbed so this drives the page's own mode state.
 * Written before the fix (rule 17).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MobileRecharge from "../index";

const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockGetOMTHistory = jest.fn().mockResolvedValue([]);
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetClients = jest.fn().mockResolvedValue([]);
// Owner note #21 (migration v182): the page now widens shop-line detection
// from the single primary line to EVERY active line for the carrier —
// `getActiveCarrierLines` replaces the old `getPrimaryCarrierLine` fetch.
const mockGetActiveCarrierLines = jest.fn().mockResolvedValue([
  {
    id: 1,
    carrier: "mtc",
    phone_number: "70123456",
    credits: 0,
    validity_expires_at: null,
    is_active: 1,
    is_primary: 1,
  },
]);
const mockProcessRecharge = jest.fn().mockResolvedValue({ success: true });

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getAllSettings: mockGetAllSettings,
    getOMTHistory: mockGetOMTHistory,
    getOMTAnalytics: mockGetOMTAnalytics,
    getClients: mockGetClients,
    processRecharge: mockProcessRecharge,
    addOMTTransaction: jest.fn().mockResolvedValue({ success: true }),
    getActiveCarrierLines: mockGetActiveCarrierLines,
  }),
}));

// window.api.recharge.* — Recharge/index.tsx reads stock/history/balances
// straight off window.api rather than useApi() for these.
(globalThis as unknown as { window: { api: unknown } }).window = {
  ...(globalThis as unknown as { window: Record<string, unknown> }).window,
  api: {
    recharge: {
      getStock: jest.fn().mockResolvedValue({ mtc: 0, alfa: 0 }),
      getHistory: jest.fn().mockResolvedValue([]),
      getDrawerBalances: jest.fn().mockResolvedValue({}),
    },
  },
};

// Stub the page's own subcomponents — this test drives the REAL
// `setRechargeType` wrapper closure (the fix under test) and the REAL
// `phoneNumber`/`isShopLineMatch` state Recharge/index.tsx computes, without
// needing TelecomForm's own deep tree (PaymentSheet, CarrierLinesPanel, …) —
// that plumbing is out of scope for this specific state-clearing bug.
jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => <div data-testid="stub-bills-form" />,
  KatshForm: () => <div data-testid="stub-katsh-form" />,
  OmtWhishAppTransferForm: () => <div data-testid="stub-transfer-form" />,
  OmtAppCashoutModal: () => null,
  CryptoForm: () => null,
  TelecomForm: () => null,
  ProviderTabs: ({
    onSelectProvider,
  }: {
    onSelectProvider: (p: string) => void;
  }) => (
    <div>
      <button onClick={() => onSelectProvider("WHISH_APP")}>go-whish</button>
      <button onClick={() => onSelectProvider("Katsh")}>go-katsh</button>
    </div>
  ),
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
}

describe("Recharge page — Whish App keeps its Bills screen across tab switches", () => {
  it("Bills chosen, Katsh opened, Whish App reopened: still on Bills", async () => {
    await renderPage();
    fireEvent.click(screen.getByText("go-whish"));
    await screen.findByTestId("stub-transfer-form");

    fireEvent.click(screen.getByRole("button", { name: /Bills/ }));
    await screen.findByTestId("stub-bills-form");

    fireEvent.click(screen.getByText("go-katsh"));
    await screen.findByTestId("stub-katsh-form");

    fireEvent.click(screen.getByText("go-whish"));
    expect(await screen.findByTestId("stub-bills-form")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-transfer-form")).toBeNull();
  });

  it("first visit still opens on Transfer", async () => {
    await renderPage();
    fireEvent.click(screen.getByText("go-whish"));
    expect(await screen.findByTestId("stub-transfer-form")).toBeInTheDocument();
  });
});

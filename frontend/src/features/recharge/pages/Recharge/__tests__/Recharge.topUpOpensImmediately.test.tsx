/** @jest-environment jsdom */

/**
 * Shop-day finding (2026-10-16): on Mobile Recharge the header "Top-Up"
 * button looked dead for 3 s+ — `handleTopUpClick` awaited a fresh
 * `getRechargeDrawerBalances()` BEFORE opening the modal. The modal must open
 * on the click, with the drawer balances shown as loading (and the
 * from-drawer confirm held) until they arrive; on failure it says so and
 * offers Retry instead of a blocking alert.
 *
 * The click-time balances request is held open by hand (deferred promise).
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import MobileRecharge from "../index";

const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockGetOMTHistory = jest.fn().mockResolvedValue([]);
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetClients = jest.fn().mockResolvedValue([]);
const mockProcessRecharge = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockGetPrimaryCarrierLine = jest
  .fn()
  .mockResolvedValue({ success: true, data: null });

// The two call sites under test — routed through useApi(), NEVER window.api.
const mockGetRechargeHistory = jest.fn().mockResolvedValue([
  {
    id: 7,
    carrier: "MTC",
    recharge_type: "CREDIT_TRANSFER",
    amount: 5,
    cost: 4,
    price: 5,
    default_price_to_client: null,
    currency_code: "USD",
    paid_by: "CASH",
    phone_number: "03000091",
    client_id: null,
    client_name: null,
    note: null,
    created_at: "2026-08-08T00:00:00.000Z",
    created_by: 1,
    edited_by: null,
    edited_at: null,
  },
]);
const DRAWERS = [
  { name: "OMT_App", usdBalance: 40, lbpBalance: 0, usdtBalance: 0 },
  { name: "General", usdBalance: 500, lbpBalance: 0, usdtBalance: 0 },
];
const mockGetRechargeDrawerBalances = jest.fn();

// A STABLE object (module-level, not a fresh literal per call) — mirrors the
// real ApiProvider, whose context value is one adapter instance created once
// at app root. A fresh-object-per-call mock would give every `useCallback`
// depending on `api` a new identity on every render, re-firing its
// mount-effect on every render and breaking the call-count assertions below
// for reasons that have nothing to do with the code under test.
const mockApi = {
  getAllSettings: mockGetAllSettings,
  getOMTHistory: mockGetOMTHistory,
  getOMTAnalytics: mockGetOMTAnalytics,
  getClients: mockGetClients,
  processRecharge: mockProcessRecharge,
  addOMTTransaction: jest.fn().mockResolvedValue({ success: true }),
  getPrimaryCarrierLine: mockGetPrimaryCarrierLine,
  // Owner note #21 (migration v182): the page's own shop-line detection now
  // fetches every active line, not just the primary one — mocked here too
  // so that (caught, harmless) fetch doesn't log noise on mount.
  getActiveCarrierLines: jest.fn().mockResolvedValue([]),
  getRechargeHistory: mockGetRechargeHistory,
  getRechargeDrawerBalances: mockGetRechargeDrawerBalances,
  // LIRA-250 follow-up: the mount/provider-switch effect now calls this
  // instead of getRechargeHistory for a telecom provider — mocked so that
  // (caught, harmless) call resolves cleanly rather than logging noise.
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

// Deliberately NO window.api here (contrast with
// Recharge.telecomTenderRate.test.tsx) — proves neither call site under test
// falls back to window.api.recharge.*.

jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatshForm: () => null,
  OmtWhishAppTransferForm: () => null,
  OmtAppCashoutModal: () => null,
  CryptoForm: () => null,
  // Minimal tabs so the test can reach OMT App (the real tabs are images).
  ProviderTabs: ({
    onSelectProvider,
  }: {
    onSelectProvider: (p: string) => void;
  }) => (
    <button type="button" onClick={() => onSelectProvider("OMT_APP")}>
      tab-omt-app
    </button>
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
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function openOmtAppTab() {
  render(<MobileRecharge />);
  await waitFor(() => expect(mockGetAllSettings).toHaveBeenCalled());
  fireEvent.click(screen.getByText("tab-omt-app"));
  await screen.findByRole("button", { name: /Top-Up/ });
}

describe("Recharge — Top-Up opens at once, balances load inside the modal", () => {
  beforeEach(() => {
    mockGetRechargeDrawerBalances.mockReset();
  });

  it("opens the modal before the balances answer, then fills them in", async () => {
    const clickBalances = deferred<typeof DRAWERS>();
    // Page loads (mount / tab switch) answer at once.
    mockGetRechargeDrawerBalances.mockResolvedValue(DRAWERS);
    await openOmtAppTab();

    // The Top-Up click's own request is held open.
    mockGetRechargeDrawerBalances.mockReturnValueOnce(clickBalances.promise);
    fireEvent.click(screen.getByRole("button", { name: /Top-Up/ }));

    // Open now — not after the balances request.
    expect(
      await screen.findByText(/Top Up OMT App Drawer/),
    ).toBeInTheDocument();

    // From-drawer path: balances are loading, confirm is held.
    fireEvent.click(screen.getByText("Transfer from drawer"));
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "15" },
    });
    expect(screen.getByTestId("topup-drawers-loading")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm Top-Up" }),
    ).toBeDisabled();

    await act(async () => {
      clickBalances.resolve(DRAWERS);
    });
    expect(screen.queryByTestId("topup-drawers-loading")).toBeNull();
    expect(screen.getByText("$500.00")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm Top-Up" }),
    ).not.toBeDisabled();
  });

  it("shows the balances error with Retry instead of a blocking alert", async () => {
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    mockGetRechargeDrawerBalances.mockResolvedValue(DRAWERS);
    await openOmtAppTab();

    // The Top-Up click's request fails; Retry's succeeds.
    mockGetRechargeDrawerBalances.mockRejectedValueOnce(
      new Error("Server busy"),
    );
    fireEvent.click(screen.getByRole("button", { name: /Top-Up/ }));
    expect(
      await screen.findByText(/Top Up OMT App Drawer/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Transfer from drawer"));

    const err = await screen.findByTestId("topup-drawers-error");
    expect(err).toHaveTextContent(/Server busy/);
    expect(alertSpy).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    });
    await waitFor(() =>
      expect(screen.queryByTestId("topup-drawers-error")).toBeNull(),
    );
    expect(screen.getByText("$500.00")).toBeInTheDocument();
    alertSpy.mockRestore();
  });
});

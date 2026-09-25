/** @jest-environment jsdom */

/**
 * NOT RUN — proven at the end-of-batch gate.
 *
 * Recharge page — #28 (LIRA-218) m1 fix (2026-09-24 adversarial review).
 *
 * Pre-fix, `shopLines` (this page's own preview of the shop's carrier
 * lines, feeding `isShopLineMatch` and TelecomForm's pre-sale "days sold
 * ahead" warning) only refetched when `activeProvider` itself changed. A
 * second DAYS sale on the SAME provider tab therefore read a STALE
 * `primaryLine.days_owed`/`validity_expires_at` for its warning and its
 * `isShopLineMatch` check until the operator switched tabs and back.
 *
 * Harness copied from `Recharge.telecomPhoneNumberTabSwitch.test.tsx`
 * (same stubbing strategy — the REAL `handleTelecomSubmit` and the shop-
 * lines effect/listener under test, `TelecomForm` stubbed out).
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
const mockGetActiveCarrierLines = jest.fn().mockResolvedValue([
  {
    id: 1,
    carrier: "mtc",
    phone_number: "03999999",
    credits: 100,
    validity_expires_at: null,
    days_owed: 0,
    is_active: 1,
    is_primary: 1,
  },
]);
const mockProcessRecharge = jest.fn().mockResolvedValue({ success: true, id: 1 });

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

jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatchForm: () => null,
  OmtWhishAppTransferForm: () => null,
  OmtAppCashoutModal: () => null,
  CryptoForm: () => null,
  ProviderTabs: () => null,
  TelecomForm: ({
    setRechargeType,
    setTelecomAmount,
    setTelecomPrice,
    setTelecomDaysCostUsd,
    handleTelecomSubmit,
  }: {
    setRechargeType: (t: string) => void;
    setTelecomAmount: (v: string) => void;
    setTelecomPrice: (v: string) => void;
    setTelecomDaysCostUsd: (v: string) => void;
    handleTelecomSubmit: () => void;
  }) => (
    <div data-testid="stub-telecom-form">
      <button
        data-testid="switch-to-days"
        onClick={() => setRechargeType("DAYS")}
      />
      <button
        data-testid="fill-days-sale"
        onClick={() => {
          setTelecomAmount("30");
          setTelecomPrice("300000");
          setTelecomDaysCostUsd("0.9");
        }}
      />
      <button data-testid="submit-telecom" onClick={handleTelecomSubmit} />
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
  await screen.findByTestId("stub-telecom-form");
  await waitFor(() => expect(mockGetActiveCarrierLines).toHaveBeenCalled());
}

describe("Recharge page — carrier lines refetch after a telecom submit (#28 m1 fix)", () => {
  it("re-fetches getActiveCarrierLines after a successful DAYS submit, without an activeProvider tab switch", async () => {
    await renderPage();
    const callsBeforeSubmit = mockGetActiveCarrierLines.mock.calls.length;

    fireEvent.click(screen.getByTestId("switch-to-days"));
    fireEvent.click(screen.getByTestId("fill-days-sale"));
    fireEvent.click(screen.getByTestId("submit-telecom"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalled());
    // Pre-fix: the shop-lines effect only re-ran on an `activeProvider`
    // change, so this call count never grew from a same-tab submit.
    await waitFor(() =>
      expect(mockGetActiveCarrierLines.mock.calls.length).toBeGreaterThan(
        callsBeforeSubmit,
      ),
    );
  });
});

/** @jest-environment jsdom */

/**
 * Recharge page — `loadBinanceData` drops is_refunded/refunded_at
 * (LIRA-131 follow-on finding, beyond the audit's original table).
 *
 * The audit that produced this ticket found `financial_services` needed a
 * repository projection fix plus lighting up an already-dead badge. That is
 * the whole story for iPick/Katsh/Whish App (KatchForm/FinancialForm/
 * OmtWhishAppTransferForm pass the RAW `api.getOMTHistory()` response,
 * spread with `...h`, straight to `HistoryModal`).
 *
 * The Binance/Crypto surface is different: `loadBinanceData` (this file)
 * hand-builds a NEW `BinanceTransaction` object per row instead of
 * spreading `...tx` — a second, frontend-side instance of the exact defect
 * this ticket is about (starving an existing/wired-up field), on top of
 * CryptoForm.tsx's own re-mapping to `FinancialTransaction` (covered by
 * CryptoForm.refundedMapping.test.tsx). This test proves `loadBinanceData`
 * itself preserves the flag when the (now-fixed) repository sends it.
 *
 * Rule 17 (failing-first): temporarily removing the two added lines
 * (`is_refunded: tx.is_refunded ?? 0, refunded_at: tx.refunded_at ?? null`)
 * from `loadBinanceData`'s `.map(...)` makes this test fail — the captured
 * `binanceTransactions` prop reads `is_refunded: undefined` instead of `1`
 * — confirmed manually, then reverted (see task report for the exact
 * captured output).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MobileRecharge from "../index";

const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockGetOMTHistory = jest.fn();
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetClients = jest.fn().mockResolvedValue([]);
const mockProcessRecharge = jest.fn().mockResolvedValue({ success: true });
const mockGetRechargeDrawerBalances = jest.fn().mockResolvedValue([]);

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getAllSettings: mockGetAllSettings,
    getOMTHistory: mockGetOMTHistory,
    getOMTAnalytics: mockGetOMTAnalytics,
    getClients: mockGetClients,
    processRecharge: mockProcessRecharge,
    addOMTTransaction: jest.fn().mockResolvedValue({ success: true }),
    getRechargeDrawerBalances: mockGetRechargeDrawerBalances,
  }),
}));

// Stub the page's own subcomponents — this test drives the REAL
// `loadBinanceData` closure defined in Recharge/index.tsx, capturing what it
// hands down as the `binanceTransactions` prop.
jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatchForm: () => null,
  TelecomForm: () => null,
  OmtWhishAppTransferForm: () => null,
  ProviderTabs: ({
    onSelectProvider,
  }: {
    onSelectProvider: (p: string) => void;
  }) => (
    <button
      data-testid="select-binance"
      onClick={() => onSelectProvider("BINANCE")}
    />
  ),
  CryptoForm: ({
    binanceTransactions,
  }: {
    binanceTransactions: Array<{
      id: number;
      client_name: string | null;
      is_refunded?: number;
      refunded_at?: string | null;
    }>;
  }) => (
    <div data-testid="stub-crypto-form">
      {binanceTransactions.map((tx) => (
        <div key={tx.id} data-testid={`binance-tx-${tx.id}`}>
          {tx.client_name} is_refunded={String(tx.is_refunded)} refunded_at=
          {String(tx.refunded_at)}
        </div>
      ))}
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

describe("Recharge page — loadBinanceData preserves is_refunded/refunded_at (LIRA-131)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllSettings.mockResolvedValue([]);
    mockGetOMTAnalytics.mockResolvedValue({
      today: { commission: 0, count: 0, byCurrency: [] },
      byProvider: [],
    });
    mockGetRechargeDrawerBalances.mockResolvedValue([]);
    // Shaped exactly like the FIXED FinancialServiceRepository.getHistory()
    // now returns Binance rows — is_refunded/refunded_at present.
    mockGetOMTHistory.mockResolvedValue([
      {
        id: 1,
        service_type: "SEND",
        amount: 100,
        currency: "USDT",
        note: null,
        client_name: "Refunded Client",
        commission: 4,
        paid_by: "CASH",
        created_at: "2026-08-10 20:00:00",
        is_refunded: 1,
        refunded_at: "2026-08-10 21:00:00",
      },
      {
        id: 2,
        service_type: "SEND",
        amount: 50,
        currency: "USDT",
        note: null,
        client_name: "Live Client",
        commission: 2,
        paid_by: "CASH",
        created_at: "2026-08-10 19:00:00",
        is_refunded: 0,
        refunded_at: null,
      },
    ]);
  });

  it("passes is_refunded/refunded_at through to CryptoForm's binanceTransactions prop", async () => {
    render(<MobileRecharge />);
    await waitFor(() => expect(mockGetAllSettings).toHaveBeenCalled());

    fireEvent.click(screen.getByTestId("select-binance"));

    await waitFor(() =>
      expect(mockGetOMTHistory).toHaveBeenCalledWith("BINANCE"),
    );

    const refundedRow = await screen.findByTestId("binance-tx-1");
    expect(refundedRow.textContent).toContain("is_refunded=1");
    expect(refundedRow.textContent).toContain(
      "refunded_at=2026-08-10 21:00:00",
    );

    const liveRow = await screen.findByTestId("binance-tx-2");
    expect(liveRow.textContent).toContain("is_refunded=0");
    expect(liveRow.textContent).toContain("refunded_at=null");
  });
});

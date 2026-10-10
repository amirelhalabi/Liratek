/** @jest-environment jsdom */

/**
 * Recharge page — a THROWN `processRecharge` failure (web: `requestJson`
 * throws a plain `{status,message,details}` object on any non-2xx response,
 * e.g. a staff-role 403 before LIRA-242) reached only `logger.error(...)` in
 * both `handleTelecomSubmit`'s and `handleAlfaGiftSubmit`'s catch blocks —
 * nothing was ever shown to the operator. The `if (result && !result.success)`
 * branch right above each catch already alerts `result.error` for a
 * RESOLVED `{success:false}`; a THROWN failure skipped that branch entirely
 * and vanished. This is the exact "payment panel just closes" symptom a real
 * web-app test reported for MTC/Alfa recharges (2026-09-28).
 *
 * Harness copied verbatim from the sibling
 * `Recharge.telecomTenderRate.test.tsx` (same stubbed subcomponents, same
 * `handleTelecomSubmit`/`handleAlfaGiftSubmit` closures under test).
 *
 * Rule 17: proven to fail against the pre-fix handlers — no `window.alert`
 * call happened at all; the rejection was swallowed by `logger.error` alone.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PaymentLine } from "@liratek/ui";
import MobileRecharge from "../index";

const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockGetOMTHistory = jest.fn().mockResolvedValue([]);
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetClients = jest.fn().mockResolvedValue([]);
const mockGetHistory = jest.fn().mockResolvedValue([]);
const mockGetDrawerBalances = jest.fn().mockResolvedValue({});
const mockGetStock = jest.fn().mockResolvedValue({ mtc: 0, alfa: 0 });
const mockProcessRecharge = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getAllSettings: mockGetAllSettings,
    getOMTHistory: mockGetOMTHistory,
    getOMTAnalytics: mockGetOMTAnalytics,
    getClients: mockGetClients,
    processRecharge: mockProcessRecharge,
    addOMTTransaction: jest.fn().mockResolvedValue({ success: true }),
  }),
}));

(globalThis as unknown as { window: { api: unknown } }).window = {
  ...(globalThis as unknown as { window: Record<string, unknown> }).window,
  api: {
    recharge: {
      getStock: mockGetStock,
      getHistory: mockGetHistory,
      getDrawerBalances: mockGetDrawerBalances,
    },
  },
};

jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatshForm: () => null,
  OmtWhishAppTransferForm: () => null,
  OmtAppCashoutModal: () => null,
  CryptoForm: () => null,
  ProviderTabs: () => null,
  TelecomForm: ({
    setTelecomAmount,
    setTelecomPrice,
    setPaymentLines,
    handleTelecomSubmit,
    setGiftTierKey,
    setGiftAmountUsd,
    setGiftPriceLbp,
    setGiftCostLbp,
    handleAlfaGiftSubmit,
  }: {
    setTelecomAmount: (v: string) => void;
    setTelecomPrice: (v: string) => void;
    setPaymentLines: (lines: PaymentLine[]) => void;
    handleTelecomSubmit: () => void;
    setGiftTierKey: (v: string) => void;
    setGiftAmountUsd: (v: string) => void;
    setGiftPriceLbp: (v: string) => void;
    setGiftCostLbp: (v: string) => void;
    handleAlfaGiftSubmit: () => void;
  }) => (
    <div data-testid="stub-telecom-form">
      <button
        data-testid="telecom-fill"
        onClick={() => {
          setTelecomAmount("8");
          setTelecomPrice("720000");
          setPaymentLines([
            { id: "L1", method: "CASH", currencyCode: "USD", amount: 10 } as PaymentLine,
          ]);
        }}
      />
      <button data-testid="telecom-submit" onClick={handleTelecomSubmit} />
      <button
        data-testid="gift-fill"
        onClick={() => {
          setGiftTierKey("TIER_A");
          setGiftAmountUsd("5");
          setGiftPriceLbp("450000");
          setGiftCostLbp("400000");
          setPaymentLines([
            { id: "G1", method: "CASH", currencyCode: "USD", amount: 5 } as PaymentLine,
          ]);
        }}
      />
      <button data-testid="gift-submit" onClick={handleAlfaGiftSubmit} />
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
  useAuth: () => ({ user: { id: 1, role: "staff" } }),
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

describe("Recharge page — a thrown processRecharge failure is surfaced (LIRA-242 fallout)", () => {
  beforeEach(() => {
    mockProcessRecharge.mockReset();
    window.alert = jest.fn();
  });

  it("handleTelecomSubmit alerts the thrown error's real message instead of failing silently", async () => {
    mockProcessRecharge.mockRejectedValue({
      status: 403,
      message: "Forbidden",
      details: { error: "Forbidden" },
    });

    await renderPage();
    fireEvent.click(screen.getByTestId("telecom-fill"));
    fireEvent.click(screen.getByTestId("telecom-submit"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    const message = (window.alert as jest.Mock).mock.calls[0][0] as string;
    expect(message).toContain("Forbidden");
  });

  it("handleAlfaGiftSubmit alerts the thrown error's real message instead of failing silently", async () => {
    mockProcessRecharge.mockRejectedValue({
      status: 403,
      message: "Forbidden",
      details: { error: "Forbidden" },
    });

    await renderPage();
    fireEvent.click(screen.getByTestId("gift-fill"));
    fireEvent.click(screen.getByTestId("gift-submit"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    const message = (window.alert as jest.Mock).mock.calls[0][0] as string;
    expect(message).toContain("Forbidden");
  });
});

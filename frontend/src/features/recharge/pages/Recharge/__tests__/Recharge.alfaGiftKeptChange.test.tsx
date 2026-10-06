/** @jest-environment jsdom */

/**
 * Recharge page — Alfa Gift sends kept change (owner decision 2026-10-06:
 * no "Keep change" button; handing back less change than due keeps the rest
 * as profit automatically wherever the backend can book it).
 *
 * `recharge:process` (createRechargeSchema → RechargeRepository) already
 * books `kept_change_*`, and the Credit/Days submit sends it — but
 * `handleAlfaGiftSubmit` did not, so the reconciliation would reject an
 * under-returned gift sale (or, without the field, the kept cash would have
 * no profit row). Payload asserted through the shared schema (rule 24).
 *
 * Rule 17: run against the pre-wiring page first — see the task report.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRechargeSchema } from "@liratek/core";
import MobileRecharge from "../index";

const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockProcessRecharge = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockAddToCart = jest.fn();
let mockActiveSession: { id: number } | null = null;

const mockApi = {
  getAllSettings: mockGetAllSettings,
  getOMTHistory: jest.fn().mockResolvedValue([]),
  getOMTAnalytics: jest.fn().mockResolvedValue({
    today: { commission: 0, count: 0, byCurrency: [] },
    byProvider: [],
  }),
  getClients: jest.fn().mockResolvedValue([]),
  processRecharge: mockProcessRecharge,
  addOMTTransaction: jest.fn().mockResolvedValue({ success: true }),
  getActiveCarrierLines: jest.fn().mockResolvedValue([]),
  getRechargeHistory: jest.fn().mockResolvedValue([]),
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

type StubProps = {
  setRechargeType: (t: string) => void;
  setTelecomAmount: (v: string) => void;
  setTelecomPrice: (v: string) => void;
  setPaymentLines: (
    l: { method: string; currencyCode: string; amount: number }[],
  ) => void;
  handleTelecomSubmit: () => void;
  handleAlfaGiftSubmit: () => void;
  setGiftTierKey: (v: string) => void;
  setGiftAmountUsd: (v: string) => void;
  setGiftPriceLbp: (v: string) => void;
  setGiftCostLbp: (v: string) => void;
  onDiscountChange?: (d: number) => void;
  onKeptChange?: (k: { usd: number; lbp: number } | null) => void;
  onReturnChange?: (l: unknown[]) => void;
};

jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatchForm: () => null,
  OmtWhishAppTransferForm: () => null,
  OmtAppCashoutModal: () => null,
  CryptoForm: () => null,
  ProviderTabs: () => null,
  TelecomForm: (p: StubProps) => (
    <div data-testid="stub-telecom-form">
      <button
        data-testid="fill-credit-sale"
        onClick={() => {
          p.setTelecomAmount("3");
          p.setTelecomPrice("300000");
          p.setPaymentLines([
            { method: "CASH", currencyCode: "LBP", amount: 280000 },
          ]);
        }}
      />
      <button
        data-testid="fill-gift-sale"
        onClick={() => {
          p.setGiftTierKey("TIER_1");
          p.setGiftAmountUsd("3");
          p.setGiftPriceLbp("300000");
          p.setGiftCostLbp("255000");
          p.setPaymentLines([
            { method: "CASH", currencyCode: "LBP", amount: 280000 },
          ]);
        }}
      />
      <button
        data-testid="gift-overpaid-nothing-returned"
        onClick={() => {
          p.setGiftTierKey("TIER_1");
          p.setGiftAmountUsd("3");
          p.setGiftPriceLbp("300000");
          p.setGiftCostLbp("255000");
          // 320,000 LBP handed over for a 300,000 gift, nothing handed back:
          // the sheet reports no OUT legs and 20,000 LBP kept.
          p.setPaymentLines([
            { method: "CASH", currencyCode: "LBP", amount: 320000 },
          ]);
          p.onReturnChange?.([]);
          p.onKeptChange?.({ usd: 0, lbp: 20000 });
        }}
      />
      <button
        data-testid="give-discount"
        onClick={() => p.onDiscountChange?.(20000)}
      />
      <button data-testid="submit-telecom" onClick={p.handleTelecomSubmit} />
      <button data-testid="submit-gift" onClick={p.handleAlfaGiftSubmit} />
    </div>
  ),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: mockActiveSession,
    linkTransaction: jest.fn(),
    addToCart: mockAddToCart,
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

beforeEach(() => {
  mockProcessRecharge.mockClear();
  mockAddToCart.mockClear();
  mockActiveSession = null;
});

describe("Recharge page — Alfa Gift kept change", () => {
  it("an under-returned gift sale carries the kept amount in the ONE payload", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("gift-overpaid-nothing-returned"));
    fireEvent.click(screen.getByTestId("submit-gift"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));
    expect(mockProcessRecharge.mock.calls[0]).toHaveLength(1);
    const p = createRechargeSchema.parse(mockProcessRecharge.mock.calls[0][0]);
    expect(p.type).toBe("ALFA_GIFT");
    expect(p.kept_change_usd).toBe(0);
    expect(p.kept_change_lbp).toBe(20000);
  });

  it("the kept amount does not ride into the NEXT gift sale", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("gift-overpaid-nothing-returned"));
    fireEvent.click(screen.getByTestId("submit-gift"));
    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));

    // Next sale: exact payment, the sheet reports nothing kept (it only
    // fires on change, so the page must have cleared its own copy).
    fireEvent.click(screen.getByTestId("fill-gift-sale"));
    fireEvent.click(screen.getByTestId("submit-gift"));
    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(2));
    const p = createRechargeSchema.parse(mockProcessRecharge.mock.calls[1][0]);
    expect(p.kept_change_usd).toBeUndefined();
    expect(p.kept_change_lbp).toBeUndefined();
  });
});

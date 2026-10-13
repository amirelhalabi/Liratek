/** @jest-environment jsdom */

/**
 * LIRA-319 T044/T048 (Telecom part) — the MTC/Alfa payment sheet's
 * "+ Extra" reaches the sale as its own field.
 *
 * The sheet reports the extra through `onExtraChange`; the page must send it
 * as `extra_lbp` (telecom sales are LBP) with `price` unchanged — never
 * folded into the price, never with a discount. Not on a session-basket item
 * (the session checkout takes the extra, FR-010). Field names come from the
 * shared schema: the payload is parsed through `createRechargeSchema`
 * (rule 24), which strips any key it does not declare.
 *
 * Harness copied from `Recharge.telecomDiscount.test.tsx` (REAL page submit
 * handlers, TelecomForm stubbed, ONE stable `useApi()` object — rule 25).
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
  onExtraChange?: (e: number) => void;
};

jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatshForm: () => null,
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
            { method: "CASH", currencyCode: "LBP", amount: 300000 },
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
            { method: "CASH", currencyCode: "LBP", amount: 320000 },
          ]);
        }}
      />
      <button
        data-testid="fill-credit-sale-with-extra"
        onClick={() => {
          p.setTelecomAmount("3");
          p.setTelecomPrice("300000");
          p.setPaymentLines([
            { method: "CASH", currencyCode: "LBP", amount: 320000 },
          ]);
        }}
      />
      <button
        data-testid="give-extra"
        onClick={() => p.onExtraChange?.(20000)}
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

describe("Recharge page — payment-sheet extra reaches the sale (LIRA-319)", () => {
  it("Credit sale: 300,000 + 20,000 extra is sent as price 300,000 + extra_lbp 20,000, no discount", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("fill-credit-sale-with-extra"));
    fireEvent.click(screen.getByTestId("give-extra"));
    fireEvent.click(screen.getByTestId("submit-telecom"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalled());
    const p = createRechargeSchema.parse(mockProcessRecharge.mock.calls[0][0]);
    expect(p.price).toBe(300000);
    expect(p.extra_lbp).toBe(20000);
    expect(p).not.toHaveProperty("extra_usd");
    expect(p).not.toHaveProperty("discount");
  });

  it("Alfa Gift sale sends the extra too", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("fill-gift-sale"));
    fireEvent.click(screen.getByTestId("give-extra"));
    fireEvent.click(screen.getByTestId("submit-gift"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalled());
    const p = createRechargeSchema.parse(mockProcessRecharge.mock.calls[0][0]);
    expect(p.type).toBe("ALFA_GIFT");
    expect(p.price).toBe(300000);
    expect(p.extra_lbp).toBe(20000);
  });

  it("session basket: the cart item carries no extra (the session checkout takes it)", async () => {
    mockActiveSession = { id: 9 };
    await renderPage();
    fireEvent.click(screen.getByTestId("fill-credit-sale-with-extra"));
    fireEvent.click(screen.getByTestId("give-extra"));
    fireEvent.click(screen.getByTestId("submit-telecom"));

    await waitFor(() => expect(mockAddToCart).toHaveBeenCalled());
    const item = mockAddToCart.mock.calls[0][0] as {
      amount: number;
      formData: Record<string, unknown>;
    };
    expect(item.amount).toBe(300000);
    expect(item.formData).not.toHaveProperty("extra_lbp");
    expect(item.formData).not.toHaveProperty("extra_usd");
  });

  it("Alfa Gift into a session basket: the cart item carries no extra", async () => {
    mockActiveSession = { id: 9 };
    await renderPage();
    fireEvent.click(screen.getByTestId("fill-gift-sale"));
    fireEvent.click(screen.getByTestId("give-extra"));
    fireEvent.click(screen.getByTestId("submit-gift"));

    await waitFor(() => expect(mockAddToCart).toHaveBeenCalled());
    const item = mockAddToCart.mock.calls[0][0] as {
      amount: number;
      formData: Record<string, unknown>;
    };
    expect(item.amount).toBe(300000);
    expect(item.formData).not.toHaveProperty("extra_lbp");
    expect(item.formData).not.toHaveProperty("extra_usd");
  });

  it("no extra given: no extra key is sent", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("fill-credit-sale"));
    fireEvent.click(screen.getByTestId("submit-telecom"));
    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalled());
    const raw = mockProcessRecharge.mock.calls[0][0] as Record<string, unknown>;
    expect(raw).not.toHaveProperty("extra_lbp");
    expect(raw).not.toHaveProperty("extra_usd");
  });
});

/** @jest-environment jsdom */

/**
 * LIRA-185 owner decision #1 (2026-10-02) — "make the MTC/Alfa Discount work".
 *
 * Pre-fix the page never passed `onDiscountChange` to TelecomForm, so a
 * discount typed in the payment sheet lowered the amount due on screen while
 * the page still submitted the full price: the sale was refused (legs short,
 * no client) or the discount silently became client debt.
 *
 * The page must now send the discount with the sale (`price` stays the LIST
 * price — the server charges `price − discount` and enforces the margin
 * cap), on all three submit paths: Credit/Days, Alfa Gift, and the session
 * basket. Field names are taken from the shared schema by parsing the real
 * payload through `createRechargeSchema` (rule 24) — a key the schema does
 * not declare is stripped and fails the assertion.
 *
 * Harness follows `Recharge.carrierLinesRefreshAfterSubmit.test.tsx`
 * (REAL page submit handlers, TelecomForm stubbed), except the `useApi()`
 * mock returns ONE stable object (rule 25).
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

/** Parse the payload the page REALLY sent through the shared schema. */
function parsedPayload(raw: unknown) {
  const parsed = createRechargeSchema.parse(raw);
  return { ...parsed, charged: parsed.price - (parsed.discount ?? 0) };
}

beforeEach(() => {
  mockProcessRecharge.mockClear();
  mockAddToCart.mockClear();
  mockActiveSession = null;
});

describe("Recharge page — payment-sheet discount reaches the sale (LIRA-185 #1)", () => {
  it("Credit sale: 300,000 list price with a 20,000 discount is submitted as price 300,000 + discount 20,000 (charged 280,000)", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("fill-credit-sale"));
    fireEvent.click(screen.getByTestId("give-discount"));
    fireEvent.click(screen.getByTestId("submit-telecom"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalled());
    const p = parsedPayload(mockProcessRecharge.mock.calls[0][0]);
    expect(p.price).toBe(300000);
    expect(p.discount).toBe(20000);
    expect(p.charged).toBe(280000);
    // The usual price is still recorded for History's margin alert.
    expect(p.default_price_to_client).toBe(3 * 100000);
  });

  it("Alfa Gift sale sends the discount too", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("fill-gift-sale"));
    fireEvent.click(screen.getByTestId("give-discount"));
    fireEvent.click(screen.getByTestId("submit-gift"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalled());
    const p = parsedPayload(mockProcessRecharge.mock.calls[0][0]);
    expect(p.type).toBe("ALFA_GIFT");
    expect(p.discount).toBe(20000);
    expect(p.charged).toBe(280000);
  });

  it("session basket: the cart item is priced at the charged amount and carries the discount", async () => {
    mockActiveSession = { id: 9 };
    await renderPage();
    fireEvent.click(screen.getByTestId("fill-credit-sale"));
    fireEvent.click(screen.getByTestId("give-discount"));
    fireEvent.click(screen.getByTestId("submit-telecom"));

    await waitFor(() => expect(mockAddToCart).toHaveBeenCalled());
    const item = mockAddToCart.mock.calls[0][0] as {
      amount: number;
      formData: unknown;
    };
    expect(item.amount).toBe(280000);
    const p = parsedPayload(item.formData);
    expect(p.discount).toBe(20000);
    expect(p.charged).toBe(280000);
  });

  it("no discount given: nothing extra is sent (charged = list price)", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("fill-credit-sale"));
    fireEvent.click(screen.getByTestId("submit-telecom"));
    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalled());
    const p = parsedPayload(mockProcessRecharge.mock.calls[0][0]);
    expect(p.charged).toBe(300000);
  });
});

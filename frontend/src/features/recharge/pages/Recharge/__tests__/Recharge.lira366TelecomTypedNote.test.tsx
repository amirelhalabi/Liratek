/** @jest-environment jsdom */

/**
 * LIRA-366 T050 — the MTC/Alfa sale sheet's optional Note box. TelecomForm
 * reports the typed text through `onTypedNoteChange`; the page sends it as
 * `typedNote` from the ONE detail-field builder each submit path already
 * shares (rule 22): Credit/Days, Alfa Gift, and the session basket.
 *
 * Harness copied from Recharge.telecomDiscount (REAL page submit handlers,
 * TelecomForm stubbed, one stable `useApi()` object — rule 25). Field names
 * come from `createRechargeSchema` (rule 24).
 * Rule 17: run against the unchanged page first and seen failing.
 */


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
  onTypedNoteChange?: (v: string) => void;
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
        data-testid="type-note"
        onClick={() => p.onTypedNoteChange?.("rest on Monday")}
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

describe("Recharge page — typed note reaches the sale (LIRA-366)", () => {
  it("Credit sale carries typedNote", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("fill-credit-sale"));
    fireEvent.click(screen.getByTestId("type-note"));
    fireEvent.click(screen.getByTestId("submit-telecom"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalled());
    expect(parsedPayload(mockProcessRecharge.mock.calls[0][0]).typedNote).toBe(
      "rest on Monday",
    );
  });

  it("Alfa Gift sale carries typedNote", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("fill-gift-sale"));
    fireEvent.click(screen.getByTestId("type-note"));
    fireEvent.click(screen.getByTestId("submit-gift"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalled());
    expect(parsedPayload(mockProcessRecharge.mock.calls[0][0]).typedNote).toBe(
      "rest on Monday",
    );
  });

  it("session basket item carries typedNote", async () => {
    mockActiveSession = { id: 9 };
    await renderPage();
    fireEvent.click(screen.getByTestId("fill-credit-sale"));
    fireEvent.click(screen.getByTestId("type-note"));
    fireEvent.click(screen.getByTestId("submit-telecom"));

    await waitFor(() => expect(mockAddToCart).toHaveBeenCalled());
    const item = mockAddToCart.mock.calls[0][0] as { formData: unknown };
    expect(parsedPayload(item.formData).typedNote).toBe("rest on Monday");
  });

  it("no note typed: no typedNote is sent", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("fill-credit-sale"));
    fireEvent.click(screen.getByTestId("submit-telecom"));
    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalled());
    expect(
      parsedPayload(mockProcessRecharge.mock.calls[0][0]).typedNote,
    ).toBeUndefined();
  });
});

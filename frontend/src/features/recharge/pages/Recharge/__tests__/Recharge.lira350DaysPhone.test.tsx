/**
 * LIRA-350 (review B8) — an Alfa / MTC Days sale saves the number that got
 * the days, so the client's Accounts row can say which line it was ("Alfa
 * 30 days → 03261026"). The form had no number field on Days, and the
 * payload only carried the number on Credit. Rule 22: the walk-in submit
 * and the session basket item carry it the same way. Rule 11 untouched:
 * this is the recharged line, not the client.
 *
 * Harness copied from Recharge.transactionDetailsPayload.test.tsx (the page
 * with a stubbed TelecomForm, so the page's own payload builder runs).
 */

/**
 * LIRA-329 T017 — the MTC / Alfa forms send the fields the transaction now
 * keeps in its details: the Alfa Gift tier (key + label), the customer's
 * phone typed next to the name, and the Days cost and price as typed in USD.
 * The session-basket item carries the same fields as the direct sale — the
 * payload is built ONCE per operation (rule 22).
 *
 * Field names come from the shared schema (rule 24): every payload is parsed
 * through `createRechargeSchema`, which strips any key it does not declare.
 *
 * Rule 17: run against the unchanged page first and seen failing (the gift
 * tier, client phone and typed Days figures were absent).
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
  setTelecomDaysCostUsd: (v: string) => void;
  onDaysPriceUsdChange?: (v: string) => void;
  setTelecomClientName: (v: string) => void;
  setTelecomClientPhone: (v: string) => void;
  setPhoneNumber: (v: string) => void;
  setPaymentLines: (
    l: { method: string; currencyCode: string; amount: number }[],
  ) => void;
  handleTelecomSubmit: () => void;
  handleAlfaGiftSubmit: () => void;
  setGiftTierKey: (v: string) => void;
  setGiftAmountUsd: (v: string) => void;
  setGiftPriceLbp: (v: string) => void;
  setGiftCostLbp: (v: string) => void;
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
        data-testid="fill-client"
        onClick={() => {
          p.setTelecomClientName("Rami Haddad");
          p.setTelecomClientPhone("71111222");
        }}
      />
      <button
        data-testid="fill-gift-sale"
        onClick={() => {
          p.setGiftTierKey("7GB");
          p.setGiftAmountUsd("9");
          p.setGiftPriceLbp("900000");
          p.setGiftCostLbp("800000");
          p.setPaymentLines([
            { method: "CASH", currencyCode: "LBP", amount: 900000 },
          ]);
        }}
      />
      <button
        data-testid="pick-days"
        onClick={() => p.setRechargeType("DAYS")}
      />
      <button
        data-testid="fill-days-sale"
        onClick={() => {
          p.setTelecomAmount("30");
          p.setTelecomDaysCostUsd("5");
          p.onDaysPriceUsdChange?.("7");
          p.setTelecomPrice("630000");
          p.setPaymentLines([
            { method: "CASH", currencyCode: "LBP", amount: 630000 },
          ]);
        }}
      />
      <button
        data-testid="type-number"
        onClick={() => p.setPhoneNumber("03261026")}
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

describe("Recharge page — the Days number is saved (LIRA-350)", () => {
  it("a walk-in Days sale sends the number typed on the Days tab", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("pick-days"));
    fireEvent.click(screen.getByTestId("type-number"));
    fireEvent.click(screen.getByTestId("fill-days-sale"));
    fireEvent.click(screen.getByTestId("submit-telecom"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));
    const p = createRechargeSchema.parse(mockProcessRecharge.mock.calls[0][0]);
    expect(p.type).toBe("DAYS");
    expect(p.phoneNumber).toBe("03261026");
  });

  it("a Days sale with no number typed sends no number (unchanged)", async () => {
    await renderPage();
    fireEvent.click(screen.getByTestId("pick-days"));
    fireEvent.click(screen.getByTestId("fill-days-sale"));
    fireEvent.click(screen.getByTestId("submit-telecom"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));
    expect(mockProcessRecharge.mock.calls[0][0].phoneNumber).toBeUndefined();
  });

  it("a Days item added to a session basket carries the same number", async () => {
    mockActiveSession = { id: 5 };
    await renderPage();
    fireEvent.click(screen.getByTestId("pick-days"));
    fireEvent.click(screen.getByTestId("type-number"));
    fireEvent.click(screen.getByTestId("fill-days-sale"));
    fireEvent.click(screen.getByTestId("submit-telecom"));

    await waitFor(() => expect(mockAddToCart).toHaveBeenCalledTimes(1));
    const formData = createRechargeSchema.parse(
      mockAddToCart.mock.calls[0][0].formData,
    );
    expect(formData.type).toBe("DAYS");
    expect(formData.phoneNumber).toBe("03261026");
    expect(mockAddToCart.mock.calls[0][0].label).toContain("03261026");
  });
});

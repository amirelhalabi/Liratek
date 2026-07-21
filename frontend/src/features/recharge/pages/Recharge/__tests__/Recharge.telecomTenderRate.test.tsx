/** @jest-environment jsdom */

/**
 * Recharge page — TelecomForm submit must send the rate the PaymentSheet
 * ACTUALLY used for reconciliation (`tender_exchange_rate`), not the static
 * buyRate this page computes via useSellRate().
 *
 * Owner-reported false-reject (2026-07-2x): MTC CREDIT_TRANSFER, price
 * 720,000 LBP, paid $10 CASH, change 170,000 LBP. The payment sheet's header
 * rate field is operator-editable (MultiPaymentInput, packages/ui) — when the
 * operator edits it away from the page's static buyRate, the legs are
 * actually computed at the EDITED rate. Pre-fix, RechargeRepository had no
 * `tender_exchange_rate` concept at all, so the false-reject was structural
 * at the backend; this test guards the FRONTEND half of the fix — that the
 * edited rate (captured via PaymentSheet's onExchangeRateChange, threaded
 * through TelecomForm's onEffectiveRateChange) reaches the submit payload
 * instead of the static buyRate.
 *
 * The page's own subcomponents are stubbed (mirrors
 * Recharge.cryptoLegsGate.test.tsx's pattern) so this test drives
 * `handleTelecomSubmit` — the real closure under test in Recharge/index.tsx —
 * directly, without needing the full real MultiPaymentInput/PaymentSheet tree
 * (that plumbing is covered by MultiPaymentInput.test.tsx and
 * TelecomForm/KatchForm/FinancialForm/OmtWhishAppTransferForm's own PaymentSheet
 * wiring — see PaymentSheet.tsx's onExchangeRateChange pass-through).
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
const mockProcessRecharge = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });

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

// window.api.recharge.* — Recharge/index.tsx reads stock/history/balances
// straight off window.api rather than useApi() for these.
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

// Stub the page's own subcomponents — this test drives handleTelecomSubmit
// (the real closure under test) directly, exposing only the props relevant
// to building its payload.
jest.mock("../../../components", () => ({
  CompactStats: () => null,
  FinancialForm: () => null,
  KatchForm: () => null,
  OmtWhishAppTransferForm: () => null,
  CryptoForm: () => null,
  ProviderTabs: () => null,
  TelecomForm: ({
    setTelecomAmount,
    setTelecomPrice,
    setPaymentLines,
    onReturnChange,
    onEffectiveRateChange,
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
    onReturnChange?: (legs: PaymentLine[]) => void;
    onEffectiveRateChange?: (rate: number) => void;
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
          // Owner's exact repro: 720,000 LBP price, $10 CASH IN, 170,000 LBP
          // OUT change.
          setTelecomAmount("8");
          setTelecomPrice("720000");
          setPaymentLines([
            {
              id: "L1",
              method: "CASH",
              currencyCode: "USD",
              amount: 10,
            } as PaymentLine,
          ]);
          onReturnChange?.([
            {
              id: "R1",
              method: "CASH",
              currencyCode: "LBP",
              amount: 170000,
              direction: "OUT",
            } as PaymentLine,
          ]);
        }}
      />
      <button
        data-testid="telecom-edit-rate"
        onClick={() => onEffectiveRateChange?.(89000)}
      />
      <button data-testid="telecom-submit" onClick={handleTelecomSubmit} />
      {/* Alfa Gift branch — shares the SAME paymentLines/onEffectiveRateChange
          wiring (only one branch is ever mounted, gated by rechargeType), so
          this exercises handleAlfaGiftSubmit's own tender_exchange_rate line. */}
      <button
        data-testid="gift-fill"
        onClick={() => {
          setGiftTierKey("TIER_A");
          setGiftAmountUsd("5");
          setGiftPriceLbp("450000");
          setGiftCostLbp("400000");
          setPaymentLines([
            {
              id: "G1",
              method: "CASH",
              currencyCode: "USD",
              amount: 5,
            } as PaymentLine,
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
  useAuth: () => ({ user: { id: 1, role: "admin" } }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [{ code: "CASH", label: "Cash" }],
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
  }),
}));

// Static buyRate=90000 — deliberately DIFFERENT from the 89000 the stub's
// "edit rate" button reports, so a passing assertion of 89000 can only mean
// the edited value made it through, not the static prop.
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

describe("Recharge page — TelecomForm sends the sheet's actual tender rate", () => {
  beforeEach(() => {
    mockProcessRecharge.mockClear();
  });

  // False-reject fix (2026-07-2x): fails on pre-fix code two ways — (a)
  // RechargeData/RechargeRepository had no tender_exchange_rate field at all
  // (payload key wouldn't exist), and (b) even with the repo wired, this page
  // never captured the sheet's live-edited rate, so it would send the static
  // buyRate (90000) instead of the edited 89000.
  it("sends the OPERATOR-EDITED sheet rate as tender_exchange_rate, not the static buyRate", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("telecom-fill"));
    fireEvent.click(screen.getByTestId("telecom-edit-rate")); // sheet reports 89000
    fireEvent.click(screen.getByTestId("telecom-submit"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));

    const payload = mockProcessRecharge.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.tender_exchange_rate).toBe(89000);
    expect(payload.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "CASH",
          currencyCode: "USD",
          amount: 10,
        }),
        expect.objectContaining({
          method: "CASH",
          currencyCode: "LBP",
          amount: 170000,
          direction: "OUT",
        }),
      ]),
    );
  });

  it("falls back to the static buyRate when the sheet never reported an edit", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("telecom-fill"));
    // No edit-rate click this time.
    fireEvent.click(screen.getByTestId("telecom-submit"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));

    const payload = mockProcessRecharge.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.tender_exchange_rate).toBe(90000);
  });

  // Alfa Gift shares RechargeRepository's SAME reconcileLegs gate — a
  // cross-currency Alfa Gift sale with change is exactly as false-reject-prone
  // as a CREDIT_TRANSFER recharge. It shares the same onEffectiveRateChange/
  // telecomTenderRate state as the credit-transfer flow (only one of the two
  // PaymentSheet-backed branches is ever mounted at a time).
  it("Alfa Gift submit also sends the operator-edited sheet rate as tender_exchange_rate", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("gift-fill"));
    fireEvent.click(screen.getByTestId("telecom-edit-rate")); // sheet reports 89000
    fireEvent.click(screen.getByTestId("gift-submit"));

    await waitFor(() => expect(mockProcessRecharge).toHaveBeenCalledTimes(1));

    const payload = mockProcessRecharge.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.type).toBe("ALFA_GIFT");
    expect(payload.tender_exchange_rate).toBe(89000);
  });
});

/** @jest-environment jsdom */

/**
 * TelecomForm — customer adds change on the credit buy-back sheet (LIRA-336,
 * T018). With the page's `onAddedChange` + `onBuybackCustomerLinesChange`,
 * the buy-back PaymentSheet gets an OPTIONAL "Customer gives change" section
 * (`optional`, `allowAddedChange`, total 0, LBP — the payout currency) and
 * the callback; never on an ordinary credit sale, never the account method;
 * Confirm waits while the section is over the cap.
 *
 * PaymentSheet is stubbed to record the props TelecomForm hands it (same
 * harness as TelecomForm.buybackRoundUp.test.tsx).
 * Rule 17: NOT proven failing-first — written after the TelecomForm change
 * (the page-level payload test Recharge.addedChange.test.tsx was).
 */

import { act, render, waitFor } from "@testing-library/react";
import { TelecomForm } from "../TelecomForm";

const mockSheetProps: { last?: Record<string, unknown> } = {};
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: Record<string, unknown>) => {
    mockSheetProps.last = props;
    return null;
  },
}));
import type { FinancialTransaction } from "../../types";

const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockGetActiveCarrierLines = jest.fn().mockResolvedValue([]);

const mockApi = {
  getAllSettings: mockGetAllSettings,
  getActiveCarrierLines: mockGetActiveCarrierLines,
  // m6 fix (2026-09-24 adversarial review): CarrierLinesPanel (rendered
  // alongside TelecomForm in this harness) calls this unconditionally on
  // mount — without it the call throws a TypeError ("not a function").
  getPendingCarrierLineOwedDeliveries: jest
    .fn()
    .mockResolvedValue({ success: true, data: [] }),
  markCarrierLineOwedDeliverySent: jest
    .fn()
    .mockResolvedValue({ success: true, data: null }),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 91000, buyRate: 90000 }),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

function buildProps(
  overrides: Partial<React.ComponentProps<typeof TelecomForm>> = {},
) {
  return {
    isMTC: true,
    rechargeType: "CREDIT_TRANSFER" as const,
    setRechargeType: jest.fn(),
    isSubmitting: false,
    handleQuickAmount: jest.fn(),
    showHistory: false,
    setShowHistory: jest.fn(),
    rechargeHistory: [] as FinancialTransaction[],
    telecomAmount: "3",
    setTelecomAmount: jest.fn(),
    onTelecomAmountChange: jest.fn(),
    telecomPrice: "270000",
    setTelecomPrice: jest.fn(),
    phoneNumber: "70123456",
    setPhoneNumber: jest.fn(),
    paidBy: "CASH",
    setPaidBy: jest.fn(),
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "CUSTOMER_ACCOUNT", label: "Customer account" },
    ],
    showClientSearch: false,
    setShowClientSearch: jest.fn(),
    telecomClientId: null,
    setTelecomClientId: jest.fn(),
    telecomClientName: "",
    setTelecomClientName: jest.fn(),
    telecomClientPhone: "",
    setTelecomClientPhone: jest.fn(),
    searchClients: jest.fn(),
    clientSearchResults: [],
    selectClient: jest.fn(),
    activeProvider: "MTC",
    activeConfig: undefined,
    handleTelecomSubmit: jest.fn(),
    giftTierKey: "" as const,
    setGiftTierKey: jest.fn(),
    giftAmountUsd: "",
    setGiftAmountUsd: jest.fn(),
    giftPriceLbp: "",
    setGiftPriceLbp: jest.fn(),
    giftCostLbp: "",
    setGiftCostLbp: jest.fn(),
    handleAlfaGiftSubmit: jest.fn(),
    paymentLines: [],
    setPaymentLines: jest.fn(),
    clientName: "",
    setClientName: jest.fn(),
    alfaCreditCostRate: 85000,
    telecomDaysCostUsd: "",
    setTelecomDaysCostUsd: jest.fn(),
    isShopLineMatch: false,
    shopLineBuyback: true,
    setShopLineBuyback: jest.fn(),
    // #28 (LIRA-218) — no primary line by default; individual tests override.
    primaryLine: null,
    ...overrides,
  };
}

interface SheetCounterFlow {
  optional?: boolean;
  allowAddedChange?: boolean;
  totalAmount: number;
  currency: string;
  paymentMethods?: Array<{ code: string }>;
  onChange: (lines: unknown[]) => void;
  onStateChange?: (s: Record<string, unknown>) => void;
}
const sheetCounterFlow = (): SheetCounterFlow | undefined =>
  mockSheetProps.last?.counterFlow as SheetCounterFlow | undefined;

describe("TelecomForm — buy-back customer adds change (LIRA-336)", () => {
  beforeEach(() => {
    delete mockSheetProps.last;
  });

  it("buy-back: an optional LBP section with allowAddedChange, the callback, and lines reported to the page", async () => {
    const onAddedChange = jest.fn();
    const onBuybackCustomerLinesChange = jest.fn();
    render(
      <TelecomForm
        {...buildProps({
          isShopLineMatch: true,
          shopLineBuyback: true,
          onAddedChange,
          onBuybackCustomerLinesChange,
        })}
      />,
    );
    await waitFor(() => expect(mockSheetProps.last).toBeDefined());
    expect(mockSheetProps.last?.onAddedChange).toBe(onAddedChange);
    const cf = sheetCounterFlow();
    expect(cf).toEqual(
      expect.objectContaining({
        optional: true,
        allowAddedChange: true,
        totalAmount: 0,
        currency: "LBP",
      }),
    );
    expect(cf?.paymentMethods?.map((m) => m.code)).toEqual(["CASH"]);
    expect(cf?.onChange).toBe(onBuybackCustomerLinesChange);
    expect(mockSheetProps.last?.confirmDisabled).toBe(false);

    // Over the cap → Confirm waits.
    act(() => {
      cf?.onStateChange?.({
        paid: 500000,
        owedToAccount: 0,
        forgiven: 0,
        balanced: false,
        overpaid: true,
        needsClient: false,
        unaccounted: 0,
        addedChange: 0,
      });
    });
    await waitFor(() =>
      expect(mockSheetProps.last?.confirmDisabled).toBe(true),
    );
  });

  it("ordinary credit sale: no section, no callback", async () => {
    render(
      <TelecomForm
        {...buildProps({
          isShopLineMatch: true,
          shopLineBuyback: false,
          onAddedChange: jest.fn(),
          onBuybackCustomerLinesChange: jest.fn(),
        })}
      />,
    );
    await waitFor(() => expect(mockSheetProps.last).toBeDefined());
    expect(mockSheetProps.last?.onAddedChange).toBeUndefined();
    expect(sheetCounterFlow()).toBeUndefined();
  });

  it("buy-back without the page's callbacks: no section", async () => {
    render(
      <TelecomForm
        {...buildProps({ isShopLineMatch: true, shopLineBuyback: true })}
      />,
    );
    await waitFor(() => expect(mockSheetProps.last).toBeDefined());
    expect(sheetCounterFlow()).toBeUndefined();
  });
});

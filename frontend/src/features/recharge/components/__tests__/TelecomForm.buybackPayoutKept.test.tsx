/** @jest-environment jsdom */

/**
 * Credit buy-back is a PAYOUT (the shop pays the customer for credits).
 * Owner decisions 2026-10-07 (FEATURE_GUIDE §4.1 "Kept change"): the buy-back
 * payment sheet runs in `payer="payout"` mode — no change (OUT) legs ever, a
 * small shortfall (under 100,000 LBP) is kept as profit via `onKeptChange`.
 * An ordinary credit sale on the same form stays a customer payment.
 *
 * PaymentSheet is stubbed to record the props TelecomForm hands it.
 * Rule 17: run against the pre-change form first — see the task report.
 */

import { render, waitFor } from "@testing-library/react";
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
    methods: [{ code: "CASH", label: "Cash" }],
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

describe("TelecomForm — buy-back payment sheet is a payout", () => {
  beforeEach(() => {
    delete mockSheetProps.last;
  });

  it("buy-back: payer is payout, no change legs are wired, kept change is", async () => {
    const onReturnChange = jest.fn();
    const onKeptChange = jest.fn();
    render(
      <TelecomForm
        {...buildProps({
          isShopLineMatch: true,
          shopLineBuyback: true,
          onReturnChange,
          onKeptChange,
        })}
      />,
    );
    await waitFor(() => expect(mockSheetProps.last).toBeDefined());
    expect(mockSheetProps.last?.payer).toBe("payout");
    expect(mockSheetProps.last?.onReturnChange).toBeUndefined();
    expect(mockSheetProps.last?.onKeptChange).toBe(onKeptChange);
  });

  it("ordinary credit sale: stays a customer payment with change legs wired", async () => {
    const onReturnChange = jest.fn();
    const onKeptChange = jest.fn();
    render(
      <TelecomForm
        {...buildProps({
          isShopLineMatch: true,
          shopLineBuyback: false,
          onReturnChange,
          onKeptChange,
        })}
      />,
    );
    await waitFor(() => expect(mockSheetProps.last).toBeDefined());
    expect(mockSheetProps.last?.payer).not.toBe("payout");
    expect(mockSheetProps.last?.onReturnChange).toBe(onReturnChange);
  });
});

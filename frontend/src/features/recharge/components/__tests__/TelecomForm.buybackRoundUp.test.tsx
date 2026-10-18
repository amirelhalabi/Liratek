/** @jest-environment jsdom */

/**
 * TelecomForm — payout round-up pass-through on the credit buy-back sheet
 * (LIRA-334, T023). The page passes `onRoundUpChange`; the form forwards it
 * to the buy-back PaymentSheet only — never on an ordinary credit sale (a
 * customer payment, where an overpay is change).
 *
 * PaymentSheet is stubbed to record the props TelecomForm hands it (same
 * harness as TelecomForm.buybackPayoutKept.test.tsx).
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

describe("TelecomForm — buy-back round-up pass-through (LIRA-334)", () => {
  beforeEach(() => {
    delete mockSheetProps.last;
  });

  it("buy-back: onRoundUpChange reaches the payout sheet", async () => {
    const onRoundUpChange = jest.fn();
    render(
      <TelecomForm
        {...buildProps({
          isShopLineMatch: true,
          shopLineBuyback: true,
          onRoundUpChange,
        })}
      />,
    );
    await waitFor(() => expect(mockSheetProps.last).toBeDefined());
    expect(mockSheetProps.last?.payer).toBe("payout");
    expect(mockSheetProps.last?.onRoundUpChange).toBe(onRoundUpChange);
  });

  it("ordinary credit sale: no round-up is wired", async () => {
    const onRoundUpChange = jest.fn();
    render(
      <TelecomForm
        {...buildProps({
          isShopLineMatch: true,
          shopLineBuyback: false,
          onRoundUpChange,
        })}
      />,
    );
    await waitFor(() => expect(mockSheetProps.last).toBeDefined());
    expect(mockSheetProps.last?.payer).not.toBe("payout");
    expect(mockSheetProps.last?.onRoundUpChange).toBeUndefined();
  });
});

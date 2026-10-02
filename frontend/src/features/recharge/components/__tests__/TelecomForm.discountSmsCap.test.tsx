/** @jest-environment jsdom */

/**
 * LIRA-185 owner decision #1 follow-up (2026-10-02) — "cap = margin − SMS
 * fee". A CREDIT_TRANSFER sale burns its own SMS_Transfer_Fee expense
 * (planSmsTransfer, one message per $3 of credit) on top of cost — a
 * discount at the plain margin nets the sale a loss equal to that fee. The
 * payment sheet's `maxDiscount` must shrink by the SAME amount
 * `RechargeRepository.processRecharge` enforces server-side
 * (`RechargeRepository.discount.test.ts`), converted to LBP at the sheet's
 * own rate.
 *
 * PaymentSheet is mocked (same technique as
 * OmtWhishAppTransferForm.discountedShopProfit.test.tsx) purely to capture
 * the `maxDiscount` prop TelecomForm computes — it is not re-testing the
 * sheet's own clamp/warning UI, which belongs to MultiPaymentInput.
 *
 * Harness copied from TelecomForm.discountField.test.tsx (stable useApi
 * mock, rule 25).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TelecomForm } from "../TelecomForm";
import type { FinancialTransaction } from "../../types";

const mockGetAllSettings = jest.fn().mockResolvedValue([]);
const mockGetActiveCarrierLines = jest.fn().mockResolvedValue([]);

const mockApi = {
  getAllSettings: mockGetAllSettings,
  getActiveCarrierLines: mockGetActiveCarrierLines,
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

// buyRate 90,000 — matches create_db.sql's seeded sell_rate, so this value
// lines up with RechargeRepository.discount.test.ts's server-side figures.
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

let capturedMaxDiscount: number | undefined;
let capturedOpen = false;
jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: { open: boolean; maxDiscount?: number }) => {
    capturedOpen = props.open;
    if (props.open) capturedMaxDiscount = props.maxDiscount;
    return null;
  },
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
    telecomPrice: "300000",
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
    primaryLine: null,
    ...overrides,
  };
}

beforeEach(() => {
  capturedMaxDiscount = undefined;
  capturedOpen = false;
});

// NOT proven failing-first (LIRA-185): verified by toggling the fix in
// place, which rule 17 does not accept.
describe("TelecomForm — SMS-aware discount cap (LIRA-185 #1 follow-up)", () => {
  it("CREDIT_TRANSFER: maxDiscount is the margin MINUS the SMS transfer fee, not the plain margin", async () => {
    render(<TelecomForm {...buildProps()} />);
    await waitFor(() => expect(mockGetActiveCarrierLines).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /proceed to pay/i }));
    await waitFor(() => expect(capturedOpen).toBe(true));

    // margin = 300,000 − 3*85,000 = 45,000
    // SMS fee = ceil(3/3)=1 message * $0.16 * buyRate(90,000) = 14,400
    // cap = 45,000 − 14,400 = 30,600 (NOT the plain 45,000)
    expect(capturedMaxDiscount).toBe(30_600);
  });

  it("DAYS: unaffected — no SMS fee, cap stays the plain margin", async () => {
    render(
      <TelecomForm
        {...buildProps({
          rechargeType: "DAYS",
          telecomDaysCostUsd: "1",
          telecomPrice: "100000",
        })}
      />,
    );
    await waitFor(() => expect(mockGetActiveCarrierLines).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /proceed to pay/i }));
    await waitFor(() => expect(capturedOpen).toBe(true));

    // margin = 100,000 − 1*85,000 = 15,000, no SMS fee for DAYS.
    expect(capturedMaxDiscount).toBe(15_000);
  });
});

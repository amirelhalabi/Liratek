/** @jest-environment jsdom */

/**
 * LIRA-319 T044 — the MTC/Alfa payment sheet's "+ Extra" switch. Offered on
 * a credit SALE (the page sends `extra_lbp`); never on a shop-line credit
 * buy-back, which is a payout — the server refuses an extra there too
 * (RechargeRepository.extraCharge.test.ts).
 *
 * Rule 17: NOT proven failing-first — the TelecomForm wiring was written
 * before this test. Harness copied from TelecomForm.discountField.test.tsx
 * (stable useApi mock, rule 25).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { TelecomForm } from "../TelecomForm";
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

describe("TelecomForm — payment-sheet extra (LIRA-319)", () => {
  it("a credit SALE offers the + Extra switch and reports the extra", async () => {
    const onExtraChange = jest.fn();
    render(
      <TelecomForm
        {...buildProps({ isShopLineMatch: false, onExtraChange })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /proceed to pay/i }));
    fireEvent.click(await screen.findByTestId("discount-mode-extra"));
    fireEvent.change(screen.getByLabelText("Extra", { selector: "input" }), {
      target: { value: "20000" },
    });
    expect(onExtraChange).toHaveBeenLastCalledWith(20000);
  });

  it("a credit BUY-BACK (payout) offers no extra", async () => {
    render(
      <TelecomForm
        {...buildProps({
          isShopLineMatch: true,
          shopLineBuyback: true,
          onExtraChange: jest.fn(),
        })}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /proceed to pay out/i }),
    );
    expect(
      await screen.findByRole("button", { name: /confirm cashout/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("discount-mode-extra")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Extra", { selector: "input" }),
    ).not.toBeInTheDocument();
  });
});

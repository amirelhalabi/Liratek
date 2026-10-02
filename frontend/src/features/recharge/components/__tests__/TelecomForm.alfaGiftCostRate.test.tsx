/** @jest-environment jsdom */

/**
 * LIRA-185 display batch — recharge lane follow-up check: does the Alfa Gift
 * cost (and therefore the stamped profit) honour the CONFIGURED Alfa credit
 * cost rate, or the `useState(85000)` the card grid starts from?
 *
 * The server stamps `profit = price - data.cost` with the cost the client
 * sends (RechargeRepository.processRecharge, `rechargeCommission`), and
 * `handleAlfaGiftSubmit` sends `giftCostLbp`, which is whatever the selected
 * card's `costLbp` was. So the question is answered entirely by what this
 * component hands to `setGiftCostLbp` once settings have loaded.
 *
 * Rule 17: this is a characterisation test of existing code, not a guard for
 * a fix — it passed on first run (no fix was needed), so it is NOT proven
 * failing-first.
 */

import { render, screen, waitFor } from "@testing-library/react";
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
    isMTC: false,
    rechargeType: "ALFA_GIFT" as const,
    setRechargeType: jest.fn(),
    isSubmitting: false,
    handleQuickAmount: jest.fn(),
    showHistory: false,
    setShowHistory: jest.fn(),
    rechargeHistory: [] as FinancialTransaction[],
    telecomAmount: "",
    setTelecomAmount: jest.fn(),
    onTelecomAmountChange: jest.fn(),
    telecomPrice: "",
    setTelecomPrice: jest.fn(),
    phoneNumber: "",
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
    activeProvider: "ALFA",
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
    // The rate under test — configured in Shop Config, NOT 100,000.
    alfaCreditSellRate: 110000,
    telecomDaysCostUsd: "",
    setTelecomDaysCostUsd: jest.fn(),
    isShopLineMatch: false,
    shopLineBuyback: true,
    setShopLineBuyback: jest.fn(),
    primaryLine: null,
    ...overrides,
  };
}

describe("TelecomForm — Alfa Gift cost uses the configured cost rate (LIRA-185 follow-up)", () => {
  it("with alfa_credit_cost_lbp = 90,000 configured, selecting 1 GB ($3.50) sends cost 315,000 LBP, not 297,500", async () => {
    mockGetAllSettings.mockResolvedValue([
      { key_name: "alfa_credit_cost_lbp", value: "90000" },
    ]);
    const setGiftCostLbp = jest.fn();
    render(
      <TelecomForm
        {...buildProps({ alfaCreditCostRate: 90000, setGiftCostLbp })}
      />,
    );
    await waitFor(() => expect(mockGetAllSettings).toHaveBeenCalled());
    await waitFor(() => expect(mockGetActiveCarrierLines).toHaveBeenCalled());

    const card = await screen.findByText("1 GB");
    await waitFor(() => {
      card.click();
      expect(setGiftCostLbp).toHaveBeenLastCalledWith("315000");
    });
    expect(setGiftCostLbp).not.toHaveBeenCalledWith("297500");
  });
});

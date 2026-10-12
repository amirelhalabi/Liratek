/** @jest-environment jsdom */
/**
 * LIRA-309 phase 6 (US4, T050) — Mobile Recharge recognises a number that
 * is one of the shop's lines FOR SALE (`resaleLineMatch`, matched by the page
 * in any format). It shows "This is your line for sale", offers the internal
 * recharge panel instead of a customer sale, and blocks "Proceed to Pay".
 * On the other carrier's tab it only explains, with no panel.
 *
 * Written before the change; first run failed (no banner rendered).
 */
import { render, screen } from "@testing-library/react";
import type { ResaleLineRow } from "@liratek/core";
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
  // LIRA-309 — the recharge panel's sources.
  getAllActiveCarrierLines: jest.fn().mockResolvedValue([]),
  getActiveMobileServiceItems: jest.fn().mockResolvedValue([]),
  rechargeResaleLine: jest.fn(),
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
    rechargeType: "CREDIT_TRANSFER" as const,
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

const ALFA_LINE: ResaleLineRow = {
  product_id: 7,
  phone_number: "70444202",
  name: "Alfa line 70 444 202",
  category: "Phone Lines",
  cost_price_usd: 12,
  selling_price_usd: 20,
  stock_quantity: 1,
  is_unsold: 1,
  resale_line_id: 1,
  carrier: "alfa",
  credits: 1.5,
  validity_expires_at: "2026-10-14",
};

describe("TelecomForm — the shop's own line for sale (LIRA-309)", () => {
  it("on the Alfa tab: banner + recharge panel, and no customer sale", async () => {
    render(
      <TelecomForm
        {...buildProps({ phoneNumber: "+961 70 444 202", telecomAmount: "3", resaleLineMatch: ALFA_LINE })}
      />,
    );
    expect(screen.getByText("This is your line for sale: Alfa line 70 444 202")).toBeTruthy();
    expect(await screen.findByText(/Recharge 70444202/)).toBeTruthy();
    const proceed = screen.getByRole("button", { name: /Proceed to Pay/i });
    expect(proceed).toBeDisabled();
  });

  it("on the MTC tab: explains it is an Alfa line, with no panel", () => {
    render(
      <TelecomForm
        {...buildProps({ isMTC: true, activeProvider: "MTC", phoneNumber: "70444202", resaleLineMatch: ALFA_LINE })}
      />,
    );
    expect(screen.getByText(/This is your Alfa line for sale/)).toBeTruthy();
    expect(screen.queryByText(/Recharge 70444202/)).toBeNull();
  });

  it("an ordinary number shows nothing new", () => {
    render(<TelecomForm {...buildProps({ phoneNumber: "03999999", resaleLineMatch: null })} />);
    expect(screen.queryByText(/line for sale/)).toBeNull();
  });
});

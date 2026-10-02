/** @jest-environment jsdom */

/**
 * LIRA-185 fix batch, part C — lead #11 (verified by the Explore-agent audit,
 * journal wf_a89a1432-255, verify:recharge, lead "#11 Alfa Gift card grid
 * prices from a localStorage key nothing writes").
 *
 * Bug: TelecomForm's Alfa Gift card grid priced `giftItems` from
 * `localStorage.getItem('alfa_credit_sell_rate_lbp')`, a key nothing in the
 * repo ever writes (`localStorage.setItem` for it does not exist) — so it
 * always fell back to the hardcoded default of 100,000 LBP/$, ignoring the
 * sell rate the owner actually configures in Shop Config
 * (`alfaCreditSellRate`, loaded from `system_settings` in
 * `Recharge/index.tsx` and already passed down as `alfaCreditCostRate` for
 * cost — but never as a sell-rate prop).
 *
 * Fix: pass the parent's configured `alfaCreditSellRate` into `TelecomForm`
 * as a prop and price `giftItems` from it directly; drop the localStorage
 * read.
 *
 * Rule 17 — proven failing-first: at a sell rate of 110,000 LBP/$, the 1GB
 * tier ($3.50) must show/select "Sell: 385,000 LBP". Before the fix this
 * test fails because the component ignores the `alfaCreditSellRate` prop
 * entirely and renders "Sell: 350,000 LBP" (the localStorage-less default of
 * 100,000/$).
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

describe("TelecomForm — Alfa Gift grid prices from the configured sell rate (LIRA-185 lead #11)", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("at a 110,000 LBP/$ sell rate, the 1GB ($3.50) tier shows Sell: 385,000 LBP — not the 100,000/$ default", async () => {
    // Confirm localStorage genuinely cannot supply the right answer: nothing
    // in the app writes this key, so leaving it unset reproduces production.
    expect(localStorage.getItem("alfa_credit_sell_rate_lbp")).toBeNull();

    render(<TelecomForm {...buildProps({ alfaCreditSellRate: 110000 })} />);
    await waitFor(() => expect(mockGetActiveCarrierLines).toHaveBeenCalled());

    expect(await screen.findByText("1 GB")).toBeInTheDocument();
    expect(screen.getByText("Sell: 385,000 LBP")).toBeInTheDocument();
    expect(screen.queryByText("Sell: 350,000 LBP")).not.toBeInTheDocument();
  });

  it("selecting the 1GB tier sends a 385,000 LBP gift price, not 350,000", async () => {
    const setGiftPriceLbp = jest.fn();
    render(
      <TelecomForm
        {...buildProps({ alfaCreditSellRate: 110000, setGiftPriceLbp })}
      />,
    );
    await waitFor(() => expect(mockGetActiveCarrierLines).toHaveBeenCalled());

    const card = await screen.findByText("1 GB");
    card.click();

    expect(setGiftPriceLbp).toHaveBeenCalledWith("385000");
    expect(setGiftPriceLbp).not.toHaveBeenCalledWith("350000");
  });
});

/** @jest-environment jsdom */

/**
 * LIRA-260 — editing the MTC/Alfa credit "Price to Client" away from the
 * saved price (amount x the owner-configured credit sell rate) shows the
 * shared amber PriceChangeWarning with both prices; restoring the saved price
 * hides it. Warning only — never on the Days tab (no saved price there) or a
 * shop-line buy-back (a payout, not a sale price).
 *
 * Rule 17: written before the wiring and seen failing (no warning rendered).
 * Harness copied from TelecomForm.discountField.test.tsx (stable useApi mock,
 * rule 25).
 */

import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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


/** Owns telecomPrice so typing in the field round-trips like the page does. */
function StatefulTelecomForm(
  overrides: Partial<React.ComponentProps<typeof TelecomForm>> = {},
) {
  const [price, setPrice] = useState("270000");
  return (
    <TelecomForm
      {...buildProps({
        alfaCreditSellRate: 90000,
        telecomAmount: "3",
        telecomPrice: price,
        setTelecomPrice: setPrice,
        ...overrides,
      })}
    />
  );
}

function priceInput(): HTMLInputElement {
  return document.getElementById("telecom-price") as HTMLInputElement;
}

describe("TelecomForm — price-change warning (LIRA-260)", () => {
  it("edit the credit price -> warning with saved vs new price; restore -> gone", async () => {
    render(<StatefulTelecomForm />);
    await waitFor(() => expect(mockGetActiveCarrierLines).toHaveBeenCalled());
    expect(screen.queryByTestId("price-change-warning")).not.toBeInTheDocument();

    fireEvent.change(priceInput(), { target: { value: "250000" } });
    const warning = await screen.findByTestId("price-change-warning");
    expect(warning).toHaveTextContent(
      `catalog ${(270000).toLocaleString()} LBP → ${(250000).toLocaleString()} LBP`,
    );

    fireEvent.change(priceInput(), { target: { value: "270000" } });
    expect(screen.queryByTestId("price-change-warning")).not.toBeInTheDocument();
  });

  it("the sale is not blocked while the warning shows", async () => {
    render(<StatefulTelecomForm />);
    await waitFor(() => expect(mockGetActiveCarrierLines).toHaveBeenCalled());
    fireEvent.change(priceInput(), { target: { value: "250000" } });
    await screen.findByTestId("price-change-warning");
    expect(
      screen.getByRole("button", { name: /proceed to pay/i }),
    ).not.toBeDisabled();
  });

  it("no warning on a shop-line credit buy-back (payout)", async () => {
    render(
      <StatefulTelecomForm isShopLineMatch={true} shopLineBuyback={true} />,
    );
    await waitFor(() => expect(mockGetActiveCarrierLines).toHaveBeenCalled());
    fireEvent.change(priceInput(), { target: { value: "250000" } });
    expect(screen.queryByTestId("price-change-warning")).not.toBeInTheDocument();
  });
});

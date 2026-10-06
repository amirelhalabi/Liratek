/** @jest-environment jsdom */

/**
 * Alfa Gift — kept change reaches the page (owner decision 2026-10-06: the
 * "Keep change" button is gone; handing back less change than due keeps the
 * rest as profit automatically, on every page whose backend can book it).
 *
 * Alfa Gift sales go through RechargeRepository (`recharge:process`), which
 * already accepts `kept_change_*` — but the card-grid path
 * (TelecomForm → CardGridPayView → PaymentSheet) never forwarded
 * `onKeptChange`, so an under-return there was only a red "not covered"
 * warning while the Credit/Days sheet next to it kept the change. This
 * drives the REAL chain: open the sheet, overpay, hand nothing back.
 *
 * Rule 17: run against the pre-wiring code first — see the task report.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TelecomForm } from "../TelecomForm";
import type { FinancialTransaction } from "../../types";

const mockApi = {
  getAllSettings: jest.fn().mockResolvedValue([]),
  getActiveCarrierLines: jest.fn().mockResolvedValue([]),
  getPendingCarrierLineOwedDeliveries: jest
    .fn()
    .mockResolvedValue({ success: true, data: [] }),
  markCarrierLineOwedDeliverySent: jest
    .fn()
    .mockResolvedValue({ success: true, data: null }),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  // Stable reference (rule 25).
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

type Kept = { usd: number; lbp: number } | null;

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
    // 1 GB ($3.50) at the 110,000 sell rate → 385,000 LBP.
    giftTierKey: "1GB" as const,
    setGiftTierKey: jest.fn(),
    giftAmountUsd: "3.5",
    setGiftAmountUsd: jest.fn(),
    giftPriceLbp: "385000",
    setGiftPriceLbp: jest.fn(),
    giftCostLbp: "297500",
    setGiftCostLbp: jest.fn(),
    handleAlfaGiftSubmit: jest.fn(),
    paymentLines: [],
    setPaymentLines: jest.fn(),
    clientName: "",
    setClientName: jest.fn(),
    alfaCreditCostRate: 85000,
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

describe("TelecomForm — Alfa Gift kept change (automatic)", () => {
  it("overpaying 400,000 LBP for a 385,000 LBP gift and handing nothing back reports 15,000 LBP kept", async () => {
    const onKeptChange = jest.fn<void, [Kept]>();
    render(<TelecomForm {...buildProps({ onKeptChange })} />);
    await waitFor(() => expect(mockApi.getAllSettings).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole("button", { name: /^Pay$/ }));

    const amount = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      );
      if (!el) throw new Error("payment sheet not open");
      return el;
    });
    fireEvent.change(amount, { target: { value: "400000" } });
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("return-lbp"), {
      target: { value: "" },
    });

    expect(onKeptChange.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ usd: 0, lbp: 15_000 }),
    );
    expect(screen.getByTestId("keep-change-summary")).toHaveTextContent(
      "as profit.",
    );
    expect(
      screen.queryByTestId("return-mismatch-warning"),
    ).not.toBeInTheDocument();
  });
});

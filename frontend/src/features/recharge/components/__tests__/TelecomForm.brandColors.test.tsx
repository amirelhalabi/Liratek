/** @jest-environment jsdom */

/**
 * MTC / Alfa brand colours on the telecom form. Every carrier-accent surface
 * takes its classes from `PROVIDER_BRANDS` (rule 14) — the expected values
 * below are READ from that module, never hand-typed, so a brand change in
 * one place keeps this test honest.
 *
 * Rule 17: written before the TelecomForm / CardGridPayView change; its
 * failure on the old cyan/red classes is recorded in the change report.
 * Harness copied from TelecomForm.discountField.test.tsx (stable module-level
 * useApi mock, rule 25).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { TelecomForm } from "../TelecomForm";
import type { FinancialTransaction } from "../../types";
import { PROVIDER_BRANDS } from "@/shared/brand/providerBrands";

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

function classesOf(el: HTMLElement): string[] {
  return el.className.split(/\s+/).filter(Boolean);
}

function expectBrandButton(el: HTMLElement, brand: "MTC" | "ALFA") {
  const expected = PROVIDER_BRANDS[brand].button.split(/\s+/);
  expect(classesOf(el)).toEqual(expect.arrayContaining(expected));
}

describe("TelecomForm — carrier brand colours", () => {
  it.each([
    ["MTC", true],
    ["ALFA", false],
  ] as const)(
    "%s: the Proceed to Pay button carries the brand button classes",
    async (brand, isMTC) => {
      render(
        <TelecomForm
          {...buildProps({
            isMTC,
            activeProvider: brand === "MTC" ? "MTC" : "ALFA",
          })}
        />,
      );
      const proceed = screen.getByRole("button", { name: /proceed to pay/i });
      expect(proceed).toBeEnabled();
      expectBrandButton(proceed, brand);
    },
  );

  it.each([
    ["MTC", true],
    ["ALFA", false],
  ] as const)(
    "%s: the payment sheet confirm button carries the brand button classes",
    async (brand, isMTC) => {
      render(
        <TelecomForm
          {...buildProps({
            isMTC,
            activeProvider: brand === "MTC" ? "MTC" : "ALFA",
          })}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /proceed to pay/i }));
      const confirm = await screen.findByRole("button", { name: /^Pay / });
      expect(confirm).toBeEnabled();
      expectBrandButton(confirm, brand);
    },
  );

  it("ALFA: the Alfa Gift card-grid Pay button carries the brand button classes", async () => {
    render(
      <TelecomForm
        {...buildProps({
          isMTC: false,
          activeProvider: "ALFA",
          rechargeType: "ALFA_GIFT",
          giftTierKey: "1GB",
          giftAmountUsd: "3.5",
          giftPriceLbp: "385000",
          giftCostLbp: "297500",
        })}
      />,
    );
    expectBrandButton(
      await screen.findByRole("button", { name: /^Pay$/ }),
      "ALFA",
    );
  });
});

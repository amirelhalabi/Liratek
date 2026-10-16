/** @jest-environment jsdom */

/**
 * TelecomForm — in a customer session the Credit tab's phone field starts
 * with the session customer's phone (shop-day test 2026-10-16).
 *
 * The cashier started a session for Samir Aoun · 70998811, opened Mobile
 * Recharge, and had to type 70998811 again for every credit. The field now
 * fills itself, but only when it is empty: a number the cashier typed is
 * never replaced, a field they cleared stays clear, it comes back after the
 * form resets (Add to Cart), and it is removed when the session ends.
 *
 * Harness copied from TelecomForm.extraField.test.tsx (stable useApi mock,
 * rule 25); `phoneNumber` lives in a real useState like Recharge/index.tsx.
 */

import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
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
  useApi: () => mockApi,
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 91000, buyRate: 90000 }),
}));

let mockSession: {
  id: number;
  customer_name: string;
  customer_phone?: string;
} | null = null;
const mockLink = jest.fn();
const mockAddToCart = jest.fn();
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: mockSession,
    linkTransaction: mockLink,
    addToCart: mockAddToCart,
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

function Harness({ initial = "" }: { initial?: string }) {
  const [phone, setPhone] = useState(initial);
  return (
    <>
      <TelecomForm
        {...buildProps({ phoneNumber: phone, setPhoneNumber: setPhone })}
      />
      <button onClick={() => setPhone("")}>parent reset</button>
    </>
  );
}

const phoneField = () => screen.getByPlaceholderText("XX XXX XXX");

describe("TelecomForm — session customer's phone", () => {
  beforeEach(() => {
    mockSession = {
      id: 97,
      customer_name: "Samir Aoun",
      customer_phone: "+961 70 998 811",
    };
  });

  it("fills an empty Credit phone with the session phone", () => {
    render(<Harness />);
    expect(phoneField()).toHaveValue("70998811");
  });

  it("never replaces a number the cashier typed", () => {
    render(<Harness initial="03123987" />);
    expect(phoneField()).toHaveValue("03123987");
  });

  it("a field the cashier cleared stays clear", () => {
    render(<Harness />);
    fireEvent.change(phoneField(), { target: { value: "" } });
    expect(phoneField()).toHaveValue("");
  });

  it("comes back after the form resets (Add to Cart)", () => {
    render(<Harness />);
    fireEvent.change(phoneField(), { target: { value: "03111222" } });
    fireEvent.click(screen.getByText("parent reset"));
    expect(phoneField()).toHaveValue("70998811");
  });

  it("no session: the field stays empty", () => {
    mockSession = null;
    render(<Harness />);
    expect(phoneField()).toHaveValue("");
  });

  it("the session ends: the filled-in phone is removed", () => {
    const { rerender } = render(<Harness />);
    expect(phoneField()).toHaveValue("70998811");
    mockSession = null;
    rerender(<Harness />);
    expect(phoneField()).toHaveValue("");
  });
});

/** @jest-environment jsdom */

/**
 * TelecomForm (MTC / Alfa) — no "For Partner" during a customer session.
 *
 * Owner rule 2026-10-16: a customer session never has partner sales. While a
 * session is open the For Partner toggle is not offered, and one left ON when
 * the session starts is turned OFF (not merely hidden).
 *
 * Harness copied from TelecomForm.brandColors.test.tsx.
 */

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

// One module-level object (rule 25); the tests flip `activeSession`.
const mockSession: {
  activeSession: { id: number } | null;
  linkTransaction: jest.Mock;
  addToCart: jest.Mock;
} = { activeSession: null, linkTransaction: jest.fn(), addToCart: jest.fn() };
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => mockSession,
}));

// PartnerSelector owns its own partner fetch — not under test here.
jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
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

const TOGGLE = "recharge-for-partner-toggle";
const NOTICE = "recharge-partner-no-payment-notice";

describe("TelecomForm — no For Partner during a customer session", () => {
  beforeEach(() => {
    mockSession.activeSession = null;
  });

  it("guard: with no session the For Partner toggle is offered", () => {
    render(<TelecomForm {...buildProps()} />);
    expect(screen.getByTestId(TOGGLE)).toBeInTheDocument();
  });

  it("session open: the For Partner toggle is not rendered", () => {
    mockSession.activeSession = { id: 1 };
    render(<TelecomForm {...buildProps()} />);
    expect(screen.queryByTestId(TOGGLE)).not.toBeInTheDocument();
  });

  it("For Partner ON, then a session opens: it is turned OFF, and stays off when the session ends", async () => {
    const props = buildProps();
    const { rerender } = render(<TelecomForm {...props} />);
    fireEvent.click(screen.getByTestId(TOGGLE));
    expect(screen.getByTestId(NOTICE)).toBeInTheDocument();

    mockSession.activeSession = { id: 1 };
    rerender(<TelecomForm {...props} />);
    await waitFor(() =>
      expect(screen.queryByTestId(NOTICE)).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId(TOGGLE)).not.toBeInTheDocument();

    mockSession.activeSession = null;
    rerender(<TelecomForm {...props} />);
    expect(screen.getByTestId(TOGGLE)).not.toBeChecked();
  });
});

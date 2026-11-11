/**
 * TelecomForm — 3 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 3).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { act, render, waitFor } from "@testing-library/react";
import { TelecomForm } from "../TelecomForm";
import { type FinancialTransaction } from "../../types";

const mockSheetProps: { last?: Record<string, unknown> } = {};

jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: Record<string, unknown>) => {
    mockSheetProps.last = props;
    return null;
  },
}));

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

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockGetAllSettings as unknown as jest.Mock).mockReset();
  (mockGetAllSettings as unknown as jest.Mock).mockResolvedValue([]);
  (mockGetActiveCarrierLines as unknown as jest.Mock).mockReset();
  (mockGetActiveCarrierLines as unknown as jest.Mock).mockResolvedValue([]);
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("TelecomForm.addedChange (LIRA-336)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * TelecomForm — customer adds change on the credit buy-back sheet (LIRA-336,
   * T018). With the page's `onAddedChange` + `onBuybackCustomerLinesChange`,
   * the buy-back PaymentSheet gets an OPTIONAL "Customer gives change" section
   * (`optional`, `allowAddedChange`, total 0, LBP — the payout currency) and
   * the callback; never on an ordinary credit sale, never the account method;
   * Confirm waits while the section is over the cap.
   *
   * PaymentSheet is stubbed to record the props TelecomForm hands it (same
   * harness as TelecomForm.buybackRoundUp.test.tsx).
   * Rule 17: NOT proven failing-first — written after the TelecomForm change
   * (the page-level payload test Recharge.addedChange.test.tsx was).
   */

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
      methods: [
        { code: "CASH", label: "Cash" },
        { code: "CUSTOMER_ACCOUNT", label: "Customer account" },
      ],
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

  interface SheetCounterFlow {
    optional?: boolean;
    allowAddedChange?: boolean;
    totalAmount: number;
    currency: string;
    paymentMethods?: Array<{ code: string }>;
    onChange: (lines: unknown[]) => void;
    onStateChange?: (s: Record<string, unknown>) => void;
  }
  const sheetCounterFlow = (): SheetCounterFlow | undefined =>
    mockSheetProps.last?.counterFlow as SheetCounterFlow | undefined;

  describe("TelecomForm — buy-back customer adds change (LIRA-336)", () => {
    beforeEach(() => {
      delete mockSheetProps.last;
    });

    it("buy-back: an optional LBP section with allowAddedChange, the callback, and lines reported to the page", async () => {
      const onAddedChange = jest.fn();
      const onBuybackCustomerLinesChange = jest.fn();
      render(
        <TelecomForm
          {...buildProps({
            isShopLineMatch: true,
            shopLineBuyback: true,
            onAddedChange,
            onBuybackCustomerLinesChange,
          })}
        />,
      );
      await waitFor(() => expect(mockSheetProps.last).toBeDefined());
      expect(mockSheetProps.last?.onAddedChange).toBe(onAddedChange);
      const cf = sheetCounterFlow();
      expect(cf).toEqual(
        expect.objectContaining({
          optional: true,
          allowAddedChange: true,
          totalAmount: 0,
          currency: "LBP",
        }),
      );
      expect(cf?.paymentMethods?.map((m) => m.code)).toEqual(["CASH"]);
      expect(cf?.onChange).toBe(onBuybackCustomerLinesChange);
      expect(mockSheetProps.last?.confirmDisabled).toBe(false);

      // Over the cap → Confirm waits.
      act(() => {
        cf?.onStateChange?.({
          paid: 500000,
          owedToAccount: 0,
          forgiven: 0,
          balanced: false,
          overpaid: true,
          needsClient: false,
          unaccounted: 0,
          addedChange: 0,
        });
      });
      await waitFor(() =>
        expect(mockSheetProps.last?.confirmDisabled).toBe(true),
      );
    });

    it("ordinary credit sale: no section, no callback", async () => {
      render(
        <TelecomForm
          {...buildProps({
            isShopLineMatch: true,
            shopLineBuyback: false,
            onAddedChange: jest.fn(),
            onBuybackCustomerLinesChange: jest.fn(),
          })}
        />,
      );
      await waitFor(() => expect(mockSheetProps.last).toBeDefined());
      expect(mockSheetProps.last?.onAddedChange).toBeUndefined();
      expect(sheetCounterFlow()).toBeUndefined();
    });

    it("buy-back without the page's callbacks: no section", async () => {
      render(
        <TelecomForm
          {...buildProps({ isShopLineMatch: true, shopLineBuyback: true })}
        />,
      );
      await waitFor(() => expect(mockSheetProps.last).toBeDefined());
      expect(sheetCounterFlow()).toBeUndefined();
    });
  });
});

describe("TelecomForm.buybackPayoutKept", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Credit buy-back is a PAYOUT (the shop pays the customer for credits).
   * Owner decisions 2026-10-07 (FEATURE_GUIDE §4.1 "Kept change"): the buy-back
   * payment sheet runs in `payer="payout"` mode — no change (OUT) legs ever, a
   * small shortfall (under 100,000 LBP) is kept as profit via `onKeptChange`.
   * An ordinary credit sale on the same form stays a customer payment.
   *
   * PaymentSheet is stubbed to record the props TelecomForm hands it.
   * Rule 17: run against the pre-change form first — see the task report.
   */

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

  describe("TelecomForm — buy-back payment sheet is a payout", () => {
    beforeEach(() => {
      delete mockSheetProps.last;
    });

    it("buy-back: payer is payout, no change legs are wired, kept change is", async () => {
      const onReturnChange = jest.fn();
      const onKeptChange = jest.fn();
      render(
        <TelecomForm
          {...buildProps({
            isShopLineMatch: true,
            shopLineBuyback: true,
            onReturnChange,
            onKeptChange,
          })}
        />,
      );
      await waitFor(() => expect(mockSheetProps.last).toBeDefined());
      expect(mockSheetProps.last?.payer).toBe("payout");
      expect(mockSheetProps.last?.onReturnChange).toBeUndefined();
      expect(mockSheetProps.last?.onKeptChange).toBe(onKeptChange);
    });

    it("ordinary credit sale: stays a customer payment with change legs wired", async () => {
      const onReturnChange = jest.fn();
      const onKeptChange = jest.fn();
      render(
        <TelecomForm
          {...buildProps({
            isShopLineMatch: true,
            shopLineBuyback: false,
            onReturnChange,
            onKeptChange,
          })}
        />,
      );
      await waitFor(() => expect(mockSheetProps.last).toBeDefined());
      expect(mockSheetProps.last?.payer).not.toBe("payout");
      expect(mockSheetProps.last?.onReturnChange).toBe(onReturnChange);
    });
  });
});

describe("TelecomForm.buybackRoundUp (LIRA-334)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * TelecomForm — payout round-up pass-through on the credit buy-back sheet
   * (LIRA-334, T023). The page passes `onRoundUpChange`; the form forwards it
   * to the buy-back PaymentSheet only — never on an ordinary credit sale (a
   * customer payment, where an overpay is change).
   *
   * PaymentSheet is stubbed to record the props TelecomForm hands it (same
   * harness as TelecomForm.buybackPayoutKept.test.tsx).
   * Rule 17: run against the pre-change form first — see the task report.
   */

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

  describe("TelecomForm — buy-back round-up pass-through (LIRA-334)", () => {
    beforeEach(() => {
      delete mockSheetProps.last;
    });

    it("buy-back: onRoundUpChange reaches the payout sheet", async () => {
      const onRoundUpChange = jest.fn();
      render(
        <TelecomForm
          {...buildProps({
            isShopLineMatch: true,
            shopLineBuyback: true,
            onRoundUpChange,
          })}
        />,
      );
      await waitFor(() => expect(mockSheetProps.last).toBeDefined());
      expect(mockSheetProps.last?.payer).toBe("payout");
      expect(mockSheetProps.last?.onRoundUpChange).toBe(onRoundUpChange);
    });

    it("ordinary credit sale: no round-up is wired", async () => {
      const onRoundUpChange = jest.fn();
      render(
        <TelecomForm
          {...buildProps({
            isShopLineMatch: true,
            shopLineBuyback: false,
            onRoundUpChange,
          })}
        />,
      );
      await waitFor(() => expect(mockSheetProps.last).toBeDefined());
      expect(mockSheetProps.last?.payer).not.toBe("payout");
      expect(mockSheetProps.last?.onRoundUpChange).toBeUndefined();
    });
  });
});

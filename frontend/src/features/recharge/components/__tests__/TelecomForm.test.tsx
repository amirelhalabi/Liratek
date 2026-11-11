/**
 * TelecomForm — 8 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 8).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { TelecomForm } from "../TelecomForm";
import { type FinancialTransaction } from "../../types";
import { PROVIDER_BRANDS } from "@/shared/brand/providerBrands";
import { useState } from "react";

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

describe("TelecomForm.alfaGiftCostRate (LIRA-185)", () => {
  beforeAll(resetBetweenFiles);

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

      const card = await screen.findByText("1 GB");
      await waitFor(() => {
        card.click();
        expect(setGiftCostLbp).toHaveBeenLastCalledWith("315000");
      });
      expect(setGiftCostLbp).not.toHaveBeenCalledWith("297500");
    });
  });
});

describe("TelecomForm.alfaGiftSellRate (LIRA-185)", () => {
  beforeAll(resetBetweenFiles);

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

      const card = await screen.findByText("1 GB");
      card.click();

      expect(setGiftPriceLbp).toHaveBeenCalledWith("385000");
      expect(setGiftPriceLbp).not.toHaveBeenCalledWith("350000");
    });
  });
});

describe("TelecomForm.brandColors", () => {
  beforeAll(resetBetweenFiles);

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
        fireEvent.click(
          screen.getByRole("button", { name: /proceed to pay/i }),
        );
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
});

describe("TelecomForm.discountField (LIRA-185)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-185 owner decision #1 — the MTC/Alfa payment sheet's Discount field.
   * Shown on a sale (the discount lowers the price charged, capped at the
   * margin); hidden on a shop-line credit buy-back, which is a payout — the
   * server refuses a discount there too (RechargeRepository.discount.test.ts).
   *
   * Rule 17: NOT proven failing-first — the `showDiscount={!isCreditBuyback}`
   * change was written before this test. Harness copied from
   * TelecomForm.shopLineUseCheckbox.test.tsx (stable useApi mock, rule 25).
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

  describe("TelecomForm — payment-sheet Discount field (LIRA-185 #1)", () => {
    it("a credit SALE offers the Discount field", async () => {
      render(<TelecomForm {...buildProps({ isShopLineMatch: false })} />);
      fireEvent.click(screen.getByRole("button", { name: /proceed to pay/i }));
      expect(await screen.findByText("Discount")).toBeInTheDocument();
    });

    it("a credit BUY-BACK (payout) does not offer a Discount", async () => {
      render(
        <TelecomForm
          {...buildProps({ isShopLineMatch: true, shopLineBuyback: true })}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /proceed to pay out/i }),
      );
      // The sheet really opened (its payout confirm button is there)…
      expect(
        await screen.findByRole("button", { name: /confirm cashout/i }),
      ).toBeInTheDocument();
      // …and it carries no Discount field.
      expect(screen.queryByText("Discount")).not.toBeInTheDocument();
    });
  });
});

describe("TelecomForm.extraField (LIRA-319)", () => {
  beforeAll(resetBetweenFiles);

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
      expect(
        screen.queryByTestId("discount-mode-extra"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText("Extra", { selector: "input" }),
      ).not.toBeInTheDocument();
    });
  });
});

describe("TelecomForm.lira366NoteBox (LIRA-366)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-366 T050 — the MTC/Alfa sale sheet shows the optional Note box and
   * reports what is typed through `onTypedNoteChange` (the page sends it as
   * `typedNote`; Recharge.lira366TelecomTypedNote covers the payload). A
   * shop-line credit buy-back is a payout — money out — so it gets no box.
   *
   * Rule 17: NOT proven failing-first — the box was added before this test
   * (the page-level payload test was seen failing first). Harness copied from
   * TelecomForm.discountField (stable useApi mock, rule 25).
   */

  /**
   * LIRA-185 owner decision #1 — the MTC/Alfa payment sheet's Discount field.
   * Shown on a sale (the discount lowers the price charged, capped at the
   * margin); hidden on a shop-line credit buy-back, which is a payout — the
   * server refuses a discount there too (RechargeRepository.discount.test.ts).
   *
   * Rule 17: NOT proven failing-first — the `showDiscount={!isCreditBuyback}`
   * change was written before this test. Harness copied from
   * TelecomForm.shopLineUseCheckbox.test.tsx (stable useApi mock, rule 25).
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

  describe("TelecomForm — payment-sheet Note box (LIRA-366)", () => {
    it("a credit SALE offers the Note box and reports the typed text", async () => {
      const onTypedNoteChange = jest.fn();
      render(
        <TelecomForm
          {...buildProps({ isShopLineMatch: false, onTypedNoteChange })}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /proceed to pay/i }));
      const box = await screen.findByTestId("payment-note");
      fireEvent.change(box, { target: { value: "rest on Monday" } });
      expect(onTypedNoteChange).toHaveBeenCalledWith("rest on Monday");
    });

    it("a credit BUY-BACK (payout) has no Note box", async () => {
      render(
        <TelecomForm
          {...buildProps({
            isShopLineMatch: true,
            shopLineBuyback: true,
            onTypedNoteChange: jest.fn(),
          })}
        />,
      );
      fireEvent.click(
        screen.getByRole("button", { name: /proceed to pay out/i }),
      );
      expect(
        await screen.findByRole("button", { name: /confirm cashout/i }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("payment-note")).not.toBeInTheDocument();
    });
  });
});

describe("TelecomForm.priceChangeWarning (LIRA-260)", () => {
  beforeAll(resetBetweenFiles);

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
      expect(
        screen.queryByTestId("price-change-warning"),
      ).not.toBeInTheDocument();

      fireEvent.change(priceInput(), { target: { value: "250000" } });
      const warning = await screen.findByTestId("price-change-warning");
      expect(warning).toHaveTextContent(
        `catalog ${(270000).toLocaleString()} LBP → ${(250000).toLocaleString()} LBP`,
      );

      fireEvent.change(priceInput(), { target: { value: "270000" } });
      expect(
        screen.queryByTestId("price-change-warning"),
      ).not.toBeInTheDocument();
    });

    it("the sale is not blocked while the warning shows", async () => {
      render(<StatefulTelecomForm />);
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
      fireEvent.change(priceInput(), { target: { value: "250000" } });
      expect(
        screen.queryByTestId("price-change-warning"),
      ).not.toBeInTheDocument();
    });
  });
});

describe("TelecomForm.shopLineUseCheckbox (LIRA-088)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * NOT RUN — proven at the end-of-batch gate (owner process rule for this
   * batch: implement first, verify at the end).
   *
   * OWNER_NOTES_REMAINING_BUILD.md #21, case 2 (LIRA-088, migration v182).
   *
   * The MTC/Alfa shop-line checkbox: shown on the Credit tab whenever the
   * typed phone number matches one of the shop's active lines
   * (`isShopLineMatch`), default ON (case 1, the existing credit buy-back).
   * Unticking it flips the form to case 2 — the customer used the shop's own
   * line for a call, an ordinary credit sale.
   *
   * This test drives `TelecomForm` directly (not the full Recharge page) —
   * `isShopLineMatch`/`shopLineBuyback` are controlled props from the parent
   * (Recharge/index.tsx owns the state), so the checkbox's checked value and
   * every UI branch gated on `isCreditBuyback` are asserted per prop
   * combination, and `setShopLineBuyback` is asserted to be the ONLY thing an
   * uncheck click calls (the component itself is controlled, it does not
   * flip its own display without a prop update).
   *
   * Rule 17 — proven failing-first: reverting `isCreditBuyback`'s derivation
   * from `rechargeType === "CREDIT_TRANSFER" && isShopLineMatch &&
   * shopLineBuyback` back to the pre-fix `rechargeType === "CREDIT_TRANSFER"
   * && isShopLineMatch` (dropping `&& shopLineBuyback`) makes the "unticked
   * checkbox still shows the ordinary sale UI" test below fail — the button
   * would keep reading "Proceed to Pay Out" and the profit preview would stay
   * hidden even with `shopLineBuyback={false}`.
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

  describe("TelecomForm — shop-line checkbox (owner note #21, LIRA-088 case 2)", () => {
    it("renders NO checkbox and NO amber note when the phone does not match a shop line", async () => {
      render(<TelecomForm {...buildProps({ isShopLineMatch: false })} />);

      expect(
        screen.queryByTestId("shop-line-buyback-checkbox"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("shop-line-buyback-note"),
      ).not.toBeInTheDocument();
    });

    it("default ON (case 1): checkbox is checked, buy-back note shown, submit button reads 'Proceed to Pay Out', profit preview hidden", async () => {
      render(
        <TelecomForm
          {...buildProps({ isShopLineMatch: true, shopLineBuyback: true })}
        />,
      );

      const checkbox = screen.getByTestId(
        "shop-line-buyback-checkbox",
      ) as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
      expect(screen.getByTestId("shop-line-buyback-note").textContent).toMatch(
        /credit buy-back/i,
      );
      expect(
        screen.getByRole("button", { name: /proceed to pay out/i }),
      ).toBeInTheDocument();
      // Hidden for a buy-back — see the file header on `!isCreditBuyback` in
      // TelecomForm.tsx.
      expect(screen.queryByText("Profit")).not.toBeInTheDocument();
    });

    it("unticked (case 2): buy-back note swaps to the case-2 text, submit button reads 'Proceed to Pay', profit preview shows", async () => {
      render(
        <TelecomForm
          {...buildProps({ isShopLineMatch: true, shopLineBuyback: false })}
        />,
      );

      const checkbox = screen.getByTestId(
        "shop-line-buyback-checkbox",
      ) as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
      expect(screen.getByTestId("shop-line-buyback-note").textContent).toMatch(
        /charged to the customer/i,
      );
      expect(
        screen.getByRole("button", { name: /^proceed to pay$/i }),
      ).toBeInTheDocument();
      // Case 2 is an ordinary sale — the profit preview (hidden for buy-back)
      // is visible again.
      expect(screen.getByText("Profit")).toBeInTheDocument();
    });

    it("clicking the checkbox calls setShopLineBuyback with the new value — the component itself stays controlled", async () => {
      const setShopLineBuyback = jest.fn();
      render(
        <TelecomForm
          {...buildProps({
            isShopLineMatch: true,
            shopLineBuyback: true,
            setShopLineBuyback,
          })}
        />,
      );

      fireEvent.click(screen.getByTestId("shop-line-buyback-checkbox"));

      expect(setShopLineBuyback).toHaveBeenCalledWith(false);
      // Controlled: the DOM checkbox does NOT flip on its own without the
      // parent re-rendering with the new `shopLineBuyback` prop.
      expect(
        (screen.getByTestId("shop-line-buyback-checkbox") as HTMLInputElement)
          .checked,
      ).toBe(true);
    });
  });
});

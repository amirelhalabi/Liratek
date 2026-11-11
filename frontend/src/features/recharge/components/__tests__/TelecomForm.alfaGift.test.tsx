/**
 * TelecomForm — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TelecomForm } from "../TelecomForm";
import { type FinancialTransaction } from "../../types";

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

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockApi.getAllSettings as unknown as jest.Mock).mockReset();
  (mockApi.getAllSettings as unknown as jest.Mock).mockResolvedValue([]);
  (mockApi.getActiveCarrierLines as unknown as jest.Mock).mockReset();
  (mockApi.getActiveCarrierLines as unknown as jest.Mock).mockResolvedValue([]);
  (
    mockApi.getPendingCarrierLineOwedDeliveries as unknown as jest.Mock
  ).mockReset();
  (
    mockApi.getPendingCarrierLineOwedDeliveries as unknown as jest.Mock
  ).mockResolvedValue({ success: true, data: [] });
  (mockApi.markCarrierLineOwedDeliverySent as unknown as jest.Mock).mockReset();
  (
    mockApi.markCarrierLineOwedDeliverySent as unknown as jest.Mock
  ).mockResolvedValue({ success: true, data: null });
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("TelecomForm.alfaGiftClientSearch", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Alfa Gift direct sale (no customer session) — the payment window must let
   * the cashier SEARCH for a client and charge the gift to their account,
   * like the Credit/Days sheet next to it.
   *
   * Owner report (Corner Tech, web, 2026-11-11): on the Alfa Gift payment
   * window "the client name search does not work" and "changing the payment
   * method does not work". The card-grid sheet (TelecomForm → CardGridPayView
   * → PaymentSheet) rendered a plain "Client name (optional)" text box: no
   * search, no way to pick a registered client — so Customer Account was
   * always refused with "Client is required when using DEBT payment method".
   *
   * Drives the REAL chain (PaymentSheet + MultiPaymentInput are not stubbed).
   * Rule 17: run against the pre-fix code first — see the task report.
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

  function openSheet() {
    fireEvent.click(screen.getByRole("button", { name: /^Pay$/ }));
  }

  /** The client text box inside the open payment window — matched loosely so
   *  the pre-fix plain box and the search box are both found (the failure must
   *  be behavioural, not "element not found"). */
  async function clientBox(): Promise<HTMLInputElement> {
    // First match: the search box comes before the new-client phone box.
    const boxes = await screen.findAllByPlaceholderText(/client/i);
    return boxes[0] as HTMLInputElement;
  }

  describe("TelecomForm — Alfa Gift direct sale: client search + account", () => {
    beforeEach(() => jest.clearAllMocks());

    it("typing a name in the payment window searches clients", async () => {
      const searchClients = jest.fn();
      render(<TelecomForm {...buildProps({ searchClients })} />);
      await waitFor(() => expect(mockApi.getAllSettings).toHaveBeenCalled());
      openSheet();

      fireEvent.change(await clientBox(), { target: { value: "Maya" } });

      expect(searchClients).toHaveBeenCalledWith("Maya");
    });

    it("a search result can be picked, and picking switches the payment to the client's account", async () => {
      const selectClient = jest.fn();
      const maya = { id: 7, full_name: "Maya Fares", phone_number: "03123456" };
      render(
        <TelecomForm
          {...buildProps({
            selectClient,
            showClientSearch: true,
            telecomClientName: "Maya",
            clientSearchResults: [maya],
            methods: [
              { code: "CASH", label: "Cash" },
              { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
            ],
          })}
        />,
      );
      await waitFor(() => expect(mockApi.getAllSettings).toHaveBeenCalled());
      openSheet();
      await clientBox();

      fireEvent.click(screen.getByRole("button", { name: /Maya Fares/ }));

      expect(selectClient).toHaveBeenCalledWith(maya);
      await waitFor(() =>
        expect(
          document.querySelector<HTMLSelectElement>(
            'select[data-testid^="payment-method-"]',
          )?.value,
        ).toBe("CUSTOMER_ACCOUNT"),
      );
    });

    it("with a picked client, Customer Account is accepted (no 'client is required')", async () => {
      render(
        <TelecomForm
          {...buildProps({
            telecomClientId: 7,
            telecomClientName: "Maya Fares",
            methods: [
              { code: "CASH", label: "Cash" },
              { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
            ],
          })}
        />,
      );
      await waitFor(() => expect(mockApi.getAllSettings).toHaveBeenCalled());
      openSheet();
      const method = await waitFor(() => {
        const el = document.querySelector<HTMLSelectElement>(
          'select[data-testid^="payment-method-"]',
        );
        if (!el) throw new Error("payment sheet not open");
        return el;
      });
      fireEvent.change(method, { target: { value: "CUSTOMER_ACCOUNT" } });

      expect(method.value).toBe("CUSTOMER_ACCOUNT");
      expect(
        screen.queryByText(/Client is required when using DEBT/i),
      ).not.toBeInTheDocument();
    });

    // Parity with the Credit/Days sheet (same picked client, same rules):
    // an underpayment goes to the client's debt, and change not handed back
    // goes to the client's account.
    const withAccount = {
      telecomClientId: 7,
      telecomClientName: "Maya Fares",
      methods: [
        { code: "CASH", label: "Cash" },
        { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
      ],
    };

    async function amountInput(): Promise<HTMLInputElement> {
      return waitFor(() => {
        const el = document.querySelector<HTMLInputElement>(
          '[data-testid^="payment-amount-"]',
        );
        if (!el) throw new Error("payment sheet not open");
        return el;
      });
    }

    it("underpaying with a picked client puts the rest on the client's debt", async () => {
      const setPaymentLines = jest.fn();
      render(
        <TelecomForm {...buildProps({ ...withAccount, setPaymentLines })} />,
      );
      await waitFor(() => expect(mockApi.getAllSettings).toHaveBeenCalled());
      openSheet();
      // 1 GB gift = 385,000 LBP; the customer hands over 300,000.
      fireEvent.change(await amountInput(), { target: { value: "300000" } });

      await waitFor(() =>
        expect(setPaymentLines.mock.calls.at(-1)?.[0]).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              method: "CUSTOMER_ACCOUNT",
              currencyCode: "LBP",
              amount: 85_000,
            }),
          ]),
        ),
      );
    });

    it("change not handed back can go to the picked client's account", async () => {
      const onReturnChange = jest.fn();
      render(
        <TelecomForm {...buildProps({ ...withAccount, onReturnChange })} />,
      );
      await waitFor(() => expect(mockApi.getAllSettings).toHaveBeenCalled());
      openSheet();
      fireEvent.change(await amountInput(), { target: { value: "400000" } });

      fireEvent.click(screen.getByTestId("change-destination-account"));

      await waitFor(() =>
        expect(onReturnChange.mock.calls.at(-1)?.[0]).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              method: "CUSTOMER_ACCOUNT",
              direction: "OUT",
              amount: 15_000,
            }),
          ]),
        ),
      );
    });
  });
});

describe("TelecomForm.alfaGiftKeptChange", () => {
  beforeAll(resetBetweenFiles);

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
});

/**
 * Suppliers — 2 per-ticket test files merged into one suite
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

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supplierCashflowSchema, supplierSettleSchema } from "@liratek/core";
import Suppliers from "../index";

const mockGetSuppliers = jest.fn();

const mockGetUnsettledTransactions = jest.fn();

const mockSettleTransactions = jest.fn();

const mockRecordSupplierCashflow = jest.fn();

const mockApi = {
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: jest.fn().mockResolvedValue([]),
  getSupplierAccountBalances: jest.fn().mockResolvedValue([]),
  getSupplierProductBalances: jest.fn().mockResolvedValue([]),
  getSupplierLedger: jest.fn().mockResolvedValue([]),
  getSupplierProductItems: jest.fn().mockResolvedValue([]),
  getAllSupplierTransactions: jest.fn().mockResolvedValue([]),
  getUnsettledTransactions: mockGetUnsettledTransactions,
  settleTransactions: mockSettleTransactions,
  recordSupplierCashflow: mockRecordSupplierCashflow,
  getOpenRecordedSupplierDebts: jest.fn().mockResolvedValue([]),
  addSupplierLedgerEntry: jest.fn(),
  getSupplierPurchases: jest.fn(),
  createSupplierPurchase: jest.fn(),
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    appEvents: { emit: jest.fn() },
  };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "OMT", label: "OMT" },
    ],
    drawerAffectingMethods: [],
    allMethods: [],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: "OMT",
    partnerSystem: "WHISH",
    loading: false,
  }),
}));

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockGetSuppliers as unknown as jest.Mock).mockReset();
  (mockGetUnsettledTransactions as unknown as jest.Mock).mockReset();
  (mockSettleTransactions as unknown as jest.Mock).mockReset();
  (mockRecordSupplierCashflow as unknown as jest.Mock).mockReset();
  (mockApi.getSupplierBalances as unknown as jest.Mock).mockReset();
  (mockApi.getSupplierBalances as unknown as jest.Mock).mockResolvedValue([]);
  (mockApi.getSupplierAccountBalances as unknown as jest.Mock).mockReset();
  (
    mockApi.getSupplierAccountBalances as unknown as jest.Mock
  ).mockResolvedValue([]);
  (mockApi.getSupplierProductBalances as unknown as jest.Mock).mockReset();
  (
    mockApi.getSupplierProductBalances as unknown as jest.Mock
  ).mockResolvedValue([]);
  (mockApi.getSupplierLedger as unknown as jest.Mock).mockReset();
  (mockApi.getSupplierLedger as unknown as jest.Mock).mockResolvedValue([]);
  (mockApi.getSupplierProductItems as unknown as jest.Mock).mockReset();
  (mockApi.getSupplierProductItems as unknown as jest.Mock).mockResolvedValue(
    [],
  );
  (mockApi.getAllSupplierTransactions as unknown as jest.Mock).mockReset();
  (
    mockApi.getAllSupplierTransactions as unknown as jest.Mock
  ).mockResolvedValue([]);
  (mockApi.getOpenRecordedSupplierDebts as unknown as jest.Mock).mockReset();
  (
    mockApi.getOpenRecordedSupplierDebts as unknown as jest.Mock
  ).mockResolvedValue([]);
  (mockApi.addSupplierLedgerEntry as unknown as jest.Mock).mockReset();
  (mockApi.getSupplierPurchases as unknown as jest.Mock).mockReset();
  (mockApi.createSupplierPurchase as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Suppliers.lira310BatchWaive (LIRA-310)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-310 follow-up — owner decision 2026-10-12: NO Waive anywhere on the
   * Suppliers page. A gap the supplier forgives is recorded by typing in the
   * Pay tab's Discount field by hand.
   *
   *   - batch settle (Settle tab → Confirm Settlement): $100 owed, $97 paid →
   *     the Remaining row shows, no Waive button, Confirm stays disabled;
   *   - a full payment sends no `discount` (names via the core
   *     `supplierSettleSchema` — rule 24);
   *   - a bills-only batch collected by "Other payment" offers no Waive;
   *   - Pay / Receive tab: $3 short of $100 → no Waive button; the Discount
   *     field is still there, and a typed $3 discount is sent as
   *     `discount: { amount_usd: 3, amount_lbp: 0 }` (names via the core
   *     `supplierCashflowSchema`).
   *
   * Same INTERACTION-layer strategy as Suppliers.settlePaymentReconciliation:
   * the real CounterpartySettleModal / MultiPaymentInput; `useApi` mocked with
   * a stable object (rule 25).
   * Rule 17: rewritten before the change and run red against the LIRA-310
   * Waive wiring.
   */

  const OMT_SUPPLIER = {
    id: 2,
    name: "OMT",
    contact_name: null,
    phone: null,
    note: null,
    is_active: 1,
    module_key: null,
    provider: "OMT",
    is_system: 1,
    created_at: "2026-08-01T00:00:00Z",
    commission_entry_mode: "LUMP" as const,
    commission_rate: null,
  };

  const LEGACY_ROW = {
    id: 201,
    service_type: "SEND" as const,
    amount: 100,
    currency: "USD",
    commission: 5,
    omt_fee: 2,
    omt_service_type: "OMT_TRANSFER",
    client_name: null,
    supplier_owed: 100,
    commission_model: 0,
    created_at: "2026-08-08T10:05:00Z",
  };

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <Suppliers />
      </QueryClientProvider>,
    );
  }

  async function openSettleConfirm() {
    fireEvent.click(await screen.findByText("OMT"));
    const legacyRow = (await screen.findByText("OMT_TRANSFER")).closest(
      "label",
    )!;
    fireEvent.click(within(legacyRow).getByRole("checkbox"));
    fireEvent.click(await screen.findByText(/^Settle \(1\)$/));
    const amountInput = await screen.findByDisplayValue("100");
    const submit = screen.getByText("Confirm Settlement");
    return { amountInput, submit };
  }

  describe("Suppliers page — no Waive on the batch settle (owner 2026-10-12)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetSuppliers.mockResolvedValue([OMT_SUPPLIER]);
      mockGetUnsettledTransactions.mockImplementation((provider: string) =>
        Promise.resolve(provider === "OMT" ? [LEGACY_ROW] : []),
      );
      mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
    });

    it("$100 owed, $97 paid: Remaining shows, no Waive button, Confirm stays disabled", async () => {
      renderPage();
      const { amountInput, submit } = await openSettleConfirm();
      fireEvent.change(amountInput, { target: { value: "97" } });
      await waitFor(() => expect(submit).toBeDisabled());
      expect(await screen.findByTestId("remaining-row")).toBeInTheDocument();
      expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
      expect(screen.queryByTestId("settle-waived")).not.toBeInTheDocument();
      expect(mockSettleTransactions).not.toHaveBeenCalled();
    });

    it("a full payment sends no discount", async () => {
      renderPage();
      const { submit } = await openSettleConfirm();
      await waitFor(() => expect(submit).not.toBeDisabled());
      fireEvent.click(submit);
      await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
      const payload = mockSettleTransactions.mock.calls[0][0];
      expect(supplierSettleSchema.parse(payload).discount).toBeUndefined();
      expect(payload).not.toHaveProperty("discount");
    });

    it("bills-only batch collected by Other payment: no Waive", async () => {
      const KATSH_SUPPLIER = {
        ...OMT_SUPPLIER,
        id: 1,
        name: "Katsh",
        provider: "Katsh",
        commission_entry_mode: "LUMP" as const,
        commission_rate: null,
        commission_rate_currency: "USD" as const,
      };
      const BILL_ROW = {
        id: 101,
        service_type: "BILL" as const,
        amount: 50,
        currency: "USD",
        commission: 0,
        omt_fee: null,
        omt_service_type: null,
        client_name: null,
        supplier_owed: 0,
        commission_model: 1,
        created_at: "2026-08-08T10:00:00Z",
      };
      mockGetSuppliers.mockResolvedValue([KATSH_SUPPLIER]);
      mockGetUnsettledTransactions.mockImplementation((provider: string) =>
        Promise.resolve(provider === "Katsh" ? [BILL_ROW] : []),
      );

      renderPage();
      fireEvent.click((await screen.findAllByText("Katsh"))[0]);
      const billRow = (await screen.findByText("Bill")).closest("label")!;
      fireEvent.click(within(billRow).getByRole("checkbox"));
      fireEvent.click(await screen.findByText(/^Settle \(1\)$/));
      fireEvent.click(await screen.findByText("Other payment"));
      // Enter a $4 commission, then pay $3 of it.
      const commissionInputs = screen.getAllByPlaceholderText("0.00");
      fireEvent.change(commissionInputs[0], { target: { value: "4" } });
      const paymentAmount = async (value: string) =>
        (await screen.findAllByDisplayValue(value)).find((el) =>
          el.getAttribute("data-testid")?.startsWith("payment-amount"),
        )!;
      fireEvent.change(await paymentAmount("4"), { target: { value: "3" } });
      expect(await paymentAmount("3")).toBeInTheDocument();
      // The Remaining row shows (a $1 gap) — but without its Waive button.
      expect(await screen.findByTestId("remaining-amount")).toBeInTheDocument();
      expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
    });
  });

  describe("Suppliers page — Pay / Receive tab: Discount field, no Waive (owner 2026-10-12)", () => {
    // LIRA-345 (S3) — product suppliers settle by day (no Pay / Receive),
    // so the Pay form is exercised on a company supplier that still has it.
    const PRODUCT_SUPPLIER = {
      id: 5,
      name: "Acme Distributors",
      contact_name: null,
      phone: null,
      note: null,
      is_active: 1,
      module_key: null,
      provider: "WHISH_APP",
      is_system: 1,
      created_at: "2026-08-01T00:00:00Z",
    };

    beforeEach(() => {
      jest.clearAllMocks();
      mockGetSuppliers.mockResolvedValue([PRODUCT_SUPPLIER]);
      mockGetUnsettledTransactions.mockResolvedValue([]);
      mockApi.getSupplierBalances.mockResolvedValue([
        { supplier_id: 5, total_usd: 100, total_lbp: 0 },
      ]);
      mockRecordSupplierCashflow.mockResolvedValue({ success: true, id: 1 });
    });

    async function openPayTab() {
      renderPage();
      fireEvent.click((await screen.findAllByText("Acme Distributors"))[0]);
      fireEvent.click(await screen.findByText("Pay / Receive"));
      const amount = (await screen.findAllByTestId(/^payment-amount-/)).find(
        (el) => el.tagName === "INPUT",
      ) as HTMLInputElement;
      return amount;
    }

    function discountInput(): HTMLInputElement {
      const label = screen.getByText("Discount", { selector: "span" });
      const row = label.parentElement as HTMLElement;
      return row.querySelector("input") as HTMLInputElement;
    }

    it("$3 short of $100: no Waive button, the Discount field is shown", async () => {
      const amount = await openPayTab();
      fireEvent.change(amount, { target: { value: "97" } });
      expect(await screen.findByTestId("remaining-row")).toBeInTheDocument();
      expect(screen.getByText("Remaining to pay")).toBeInTheDocument();
      expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
      expect(discountInput()).toBeInTheDocument();
    });

    it("a hand-typed $3 discount is sent with the $97 payment", async () => {
      const amount = await openPayTab();
      fireEvent.change(amount, { target: { value: "97" } });
      fireEvent.change(discountInput(), { target: { value: "3" } });
      await waitFor(() =>
        expect(screen.queryByTestId("remaining-row")).not.toBeInTheDocument(),
      );
      expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
      fireEvent.click(screen.getByText("Record Payment"));

      await waitFor(() =>
        expect(mockRecordSupplierCashflow).toHaveBeenCalled(),
      );
      const parsed = supplierCashflowSchema.parse(
        mockRecordSupplierCashflow.mock.calls[0][0],
      );
      expect(parsed.direction).toBe("PAY");
      expect(parsed.discount).toEqual({ amount_usd: 3, amount_lbp: 0 });
      expect(parsed.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 97 },
      ]);
    });
  });
});

describe("Suppliers.lira372 (LIRA-372)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-372 (owner 2026-11-05) — the ONE shared Discount line
   * (`SettleDiscountLine`) on the Suppliers settle screens:
   *   - batch Settle, only when the shop pays (no line on a bills-only batch);
   *   - Pay / Receive, both directions (a Receive discount is new: the shop
   *     accepts a little less from the supplier).
   * Capped at $5 / 450,000 LBP; typing it sets the payment to owed − discount,
   * even a payment typed by hand (option B). No Waive. Payload keys are read
   * back through the core schemas (rule 24).
   */

  const OMT_SUPPLIER = {
    id: 2,
    name: "OMT",
    contact_name: null,
    phone: null,
    note: null,
    is_active: 1,
    module_key: null,
    provider: "OMT",
    is_system: 1,
    created_at: "2026-08-01T00:00:00Z",
    commission_entry_mode: "LUMP" as const,
    commission_rate: null,
  };

  const LEGACY_ROW = {
    id: 201,
    service_type: "SEND" as const,
    amount: 100,
    currency: "USD",
    commission: 5,
    omt_fee: 2,
    omt_service_type: "OMT_TRANSFER",
    client_name: null,
    supplier_owed: 100,
    commission_model: 0,
    created_at: "2026-08-08T10:05:00Z",
  };

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <Suppliers />
      </QueryClientProvider>,
    );
  }

  async function openSettleConfirm() {
    fireEvent.click(await screen.findByText("OMT"));
    const legacyRow = (await screen.findByText("OMT_TRANSFER")).closest(
      "label",
    )!;
    fireEvent.click(within(legacyRow).getByRole("checkbox"));
    fireEvent.click(await screen.findByText(/^Settle \(1\)$/));
    const amountInput = await screen.findByDisplayValue("100");
    const submit = screen.getByText("Confirm Settlement");
    return { amountInput, submit };
  }

  const discountUsd = () =>
    screen.getByTestId("settle-discount-usd") as HTMLInputElement;
  const paymentAmount = () =>
    screen
      .getAllByTestId(/^payment-amount-/)
      .find((el) => el.tagName === "INPUT") as HTMLInputElement;

  describe("batch Settle — Discount line when the shop pays (LIRA-372)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetSuppliers.mockResolvedValue([OMT_SUPPLIER]);
      mockGetUnsettledTransactions.mockImplementation((provider: string) =>
        Promise.resolve(provider === "OMT" ? [LEGACY_ROW] : []),
      );
      mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
    });

    it("$100 net pay, discount 2.50 → the pay line reads 97.5, the payload carries the discount", async () => {
      renderPage();
      const { submit } = await openSettleConfirm();
      expect(screen.getByTestId("settle-discount-line")).toBeInTheDocument();
      fireEvent.change(discountUsd(), { target: { value: "2.5" } });
      await waitFor(() => expect(paymentAmount().value).toBe("97.5"));
      await waitFor(() => expect(submit).not.toBeDisabled());
      fireEvent.click(submit);
      await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
      const parsed = supplierSettleSchema.parse(
        mockSettleTransactions.mock.calls[0][0],
      );
      expect(parsed.discount).toEqual(
        expect.objectContaining({ amount_usd: 2.5, amount_lbp: 0 }),
      );
    });

    it("typed 6 → capped at $5 with the note; a hand-typed $100 is lowered to $95", async () => {
      renderPage();
      await openSettleConfirm();
      fireEvent.change(paymentAmount(), { target: { value: "100" } });
      fireEvent.change(discountUsd(), { target: { value: "6" } });
      expect(await screen.findByTestId("discount-cap-note")).toHaveTextContent(
        "Capped to max ($5.00)",
      );
      await waitFor(() => expect(paymentAmount().value).toBe("95"));
      expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
    });
  });

  describe("Pay / Receive — the shared Discount line both ways (LIRA-372)", () => {
    const COMPANY = {
      id: 5,
      name: "Acme Distributors",
      contact_name: null,
      phone: null,
      note: null,
      is_active: 1,
      module_key: null,
      provider: "WHISH_APP",
      is_system: 1,
      created_at: "2026-08-01T00:00:00Z",
    };

    beforeEach(() => {
      jest.clearAllMocks();
      mockGetSuppliers.mockResolvedValue([COMPANY]);
      mockGetUnsettledTransactions.mockResolvedValue([]);
      mockRecordSupplierCashflow.mockResolvedValue({ success: true, id: 1 });
    });

    async function openPayTab(balanceUsd: number) {
      mockApi.getSupplierBalances.mockResolvedValue([
        { supplier_id: 5, total_usd: balanceUsd, total_lbp: 0 },
      ]);
      renderPage();
      fireEvent.click((await screen.findAllByText("Acme Distributors"))[0]);
      fireEvent.click(await screen.findByText("Pay / Receive"));
      await screen.findByTestId("multi-payment-input");
      await waitFor(() =>
        expect(paymentAmount().value).toBe(String(Math.abs(balanceUsd))),
      );
    }

    it("Pay: owed $412.50, discount 2.50 → pay line 410; typed 6 → capped at 5, sent", async () => {
      await openPayTab(412.5);
      expect(screen.getByTestId("settle-discount-line")).toBeInTheDocument();
      fireEvent.change(discountUsd(), { target: { value: "2.5" } });
      await waitFor(() => expect(paymentAmount().value).toBe("410"));
      fireEvent.change(discountUsd(), { target: { value: "6" } });
      expect(await screen.findByTestId("discount-cap-note")).toHaveTextContent(
        "Capped to max ($5.00)",
      );
      await waitFor(() => expect(paymentAmount().value).toBe("407.5"));
      fireEvent.change(screen.getByTestId("settle-discount-reason"), {
        target: { value: "rounded" },
      });
      fireEvent.click(screen.getByText("Record Payment"));
      await waitFor(() =>
        expect(mockRecordSupplierCashflow).toHaveBeenCalled(),
      );
      const parsed = supplierCashflowSchema.parse(
        mockRecordSupplierCashflow.mock.calls[0][0],
      );
      expect(parsed.direction).toBe("PAY");
      expect(parsed.discount).toEqual({
        amount_usd: 5,
        amount_lbp: 0,
        reason: "rounded",
      });
      expect(parsed.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 407.5 },
      ]);
    });

    it("Pay: a hand-typed $412.50 is lowered to $410 when 2.50 is typed (owner option B)", async () => {
      await openPayTab(412.5);
      fireEvent.change(paymentAmount(), { target: { value: "412.5" } });
      fireEvent.change(discountUsd(), { target: { value: "2.5" } });
      await waitFor(() => expect(paymentAmount().value).toBe("410"));
    });

    it("Receive: the supplier owes $500, discount 5 → receive line 495, discount sent", async () => {
      await openPayTab(-500);
      expect(screen.getByTestId("settle-discount-line")).toBeInTheDocument();
      fireEvent.change(discountUsd(), { target: { value: "5" } });
      await waitFor(() => expect(paymentAmount().value).toBe("495"));
      fireEvent.click(screen.getByText("Record Receipt"));
      await waitFor(() =>
        expect(mockRecordSupplierCashflow).toHaveBeenCalled(),
      );
      const parsed = supplierCashflowSchema.parse(
        mockRecordSupplierCashflow.mock.calls[0][0],
      );
      expect(parsed.direction).toBe("RECEIVE");
      expect(parsed.discount).toEqual({ amount_usd: 5, amount_lbp: 0 });
      expect(parsed.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 495 },
      ]);
    });
  });
});

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
import Suppliers from "../index";

const mockGetSuppliers = jest.fn();

const mockGetSupplierBalances = jest.fn();

const mockGetSupplierProductBalances = jest.fn();

const mockGetSupplierLedger = jest.fn();

const mockGetSupplierProductItems = jest.fn();

const mockGetAllSupplierTransactions = jest.fn();

const mockGetUnsettledTransactions = jest.fn();

const mockSettleTransactions = jest.fn();

const mockAppEventsEmit = jest.fn();

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      getSuppliers: mockGetSuppliers,
      getSupplierBalances: mockGetSupplierBalances,
      // OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-188) — the page now always
      // fetches this too; none of this file's cases exercise an account
      // parent, so a static empty array (no account on this tenant) keeps
      // every existing assertion byte-for-byte unaffected.
      getSupplierAccountBalances: jest.fn().mockResolvedValue([]),
      getSupplierProductBalances: mockGetSupplierProductBalances,
      getSupplierLedger: mockGetSupplierLedger,
      getSupplierProductItems: mockGetSupplierProductItems,
      getAllSupplierTransactions: mockGetAllSupplierTransactions,
      getUnsettledTransactions: mockGetUnsettledTransactions,
      settleTransactions: mockSettleTransactions,
      recordSupplierCashflow: jest.fn(),
      addSupplierLedgerEntry: jest.fn(),
      getSupplierPurchases: jest.fn(),
      createSupplierPurchase: jest.fn(),
    }),
    // Wrapped in a closure — jest.mock factories are hoisted above this
    // file's `const` declarations, so a direct `{ emit: mockAppEventsEmit }`
    // property throws a TDZ error (same reason as the sibling test file).
    appEvents: { emit: (...args: unknown[]) => mockAppEventsEmit(...args) },
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
  (mockGetSupplierBalances as unknown as jest.Mock).mockReset();
  (mockGetSupplierProductBalances as unknown as jest.Mock).mockReset();
  (mockGetSupplierLedger as unknown as jest.Mock).mockReset();
  (mockGetSupplierProductItems as unknown as jest.Mock).mockReset();
  (mockGetAllSupplierTransactions as unknown as jest.Mock).mockReset();
  (mockGetUnsettledTransactions as unknown as jest.Mock).mockReset();
  (mockSettleTransactions as unknown as jest.Mock).mockReset();
  (mockAppEventsEmit as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Suppliers.settleNetPayCurrency (LIRA-119)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-119 (superseded for bills by BILL_COMMISSION_SETTLEMENT_PLAN.md,
   * LIRA-137) — Settle modal showed "Net payment $0.00" / "Total Amount
   * $0.00" for a LBP RATE-mode commission (Katsh bills), hardcoding USD
   * everywhere regardless of the commission/rate currency the operator
   * actually entered.
   *
   * LIRA-119 fixed only the currency LABEL on "Net payment"/"Total Amount" —
   * both were still frozen at 0, and the commission still posted as an
   * invisible cashless `SUPPLIER_PAYS_US` ledger credit (owner report,
   * 2026-08-11: "how will I know how much I am paying?"). LIRA-137 removes
   * "Net payment"/"Total Amount" for a bills-only batch ENTIRELY — there is no
   * tender to enter — and replaces them with "{supplier} owes you: <amount>",
   * the RAW entered commission, framed as arriving IN via a top-up to the
   * provider's own drawer (`_bookBillsCommissionDrawerTopUp`,
   * SupplierRepository.ts) the instant Confirm is pressed. The legacy/OMT
   * scenario (second test below) is untouched — it still shows "Net payment
   * to <supplier>:" exactly as LIRA-119 left it.
   *
   * This is an INTERACTION-layer test (rule 17's "not just repo-level math"
   * instruction) — unlike Suppliers.commissionAtSettlement.test.tsx, this file
   * does NOT mock `CounterpartySettleModal`/`MultiPaymentInput`: it renders the
   * REAL `@liratek/ui` components (jest.config.ts maps "@liratek/ui" to
   * packages/ui/src, so this is the exact code the app ships) so the
   * assertions below are against literal rendered DOM text, not intercepted
   * props.
   *
   * Rule 17 (failing-first): confirmed against the pre-LIRA-137
   * Suppliers/index.tsx — the first test below (Katsh BILL) failed at
   * `screen.getByText("Net payment to Katsh:")` (that label no longer renders
   * for a bills-only batch; `queryByText` was substituted for the assertion
   * that it does NOT). See the task report for the exact failure output.
   */

  // Same fixtures as Suppliers.commissionAtSettlement.test.tsx — Katsh is the
  // ONE bill provider that earns commission (20,000 LBP/bill, RATE mode,
  // LIRA-112's commission_rate_currency = "LBP").
  const KATSH_SUPPLIER = {
    id: 1,
    name: "Katsh",
    contact_name: null,
    phone: null,
    note: null,
    is_active: 1,
    module_key: null,
    provider: "Katsh",
    is_system: 1,
    created_at: "2026-08-01T00:00:00Z",
    commission_entry_mode: "RATE" as const,
    commission_rate: 20000,
    commission_rate_currency: "LBP" as const,
  };

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

  // commission_model = 1 (AT_SETTLEMENT), bill principal never reaches the
  // ledger (SUPPLIER_OWED_EXPR's BILL branch is hardcoded 0) — supplier_owed
  // is 0 regardless of the bill's face amount.
  const BILL_ROW = {
    id: 101,
    service_type: "BILL" as const,
    amount: 500000,
    currency: "LBP",
    commission: 0,
    omt_fee: null,
    omt_service_type: null,
    client_name: null,
    supplier_owed: 0,
    commission_model: 1,
    created_at: "2026-08-08T10:00:00Z",
  };

  // commission_model = 0 (EMBEDDED legacy) — real USD cash genuinely owed, to
  // prove the fix does NOT relabel a real-cash USD batch as LBP.
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

  describe("Suppliers page — Settle modal net-payment currency (LIRA-119)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetSupplierBalances.mockResolvedValue([]);
      mockGetSupplierProductBalances.mockResolvedValue([]);
      mockGetSupplierLedger.mockResolvedValue([]);
      mockGetAllSupplierTransactions.mockResolvedValue([]);
      mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
    });

    it("LBP-commission (Katsh bill): no 'Net payment'/'Total Amount' tender form at all — '{supplier} owes you: 20,000 LBP' instead, and Confirm is enabled with no legs", async () => {
      mockGetSuppliers.mockResolvedValue([KATSH_SUPPLIER, OMT_SUPPLIER]);
      mockGetUnsettledTransactions.mockImplementation((provider: string) =>
        Promise.resolve(provider === "Katsh" ? [BILL_ROW] : []),
      );

      renderPage();

      fireEvent.click((await screen.findAllByText("Katsh"))[0]);

      const billRow = (await screen.findByText("Bill")).closest("label")!;
      fireEvent.click(within(billRow).getByRole("checkbox"));

      fireEvent.click(await screen.findByText(/^Settle \(1\)$/));

      // D8 default: RATE mode pre-selected, rate pre-filled 20000 from the
      // supplier's own commission_rate — confirms the modal actually opened
      // with the LBP-rated commission math the ticket's screenshot shows.
      expect(await screen.findByDisplayValue("20000")).toBeInTheDocument();

      // ── BILL_COMMISSION_SETTLEMENT_PLAN.md (LIRA-137) — "Net payment to
      // Katsh:" no longer renders at all for a bills-only batch; it is
      // replaced by "Katsh owes you:" showing the RAW entered commission
      // (rate × count = 20,000 × 1), never netted against a $0 "owed" figure.
      expect(screen.queryByText("Net payment to Katsh:")).toBeNull();
      expect(screen.queryByText(/Total owed to Katsh/)).toBeNull();
      const owesYouLabel = await screen.findByText("Katsh owes you:");
      const owesYouRow = owesYouLabel.closest("div")!;
      expect(within(owesYouRow).getByText("20,000 LBP")).toBeInTheDocument();

      // ── No tender form at all: MultiPaymentInput does not render for a
      // bills-only batch (nothing to pay — the commission arrives as a
      // provider-drawer top-up, not a payment leg the operator enters). ─────
      expect(screen.queryByText("Total Amount")).toBeNull();
      expect(
        document.querySelector('[data-testid^="payment-currency-"]'),
      ).toBeNull();
      expect(
        document.querySelector('[data-testid^="payment-amount-"]'),
      ).toBeNull();

      // ── Confirm is enabled (nothing owed, no legs — no mismatch) ─────────
      const confirmBtn = screen.getByText("Confirm Settlement");
      expect(confirmBtn).not.toBeDisabled();

      // Confirming still settles $0/0 LBP cash + the real 20,000 LBP
      // commission (now a drawer top-up, not a ledger credit) — no
      // `payments` leg is ever sent for this batch shape.
      fireEvent.click(confirmBtn);
      await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
      const payload = mockSettleTransactions.mock.calls[0][0];
      expect(payload.amount_usd).toBe(0);
      expect(payload.amount_lbp).toBe(0);
      expect(payload.commission_lbp).toBe(20000);
      expect(payload.payments).toBeUndefined();
    });

    // Owner follow-up (2026-08-13, request #3) — "Other payment" mode: the
    // SAME real MultiPaymentInput this file already proves renders for the
    // legacy branch now renders for a bills-only batch too, once the operator
    // switches the toggle — autofilled with the entered commission (never
    // typed manually), and the leg travels to the backend as `payments` +
    // `commission_collection_mode: "OTHER_PAYMENT"`.
    it("Other payment mode: switching the toggle reveals MultiPaymentInput autofilled with the commission, and Confirm sends the leg + commission_collection_mode", async () => {
      mockGetSuppliers.mockResolvedValue([KATSH_SUPPLIER, OMT_SUPPLIER]);
      mockGetUnsettledTransactions.mockImplementation((provider: string) =>
        Promise.resolve(provider === "Katsh" ? [BILL_ROW] : []),
      );

      renderPage();

      fireEvent.click((await screen.findAllByText("Katsh"))[0]);
      const billRow = (await screen.findByText("Bill")).closest("label")!;
      fireEvent.click(within(billRow).getByRole("checkbox"));
      fireEvent.click(await screen.findByText(/^Settle \(1\)$/));

      await screen.findByDisplayValue("20000"); // RATE input, confirms the modal opened

      // Default mode ("Top-up"): no tender form, exactly as the sibling test
      // above already proves.
      expect(
        document.querySelector('[data-testid^="payment-amount-"]'),
      ).toBeNull();

      // Switch to "Other payment".
      fireEvent.click(screen.getByRole("button", { name: "Other payment" }));

      // The sheet now renders, autofilled with the entered commission (20,000
      // LBP) — never typed by the operator (MultiPaymentInput's own
      // single-mode auto-sync fills it from `totals`).
      const amountInput = document.querySelector<HTMLInputElement>(
        '[data-testid^="payment-amount-"]',
      );
      expect(amountInput).not.toBeNull();
      expect(parseFloat((amountInput!.value || "0").replace(/,/g, ""))).toBe(
        20000,
      );
      const currencySelect = document.querySelector<HTMLSelectElement>(
        '[data-testid^="payment-currency-"]',
      );
      expect(currencySelect!.value).toBe("LBP");

      // Confirm — the leg travels through `payments`, tagged with the mode.
      fireEvent.click(screen.getByText("Confirm Settlement"));
      await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
      const payload = mockSettleTransactions.mock.calls[0][0];
      expect(payload.amount_usd).toBe(0);
      expect(payload.amount_lbp).toBe(0);
      expect(payload.commission_lbp).toBe(20000);
      expect(payload.commission_collection_mode).toBe("OTHER_PAYMENT");
      expect(payload.payments).toEqual([
        { method: "CASH", currency_code: "LBP", amount: 20000 },
      ]);
    });

    // Switching back to "Top-up" after visiting "Other payment" must clear the
    // in-progress leg — otherwise a stale leg would ride along into a Top-up
    // submission and trip the backend's mode-aware guard.
    it("switching back to Top-up clears any in-progress Other-payment leg", async () => {
      mockGetSuppliers.mockResolvedValue([KATSH_SUPPLIER, OMT_SUPPLIER]);
      mockGetUnsettledTransactions.mockImplementation((provider: string) =>
        Promise.resolve(provider === "Katsh" ? [BILL_ROW] : []),
      );

      renderPage();

      fireEvent.click((await screen.findAllByText("Katsh"))[0]);
      const billRow = (await screen.findByText("Bill")).closest("label")!;
      fireEvent.click(within(billRow).getByRole("checkbox"));
      fireEvent.click(await screen.findByText(/^Settle \(1\)$/));
      await screen.findByDisplayValue("20000");

      fireEvent.click(screen.getByRole("button", { name: "Other payment" }));
      await waitFor(() =>
        expect(
          document.querySelector('[data-testid^="payment-amount-"]'),
        ).not.toBeNull(),
      );

      fireEvent.click(screen.getByRole("button", { name: "Top-up" }));
      expect(
        document.querySelector('[data-testid^="payment-amount-"]'),
      ).toBeNull();

      fireEvent.click(screen.getByText("Confirm Settlement"));
      await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
      const payload = mockSettleTransactions.mock.calls[0][0];
      expect(payload.payments).toBeUndefined();
      expect(payload.commission_collection_mode).toBe("TOP_UP");
    });

    it("real USD cash owed (legacy OMT batch): Net payment stays in USD — the fix must not relabel genuine cash", async () => {
      mockGetSuppliers.mockResolvedValue([KATSH_SUPPLIER, OMT_SUPPLIER]);
      mockGetUnsettledTransactions.mockImplementation((provider: string) =>
        Promise.resolve(provider === "OMT" ? [LEGACY_ROW] : []),
      );

      renderPage();

      fireEvent.click(await screen.findByText("OMT"));

      const legacyRow = (await screen.findByText("OMT_TRANSFER")).closest(
        "label",
      )!;
      fireEvent.click(within(legacyRow).getByRole("checkbox"));

      fireEvent.click(await screen.findByText(/^Settle \(1\)$/));

      const netPayLabel = await screen.findByText("Net payment to OMT:");
      const netPayRow = netPayLabel.closest("div")!;
      expect(within(netPayRow).getByText("$100.00")).toBeInTheDocument();

      const currencySelect = document.querySelector<HTMLSelectElement>(
        '[data-testid^="payment-currency-"]',
      );
      expect(currencySelect!.value).toBe("USD");
    });
  });
});

describe("Suppliers.settlePaymentReconciliation (LIRA-193)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-193 — the single-supplier settle screen's confirm gate
   * (`settleHasActiveLegs`/`settleConfirmDisabled`, Suppliers/index.tsx) used
   * to check only that SOME payment leg amount was greater than zero — it
   * never compared the entered amount to the net amount actually owed
   * (`settleNetPayUsd`/`settleNetPayLbp`). A $100 debt could be "settled" with
   * a stray $150 leg: the ledger nets to 0 while the drawer drops the full
   * $150, a $50 leak with no ledger row, no profit stamp, no kept-change
   * record — until `SupplierRepository.settleTransactions`'s own new
   * reconciliation guard started throwing instead (the core half of LIRA-193,
   * already shipped). This file closes the UI half: stop the operator from
   * ever reaching that thrown error, by disabling Confirm and naming the exact
   * mismatch while they can still fix it — the same shape
   * `AccountSettleSheet.test.tsx` already proves for the account-wide sheet.
   *
   * INTERACTION-layer test, same convention as
   * `Suppliers.settleNetPayCurrency.test.tsx`: renders the REAL `@liratek/ui`
   * `CounterpartySettleModal`/`MultiPaymentInput` (jest.config.ts maps
   * "@liratek/ui" to packages/ui/src) so `confirmDisabled` is honoured by an
   * actual `disabled` DOM attribute, not swallowed by a stand-in mock the way
   * `Suppliers.commissionAtSettlement.test.tsx`'s local `CounterpartySettleModal`
   * mock would (that mock's Confirm button carries no `disabled` prop at all).
   *
   * Rule 17 (failing-first): confirmed against the pre-fix `settleConfirmDisabled`
   * (`settleOwesCash ? !settleHasActiveLegs : settleHasActiveLegs`, no
   * reconciliation term) — the "blocks overpay"/"blocks underpay" tests below
   * both failed (`submit` came back enabled, `mockSettleTransactions` was
   * called) against that code. Restored immediately after confirming red — see
   * the task report for the exact failure output.
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

  // commission_model = 0 (EMBEDDED legacy) — real USD cash genuinely owed, the
  // "normal cash-owed path" the ticket describes (not a bills-only batch, so
  // `isBillsOnlyBatch` is false and `settleOwesCash` is the live gate).
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

  /** Opens the settle confirm modal for the $100 LEGACY_ROW and returns the
   *  amount input (MultiPaymentInput auto-seeds it to "100" on mount — the
   *  single-mode auto-sync-to-total effect) plus the Confirm button. */
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

  describe("Suppliers page — single-supplier settle payment reconciliation (LIRA-193)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetSuppliers.mockResolvedValue([OMT_SUPPLIER]);
      mockGetSupplierBalances.mockResolvedValue([]);
      mockGetSupplierProductBalances.mockResolvedValue([]);
      mockGetSupplierLedger.mockResolvedValue([]);
      mockGetAllSupplierTransactions.mockResolvedValue([]);
      mockGetUnsettledTransactions.mockImplementation((provider: string) =>
        Promise.resolve(provider === "OMT" ? [LEGACY_ROW] : []),
      );
      mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
    });

    it("an exact amount reconciles: no mismatch message, Confirm enabled, and the expected payload is submitted", async () => {
      renderPage();
      const { amountInput, submit } = await openSettleConfirm();

      // Auto-seeded to the exact target already — re-type it anyway so this
      // proves the boundary itself reconciles, not just that an untouched
      // default happens to (same discipline as AccountSettleSheet.test.tsx's
      // "confirms ... exactly" case).
      fireEvent.change(amountInput, { target: { value: "100" } });

      expect(
        screen.queryByTestId("settle-payment-mismatch"),
      ).not.toBeInTheDocument();
      expect(submit).not.toBeDisabled();

      fireEvent.click(submit);
      await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
      const payload = mockSettleTransactions.mock.calls[0][0];
      expect(payload.amount_usd).toBe(100);
      expect(payload.amount_lbp).toBe(0);
      expect(payload.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 100 },
      ]);
    });

    // LIRA-315 (owner decisions 2026-10-12/13) — LIRA-193's overpay example
    // ($150 on a $100 debt) is no longer blocked. The money-safety concern it
    // guarded (drawer −$150, ledger nets $100) is now closed server-side: the
    // extra is booked on the supplier's account. The UI's job is to send the
    // change the supplier hands back as an OUT leg (default), or no change
    // leg at all when the cashier taps "Account".
    it("an overpay is allowed: by default the $50 goes back as a CASH change (OUT) leg", async () => {
      renderPage();
      const { amountInput, submit } = await openSettleConfirm();

      fireEvent.change(amountInput, { target: { value: "150" } });

      await waitFor(() =>
        expect(screen.getByTestId("return-change")).toBeInTheDocument(),
      );
      expect(
        screen.queryByTestId("settle-payment-mismatch"),
      ).not.toBeInTheDocument();
      expect(submit).not.toBeDisabled();

      fireEvent.click(submit);
      await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
      const payload = mockSettleTransactions.mock.calls[0][0];
      expect(payload.amount_usd).toBe(100);
      expect(payload.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 150 },
        { method: "CASH", currency_code: "USD", amount: 50, direction: "OUT" },
      ]);
    });

    it("an overpay with 'Account': only the paid leg is sent — the $50 stays on the supplier's account", async () => {
      renderPage();
      const { amountInput, submit } = await openSettleConfirm();

      fireEvent.change(amountInput, { target: { value: "150" } });
      fireEvent.click(await screen.findByTestId("change-destination-account"));
      expect(
        screen.getByTestId("change-to-account-summary").textContent,
      ).toMatch(/stays on the supplier's account/);

      fireEvent.click(submit);
      await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
      const payload = mockSettleTransactions.mock.calls[0][0];
      expect(payload.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 150 },
      ]);
    });

    it("blocks submit when the entered payment UNDERPAYS the net amount owed", async () => {
      renderPage();
      const { amountInput, submit } = await openSettleConfirm();

      fireEvent.change(amountInput, { target: { value: "60" } });

      await waitFor(() => {
        expect(
          screen.getByTestId("settle-payment-mismatch").textContent,
        ).toMatch(/doesn't cover the amount owed/i);
      });
      expect(submit).toBeDisabled();

      fireEvent.click(submit);
      expect(mockSettleTransactions).not.toHaveBeenCalled();
    });

    // A batch with nothing owed in cash (e.g. a bills-only/commission-only
    // selection — see Suppliers.settleNetPayCurrency.test.tsx's Katsh case)
    // must not be permanently blocked by this new reconciliation term: with
    // `settleOwesCash` false, the guard doesn't apply at all — Confirm's gate
    // falls back to the pre-existing `settleHasActiveLegs` branch untouched.
    it("does not wrongly block a zero-target (bills-only) batch — Confirm stays enabled with no legs", async () => {
      const KATSH_SUPPLIER = {
        ...OMT_SUPPLIER,
        id: 1,
        name: "Katsh",
        provider: "Katsh",
        commission_entry_mode: "RATE" as const,
        commission_rate: 20000,
        commission_rate_currency: "LBP" as const,
      };
      const BILL_ROW = {
        id: 101,
        service_type: "BILL" as const,
        amount: 500000,
        currency: "LBP",
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

      await screen.findByDisplayValue("20000"); // RATE input, confirms the modal opened

      expect(
        screen.queryByTestId("settle-payment-mismatch"),
      ).not.toBeInTheDocument();
      const confirmBtn = screen.getByText("Confirm Settlement");
      expect(confirmBtn).not.toBeDisabled();

      fireEvent.click(confirmBtn);
      await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
      const payload = mockSettleTransactions.mock.calls[0][0];
      expect(payload.amount_usd).toBe(0);
      expect(payload.amount_lbp).toBe(0);
      expect(payload.payments).toBeUndefined();
    });
  });
});

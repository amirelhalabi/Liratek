/** @jest-environment jsdom */
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
      getSupplierProductBalances: mockGetSupplierProductBalances,
      getSupplierLedger: mockGetSupplierLedger,
      getSupplierProductItems: mockGetSupplierProductItems,
      getAllSupplierTransactions: mockGetAllSupplierTransactions,
      getUnsettledTransactions: mockGetUnsettledTransactions,
      settleTransactions: mockSettleTransactions,
      recordSupplierCashflow: jest.fn(),
      addSupplierLedgerEntry: jest.fn(),
      supplierWriteOff: jest.fn(),
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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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

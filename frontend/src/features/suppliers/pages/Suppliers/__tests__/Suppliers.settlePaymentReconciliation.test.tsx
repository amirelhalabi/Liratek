/** @jest-environment jsdom */
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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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

    expect(screen.queryByTestId("settle-payment-mismatch")).not.toBeInTheDocument();
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

  // Money-safety regression (LIRA-193's own overpay example): a $100 debt
  // entered as $150 must never reach settleTransactions — the repository's
  // own reconciliation guard would now throw, but this is the UI half that
  // must stop the operator getting there in the first place.
  it("blocks submit and names the exact overage when the entered payment OVERPAYS the net amount owed", async () => {
    renderPage();
    const { amountInput, submit } = await openSettleConfirm();

    fireEvent.change(amountInput, { target: { value: "150" } });

    await waitFor(() => {
      expect(
        screen.getByTestId("settle-payment-mismatch").textContent,
      ).toMatch(/\$50\.00 more than the net amount/i);
    });
    expect(
      screen.getByTestId("settle-payment-mismatch").textContent,
    ).toMatch(/reduce the payment to \$100\.00/i);
    expect(submit).toBeDisabled();

    fireEvent.click(submit);
    expect(mockSettleTransactions).not.toHaveBeenCalled();
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

    expect(screen.queryByTestId("settle-payment-mismatch")).not.toBeInTheDocument();
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

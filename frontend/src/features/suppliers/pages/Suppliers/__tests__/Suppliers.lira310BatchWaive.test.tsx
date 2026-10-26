/** @jest-environment jsdom */
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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Suppliers />
    </QueryClientProvider>,
  );
}

async function openSettleConfirm() {
  fireEvent.click(await screen.findByText("OMT"));
  const legacyRow = (await screen.findByText("OMT_TRANSFER")).closest("label")!;
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

    await waitFor(() => expect(mockRecordSupplierCashflow).toHaveBeenCalled());
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

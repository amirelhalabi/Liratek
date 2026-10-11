/** @jest-environment jsdom */
/**
 * LIRA-310 (US3, T044) — Waive on the single-supplier BATCH settle modal
 * (Suppliers page → Settle tab → Confirm Settlement).
 *
 *   - $100 owed, the cashier enters $97 and taps Waive on the Remaining row
 *     → Confirm enabled; the payload keeps `amount_usd` 100 (owed), the legs
 *     as paid ($97) and `discount: { amount_usd: 3, amount_lbp: 0 }` — field
 *     names checked by parsing through the core `supplierSettleSchema`
 *     (rule 24);
 *   - a full payment sends no `discount`;
 *   - a bills-only batch collected by "Other payment" offers no Waive (the
 *     server refuses it: those legs are the commission, not a payment).
 *
 * Same INTERACTION-layer strategy as Suppliers.settlePaymentReconciliation:
 * the real CounterpartySettleModal / MultiPaymentInput; `useApi` mocked with
 * a stable object (rule 25).
 * Rule 17: written before the change and run red — see tasks.md T044.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supplierSettleSchema } from "@liratek/core";
import Suppliers from "../index";

const mockGetSuppliers = jest.fn();
const mockGetUnsettledTransactions = jest.fn();
const mockSettleTransactions = jest.fn();
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
  recordSupplierCashflow: jest.fn(),
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
  const legacyRow = (await screen.findByText("OMT_TRANSFER")).closest(
    "label",
  )!;
  fireEvent.click(within(legacyRow).getByRole("checkbox"));
  fireEvent.click(await screen.findByText(/^Settle \(1\)$/));
  const amountInput = await screen.findByDisplayValue("100");
  const submit = screen.getByText("Confirm Settlement");
  return { amountInput, submit };
}

describe("Suppliers page — batch settle Waive (LIRA-310)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([OMT_SUPPLIER]);
    mockGetUnsettledTransactions.mockImplementation((provider: string) =>
      Promise.resolve(provider === "OMT" ? [LEGACY_ROW] : []),
    );
    mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
  });

  it("$100 owed, $97 paid, Waive → Confirm enabled, discount $3 sent with the owed amount", async () => {
    renderPage();
    const { amountInput, submit } = await openSettleConfirm();
    fireEvent.change(amountInput, { target: { value: "97" } });
    await waitFor(() => expect(submit).toBeDisabled());

    fireEvent.click(await screen.findByTestId("waive-remaining"));
    await waitFor(() => expect(submit).not.toBeDisabled());
    expect(
      screen.queryByTestId("settle-payment-mismatch"),
    ).not.toBeInTheDocument();
    fireEvent.click(submit);

    await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
    const payload = mockSettleTransactions.mock.calls[0][0];
    const parsed = supplierSettleSchema.parse(payload);
    expect(parsed.amount_usd).toBe(100);
    expect(parsed.discount).toEqual({ amount_usd: 3, amount_lbp: 0 });
    expect(parsed.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 97 },
    ]);
  });

  it("a full payment sends no discount", async () => {
    renderPage();
    const { submit } = await openSettleConfirm();
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
    expect(mockSettleTransactions.mock.calls[0][0]).not.toHaveProperty(
      "discount",
    );
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

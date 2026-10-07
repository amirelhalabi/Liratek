/** @jest-environment jsdom */
/**
 * Owner decision 2026-10-07 — a rate the cashier types by hand is sent
 * everywhere, and the transaction row saves it. On the Suppliers "Pay /
 * Receive" tab the payment input's rate box used to be ignored: the page
 * always sent the shop's buy rate as `exchange_rate`. Now the rate the
 * cashier typed is what reaches `recordSupplierCashflow` (which converts LBP
 * legs for purchase coverage at it and stamps it on SUPPLIER_PAYMENT).
 *
 * Renders the REAL page + the real `@liratek/ui` MultiPaymentInput
 * (jest.config maps "@liratek/ui" to packages/ui/src) and types into its
 * rate box. The payload is parsed through the core `supplierCashflowSchema`
 * (rule 24 — field names come from the schema).
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

const mockRecordSupplierCashflow = jest.fn();

// Rule 25: ONE stable object, never a fresh literal per useApi() call.
const mockApi = {
  getSuppliers: jest.fn(),
  getSupplierBalances: jest.fn(),
  getSupplierAccountBalances: jest.fn(),
  getSupplierProductBalances: jest.fn(),
  getSupplierLedger: jest.fn(),
  getSupplierProductItems: jest.fn(),
  getAllSupplierTransactions: jest.fn(),
  getUnsettledTransactions: jest.fn(),
  settleTransactions: jest.fn(),
  recordSupplierCashflow: mockRecordSupplierCashflow,
  addSupplierLedgerEntry: jest.fn(),
  getSupplierPurchases: jest.fn(),
  createSupplierPurchase: jest.fn(),
  getOpenRecordedSupplierDebts: jest.fn(),
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
    methods: [{ code: "CASH", label: "Cash" }],
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

const BUY_RATE = 89000;
const TYPED_RATE = 87000;

// A product supplier (is_system = 0, no provider).
const SUPPLIER = {
  id: 5,
  name: "Acme Distributors",
  contact_name: null,
  phone: null,
  note: null,
  is_active: 1,
  module_key: null,
  provider: null,
  is_system: 0,
  created_at: "2026-08-01T00:00:00Z",
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

async function openPayTab() {
  fireEvent.click(screen.getByRole("button", { name: "Products" }));
  fireEvent.click((await screen.findAllByText("Acme Distributors"))[0]);
  fireEvent.click(await screen.findByText("Pay / Receive"));
  return screen.findByTestId("payment-exchange-rate");
}

async function payFifty(): Promise<void> {
  const amount = screen
    .getAllByTestId(/^payment-amount-/)
    .find((el) => el.tagName === "INPUT") as HTMLInputElement;
  fireEvent.change(amount, { target: { value: "50" } });
  fireEvent.click(screen.getByText("Record Payment"));
  await waitFor(() => expect(mockRecordSupplierCashflow).toHaveBeenCalled());
}

describe("Suppliers page — Pay / Receive sends the rate the cashier used", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getSuppliers.mockResolvedValue([SUPPLIER]);
    mockApi.getSupplierBalances.mockResolvedValue([]);
    mockApi.getSupplierAccountBalances.mockResolvedValue([]);
    mockApi.getSupplierProductBalances.mockResolvedValue([
      { supplier_id: 5, total_usd: 0, total_lbp: 0 },
    ]);
    mockApi.getSupplierProductItems.mockResolvedValue([]);
    mockApi.getOpenRecordedSupplierDebts.mockResolvedValue([]);
    mockApi.getSupplierLedger.mockResolvedValue([]);
    mockApi.getAllSupplierTransactions.mockResolvedValue([]);
    mockApi.getUnsettledTransactions.mockResolvedValue([]);
    mockRecordSupplierCashflow.mockResolvedValue({ success: true, id: 1 });
  });

  it("a hand-typed rate is sent as exchange_rate", async () => {
    renderPage();
    const rateBox = await openPayTab();
    fireEvent.change(rateBox, { target: { value: String(TYPED_RATE) } });
    await payFifty();

    const parsed = supplierCashflowSchema.parse(
      mockRecordSupplierCashflow.mock.calls[0][0],
    );
    expect(parsed.exchange_rate).toBe(TYPED_RATE);
  });

  it("an untouched rate box still sends the buy rate", async () => {
    renderPage();
    await openPayTab();
    await payFifty();

    const parsed = supplierCashflowSchema.parse(
      mockRecordSupplierCashflow.mock.calls[0][0],
    );
    expect(parsed.exchange_rate).toBe(BUY_RATE);
  });
});

// The single-supplier Settle sheet: same rule — its payment input's rate is
// sent as `exchange_rate` and stamped on SUPPLIER_SETTLEMENT (stamp-only;
// the server reconciles legs per currency).
describe("Suppliers page — Settle sends the rate the cashier used", () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getSuppliers.mockResolvedValue([OMT_SUPPLIER]);
    mockApi.getSupplierBalances.mockResolvedValue([]);
    mockApi.getSupplierAccountBalances.mockResolvedValue([]);
    mockApi.getSupplierProductBalances.mockResolvedValue([]);
    mockApi.getSupplierLedger.mockResolvedValue([]);
    mockApi.getAllSupplierTransactions.mockResolvedValue([]);
    mockApi.getUnsettledTransactions.mockImplementation((provider: string) =>
      Promise.resolve(provider === "OMT" ? [LEGACY_ROW] : []),
    );
    mockApi.settleTransactions.mockResolvedValue({ success: true, id: 1 });
  });

  it("a hand-typed rate is sent as exchange_rate", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("OMT"));
    const legacyRow = (await screen.findByText("OMT_TRANSFER")).closest(
      "label",
    )!;
    fireEvent.click(within(legacyRow).getByRole("checkbox"));
    fireEvent.click(await screen.findByText(/^Settle \(1\)$/));
    await screen.findByDisplayValue("100");

    fireEvent.change(screen.getByTestId("payment-exchange-rate"), {
      target: { value: String(TYPED_RATE) },
    });
    fireEvent.click(screen.getByText("Confirm Settlement"));

    await waitFor(() => expect(mockApi.settleTransactions).toHaveBeenCalled());
    const parsed = supplierSettleSchema.parse(
      mockApi.settleTransactions.mock.calls[0][0],
    );
    expect(parsed.exchange_rate).toBe(TYPED_RATE);
  });
});

/** @jest-environment jsdom */
/**
 * LIRA-087 (migration v189) — "Record Debt" on a product supplier's own
 * page: books a supplier debt WITHOUT a product line yet
 * (SupplierRepository.recordDebt), so restocking goods already received
 * doesn't risk a double booking (owner note 31).
 *
 * Rule 17: this is brand-new UI — before this change the mocked `useApi()`
 * carried no `recordDebt`, and no "Record Debt" button existed at all, so
 * the component could not have rendered or called it (the strongest
 * possible failing-first proof for new functionality).
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
const mockRecordSupplierDebt = jest.fn();
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
      settleTransactions: jest.fn(),
      recordSupplierCashflow: jest.fn(),
      addSupplierLedgerEntry: jest.fn(),
      getSupplierPurchases: jest.fn(),
      createSupplierPurchase: jest.fn(),
      recordSupplierDebt: mockRecordSupplierDebt,
      getOpenRecordedSupplierDebts: jest.fn().mockResolvedValue([]),
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

// A product supplier (is_system = 0) — "Record Debt" is a product-supplier
// feature, the mirror of "Add Credit / Debt" (company suppliers only).
const ACME_SUPPLIER = {
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

describe("Suppliers page — Record Debt (LIRA-087)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([ACME_SUPPLIER]);
    mockGetSupplierBalances.mockResolvedValue([]);
    mockGetSupplierProductBalances.mockResolvedValue([
      { supplier_id: 5, total_usd: 0, total_lbp: 0 },
    ]);
    mockGetSupplierLedger.mockResolvedValue([]);
    mockGetSupplierProductItems.mockResolvedValue([]);
    mockGetAllSupplierTransactions.mockResolvedValue([]);
    mockRecordSupplierDebt.mockResolvedValue({
      success: true,
      ledgerEntryId: 1,
      transactionId: 1,
    });
  });

  it("opens the Record Debt modal for a product supplier and submits amount + note", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Products" }));
    fireEvent.click((await screen.findAllByText("Acme Distributors"))[0]);

    const recordDebtBtn = await screen.findByRole("button", {
      name: "Record Debt",
    });
    fireEvent.click(recordDebtBtn);

    const modalTitle = await screen.findByText(
      "Record Debt — Acme Distributors",
    );
    const modal = modalTitle.closest("div")!.parentElement!;

    fireEvent.change(within(modal).getByPlaceholderText("0.00"), {
      target: { value: "50" },
    });
    fireEvent.change(
      within(modal).getByPlaceholderText(
        "e.g. Invoice #1234, 20 units incoming",
      ),
      { target: { value: "20 units incoming" } },
    );

    fireEvent.click(within(modal).getByText("Record debt"));

    await waitFor(() => expect(mockRecordSupplierDebt).toHaveBeenCalled());
    expect(mockRecordSupplierDebt).toHaveBeenCalledWith({
      supplier_id: 5,
      amount_usd: 50,
      amount_lbp: 0,
      note: "20 units incoming",
    });

    // Modal closes on success.
    await waitFor(() =>
      expect(
        screen.queryByText("Record Debt — Acme Distributors"),
      ).not.toBeInTheDocument(),
    );
  });

  it("disables 'Record debt' submission until an amount is entered", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Products" }));
    fireEvent.click((await screen.findAllByText("Acme Distributors"))[0]);
    fireEvent.click(
      await screen.findByRole("button", { name: "Record Debt" }),
    );

    const modalTitle = await screen.findByText(
      "Record Debt — Acme Distributors",
    );
    const modal = modalTitle.closest("div")!.parentElement!;
    expect(within(modal).getByText("Record debt")).toBeDisabled();

    fireEvent.change(within(modal).getByPlaceholderText("0.00"), {
      target: { value: "10" },
    });
    expect(within(modal).getByText("Record debt")).not.toBeDisabled();
  });

  it("does NOT show 'Record Debt' for a company (non-product) supplier", async () => {
    mockGetSuppliers.mockResolvedValue([
      { ...ACME_SUPPLIER, id: 2, name: "OMT", is_system: 1, provider: "OMT" },
    ]);
    mockGetSupplierBalances.mockResolvedValue([
      { supplier_id: 2, total_usd: 0, total_lbp: 0 },
    ]);
    renderPage();

    fireEvent.click((await screen.findAllByText("OMT"))[0]);

    await screen.findByText("Add Credit / Debt");
    expect(
      screen.queryByRole("button", { name: "Record Debt" }),
    ).not.toBeInTheDocument();
  });
});

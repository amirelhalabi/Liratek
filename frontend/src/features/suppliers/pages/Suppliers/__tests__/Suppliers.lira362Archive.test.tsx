/** @jest-environment jsdom */
/**
 * LIRA-362 — archive a settled product supplier from its own page.
 * Owner decisions (2026-10-30): only when Settled; archived suppliers are
 * hidden behind "Show archived (N)" and can be unarchived; admin only.
 *
 * Not proven failing-first: written after the page change.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supplierArchiveSchema } from "@liratek/core";
import Suppliers from "../index";

const mockGetSuppliers = jest.fn();
const mockGetSupplierProductBalances = jest.fn();
const mockSetSupplierArchived = jest.fn();
const mockAppEventsEmit = jest.fn();
let mockRole = "admin";

// Module-level: one identity for the whole file (rule 25).
const mockApi = {
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: jest.fn().mockResolvedValue([]),
  getSupplierAccountBalances: jest.fn().mockResolvedValue([]),
  getSupplierProductBalances: mockGetSupplierProductBalances,
  getSupplierLedger: jest.fn().mockResolvedValue([]),
  getSupplierProductItems: jest.fn().mockResolvedValue([]),
  getSupplierProductStockValue: jest.fn().mockResolvedValue([]),
  getAllSupplierTransactions: jest.fn().mockResolvedValue([]),
  getUnsettledTransactions: jest.fn().mockResolvedValue([]),
  getSupplierPurchases: jest.fn().mockResolvedValue([]),
  getOpenRecordedSupplierDebts: jest.fn().mockResolvedValue([]),
  setSupplierArchived: mockSetSupplierArchived,
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    appEvents: { emit: (...args: unknown[]) => mockAppEventsEmit(...args) },
  };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "u", role: mockRole } }),
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

const base = {
  contact_name: null,
  phone: null,
  note: null,
  module_key: null,
  provider: null,
  is_system: 0,
  created_at: "2026-10-19T00:00:00Z",
};
const TYPO = { ...base, id: 46, name: "JEQANGJB-382", is_active: 1 };
const OWING = { ...base, id: 47, name: "RABIH TRIPOLI", is_active: 1 };
const OLD = { ...base, id: 48, name: "Old Supplier", is_active: 0 };

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

async function openProduct(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Products" }));
  fireEvent.click((await screen.findAllByText(name))[0]);
}

describe("Suppliers page — archive a settled supplier (LIRA-362)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = "admin";
    mockGetSuppliers.mockResolvedValue([TYPO, OWING, OLD]);
    mockGetSupplierProductBalances.mockResolvedValue([
      { supplier_id: 46, total_usd: 0, total_lbp: 0 },
      { supplier_id: 47, total_usd: 120, total_lbp: 0 },
    ]);
    mockSetSupplierArchived.mockResolvedValue({ success: true, id: 46 });
  });

  it("archives a settled supplier with the schema's payload", async () => {
    renderPage();
    await openProduct("JEQANGJB-382");

    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));

    await waitFor(() => expect(mockSetSupplierArchived).toHaveBeenCalled());
    expect(mockSetSupplierArchived).toHaveBeenCalledWith(
      supplierArchiveSchema.parse({ supplier_id: 46, archived: true }),
    );
  });

  it("disables Archive while the supplier is still owed", async () => {
    renderPage();
    await openProduct("RABIH TRIPOLI");

    expect(
      await screen.findByRole("button", { name: "Archive" }),
    ).toBeDisabled();
  });

  it("hides archived suppliers until 'Show archived' is clicked, then offers Unarchive", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Products" }));
    await screen.findAllByText("JEQANGJB-382");
    expect(screen.queryByText("Old Supplier")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("supplier-show-archived"));
    fireEvent.click((await screen.findAllByText("Old Supplier"))[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Unarchive" }));

    await waitFor(() =>
      expect(mockSetSupplierArchived).toHaveBeenCalledWith(
        supplierArchiveSchema.parse({ supplier_id: 48, archived: false }),
      ),
    );
  });

  it("shows no Archive button to a non-admin", async () => {
    mockRole = "staff";
    renderPage();
    await openProduct("JEQANGJB-382");

    await screen.findAllByText("JEQANGJB-382");
    expect(
      screen.queryByRole("button", { name: "Archive" }),
    ).not.toBeInTheDocument();
  });
});

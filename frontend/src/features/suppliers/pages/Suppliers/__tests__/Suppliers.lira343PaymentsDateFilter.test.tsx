/** @jest-environment jsdom */

/**
 * LIRA-343 follow-up — the Payments window gets the same From / To date
 * filter as the Transactions window (presets, From never after To).
 *
 * - The OMT account parent's merged ledger is read on the server by shop day:
 *   the range reaches `getSupplierAccountLedger(id, 200, { from, to })`; no
 *   range keeps the old two-argument call.
 * - A plain supplier's ledger read (`getSupplierLedger`) takes no range on any
 *   layer, so its Payments window shows no filter (a filter that does nothing
 *   would mislead).
 * - The Payments range is its own: setting it does not filter Transactions.
 *
 * Failing-first (rule 17): written before the Payments window had a filter.
 * ONE stable `useApi` object (rule 25); mocks copied from
 * `Suppliers.lira343TxnsRange.test.tsx`.
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
import { openSupplierTable } from "@/features/suppliers/testing/supplierTableModals";

const mockGetSuppliers = jest.fn();
const mockGetAllSupplierTransactions = jest.fn();
const mockGetSupplierAccountBalances = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
const mockGetSupplierAccountTransactions = jest.fn();
const mockGetSupplierAccountMonthRows = jest.fn();
const mockGetSupplierAccountLedger = jest.fn();

const mockApi = {
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: jest.fn().mockResolvedValue([]),
  getSupplierProductBalances: jest.fn().mockResolvedValue([]),
  getSupplierLedger: jest.fn().mockResolvedValue([]),
  getSupplierProductItems: jest.fn().mockResolvedValue([]),
  getAllSupplierTransactions: mockGetAllSupplierTransactions,
  getUnsettledTransactions: jest.fn().mockResolvedValue([]),
  settleTransactions: jest.fn(),
  recordSupplierCashflow: jest.fn(),
  addSupplierLedgerEntry: jest.fn(),
  getSupplierPurchases: jest.fn().mockResolvedValue([]),
  createSupplierPurchase: jest.fn(),
  getSupplierProductStockValue: jest.fn().mockResolvedValue([]),
  getSupplierAccountBalances: mockGetSupplierAccountBalances,
  getSupplierAccountLedger: mockGetSupplierAccountLedger,
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
  getSupplierAccountTransactions: mockGetSupplierAccountTransactions,
  getSupplierAccountMonthRows: mockGetSupplierAccountMonthRows,
  getSupplierAccountDayDetail: jest.fn(async () => []),
  getSupplierAccountExpectedStatement: jest.fn().mockResolvedValue(null),
  settleSupplierAccount: jest.fn(),
};

jest.mock("@/shared/utils/localDay", () => {
  const actual = jest.requireActual("@/shared/utils/localDay");
  return {
    ...actual,
    localDay: () => "2026-10-26",
    localMonth: () => "2026-10",
  };
});

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return { ...actual, useApi: () => mockApi };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "u", role: "admin" } }),
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

const BASE_SUPPLIER = {
  contact_name: null,
  phone: null,
  note: null,
  is_active: 1,
  module_key: null,
  is_system: 1,
  created_at: "2026-09-01T00:00:00Z",
};
const OMT = {
  ...BASE_SUPPLIER,
  id: 1,
  name: "OMT",
  provider: "OMT",
  account_supplier_id: null,
};
const OMT_APP = {
  ...BASE_SUPPLIER,
  id: 2,
  name: "OMT App",
  provider: "OMT_APP",
  account_supplier_id: 1,
};
const IPICK = {
  ...BASE_SUPPLIER,
  id: 3,
  name: "iPick",
  provider: "iPick",
  account_supplier_id: 1,
};
const KATSH = {
  ...BASE_SUPPLIER,
  id: 4,
  name: "Katsh",
  provider: "KATSH",
  account_supplier_id: null,
};

const ACCOUNT = {
  account_supplier_id: 1,
  account_name: "OMT",
  total_usd: 54,
  total_lbp: 800000,
  children: [
    {
      supplier_id: 1,
      name: "OMT",
      provider: "OMT",
      drawer_name: "OMT_System",
      total_usd: 54,
      total_lbp: 800000,
      is_parent: true,
    },
    {
      supplier_id: 2,
      name: "OMT App",
      provider: "OMT_APP",
      drawer_name: "OMT_App",
      total_usd: 0,
      total_lbp: 0,
      is_parent: false,
    },
    {
      supplier_id: 3,
      name: "iPick",
      provider: "iPick",
      drawer_name: "iPick",
      total_usd: 0,
      total_lbp: 0,
      is_parent: false,
    },
  ],
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

function fields(dialog: HTMLElement) {
  return {
    from: within(dialog).getByLabelText("From") as HTMLInputElement,
    to: within(dialog).getByLabelText("To") as HTMLInputElement,
  };
}

async function openOmtPayments(): Promise<HTMLElement> {
  const card = await screen.findByTestId("supplier-account-card-OMT");
  fireEvent.click(within(card).getByTestId("supplier-tile-OMT"));
  return openSupplierTable("payments");
}

describe("Suppliers page — Payments window date filter (LIRA-343)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([OMT, OMT_APP, IPICK, KATSH]);
    mockGetSupplierAccountBalances.mockResolvedValue([ACCOUNT]);
    mockGetSupplierAccountUnsettled.mockResolvedValue([]);
    mockGetAllSupplierTransactions.mockResolvedValue([]);
    mockGetSupplierAccountTransactions.mockResolvedValue([]);
    mockGetSupplierAccountMonthRows.mockResolvedValue([]);
    mockGetSupplierAccountLedger.mockResolvedValue([]);
  });

  it("OMT account: empty fields and presets; no range keeps the old call", async () => {
    renderPage();
    const dialog = await openOmtPayments();
    const { from, to } = fields(dialog);
    expect(from.type).toBe("date");
    expect(from.value).toBe("");
    expect(to.value).toBe("");
    for (const name of ["Today", "Yesterday", "This month", "Clear"]) {
      expect(within(dialog).getByRole("button", { name })).toBeInTheDocument();
    }
    await waitFor(() =>
      expect(mockGetSupplierAccountLedger).toHaveBeenCalledWith(1, 200),
    );
    for (const call of mockGetSupplierAccountLedger.mock.calls) {
      expect(call).toHaveLength(2);
    }
  });

  it("OMT account: a typed range and the presets reach the ledger read", async () => {
    renderPage();
    const dialog = await openOmtPayments();

    fireEvent.change(fields(dialog).from, { target: { value: "2026-10-01" } });
    fireEvent.change(fields(dialog).to, { target: { value: "2026-10-21" } });
    await waitFor(() =>
      expect(mockGetSupplierAccountLedger).toHaveBeenLastCalledWith(1, 200, {
        from: "2026-10-01",
        to: "2026-10-21",
      }),
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Today" }));
    await waitFor(() =>
      expect(mockGetSupplierAccountLedger).toHaveBeenLastCalledWith(1, 200, {
        from: "2026-10-26",
        to: "2026-10-26",
      }),
    );
    expect(fields(dialog).from.value).toBe("2026-10-26");

    fireEvent.click(within(dialog).getByRole("button", { name: "This month" }));
    await waitFor(() =>
      expect(mockGetSupplierAccountLedger).toHaveBeenLastCalledWith(1, 200, {
        from: "2026-10-01",
        to: "2026-10-26",
      }),
    );
  });

  it("From can never be after To", async () => {
    renderPage();
    const dialog = await openOmtPayments();

    fireEvent.change(fields(dialog).to, { target: { value: "2026-10-10" } });
    fireEvent.change(fields(dialog).from, { target: { value: "2026-10-15" } });
    expect(fields(dialog).from.value).toBe("2026-10-15");
    expect(fields(dialog).to.value).toBe("2026-10-15");

    fireEvent.change(fields(dialog).to, { target: { value: "2026-10-12" } });
    expect(fields(dialog).from.value).toBe("2026-10-12");
    expect(fields(dialog).to.value).toBe("2026-10-12");
  });

  it("the Payments range does not filter the Transactions window", async () => {
    renderPage();
    let dialog = await openOmtPayments();
    fireEvent.click(within(dialog).getByRole("button", { name: "Today" }));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    dialog = await openSupplierTable("transactions");
    expect(fields(dialog).from.value).toBe("");
    expect(fields(dialog).to.value).toBe("");
    for (const call of mockGetSupplierAccountTransactions.mock.calls) {
      expect(call).toHaveLength(1);
    }
  });

  it("selecting another supplier clears the range, also on coming back", async () => {
    renderPage();
    let dialog = await openOmtPayments();
    fireEvent.click(within(dialog).getByRole("button", { name: "Today" }));
    await waitFor(() =>
      expect(mockGetSupplierAccountLedger).toHaveBeenLastCalledWith(1, 200, {
        from: "2026-10-26",
        to: "2026-10-26",
      }),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(await screen.findByTestId("supplier-tile-KATSH"));
    dialog = await openOmtPayments();
    expect(fields(dialog).from.value).toBe("");
    expect(fields(dialog).to.value).toBe("");
    await waitFor(() =>
      expect(mockGetSupplierAccountLedger).toHaveBeenLastCalledWith(1, 200),
    );
  });

  it("shows a loading line while a new range is read", async () => {
    renderPage();
    const dialog = await openOmtPayments();
    await waitFor(() =>
      expect(mockGetSupplierAccountLedger).toHaveBeenCalledWith(1, 200),
    );
    expect(within(dialog).queryByText("Loading payments…")).toBeNull();
    mockGetSupplierAccountLedger.mockImplementation(
      () => new Promise(() => {}),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Today" }));
    expect(await within(dialog).findByText("Loading payments…")).toBeInTheDocument();
  });

  it("a plain supplier's Payments window has no date filter (its ledger read takes no range)", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("supplier-tile-KATSH"));
    const dialog = await openSupplierTable("payments");
    expect(within(dialog).queryByLabelText("From")).toBeNull();
    expect(
      within(dialog).queryByTestId("supplier-payments-date-filter"),
    ).toBeNull();
  });
});

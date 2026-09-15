/** @jest-environment jsdom */

/**
 * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-188) — the Companies tab renders
 * the OMT open-credit account as ONE rolled-up card (D6) instead of three
 * separate top-level tiles for OMT / OMT App / iPick, and the selected
 * account's Payments ledger gains a Type column + filter (source_name).
 *
 * INTERACTION-layer test (rule 15/17) — renders the REAL Suppliers page
 * against the REAL account-card/ledger-table JSX, not a props-level shape.
 * DO NOT RUN per this lane's instructions — written for the owner's next
 * full-suite pass.
 */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
const mockGetSupplierAccountBalances = jest.fn();
const mockGetSupplierAccountLedger = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
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
      getSupplierPurchases: jest.fn(),
      createSupplierPurchase: jest.fn(),
      getSupplierProductStockValue: jest.fn().mockResolvedValue([]),
      getSupplierAccountBalances: mockGetSupplierAccountBalances,
      getSupplierAccountLedger: mockGetSupplierAccountLedger,
      getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
    }),
    appEvents: { emit: (...args: unknown[]) => mockAppEventsEmit(...args) },
    CounterpartySettleModal: () => null,
    PageHeader: ({ title }: { title: string }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
      </div>
    ),
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
    methods: [],
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
  id: 1,
  name: "OMT",
  contact_name: null,
  phone: null,
  note: null,
  is_active: 1,
  module_key: null,
  provider: "OMT",
  is_system: 1,
  created_at: "2026-09-01T00:00:00Z",
  account_supplier_id: null,
};
const OMT_APP_SUPPLIER = {
  ...OMT_SUPPLIER,
  id: 2,
  name: "OMT App",
  provider: "OMT_APP",
  account_supplier_id: 1,
};
const IPICK_SUPPLIER = {
  ...OMT_SUPPLIER,
  id: 3,
  name: "iPick",
  provider: "iPick",
  account_supplier_id: 1,
};

// Parent first, then children alphabetically — matches
// `SupplierRepository.getAccountBalances`' own ordering.
const ACCOUNT_BALANCE = {
  account_supplier_id: 1,
  account_name: "OMT",
  total_usd: 1250,
  total_lbp: 0,
  children: [
    {
      supplier_id: 1,
      name: "OMT",
      provider: "OMT",
      drawer_name: "OMT_System",
      total_usd: 1050,
      total_lbp: 0,
      is_parent: true,
    },
    {
      supplier_id: 2,
      name: "OMT App",
      provider: "OMT_APP",
      drawer_name: "OMT_App",
      total_usd: 25,
      total_lbp: 0,
      is_parent: false,
    },
    {
      supplier_id: 3,
      name: "iPick",
      provider: "iPick",
      drawer_name: "iPick",
      total_usd: 175,
      total_lbp: 0,
      is_parent: false,
    },
  ],
};

const ACCOUNT_UNSETTLED = [
  {
    kind: "LEDGER" as const,
    id: 501,
    supplier_id: 3,
    source_provider: "iPick",
    source_name: "iPick",
    created_at: "2026-09-01T00:00:00Z",
    amount_usd: 50,
    amount_lbp: 0,
    entry_type: "TOP_UP",
    service_type: null,
  },
  {
    kind: "LEDGER" as const,
    id: 502,
    supplier_id: 3,
    source_provider: "iPick",
    source_name: "iPick",
    created_at: "2026-09-02T00:00:00Z",
    amount_usd: 30,
    amount_lbp: 0,
    entry_type: "TOP_UP",
    service_type: null,
  },
];

const ACCOUNT_LEDGER = [
  {
    id: 901,
    supplier_id: 1,
    source_provider: "OMT",
    source_name: "OMT",
    entry_type: "TOP_UP",
    amount_usd: 1050,
    amount_lbp: 0,
    note: "OMT SEND + fee",
    created_at: "2026-09-05T00:00:00Z",
    is_refunded: 0,
    settlement_id: null,
  },
  {
    id: 902,
    supplier_id: 3,
    source_provider: "iPick",
    source_name: "iPick",
    entry_type: "TOP_UP",
    amount_usd: 175,
    amount_lbp: 0,
    note: "iPick supplier-credit top-up",
    created_at: "2026-09-04T00:00:00Z",
    is_refunded: 0,
    settlement_id: null,
  },
];

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

describe("Suppliers page — OMT open-credit account rollup (LIRA-188)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([
      OMT_SUPPLIER,
      OMT_APP_SUPPLIER,
      IPICK_SUPPLIER,
    ]);
    // Legacy per-supplier balances read — no longer relied on for the
    // account members (the account card uses the rolled-up read instead),
    // kept empty here to prove that.
    mockGetSupplierBalances.mockResolvedValue([]);
    mockGetSupplierProductBalances.mockResolvedValue([]);
    mockGetAllSupplierTransactions.mockResolvedValue([]);
    mockGetUnsettledTransactions.mockResolvedValue([]);
    mockGetSupplierLedger.mockResolvedValue([]);
    mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
    mockGetSupplierAccountBalances.mockResolvedValue([ACCOUNT_BALANCE]);
    mockGetSupplierAccountUnsettled.mockResolvedValue(ACCOUNT_UNSETTLED);
    mockGetSupplierAccountLedger.mockResolvedValue(ACCOUNT_LEDGER);
  });

  it("renders OMT as ONE account card with the rolled-up headline balance, not a plain balance-less tile", async () => {
    renderPage();

    const card = await screen.findByTestId("supplier-account-card-OMT");
    await waitFor(() => {
      expect(
        within(card).getByTestId("supplier-account-balance-usd").textContent,
      ).toBe("$1250.00");
    });
    expect(
      within(card).getByTestId("supplier-account-balance-lbp").textContent,
    ).toBe("0 LBP");
  });

  it("renders exactly three sub-rows (OMT, OMT App, iPick) with their own contribution, and NO plain top-level tile for the two children", async () => {
    renderPage();

    const card = await screen.findByTestId("supplier-account-card-OMT");
    expect(
      within(card).getByTestId("supplier-account-subrow-OMT"),
    ).toBeInTheDocument();
    expect(
      within(card).getByTestId("supplier-account-subrow-OMT_APP"),
    ).toBeInTheDocument();
    expect(
      within(card).getByTestId("supplier-account-subrow-iPick"),
    ).toBeInTheDocument();

    expect(
      within(card).getByTestId("supplier-account-subrow-balance-OMT")
        .textContent,
    ).toBe("$1050.00");
    expect(
      within(card).getByTestId("supplier-account-subrow-balance-OMT_APP")
        .textContent,
    ).toBe("$25.00");
    expect(
      within(card).getByTestId("supplier-account-subrow-balance-iPick")
        .textContent,
    ).toBe("$175.00");

    // The children no longer get their own top-level tile (D6) — only the
    // account parent's compat tile testid survives (nested inside the card).
    expect(screen.queryByTestId("supplier-tile-OMT_APP")).toBeNull();
    expect(screen.queryByTestId("supplier-tile-iPick")).toBeNull();
    expect(within(card).getByTestId("supplier-tile-OMT")).toBeInTheDocument();
  });

  it("shows the iPick sub-row's unsettled count from the account's unioned unsettled queue", async () => {
    renderPage();

    const card = await screen.findByTestId("supplier-account-card-OMT");
    const ipickRow = within(card).getByTestId(
      "supplier-account-subrow-iPick",
    );
    // The sub-row's unsettled count comes from `useSupplierAccountUnsettledQuery`
    // — a SEPARATE async query from the one `findByTestId` above waits on
    // (the account balances query that renders the card/sub-rows
    // themselves). It can still be in flight the instant the card first
    // appears, so the count needs its own wait rather than an immediate
    // synchronous `getByText`.
    await waitFor(() => {
      expect(within(ipickRow).getByText("2 unsettled")).toBeInTheDocument();
    });
  });

  it("clicking the account card selects the OMT parent (backward-compat with the pre-existing supplier-tile-OMT selector)", async () => {
    renderPage();

    fireEvent.click(await screen.findByTestId("supplier-tile-OMT"));

    // "OMT" renders in several places at once (the card header, the parent
    // sub-row, the detail panel title) — asserting the ledger fetch fired
    // for supplier id 1 is the unambiguous proof that clicking the card
    // selected the account PARENT, without a multi-match text query.
    await waitFor(() => {
      expect(mockGetSupplierLedger).toHaveBeenCalledWith(1, 200);
    });
  });

  it("clicking a sub-row selects THAT child supplier, not the account parent", async () => {
    renderPage();

    const card = await screen.findByTestId("supplier-account-card-OMT");
    fireEvent.click(within(card).getByTestId("supplier-account-subrow-iPick"));

    await waitFor(() => {
      expect(mockGetAllSupplierTransactions).toHaveBeenCalledWith("iPick");
    });
  });

  it("selecting the account parent renders the MERGED ledger with a Type/Source cell per row, fed by source_name", async () => {
    renderPage();

    fireEvent.click(await screen.findByTestId("supplier-tile-OMT"));

    const typeCells = await screen.findAllByTestId("supplier-ledger-type-cell");
    expect(typeCells.map((el) => el.textContent)).toEqual(
      expect.arrayContaining(["OMT", "iPick"]),
    );
  });

  it("the ledger Type filter defaults to All and narrows the merged ledger when changed", async () => {
    renderPage();

    fireEvent.click(await screen.findByTestId("supplier-tile-OMT"));
    await screen.findAllByTestId("supplier-ledger-type-cell");

    const filter = screen.getByTestId(
      "supplier-ledger-type-filter",
    ) as HTMLSelectElement;
    expect(filter.value).toBe("ALL");

    fireEvent.change(filter, { target: { value: "iPick" } });

    await waitFor(() => {
      const cells = screen.getAllByTestId("supplier-ledger-type-cell");
      expect(cells).toHaveLength(1);
      expect(cells[0].textContent).toBe("iPick");
    });
  });

  it("a tenant with no OMT account (empty getSupplierAccountBalances) falls back to the pre-LIRA-188 plain-tile rendering untouched", async () => {
    mockGetSupplierAccountBalances.mockResolvedValue([]);
    mockGetSupplierBalances.mockResolvedValue([
      { supplier_id: 1, total_usd: 34.5, total_lbp: 0 },
      { supplier_id: 2, total_usd: 0, total_lbp: 0 },
      { supplier_id: 3, total_usd: 10, total_lbp: 0 },
    ]);

    renderPage();

    await waitFor(() => {
      expect(mockGetSupplierAccountBalances).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("supplier-account-card-OMT")).toBeNull();
    expect(await screen.findByTestId("supplier-tile-OMT")).toBeInTheDocument();
    expect(screen.getByTestId("supplier-tile-OMT_APP")).toBeInTheDocument();
    expect(screen.getByTestId("supplier-tile-iPick")).toBeInTheDocument();
  });
});

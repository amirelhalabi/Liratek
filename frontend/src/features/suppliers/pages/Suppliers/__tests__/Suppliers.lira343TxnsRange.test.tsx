/** @jest-environment jsdom */

/**
 * LIRA-343 T033 / T033a — the Transactions window reads its rows on the
 * server by shop day, and the settle sheet's "See in Transactions ›" opens
 * that window ABOVE the sheet.
 *
 * - The From / To range reaches the adapter (`{ from, to }`); no range at
 *   all keeps the old call shape.
 * - An OMT account parent's window reads every member's rows through
 *   `getSupplierAccountTransactions`, never the single-provider read.
 * - From can never be after To (the server refuses it).
 * - From a day's details, the window opens filtered to that day while the
 *   sheet stays mounted underneath (z-[60] layer).
 *
 * NOT proven failing-first (rule 17): the page wiring was written before
 * this file. Kept here as guards.
 *
 * (Header below copied from the LIRA-322 account test.)
 *
 * LIRA-322 — the Suppliers page for the OMT account.
 *
 * US4 (T042): for the OMT counter, OMT App and iPick, Settle Account is the
 * one way to pay OMT — no "Pay / Receive" tab and no "Commission
 * Settlement" tick list; the panel opens on the Transactions history. A
 * supplier outside the account (Katsh) keeps both.
 *
 * US2 (T030): the history labels come from the settlements — a part-paid
 * transfer reads "Partial · $47.00" (its own currency), and "Outstanding"
 * shows both currencies for an account member.
 *
 * Renders the REAL page; `useApi` is ONE stable object (rule 25).
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
  getSupplierAccountLedger: jest.fn().mockResolvedValue([]),
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
  getSupplierAccountTransactions: mockGetSupplierAccountTransactions,
  getSupplierAccountMonthRows: mockGetSupplierAccountMonthRows,
  getSupplierAccountDayDetail: jest.fn(async () => []),
  getSupplierAccountExpectedStatement: jest.fn().mockResolvedValue(null),
  settleSupplierAccount: jest.fn(),
};

jest.mock("@/shared/utils/localDay", () => {
  const actual = jest.requireActual("@/shared/utils/localDay");
  return { ...actual, localDay: () => "2026-10-26" };
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

const TXN = {
  commission: 0,
  omt_fee: null,
  omt_service_type: "INTRA",
  settlement_id: null,
  is_settled: 0,
  is_refunded: 0,
  service_type: "SEND" as const,
};
/** $101 transfer part-paid by $47 (coverage). */
const USD_PARTIAL = {
  ...TXN,
  id: 701,
  amount: 101,
  currency: "USD",
  cost: 101,
  supplier_owed: 101,
  fifo_status: "partial" as const,
  fifo_paid_usd: 47,
  fifo_paid_lbp: 0,
  created_at: "2026-10-01T10:00:00Z",
};
/** 900,000 LBP transfer part-paid by 100,000 LBP. */
const LBP_PARTIAL = {
  ...TXN,
  id: 702,
  amount: 900000,
  currency: "LBP",
  cost: 900000,
  supplier_owed: 900000,
  fifo_status: "partial" as const,
  fifo_paid_usd: 0,
  fifo_paid_lbp: 100000,
  created_at: "2026-10-02T10:00:00Z",
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

/** One open $50 transfer on 20 Oct (settle-sheet fixture). */
const OCT20_ROW = {
  kind: "FINANCIAL_SERVICE" as const,
  id: 900,
  supplier_id: 1,
  source_provider: "OMT",
  source_name: "OMT",
  created_at: "2026-10-20 09:00:00",
  amount_usd: 50,
  amount_lbp: 0,
  entry_type: null,
  service_type: "SEND",
  commission_usd: 0,
  commission_lbp: 0,
  omt_service_type: "INTRA",
  commission_model: 0,
  covered_usd: 0,
  covered_lbp: 0,
  remaining_usd: 50,
  remaining_lbp: 0,
  shop_day: "2026-10-20",
  source_ref_table: null,
  row_scope: "DAY" as const,
  transaction_id: null,
};

function fields(dialog: HTMLElement) {
  return {
    from: within(dialog).getByLabelText("From") as HTMLInputElement,
    to: within(dialog).getByLabelText("To") as HTMLInputElement,
  };
}

describe("Suppliers page — Transactions window range on the server (LIRA-343 T033a)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([OMT, OMT_APP, IPICK, KATSH]);
    mockGetSupplierAccountBalances.mockResolvedValue([ACCOUNT]);
    mockGetSupplierAccountUnsettled.mockResolvedValue([]);
    mockGetAllSupplierTransactions.mockResolvedValue([]);
    mockGetSupplierAccountTransactions.mockResolvedValue([
      USD_PARTIAL,
      LBP_PARTIAL,
    ]);
    mockGetSupplierAccountMonthRows.mockResolvedValue([]);
  });

  it("a plain supplier: no range keeps the old call; a range is passed to the adapter", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("supplier-tile-KATSH"));
    const dialog = await openSupplierTable("transactions");
    await waitFor(() =>
      expect(mockGetAllSupplierTransactions).toHaveBeenCalledWith("KATSH"),
    );

    fireEvent.change(fields(dialog).from, { target: { value: "2026-10-01" } });
    fireEvent.change(fields(dialog).to, { target: { value: "2026-10-21" } });
    await waitFor(() =>
      expect(mockGetAllSupplierTransactions).toHaveBeenLastCalledWith(
        "KATSH",
        undefined,
        { from: "2026-10-01", to: "2026-10-21" },
      ),
    );
    expect(mockGetSupplierAccountTransactions).not.toHaveBeenCalled();
  });

  it("the OMT account parent reads every member's rows through getSupplierAccountTransactions", async () => {
    renderPage();
    const card = await screen.findByTestId("supplier-account-card-OMT");
    fireEvent.click(within(card).getByTestId("supplier-tile-OMT"));
    const dialog = await openSupplierTable("transactions");
    await within(dialog).findByTestId("supplier-txn-row-701");
    expect(mockGetSupplierAccountTransactions).toHaveBeenCalledWith(1);
    expect(mockGetAllSupplierTransactions).not.toHaveBeenCalledWith("OMT");

    fireEvent.change(fields(dialog).from, { target: { value: "2026-10-02" } });
    await waitFor(() =>
      expect(mockGetSupplierAccountTransactions).toHaveBeenLastCalledWith(
        1,
        undefined,
        { from: "2026-10-02", to: "" },
      ),
    );
  });

  it("From can never be after To", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("supplier-tile-KATSH"));
    const dialog = await openSupplierTable("transactions");

    fireEvent.change(fields(dialog).to, { target: { value: "2026-10-10" } });
    fireEvent.change(fields(dialog).from, { target: { value: "2026-10-15" } });
    expect(fields(dialog).from.value).toBe("2026-10-15");
    expect(fields(dialog).to.value).toBe("2026-10-15");

    fireEvent.change(fields(dialog).to, { target: { value: "2026-10-12" } });
    expect(fields(dialog).from.value).toBe("2026-10-12");
    expect(fields(dialog).to.value).toBe("2026-10-12");
    for (const call of mockGetAllSupplierTransactions.mock.calls) {
      const range = call[2] as { from: string; to: string } | undefined;
      if (range?.from && range.to) {
        expect(range.from <= range.to).toBe(true);
      }
    }
  });

  // Was: '"See in Transactions ›" from the settle sheet opens the window for
  // that day ABOVE the sheet'. Owner decision 2026-10-27 removed the day
  // details (and that link with them); a day tap only picks / unpicks.
  // Failing-first guard (rule 17): run against the page whose sheet still
  // opened the details.
  it("tapping a day in the settle sheet opens no day details and no Transactions window", async () => {
    mockGetSupplierAccountUnsettled.mockResolvedValue([OCT20_ROW]);
    mockGetSupplierAccountMonthRows.mockImplementation(
      async (_id: number, month: string) =>
        month === "2026-10" ? [OCT20_ROW] : [],
    );
    renderPage();
    const card = await screen.findByTestId("supplier-account-card-OMT");
    fireEvent.click(within(card).getByTestId("supplier-account-settle-button"));
    const sheet = await screen.findByTestId("supplier-account-settle-sheet");

    const cell = await waitFor(() => {
      const el = sheet.querySelector('[data-day="2026-10-20"]');
      if (!el) throw new Error("calendar not rendered");
      return el as HTMLElement;
    });
    const button = within(cell).getByRole("button");
    const before = button.getAttribute("aria-pressed");
    fireEvent.click(button);
    await waitFor(() =>
      expect(
        within(
          sheet.querySelector('[data-day="2026-10-20"]') as HTMLElement,
        ).getByRole("button"),
      ).not.toHaveAttribute("aria-pressed", before ?? ""),
    );
    expect(within(sheet).queryByTestId("settle-day-details")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "See in Transactions ›" }),
    ).toBeNull();
    expect(screen.queryByTestId("supplier-txns-layer")).toBeNull();
    expect(mockGetSupplierAccountTransactions).not.toHaveBeenCalled();
  });
});

/** @jest-environment jsdom */
/**
 * LIRA-343 T033b (spec FR-016c) — the supplier Transactions window gets a
 * from–to date filter (two date fields + Today, Yesterday, This month, Clear).
 * Days are the browser's own local days (`localDay`, rule 27). The range lives
 * in the page and is cleared when another supplier is selected.
 *
 * Rule 17: written before the filter existed; the first run must fail on the
 * missing "From" field. Rule 25: one module-level `useApi` mock object.
 *
 * The server-side filtering (T033a) is not part of this file: the history
 * hook does not take a range yet.
 */

import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Suppliers from "../index";
import { localDay } from "@/shared/utils/localDay";
import { openSupplierTable } from "@/features/suppliers/testing/supplierTableModals";

const mockGetSuppliers = jest.fn();
const mockGetSupplierLedger = jest.fn();
const mockGetAllSupplierTransactions = jest.fn();
const mockGetUnsettledTransactions = jest.fn();

// Rule 25 — one module-level object, never a fresh literal per useApi() call.
const mockApi = {
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: jest.fn().mockResolvedValue([]),
  getSupplierAccountBalances: jest.fn().mockResolvedValue([]),
  getSupplierProductBalances: jest.fn().mockResolvedValue([]),
  getSupplierProductStockValue: jest.fn().mockResolvedValue([]),
  getSupplierLedger: mockGetSupplierLedger,
  getSupplierProductItems: jest.fn().mockResolvedValue([]),
  getAllSupplierTransactions: mockGetAllSupplierTransactions,
  getUnsettledTransactions: mockGetUnsettledTransactions,
  settleTransactions: jest.fn(),
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
    CounterpartySettleModal: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="settle-modal">{children}</div>
    ),
    PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  };
});

let mockRole = "admin";
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: mockRole, role: mockRole } }),
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

const KATSH = {
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
};

const TXN = {
  service_type: "BILL" as const,
  currency: "USD",
  amount: 10,
  commission: 0,
  cost: 10,
  omt_fee: null,
  omt_service_type: null,
  settlement_id: null,
  is_settled: 0,
  supplier_owed: 10,
  fifo_status: "unpaid" as const,
  fifo_paid_usd: 0,
};
const TXN_A = { ...TXN, id: 801, created_at: "2026-10-01T09:00:00Z" };
const TXN_B = { ...TXN, id: 802, created_at: "2026-10-01T10:00:00Z" };

const ALFA = { ...KATSH, id: 2, name: "Alfa", provider: "Alfa" };

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

async function openKatshTransactions(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByTestId("supplier-tile-Katsh"));
  return openSupplierTable("transactions");
}

function fields(dialog: HTMLElement) {
  return {
    from: within(dialog).getByLabelText("From") as HTMLInputElement,
    to: within(dialog).getByLabelText("To") as HTMLInputElement,
  };
}

function shift(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDay(d);
}

describe("Suppliers page — Transactions window date filter (LIRA-343 FR-016c)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = "admin";
    mockGetSuppliers.mockResolvedValue([KATSH, ALFA]);
    mockGetSupplierLedger.mockResolvedValue([]);
    mockGetAllSupplierTransactions.mockResolvedValue([TXN_A, TXN_B]);
    mockGetUnsettledTransactions.mockResolvedValue([]);
  });

  it("shows empty From / To date fields and the four presets", async () => {
    renderPage();
    const dialog = await openKatshTransactions();
    const { from, to } = fields(dialog);
    expect(from.type).toBe("date");
    expect(to.type).toBe("date");
    expect(from.value).toBe("");
    expect(to.value).toBe("");
    for (const name of ["Today", "Yesterday", "This month", "Clear"]) {
      expect(within(dialog).getByRole("button", { name })).toBeInTheDocument();
    }
    // The rows are still listed (no range = everything).
    expect(within(dialog).getByTestId("supplier-txn-row-801")).toBeInTheDocument();
  });

  it("Today, Yesterday and This month fill both fields with local days; Clear empties them", async () => {
    renderPage();
    const dialog = await openKatshTransactions();

    fireEvent.click(within(dialog).getByRole("button", { name: "Today" }));
    expect(fields(dialog).from.value).toBe(localDay());
    expect(fields(dialog).to.value).toBe(localDay());

    fireEvent.click(within(dialog).getByRole("button", { name: "Yesterday" }));
    expect(fields(dialog).from.value).toBe(shift(-1));
    expect(fields(dialog).to.value).toBe(shift(-1));

    fireEvent.click(within(dialog).getByRole("button", { name: "This month" }));
    expect(fields(dialog).from.value).toBe(`${localDay().slice(0, 7)}-01`);
    expect(fields(dialog).to.value).toBe(localDay());

    fireEvent.click(within(dialog).getByRole("button", { name: "Clear" }));
    expect(fields(dialog).from.value).toBe("");
    expect(fields(dialog).to.value).toBe("");
  });

  it("typed dates are kept while the window is closed and reopened", async () => {
    renderPage();
    let dialog = await openKatshTransactions();
    fireEvent.change(fields(dialog).from, { target: { value: "2026-10-01" } });
    fireEvent.change(fields(dialog).to, { target: { value: "2026-10-21" } });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    dialog = await openSupplierTable("transactions");
    expect(fields(dialog).from.value).toBe("2026-10-01");
    expect(fields(dialog).to.value).toBe("2026-10-21");
  });

  it("selecting another supplier clears the range", async () => {
    renderPage();
    let dialog = await openKatshTransactions();
    fireEvent.click(within(dialog).getByRole("button", { name: "Today" }));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(await screen.findByTestId("supplier-tile-Alfa"));
    dialog = await openSupplierTable("transactions");
    expect(fields(dialog).from.value).toBe("");
    expect(fields(dialog).to.value).toBe("");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(await screen.findByTestId("supplier-tile-Katsh"));
    dialog = await openSupplierTable("transactions");
    expect(fields(dialog).from.value).toBe("");
  });
});

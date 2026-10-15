/** @jest-environment jsdom */
/**
 * LIRA-256 — the supplier Settle tab honours OMT statement covered types.
 *
 * For the OMT supplier only: a covered-types picker; with a choice set,
 * "Select all" picks covered rows only, uncovered new-style rows are
 * disabled and read "Waiting — not in this statement", they are dropped
 * from the selection when the choice changes, nothing is pre-selected
 * (unchanged Settle-tab behaviour), and `settleTransactions` receives
 * `covered_omt_service_types` only when the choice is not "All types".
 * Non-OMT suppliers: no picker, never the key.
 *
 * Rule 25: `useApi` returns ONE module-level stable object (unlike the
 * inline literal in Suppliers.commissionAtSettlement.test.tsx).
 *
 * RULE 17 — run red before the page change (no picker rendered).
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
import {
  coveredPickerShowsAllTypes,
  isCoveredTypeTicked,
  toggleCoveredType,
} from "../../../testing/coveredTypesPicker";

const SP = "supplier-settle-covered";

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
    CounterpartySettleModal: ({
      onConfirm,
      confirmLabel,
      beforeContent,
      children,
    }: {
      onConfirm: () => void;
      confirmLabel: string;
      beforeContent?: React.ReactNode;
      children?: React.ReactNode;
    }) => (
      <div data-testid="settle-modal">
        {beforeContent}
        {children}
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    ),
    PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
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

const supplier = (id: number, name: string, provider: string) => ({
  id,
  name,
  contact_name: null,
  phone: null,
  note: null,
  is_active: 1,
  module_key: null,
  provider,
  is_system: 1,
  created_at: "2026-08-01T00:00:00Z",
  commission_entry_mode: "LUMP" as const,
  commission_rate: null,
});
const OMT = supplier(2, "OMT", "OMT");
const KATSH = supplier(1, "Katsh", "Katsh");

const row = (id: number, type: string | null, model: number, owed: number) => ({
  id,
  service_type: "SEND" as const,
  amount: owed - 7,
  currency: "USD",
  commission: 0.7,
  omt_fee: 7,
  omt_service_type: type,
  client_name: null,
  supplier_owed: owed,
  commission_model: model,
  created_at: `2026-10-0${id - 300}T10:00:00Z`,
});
const INTRA = row(301, "INTRA", 1, 468);
const WU = row(302, "WESTERN_UNION", 1, 526);
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

const rowToggle = (id: number) =>
  within(screen.getByTestId(`settle-row-${id}`)).getByRole("checkbox");

describe("Suppliers Settle tab — LIRA-256 covered types", () => {
  const KEY = "covered_omt_service_types";
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mockGetSuppliers.mockResolvedValue([KATSH, OMT]);
    mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
    mockGetUnsettledTransactions.mockImplementation((provider: string) =>
      Promise.resolve(
        provider === "OMT"
          ? [INTRA, WU]
          : provider === "Katsh"
            ? [BILL_ROW]
            : [],
      ),
    );
  });

  it("the key name comes from the schema (rule 24)", () => {
    expect(Object.keys(supplierSettleSchema.shape)).toContain(KEY);
  });

  it("OMT: picker shows; with [INTRA], Select all picks covered rows only, WU is disabled and waiting, nothing pre-selected; payload carries the choice", async () => {
    window.localStorage.setItem(
      "liratek:omt-covered-types:2",
      JSON.stringify(["INTRA"]),
    );
    renderPage();
    fireEvent.click((await screen.findAllByText("OMT"))[0]);
    await screen.findByTestId("settle-row-302");
    expect(await isCoveredTypeTicked(SP, "INTRA")).toBe(true);
    // Nothing pre-selected (unchanged Settle-tab behaviour).
    expect(rowToggle(301)).not.toBeChecked();
    expect(rowToggle(302)).toBeDisabled();
    expect(
      within(screen.getByTestId("settle-row-302")).getByText(
        /Waiting — not in this statement/,
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText(/^Select all \(1\)$/));
    expect(rowToggle(301)).toBeChecked();
    expect(rowToggle(302)).not.toBeChecked();

    fireEvent.click(await screen.findByText(/^Settle \(1\)$/));
    fireEvent.click(await screen.findByText("Confirm Settlement"));
    await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
    const payload = mockSettleTransactions.mock.calls[0][0];
    expect(payload.financial_service_ids).toEqual([301]);
    expect(payload[KEY]).toEqual(["INTRA"]);
  });

  it("changing the choice drops newly-uncovered rows from the selection; 'All types' sends no key", async () => {
    renderPage();
    fireEvent.click((await screen.findAllByText("OMT"))[0]);
    await screen.findByTestId("settle-row-302");
    expect(coveredPickerShowsAllTypes(SP)).toBe(true);
    fireEvent.click(rowToggle(302));
    expect(rowToggle(302)).toBeChecked();
    await toggleCoveredType(SP, "INTRA");
    expect(rowToggle(302)).not.toBeChecked();
    expect(rowToggle(302)).toBeDisabled();
    // Unticking the only ticked type returns to "All types".
    await toggleCoveredType(SP, "INTRA");
    expect(rowToggle(302)).not.toBeDisabled();
    fireEvent.click(rowToggle(302));
    fireEvent.click(await screen.findByText(/^Settle \(1\)$/));
    fireEvent.click(await screen.findByText("Confirm Settlement"));
    await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
    expect(KEY in mockSettleTransactions.mock.calls[0][0]).toBe(false);
  });

  it("a non-OMT supplier (Katsh): no picker and the payload never carries the key", async () => {
    window.localStorage.setItem(
      "liratek:omt-covered-types:1",
      JSON.stringify(["INTRA"]),
    );
    renderPage();
    fireEvent.click((await screen.findAllByText("Katsh"))[0]);
    const billRow = (await screen.findByText("Bill")).closest("label")!;
    expect(screen.queryByTestId("supplier-settle-covered-picker")).toBeNull();
    fireEvent.click(within(billRow).getByRole("checkbox"));
    fireEvent.click(await screen.findByText(/^Settle \(1\)$/));
    fireEvent.click(await screen.findByText("Confirm Settlement"));
    await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
    expect(KEY in mockSettleTransactions.mock.calls[0][0]).toBe(false);
  });
});

/** @jest-environment jsdom */

/**
 * LIRA-371 T026 — the Suppliers page hands the "OMT Cash Drawer | General"
 * choice to the main-system supplier's settle screens only:
 *  - OMT shop: the OMT account's Settle Account sheet gets the choice;
 *    Katsh's does not;
 *  - Whish shop: the Whish bills-only batch Settle confirm, with an "Other
 *    payment" cash commission, shows it; picking General sends
 *    `cash_drawer: "GENERAL"` (parsed through supplierSettleSchema, rule 24);
 *  - OMT shop: OMT shows no batch Settle / Pay / Receive (unchanged);
 *  - Partners pages never import the control.
 *
 * Renders the REAL page with ONE stable useApi object (rule 25).
 */
import * as fs from "fs";
import * as path from "path";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supplierSettleSchema } from "@liratek/core";
import Suppliers from "../index";
import { queueRow } from "@/features/suppliers/testing/accountSettleFixtures";

const mockGetSuppliers = jest.fn();
const mockGetUnsettledTransactions = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
const mockGetSupplierAccountBalances = jest.fn();
const mockSettleTransactions = jest.fn();

const mockApi = {
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: jest.fn().mockResolvedValue([]),
  getSupplierProductBalances: jest.fn().mockResolvedValue([]),
  getSupplierLedger: jest.fn().mockResolvedValue([]),
  getSupplierProductItems: jest.fn().mockResolvedValue([]),
  getAllSupplierTransactions: jest.fn().mockResolvedValue([]),
  getUnsettledTransactions: mockGetUnsettledTransactions,
  settleTransactions: mockSettleTransactions,
  recordSupplierCashflow: jest.fn(),
  addSupplierLedgerEntry: jest.fn(),
  getSupplierPurchases: jest.fn().mockResolvedValue([]),
  createSupplierPurchase: jest.fn(),
  getSupplierProductStockValue: jest.fn().mockResolvedValue([]),
  getSupplierAccountBalances: mockGetSupplierAccountBalances,
  getSupplierAccountLedger: jest.fn().mockResolvedValue([]),
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
  getSupplierAccountTransactions: jest.fn().mockResolvedValue([]),
  getSupplierAccountExpectedStatement: jest.fn().mockResolvedValue(null),
  getSupplierAccountMonthRows: jest.fn(async () => []),
  getSupplierAccountDayDetail: jest.fn(async () => []),
  getSupplierOpenRecordedDebts: jest.fn().mockResolvedValue([]),
  getSupplierAccountOwedShares: jest.fn().mockResolvedValue([]),
  settleSupplierAccount: jest.fn(),
};

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

const mockMethods = [
  { code: "CASH", label: "Cash", drawer_name: "General", affects_drawer: 1 },
];
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: mockMethods,
    drawerAffectingMethods: mockMethods,
    allMethods: mockMethods,
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

let mockBase: "OMT" | "WHISH" = "OMT";
jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: mockBase,
    partnerSystem: mockBase === "OMT" ? "WHISH" : "OMT",
    loading: false,
  }),
}));

const BASE = {
  contact_name: null,
  phone: null,
  note: null,
  is_active: 1,
  module_key: null,
  is_system: 1,
  created_at: "2026-09-01T00:00:00Z",
  account_supplier_id: null,
};
const OMT = { ...BASE, id: 1, name: "OMT", provider: "OMT" };
const OMT_APP = { ...BASE, id: 2, name: "OMT App", provider: "OMT_APP", account_supplier_id: 1 };
const KATSH = { ...BASE, id: 4, name: "Katsh", provider: "Katsh" };
const WHISH = {
  ...BASE,
  id: 6,
  name: "Whish",
  provider: "WHISH",
  commission_entry_mode: "LUMP" as const,
};

const ACCOUNT = {
  account_supplier_id: 1,
  account_name: "OMT",
  total_usd: 101,
  total_lbp: 0,
  children: [
    {
      supplier_id: 1,
      name: "OMT",
      provider: "OMT",
      drawer_name: "OMT_System",
      total_usd: 101,
      total_lbp: 0,
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
  ],
};

const OMT_ROW = queueRow({ id: 50, created_at: "2026-10-01 09:00:00", amount_usd: 101 });
const KATSH_TOPUP = queueRow({
  kind: "LEDGER",
  id: 60,
  supplier_id: 4,
  source_provider: "Katsh",
  source_name: "Katsh",
  created_at: "2026-10-01 09:00:00",
  amount_usd: 40,
  entry_type: "TOP_UP",
  service_type: null,
  omt_service_type: null,
  commission_model: null,
});

const WHISH_BILL = {
  id: 701,
  service_type: "BILL" as const,
  amount: 500000,
  currency: "LBP",
  commission: 0,
  omt_fee: null,
  omt_service_type: null,
  client_name: null,
  supplier_owed: 0,
  commission_model: 1,
  settlement_id: null,
  is_settled: 0,
  is_refunded: 0,
  created_at: "2026-10-08T10:00:00Z",
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

describe("Suppliers page — LIRA-371 cash drawer choice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBase = "OMT";
    mockGetSuppliers.mockResolvedValue([OMT, OMT_APP, KATSH, WHISH]);
    mockGetSupplierAccountBalances.mockResolvedValue([ACCOUNT]);
    mockGetUnsettledTransactions.mockResolvedValue([]);
    mockGetSupplierAccountUnsettled.mockImplementation(async (id: number) =>
      id === 1 ? [OMT_ROW] : id === 4 ? [KATSH_TOPUP] : [],
    );
    mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
  });

  it("OMT shop: the OMT account's Settle Account sheet offers the choice", async () => {
    renderPage();
    const card = await screen.findByTestId("supplier-account-card-OMT");
    fireEvent.click(within(card).getByTestId("supplier-account-settle-button"));
    await screen.findByTestId("supplier-account-settle-sheet");
    expect(await screen.findByTestId("cash-drawer-choice")).toBeInTheDocument();
    expect(screen.getByTestId("cash-drawer-choice-system").textContent).toBe(
      "OMT Cash Drawer",
    );
  });

  it("OMT shop: Katsh's Settle Account sheet has no choice", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("supplier-tile-Katsh"));
    fireEvent.click(await screen.findByTestId("supplier-settle-by-day-button"));
    await screen.findByTestId("supplier-account-settle-sheet");
    await screen.findByTestId("supplier-account-settle-submit");
    expect(screen.queryByTestId("cash-drawer-choice")).toBeNull();
  });

  it("Whish shop: the bills-only batch Settle with an Other-payment cash commission offers the choice and sends GENERAL", async () => {
    mockBase = "WHISH";
    mockGetUnsettledTransactions.mockImplementation((provider: string) =>
      Promise.resolve(provider === "WHISH" ? [WHISH_BILL] : []),
    );
    renderPage();
    fireEvent.click(await screen.findByTestId("supplier-tile-WHISH"));
    const billRow = (await screen.findByText("Bill")).closest("label")!;
    fireEvent.click(within(billRow).getByRole("checkbox"));
    fireEvent.click(await screen.findByText(/^Settle \(1\)$/));
    fireEvent.click(await screen.findByRole("button", { name: "Other payment" }));
    // Enter the commission (lump sum, LBP); the cash line is autofilled with it.
    fireEvent.change(await screen.findByTestId("supplier-settle-commission-lbp"), {
      target: { value: "20000" },
    });
    await waitFor(() =>
      expect(
        document.querySelector('[data-testid^="payment-amount-"]'),
      ).not.toBeNull(),
    );
    fireEvent.click(await screen.findByTestId("cash-drawer-choice-general"));
    fireEvent.click(screen.getByText("Confirm Settlement"));
    await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
    const parsed = supplierSettleSchema.parse(mockSettleTransactions.mock.calls[0][0]);
    expect(parsed.cash_drawer).toBe("GENERAL");
  });

  it("OMT shop: OMT shows no batch Settle and no Pay / Receive (unchanged)", async () => {
    renderPage();
    const card = await screen.findByTestId("supplier-account-card-OMT");
    fireEvent.click(within(card).getByTestId("supplier-tile-OMT"));
    await waitFor(() => expect(screen.queryByText("Pay / Receive")).toBeNull());
    expect(screen.queryByTestId("supplier-tab-settle")).toBeNull();
  });

  it("Partners pages never use the control", () => {
    const root = path.resolve(__dirname, "../../../../partners");
    const files: string[] = [];
    const walk = (d: string) => {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(fs.readFileSync(f, "utf8")).not.toContain("CashDrawerChoice");
    }
  });
});

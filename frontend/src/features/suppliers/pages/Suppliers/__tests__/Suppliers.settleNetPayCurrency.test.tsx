/** @jest-environment jsdom */
/**
 * LIRA-119 — Settle modal showed "Net payment $0.00" / "Total Amount $0.00"
 * for a LBP RATE-mode commission (Katsh bills), hardcoding USD everywhere
 * regardless of the commission/rate currency the operator actually entered.
 *
 * INVESTIGATION FINDING (see the task report for the full trace): what
 * actually POSTS for a bills-only Katsh batch was already CORRECT before
 * this fix — `SupplierRepository.settleTransactions` books $0/0 LBP cash
 * (genuinely nothing to pay: a bill's principal already left via a
 * provider-drawer cost leg at creation time — SUPPLIER_OWED_EXPR's BILL
 * branch is hardcoded 0) AND separately books the real 20,000 LBP commission
 * as a cashless `SUPPLIER_PAYS_US` ledger credit (proved at the repo level
 * by `SupplierRepository.commissionAtSettlement.test.ts` and unchanged by
 * this fix — `Suppliers.commissionAtSettlement.test.tsx`'s existing
 * `payload.amount_lbp).toBe(0)` / `payload.commission_lbp).toBe(20000)`
 * assertions still hold). The bug was PURELY the on-screen display: the
 * confirm modal's "Net payment"/"Total Amount" hardcoded a "$" prefix and
 * `currency: "USD"` regardless of what currency the batch's money was
 * actually in.
 *
 * This is an INTERACTION-layer test (rule 17's "not just repo-level math"
 * instruction) — unlike Suppliers.commissionAtSettlement.test.tsx, this file
 * does NOT mock `CounterpartySettleModal`/`MultiPaymentInput`: it renders the
 * REAL `@liratek/ui` components (jest.config.ts maps "@liratek/ui" to
 * packages/ui/src, so this is the exact code the app ships) so the
 * assertions below are against literal rendered DOM text, not intercepted
 * props.
 *
 * Rule 17 (failing-first): confirmed against the pre-fix
 * Suppliers/index.tsx (hardcoded `$${settleNetPayUsd.toFixed(2)}` /
 * `currency: "USD"` / `totals: [{ amount: settleNetPayUsd, currency: "USD"
 * }]`, no `totalAmountCurrency`) — every assertion below that checks for
 * "LBP" failed; the DOM showed "$0.00" for both "Net payment to Katsh:" and
 * MultiPaymentInput's "Total Amount", and the payment-currency select's
 * value was "USD". See the task report for the exact failure output.
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
const mockSettleTransactions = jest.fn();
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
      supplierWriteOff: jest.fn(),
      getSupplierPurchases: jest.fn(),
      createSupplierPurchase: jest.fn(),
    }),
    // Wrapped in a closure — jest.mock factories are hoisted above this
    // file's `const` declarations, so a direct `{ emit: mockAppEventsEmit }`
    // property throws a TDZ error (same reason as the sibling test file).
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

// Same fixtures as Suppliers.commissionAtSettlement.test.tsx — Katsh is the
// ONE bill provider that earns commission (20,000 LBP/bill, RATE mode,
// LIRA-112's commission_rate_currency = "LBP").
const KATSH_SUPPLIER = {
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
  commission_entry_mode: "RATE" as const,
  commission_rate: 20000,
  commission_rate_currency: "LBP" as const,
};

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

// commission_model = 1 (AT_SETTLEMENT), bill principal never reaches the
// ledger (SUPPLIER_OWED_EXPR's BILL branch is hardcoded 0) — supplier_owed
// is 0 regardless of the bill's face amount.
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

// commission_model = 0 (EMBEDDED legacy) — real USD cash genuinely owed, to
// prove the fix does NOT relabel a real-cash USD batch as LBP.
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

describe("Suppliers page — Settle modal net-payment currency (LIRA-119)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSupplierBalances.mockResolvedValue([]);
    mockGetSupplierProductBalances.mockResolvedValue([]);
    mockGetSupplierLedger.mockResolvedValue([]);
    mockGetAllSupplierTransactions.mockResolvedValue([]);
    mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
  });

  it("LBP-commission (Katsh bill): Net payment + Total Amount show '0 LBP', never '$0.00', and the payment sheet defaults to LBP", async () => {
    mockGetSuppliers.mockResolvedValue([KATSH_SUPPLIER, OMT_SUPPLIER]);
    mockGetUnsettledTransactions.mockImplementation((provider: string) =>
      Promise.resolve(provider === "Katsh" ? [BILL_ROW] : []),
    );

    renderPage();

    fireEvent.click((await screen.findAllByText("Katsh"))[0]);

    const billRow = (await screen.findByText("Bill")).closest("label")!;
    fireEvent.click(within(billRow).getByRole("checkbox"));

    fireEvent.click(await screen.findByText(/^Settle \(1\)$/));

    // D8 default: RATE mode pre-selected, rate pre-filled 20000 from the
    // supplier's own commission_rate — confirms the modal actually opened
    // with the LBP-rated commission math the ticket's screenshot shows.
    expect(await screen.findByDisplayValue("20000")).toBeInTheDocument();

    // ── The actual bug: "Net payment to Katsh:" must NOT read "$0.00" ──────
    const netPayLabel = screen.getByText("Net payment to Katsh:");
    const netPayRow = netPayLabel.closest("div")!;
    expect(within(netPayRow).queryByText("$0.00")).toBeNull();
    expect(within(netPayRow).getByText("0 LBP")).toBeInTheDocument();

    // ── MultiPaymentInput's own "Total Amount" line (real component,
    //     not mocked) — the second half of the ticket's screenshot ────────
    const totalAmountLabel = screen.getByText("Total Amount");
    const totalAmountRow = totalAmountLabel.closest("div")!;
    expect(within(totalAmountRow).queryByText("$0.00")).toBeNull();
    expect(within(totalAmountRow).getByText("0 LBP")).toBeInTheDocument();

    // ── Payment sheet's default leg currency is LBP, not USD ────────────────
    const currencySelect = document.querySelector<HTMLSelectElement>(
      '[data-testid^="payment-currency-"]',
    );
    expect(currencySelect).not.toBeNull();
    expect(currencySelect!.value).toBe("LBP");

    // Confirming still settles $0/0 LBP cash + the real 20,000 LBP
    // commission credit — the display fix must not change what posts.
    fireEvent.click(screen.getByText("Confirm Settlement"));
    await waitFor(() => expect(mockSettleTransactions).toHaveBeenCalled());
    const payload = mockSettleTransactions.mock.calls[0][0];
    expect(payload.amount_usd).toBe(0);
    expect(payload.amount_lbp).toBe(0);
    expect(payload.commission_lbp).toBe(20000);
  });

  it("real USD cash owed (legacy OMT batch): Net payment stays in USD — the fix must not relabel genuine cash", async () => {
    mockGetSuppliers.mockResolvedValue([KATSH_SUPPLIER, OMT_SUPPLIER]);
    mockGetUnsettledTransactions.mockImplementation((provider: string) =>
      Promise.resolve(provider === "OMT" ? [LEGACY_ROW] : []),
    );

    renderPage();

    fireEvent.click(await screen.findByText("OMT"));

    const legacyRow = (await screen.findByText("OMT_TRANSFER")).closest(
      "label",
    )!;
    fireEvent.click(within(legacyRow).getByRole("checkbox"));

    fireEvent.click(await screen.findByText(/^Settle \(1\)$/));

    const netPayLabel = await screen.findByText("Net payment to OMT:");
    const netPayRow = netPayLabel.closest("div")!;
    expect(within(netPayRow).getByText("$100.00")).toBeInTheDocument();

    const currencySelect = document.querySelector<HTMLSelectElement>(
      '[data-testid^="payment-currency-"]',
    );
    expect(currencySelect!.value).toBe("USD");
  });
});

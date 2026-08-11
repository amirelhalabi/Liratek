/** @jest-environment jsdom */

/**
 * Balance Pages colour audit (`docs/plans/todo_plans/BALANCE_PAGES_UX_AUDIT.md`),
 * owner's rule verbatim (2026-08-10): "Positive account should be green,
 * means shop owes the second party."
 *
 * Suppliers' own documented convention (`balanceColor`/`describeBalance`,
 * this file's `index.tsx`) is POSITIVE total = "WE owe the supplier" — i.e.
 * positive already means "shop owes" on this page, unlike Debts/Partners.
 * Pre-audit, that meaning rendered RED (`text-red-400`) — the exact opposite
 * of the owner's rule, on every balance/badge on the page (latent bug 0a).
 * This test proves the FLIPPED polarity plus the separate exact-zero-renders
 * -red bug on the "Total Owed" summary cards (latent bug #1), which bypassed
 * the page's own `signBucket`/`BALANCE_EPS` entirely.
 *
 * INTERACTION-layer test (rule 15/17) — renders the REAL Suppliers page
 * against the REAL, unmodified `balanceColor`/`describeBalance`/"Total
 * Owed" JSX, not a props-level shape.
 *
 * Rule 17 (failing-first): confirmed by temporarily reverting `balanceColor`/
 * `describeBalance` to the pre-audit branches (`UP -> red`, `DOWN -> green`)
 * and the "Total Owed" cards to the pre-audit bare
 * `totalOwed.usd < 0 ? green : red` (no epsilon) — the "shop owes" case then
 * fails with:
 *   expect(received).toMatch(expected)
 *   Expected pattern: /text-emerald-400/
 *   Received string:  "text-2xl font-bold font-mono text-red-400"
 * and the "exactly settled" case fails with the summary card carrying
 * `text-red-400` instead of a neutral class. Reverted back to the fix after
 * capturing this.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

// Spread the REAL module first (`jest.requireActual`) — this page imports
// the shared, presentation-only balance colour helpers (`BALANCE_EPS`/
// `balanceBucket`/`balanceTextColor`, `@liratek/ui`) that this test is
// actually exercising; a plain object-literal mock would turn them into
// `undefined`.
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

describe("Suppliers page — balance colour (Balance Pages colour audit)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSuppliers.mockResolvedValue([OMT_SUPPLIER]);
    mockGetSupplierProductBalances.mockResolvedValue([]);
    mockGetAllSupplierTransactions.mockResolvedValue([]);
    mockGetUnsettledTransactions.mockResolvedValue([]);
    mockGetSupplierLedger.mockResolvedValue([]);
    mockSettleTransactions.mockResolvedValue({ success: true, id: 1 });
  });

  it("shop owes the supplier (positive total) renders GREEN, both the summary card and the detail text", async () => {
    mockGetSupplierBalances.mockResolvedValue([
      { supplier_id: 1, total_usd: 34.5, total_lbp: 0 },
    ]);

    renderPage();

    // "$34.50" is ambiguous on its own (the supplier list row shows the
    // identical amount) — scope to the "Total Owed (USD)" card specifically
    // via its label's next sibling, the actual coloured amount div. The
    // label itself renders on mount (before `getSupplierBalances` resolves),
    // so wait for the amount's TEXT to update, not just the label to exist.
    await waitFor(() => {
      const label = screen.getByText("Total Owed (USD)");
      const summaryCard = label.nextElementSibling as HTMLElement;
      expect(summaryCard.textContent?.replace(/\s+/g, "")).toBe("$34.50");
    });
    const summaryCard = screen.getByText("Total Owed (USD)")
      .nextElementSibling as HTMLElement;
    expect(summaryCard.className).toMatch(/text-emerald-400/);
    expect(summaryCard.className).not.toMatch(/text-red-400/);

    fireEvent.click((await screen.findAllByText("OMT"))[0]);

    const detailText = await screen.findByText("You owe $34.50");
    expect(detailText.className).toMatch(/text-emerald-400/);
    expect(detailText.className).not.toMatch(/text-red-400/);
  });

  it("the supplier owes the shop (negative total) renders RED, both the summary card and the detail text", async () => {
    mockGetSupplierBalances.mockResolvedValue([
      { supplier_id: 1, total_usd: -34.5, total_lbp: 0 },
    ]);

    renderPage();

    await waitFor(() => {
      const label = screen.getByText("Total Owed (USD)");
      const summaryCard = label.nextElementSibling as HTMLElement;
      expect(summaryCard.textContent?.replace(/\s+/g, "")).toBe("$-34.50");
    });
    const summaryCard = screen.getByText("Total Owed (USD)")
      .nextElementSibling as HTMLElement;
    expect(summaryCard.className).toMatch(/text-red-400/);
    expect(summaryCard.className).not.toMatch(/text-emerald-400/);

    fireEvent.click((await screen.findAllByText("OMT"))[0]);

    const detailText = await screen.findByText("They owe you $34.50");
    expect(detailText.className).toMatch(/text-red-400/);
    expect(detailText.className).not.toMatch(/text-emerald-400/);
  });

  it("an exactly-settled supplier (total === 0) renders the 'Total Owed' summary card NEUTRAL, not red", async () => {
    mockGetSupplierBalances.mockResolvedValue([
      { supplier_id: 1, total_usd: 0, total_lbp: 0 },
    ]);

    renderPage();

    // Latent bug #1: the "Total Owed" cards bypassed this page's own
    // `signBucket`/`BALANCE_EPS` and used a bare `< 0 ? green : red`, so an
    // all-settled shop rendered its top-of-page balance tile in alarm-red.
    // (An all-zero total is indistinguishable from the pre-fetch default —
    // both are 0 — so this case doesn't need the "wait for a DIFFERENT
    // value to land" treatment the nonzero cases above do; `mockGetSupplierBalances`
    // is still awaited via `findByText` below, which polls until settled.)
    await waitFor(() => expect(mockGetSupplierBalances).toHaveBeenCalled());
    const label = screen.getByText("Total Owed (USD)");
    const summaryCard = label.nextElementSibling as HTMLElement;
    expect(summaryCard.textContent?.replace(/\s+/g, "")).toBe("$0.00");
    expect(summaryCard.className).not.toMatch(/text-red-400/);
    expect(summaryCard.className).toMatch(/text-slate-400/);

    fireEvent.click((await screen.findAllByText("OMT"))[0]);
    expect(await screen.findByText("Settled")).toBeInTheDocument();
  });
});

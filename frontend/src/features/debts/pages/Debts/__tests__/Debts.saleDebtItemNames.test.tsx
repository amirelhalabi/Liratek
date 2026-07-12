/** @jest-environment jsdom */

/**
 * Regression test for the Sale Debt item-name resolution bug.
 *
 * `debt_ledger.transaction_id` is a unified `transactions.id`, NOT a
 * `sales.id`. `loadHistory` (Debts/index.tsx) used to pass that id directly
 * into `getSaleItems(saleId)`, which queries `sale_items WHERE sale_id = ?`.
 * Because both tables autoincrement from 1, this either returned nothing or
 * the WRONG sale's items — either way the UI silently fell back to the raw
 * `note` text instead of showing item names.
 *
 * The fix resolves through `getTransactionById` first (the same pattern
 * `loadSaleDetails` already used) to get the real `sales.id` via
 * `transaction.source_id`, then calls `getSaleItems` with THAT id.
 *
 * This test uses two DISTINCT ids — the debt ledger's `transaction_id` (55)
 * vs. the resolved `sales.id` (999) — so it only passes if the code
 * actually resolves through `getTransactionById` before calling
 * `getSaleItems`. Passing the raw `transaction_id` straight into
 * `getSaleItems` (the old, buggy behavior) yields an empty item list here,
 * which is exactly what was confirmed by temporarily reverting the fix.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Debts from "../index";

const DEBT_LEDGER_TRANSACTION_ID = 55; // transactions.id stored on the debt row
const RESOLVED_SALE_ID = 999; // sales.id the transaction actually points to

const mockGetDebtors = jest.fn();
const mockGetClientDebtHistory = jest.fn();
const mockGetTransactionById = jest.fn();
const mockGetSaleItems = jest.fn();
const mockGetClientBalance = jest.fn();
const mockGetSale = jest.fn();

jest.mock("@liratek/ui", () => ({
  useApi: () => ({
    getDebtors: mockGetDebtors,
    getClientDebtHistory: mockGetClientDebtHistory,
    getTransactionById: mockGetTransactionById,
    getSaleItems: mockGetSaleItems,
    getClientBalance: mockGetClientBalance,
    getCustomServiceById: jest.fn(),
    getSale: mockGetSale,
    cashOut: jest.fn(),
    addRepayment: jest.fn(),
    addAccountEntry: jest.fn(),
    getClientDebtTotal: jest.fn(),
  }),
  PageHeader: ({
    title,
    actions,
  }: {
    title: string;
    actions?: React.ReactNode;
  }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {actions}
    </div>
  ),
  Select: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select
      data-testid="debt-filter-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  ServiceTypeTabs: () => null,
  MultiPaymentInput: () => null,
  DataTable: <T,>({
    data,
    renderRow,
    emptyMessage,
  }: {
    data: T[];
    renderRow: (item: T) => React.ReactNode;
    emptyMessage?: string;
  }) => (
    <table>
      <tbody>
        {data.length === 0 ? (
          <tr>
            <td>{emptyMessage}</td>
          </tr>
        ) : (
          data.map((item) => renderRow(item))
        )}
      </tbody>
    </table>
  ),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
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

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

jest.mock("@/api/backendApi", () => ({
  getDebtAging: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

describe("Debts page — Sale Debt item name resolution (loadHistory)", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetDebtors.mockResolvedValue([
      {
        id: 1,
        full_name: "Jane Doe",
        phone_number: "71234567",
        total_debt: 10,
        total_debt_usd: 10,
        total_debt_lbp: 0,
      },
    ]);

    mockGetClientDebtHistory.mockResolvedValue([
      {
        id: 200,
        client_id: 1,
        transaction_id: DEBT_LEDGER_TRANSACTION_ID,
        transaction_type: "Sale Debt",
        amount_usd: 10,
        amount_lbp: 0,
        note: "Balance from Sale",
        created_at: "2026-07-01 10:00:00",
        created_by: null,
        session_id: null,
      },
    ]);

    // getTransactionById(55) resolves to the sales row's real id (999).
    mockGetTransactionById.mockImplementation(async (id: number) => {
      if (id === DEBT_LEDGER_TRANSACTION_ID) {
        return { id, source_table: "sales", source_id: RESOLVED_SALE_ID };
      }
      return null;
    });

    // Only returns items when called with the RESOLVED sale id (999) — the
    // raw transaction_id (55) must yield nothing, mirroring how a real
    // sales table would either 404 or (worse) collide with an unrelated row.
    mockGetSaleItems.mockImplementation(async (saleId: number) => {
      if (saleId === RESOLVED_SALE_ID) {
        return [{ name: "iPhone 13 Screen" }, { name: "Charger" }];
      }
      return [];
    });

    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: 10, balance_lbp: 0 },
    });
  });

  it("resolves the sale via getTransactionById before calling getSaleItems, and shows item names instead of the raw note", async () => {
    render(<Debts />);

    // Item names should appear once history loads and resolution completes.
    await waitFor(() => {
      expect(screen.getByText("• iPhone 13 Screen")).toBeInTheDocument();
    });
    expect(screen.getByText("• Charger")).toBeInTheDocument();

    // The raw note text must NOT be the fallback shown for this row — the
    // resolved item names take its place.
    expect(screen.queryByText("Balance from Sale")).not.toBeInTheDocument();

    // Prove the resolution order: getTransactionById is called with the
    // debt ledger's raw transaction_id, and getSaleItems is called with the
    // RESOLVED sale id — never with the raw transaction_id.
    expect(mockGetTransactionById).toHaveBeenCalledWith(
      DEBT_LEDGER_TRANSACTION_ID,
    );
    expect(mockGetSaleItems).toHaveBeenCalledWith(RESOLVED_SALE_ID);
    expect(mockGetSaleItems).not.toHaveBeenCalledWith(
      DEBT_LEDGER_TRANSACTION_ID,
    );
  });

  it("shows an enriched stored note verbatim (matches the transaction summary) and skips the item fetch", async () => {
    const enrichedNote = "Sale #5: 1× 123 — $4 (discounted 90,000 LBP)";
    mockGetClientDebtHistory.mockResolvedValue([
      {
        id: 201,
        client_id: 1,
        transaction_id: DEBT_LEDGER_TRANSACTION_ID,
        transaction_type: "Sale Debt",
        amount_usd: 4,
        amount_lbp: 0,
        note: enrichedNote,
        created_at: "2026-07-12 04:08:08",
        created_by: null,
        session_id: null,
      },
    ]);

    render(<Debts />);

    // The stored note already names the items and carries the discount —
    // it must be shown as-is, not replaced by re-derived "• item" bullets.
    await waitFor(() => {
      expect(screen.getByText(enrichedNote)).toBeInTheDocument();
    });

    // No per-row sale lookup for enriched notes (the fetch is the fallback
    // for legacy bare notes only).
    expect(mockGetSaleItems).not.toHaveBeenCalled();
  });

  const saleRow = (discountUsd: number) => ({
    id: RESOLVED_SALE_ID,
    total_amount_usd: 5,
    discount_usd: discountUsd,
    final_amount_usd: 5 - discountUsd,
    paid_usd: 0,
    paid_lbp: (5 - discountUsd) * 90_000,
    exchange_rate_snapshot: 90_000,
    status: "completed",
    created_at: "2026-07-12 04:36:48",
  });

  it("Sale Details modal shows a Discount row above Total Amount when the sale was discounted", async () => {
    mockGetSale.mockResolvedValue(saleRow(1));

    render(<Debts />);
    fireEvent.click(await screen.findByTitle("View Sale Details"));

    await waitFor(() => {
      expect(screen.getByText("Discount:")).toBeInTheDocument();
    });
    expect(screen.getByText("-$1.00")).toBeInTheDocument();
    // Zero USD paid + LBP tender renders without the "$0.00 +" prefix.
    expect(screen.getAllByText("360,000 LBP").length).toBeGreaterThan(0);
  });

  it("Sale Details modal hides the Discount row when there is no discount", async () => {
    mockGetSale.mockResolvedValue(saleRow(0));

    render(<Debts />);
    fireEvent.click(await screen.findByTitle("View Sale Details"));

    await waitFor(() => {
      expect(screen.getByText("Total Amount:")).toBeInTheDocument();
    });
    expect(screen.queryByText("Discount:")).not.toBeInTheDocument();
  });
});

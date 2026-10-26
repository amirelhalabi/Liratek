/** @jest-environment jsdom */

/**
 * Sale Debt rows — item names (rewritten for LIRA-350, rule 24).
 *
 * The page used to resolve every Sale Debt row's items itself:
 * `getTransactionById(row.transaction_id)` then `getSaleItems(source_id)` —
 * one or two requests per row (the original bug here was passing the
 * transactions.id straight into getSaleItems). Since LIRA-350 the history
 * read carries `client_details`, built by core from the sale's saved
 * details, so this file now guards that:
 *   - the row shows the core-built line (items, quantities, discount);
 *   - the page makes NO per-row transaction / sale-item request;
 *   - a legacy row without details shows its stored note as-is;
 *   - the row's details window lists the items and the discount.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { buildClientDebtDetails } from "@liratek/core";
import Debts from "../index";

const DEBT_LEDGER_TRANSACTION_ID = 55; // transactions.id stored on the debt row
const RESOLVED_SALE_ID = 999; // sales.id the transaction actually points to

const mockGetOpenDebtItems = jest.fn().mockResolvedValue([]);
const mockGetDebtors = jest.fn();
const mockGetClientDebtHistory = jest.fn();
const mockGetTransactionById = jest.fn();
const mockGetSaleItems = jest.fn();
const mockGetClientBalance = jest.fn();
const mockGetSale = jest.fn();

// Spread the REAL module first (`jest.requireActual`) — Debts also imports
// the shared, presentation-only balance colour helpers (`BALANCE_EPS`/
// `balanceTextColor`/`combinedBalanceBucket`/`BALANCE_BORDER_COLOR`,
// `@liratek/ui`, Balance Pages colour audit 2026-08-11), which a plain
// object-literal mock like the old one here would silently turn into
// `undefined` (a `TypeError` at render). Only the pieces below need
// stubbing — everything else stays real.
// Rule 25: ONE stable object for the whole file.
const mockApi = {
  getDebtors: mockGetDebtors,
  getClientDebtHistory: mockGetClientDebtHistory,
  // LIRA-304 — open items (basket breakdown / repayment picker): none.
  getOpenDebtItems: mockGetOpenDebtItems,
  getTransactionById: mockGetTransactionById,
  getSaleItems: mockGetSaleItems,
  getClientBalance: mockGetClientBalance,
  getCustomServiceById: jest.fn(),
  getSale: mockGetSale,
  cashOut: jest.fn(),
  addRepayment: jest.fn(),
  addAccountEntry: jest.fn(),
  getClientDebtTotal: jest.fn(),
  getClients: jest.fn().mockResolvedValue([]),
};
jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
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
  };
});

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
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

const SALE_META = JSON.stringify({
  details: {
    v: 1,
    kind: "pos_sale",
    discount: { amount: 1, currency: "USD" },
    items: [
      {
        productId: 7,
        name: "iPhone 13 Screen",
        quantity: 1,
        unitPrice: 4,
        unitCost: 2,
      },
      {
        productId: 8,
        name: "Charger",
        quantity: 1,
        unitPrice: 1,
        unitCost: 0.5,
      },
    ],
  },
  payment_snapshot: {
    lines: [
      {
        method: "CUSTOMER_ACCOUNT",
        currency: "USD",
        amount: 4,
        direction: "IN",
      },
    ],
  },
});

const saleDebtRow = {
  id: 200,
  client_id: 1,
  transaction_id: DEBT_LEDGER_TRANSACTION_ID,
  transaction_type: "Sale Debt",
  amount_usd: 4,
  amount_lbp: 0,
  note: "Balance from Sale",
  created_at: "2026-07-01 10:00:00",
  created_by: null,
  session_id: null,
  client_details: buildClientDebtDetails({
    ledger: {
      transaction_type: "Sale Debt",
      amount_usd: 4,
      amount_lbp: 0,
      note: "x",
    },
    tx: {
      id: DEBT_LEDGER_TRANSACTION_ID,
      type: "SALE",
      summary: `Sale #${RESOLVED_SALE_ID}: …`,
      metadata_json: SALE_META,
      amount_usd: 4,
      amount_lbp: 0,
    },
  }),
};

describe("Debts page — Sale Debt rows read core's line (LIRA-350)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDebtors.mockResolvedValue([
      {
        id: 1,
        full_name: "Jane Doe",
        phone_number: "71234567",
        total_debt: 4,
        total_debt_usd: 4,
        total_debt_lbp: 0,
      },
    ]);
    mockGetClientDebtHistory.mockResolvedValue([saleDebtRow]);
    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: 4, balance_lbp: 0 },
    });
  });

  it("shows the items from the saved sale, with no per-row request", async () => {
    render(<Debts />);
    expect(
      await screen.findByText(
        `Sale #${RESOLVED_SALE_ID}: 1× iPhone 13 Screen, 1× Charger — $4 (discount $1)`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Balance from Sale")).not.toBeInTheDocument();
    expect(mockGetTransactionById).not.toHaveBeenCalled();
    expect(mockGetSaleItems).not.toHaveBeenCalled();
    expect(mockGetSale).not.toHaveBeenCalled();
  });

  it("a legacy row without details shows its stored note verbatim", async () => {
    const enrichedNote = "Sale #5: 1× 123 — $4 (discounted 90,000 LBP)";
    mockGetClientDebtHistory.mockResolvedValue([
      { ...saleDebtRow, note: enrichedNote, client_details: undefined },
    ]);
    render(<Debts />);
    await waitFor(() => {
      expect(screen.getByText(enrichedNote)).toBeInTheDocument();
    });
    expect(mockGetSaleItems).not.toHaveBeenCalled();
  });

  it("the row's details window lists the items and the discount", async () => {
    render(<Debts />);
    fireEvent.click(await screen.findByTitle("See details"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(`Sale #${RESOLVED_SALE_ID}`);
    expect(dialog).toHaveTextContent("iPhone 13 Screen");
    expect(dialog).toHaveTextContent("Charger");
    expect(dialog).toHaveTextContent("Discount");
    expect(dialog).toHaveTextContent("$1");
    expect(dialog.textContent).not.toMatch(/cost/i);
  });
});

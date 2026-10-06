/** @jest-environment jsdom */

/**
 * LIRA-185 expenses lead 1 — the Expenses page header ("Total USD" /
 * "Total LBP") must not count an expense that was voided from the
 * Transactions page.
 *
 * `getTodayExpenses` deliberately returns such a row flagged
 * `is_refunded = 1` (LIRA-131: the History modal badges it), so the page
 * must leave it out of its own sum. Profits and the closing report already
 * exclude it (`activeExpense()`); with the old unfiltered reduce the header
 * read $60 for one active $10 expense plus one voided $50 expense.
 *
 * Harness copied from Expenses.voidError.test.tsx (stable mockApi, rule 25).
 */

import { render, screen, waitFor } from "@testing-library/react";
import Expenses from "../index";

const mockDeleteExpense = jest.fn();
const mockGetTodayExpenses = jest.fn();
const mockAddExpense = jest.fn();

// rule 25 — a stable useApi() identity, module-level, never a fresh literal
// per render.
const mockApi = {
  deleteExpense: mockDeleteExpense,
  getTodayExpenses: mockGetTodayExpenses,
  addExpense: mockAddExpense,
};

jest.mock("@liratek/ui", () => ({
  appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
  useApi: () => mockApi,
  // LIRA-262: the page now renders the stock-use SearchBar.
  SearchBar: () => <div data-testid="search-bar" />,
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
      data-testid="category-select"
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
  MultiPaymentInput: () => <div data-testid="multi-payment-input" />,
}));

jest.mock("../components/HistoryModal", () => ({
  HistoryModal: ({ onVoid }: { onVoid: (id: number) => void }) => (
    <div data-testid="history-modal">
      <button onClick={() => onVoid(1)}>Void expense #1</button>
    </div>
  ),
}));

// Render the props the page computes, so the test reads the header totals.
jest.mock("../../../components/StatsCards", () => ({
  StatsCards: ({ totalUSD, totalLBP }: { totalUSD: number; totalLBP: number }) => (
    <div data-testid="stats-cards">
      <span data-testid="total-usd">{totalUSD}</span>
      <span data-testid="total-lbp">{totalLBP}</span>
    </div>
  ),
}));

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [{ code: "CASH", label: "Cash" }],
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ buyRate: 89000, sellRate: 90000, isLoading: false }),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("Expenses — header total excludes voided expenses", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sums only the active rows: $10 / 1,200,000 LBP, not $60", async () => {
    mockGetTodayExpenses.mockResolvedValue([
      {
        id: 1,
        description: "active",
        category: "Shop_Supply",
        amount_usd: 10,
        amount_lbp: 1_200_000,
        expense_date: "2026-10-02T12:00:00.000Z",
        status: "active",
        is_refunded: 0,
      },
      {
        id: 2,
        description: "voided from Transactions",
        category: "Shop_Supply",
        amount_usd: 50,
        amount_lbp: 300_000,
        expense_date: "2026-10-02T12:00:00.000Z",
        status: "active",
        is_refunded: 1,
      },
    ]);

    render(<Expenses />);

    await waitFor(() =>
      expect(screen.getByTestId("total-usd").textContent).not.toBe("0"),
    );
    expect(screen.getByTestId("total-usd").textContent).toBe("10");
    expect(screen.getByTestId("total-lbp").textContent).toBe("1200000");
  });
});

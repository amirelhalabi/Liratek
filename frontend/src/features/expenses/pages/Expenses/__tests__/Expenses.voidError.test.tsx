/** @jest-environment jsdom */

/**
 * Rule 19c follow-up — `Expenses/index.tsx`'s `handleVoid` had no `else`
 * branch for `result.success === false`, so a server refusal (an
 * already-voided expense, or any other business-rule refusal — the REST
 * envelope now ALWAYS answers HTTP 200 `{ success: false, error }`, so this
 * path is reachable on both desktop and web) was silently dropped: the row
 * stayed in the list with no feedback at all. Mirrors the existing pattern
 * this same page already uses on `handleAddExpense`'s failure branch
 * (`alert("Error: " + result.error)`).
 *
 * Harness mirrors CustomServices.payout.test.tsx (rule 14 — the established
 * "mock @liratek/ui + child components, drive the real page" pattern for
 * this codebase): a stable module-level `mockApi` (rule 25 — `useApi()`
 * must return a stable identity), `HistoryModal` mocked to a thin stub that
 * exposes a button calling the real `onVoid` prop passed down from the page.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

jest.mock("../../../components/StatsCards", () => ({
  StatsCards: () => <div data-testid="stats-cards" />,
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

describe("Expenses — void refusal is surfaced (rule 19c)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTodayExpenses.mockResolvedValue([]);
    window.confirm = jest.fn(() => true);
    window.alert = jest.fn();
  });

  it("alerts the server's error when the void is refused (result.success === false)", async () => {
    mockDeleteExpense.mockResolvedValue({
      success: false,
      error: "Expense already voided",
    });

    render(<Expenses />);
    await waitFor(() => expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("History"));
    fireEvent.click(await screen.findByText("Void expense #1"));

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(
        "Error: Expense already voided",
      );
    });
    // A refused void must not silently behave as a success — no extra
    // reload beyond the initial mount fetch.
    expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1);
  });

  it("reloads without alerting when the void succeeds (unchanged behavior)", async () => {
    mockDeleteExpense.mockResolvedValue({ success: true });

    render(<Expenses />);
    await waitFor(() => expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("History"));
    fireEvent.click(await screen.findByText("Void expense #1"));

    await waitFor(() => {
      expect(mockGetTodayExpenses).toHaveBeenCalledTimes(2);
    });
    expect(window.alert).not.toHaveBeenCalled();
  });
});

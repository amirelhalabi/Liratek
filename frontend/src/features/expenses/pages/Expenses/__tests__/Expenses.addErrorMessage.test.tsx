/** @jest-environment jsdom */

/**
 * `handleAddExpense`'s catch block hardcoded `alert("Failed to add
 * expense")`, discarding the real reason whenever the call THROWS (web:
 * `requestJson` throws a plain `{status,message,details}` object on any
 * non-2xx response — a staff-role 403 before LIRA-242, or any other server
 * refusal). The resolved `{success:false}` branch already surfaces
 * `result.error` (`Expenses.voidError.test.tsx`'s sibling pattern) — this
 * file guards the THROWN case, which the generic string swallowed
 * completely.
 *
 * Harness mirrors `Expenses.voidError.test.tsx` (rule 14 — established
 * pattern for this page: a stable module-level `mockApi`, minimal child
 * mocks, drive the real page).
 *
 * Rule 17: proven to fail against the pre-fix handler — the alert always
 * read "Failed to add expense", never the thrown object's real message.
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
  MultiPaymentInput: ({
    onChange,
  }: {
    onChange: (lines: { id: string; method: string; currencyCode: string; amount: number }[]) => void;
  }) => {
    // Fire once on mount with a valid single CASH/USD line (cash handed =
    // the $25 bill typed below) so handleAddExpense's guards don't block
    // the submit.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    require("react").useEffect(() => {
      onChange([{ id: "1", method: "CASH", currencyCode: "USD", amount: 25 }]);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="multi-payment-input" />;
  },
}));

jest.mock("../components/HistoryModal", () => ({
  HistoryModal: () => <div data-testid="history-modal" />,
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

describe("Expenses — add-expense failure is surfaced with the real reason", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTodayExpenses.mockResolvedValue([]);
    window.alert = jest.fn();
  });

  it("alerts the thrown object's real message (web 403 shape) instead of the generic 'Failed to add expense'", async () => {
    mockAddExpense.mockRejectedValue({
      status: 403,
      message: "Forbidden",
      details: { error: "Forbidden" },
    });

    render(<Expenses />);
    await waitFor(() => expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "Office paper" },
    });
    // Owner decision 2026-10-07: the bill is its own field now.
    fireEvent.change(screen.getByLabelText(/bill amount/i), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalled();
    });
    const alertMessage = (window.alert as jest.Mock).mock.calls[0][0] as string;
    expect(alertMessage).toContain("Forbidden");
    expect(alertMessage).not.toBe("Failed to add expense");
  });

  it("still alerts a resolved {success:false} with its own error (unchanged behavior)", async () => {
    mockAddExpense.mockResolvedValue({
      success: false,
      error: "Insufficient drawer balance",
    });

    render(<Expenses />);
    await waitFor(() => expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "Office paper" },
    });
    // Owner decision 2026-10-07: the bill is its own field now.
    fireEvent.change(screen.getByLabelText(/bill amount/i), {
      target: { value: "25" },
    });
    fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(
        "Error: Insufficient drawer balance",
      );
    });
  });
});

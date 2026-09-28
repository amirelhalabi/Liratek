/** @jest-environment jsdom */

/**
 * LIRA-247 — `Expenses/index.tsx`'s `handleVoid` catch block hardcoded
 * `alert("Failed to void expense")` on ANY thrown error, discarding the real
 * reason. `Expenses.voidError.test.tsx` (sibling file) already guards the
 * RESOLVED `{success:false}` refusal path; this file guards the THROWN
 * path — `requestJson` (web) throws a plain `{status,message,details}`
 * object on a non-2xx response (a role 403, or any other refusal surfaced
 * as a throw), which is not an `Error` instance, so `instanceof Error`
 * checks (and hardcoded fallbacks) swallow the real reason completely.
 *
 * Harness mirrors `Expenses.voidError.test.tsx` / `Expenses.addErrorMessage.test.tsx`
 * (rule 14 — established pattern for this page).
 *
 * Rule 17 note: the source fix (`getApiErrorMessage` in `handleVoid`'s catch)
 * was applied in the same LIRA-247 pass as this test, before this specific
 * test was run against the unfixed handler — so, unlike this ticket's
 * `CustomServices.advanceFulfillmentThrownError.test.tsx` (written and run
 * failing-first), this one is NOT proven failing-first. It is a straight
 * regression guard for a call site whose bug is documented and visually
 * obvious from the diff (the same hardcoded-string pattern the sibling
 * `voidError`/`addErrorMessage` tests already prove elsewhere on this page).
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

describe("Expenses — void's THROWN error is surfaced with the real reason (LIRA-247)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTodayExpenses.mockResolvedValue([]);
    window.confirm = jest.fn(() => true);
    window.alert = jest.fn();
  });

  it("alerts the thrown ApiError's real message (web 403 shape) instead of the generic 'Failed to void expense'", async () => {
    mockDeleteExpense.mockRejectedValue({
      status: 403,
      message: "Staff cannot void expenses",
      details: {},
    });

    render(<Expenses />);
    await waitFor(() => expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("History"));
    fireEvent.click(await screen.findByText("Void expense #1"));

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalled();
    });
    const alertMessage = (window.alert as jest.Mock).mock.calls[0][0] as string;
    expect(alertMessage).toContain("Staff cannot void expenses");
    expect(alertMessage).not.toBe("Failed to void expense");
  });
});

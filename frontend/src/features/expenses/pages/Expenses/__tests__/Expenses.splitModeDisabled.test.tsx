/** @jest-environment jsdom */

/**
 * LIRA-185 fix batch, part C — Expenses split-payment lead (verified by the
 * Explore-agent audit, journal wf_a89a1432-255, verify:expenses):
 *
 * "Split-payment mode: form 'Total Amount' shows only line 1 while the
 * submitted expense sums all lines (and line 2's method is dropped)".
 *
 * The audit executed the REAL `MultiPaymentInput` with the Expenses page's
 * exact prop wiring (`totals={[{amount: paymentLines[0]?.amount, currency:
 * paymentLines[0]?.currencyCode}]}`) and found: in split mode, the widget's
 * own "Total Amount" summary reflects only line 1 (it treats every line past
 * the first as an OVERPAYMENT and even offers "change" back), while
 * `handleAddExpense` sums every line's amount into `amount_usd`/`amount_lbp`
 * — and uses ONLY `paymentLines[0].method` as `paid_by_method`, silently
 * dropping a second line's own method (e.g. WHISH gets booked as CASH).
 *
 * Root cause: unlike a sale/debt, an expense has no independently-known
 * "total owed" the way `MultiPaymentInput` requires for split mode to
 * reconcile correctly — the "total" IS whatever the operator types across
 * lines, which is exactly what `totals={[...line1]}` cannot express. Fixing
 * the math would mean teaching `createExpense` (and its schema/IPC/REST
 * surfaces) to post one leg per currency+method — out of scope for a
 * frontend-only fix. Per the ticket's preferred option, SPLIT MODE IS
 * DISABLED on the Expenses page instead (`MultiPaymentInput`'s new
 * `allowSplit={false}` prop hides the Split toggle), so the page can only
 * ever submit the one line it displays — the mismatch class is made
 * unreachable rather than patched around.
 *
 * Rule 17 — proven failing-first: before the fix, `MultiPaymentInput` always
 * renders its "Split" toggle button (`data-testid="split-toggle"`) because
 * the Expenses page passed no `allowSplit` prop at all (the prop did not
 * exist). The first test below fails on the pre-fix page because the button
 * is present.
 *
 * This renders the REAL `MultiPaymentInput` from `@liratek/ui` (only
 * `useApi` is mocked) — a stubbed MultiPaymentInput (as in
 * `Expenses.addErrorMessage.test.tsx`) would hide this entire bug class,
 * same trap rule 25 describes for `useApi` identity.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Expenses from "../index";

const mockDeleteExpense = jest.fn();
const mockGetTodayExpenses = jest.fn();
const mockAddExpense = jest.fn();

const mockApi = {
  deleteExpense: mockDeleteExpense,
  getTodayExpenses: mockGetTodayExpenses,
  addExpense: mockAddExpense,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
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
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "WHISH", label: "Whish" },
    ],
    drawerAffectingMethods: [
      { code: "CASH", label: "Cash" },
      { code: "WHISH", label: "Whish" },
    ],
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

describe("Expenses — split payment mode is disabled (LIRA-185)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTodayExpenses.mockResolvedValue([]);
    mockAddExpense.mockResolvedValue({ success: true });
    window.alert = jest.fn();
  });

  it("renders no Split toggle — split mode can never be entered, so a second line's method can never be silently dropped", async () => {
    render(<Expenses />);
    await waitFor(() => expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1));

    expect(await screen.findByTestId("multi-payment-input")).toBeInTheDocument();
    expect(screen.queryByTestId("split-toggle")).not.toBeInTheDocument();
  });

  it("a single-line WHISH expense still submits WHISH (not CASH) at the typed amount — unaffected by the split-disable", async () => {
    render(<Expenses />);
    await waitFor(() => expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "Delivery fee" },
    });

    const methodSelect = await screen.findByTestId(/^payment-method-/);
    fireEvent.change(methodSelect, { target: { value: "WHISH" } });
    const amountInput = screen.getByTestId(/^payment-amount-/);
    fireEvent.change(amountInput, { target: { value: "25" } });

    fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

    await waitFor(() => expect(mockAddExpense).toHaveBeenCalled());
    const payload = mockAddExpense.mock.calls[0][0];
    expect(payload.paid_by_method).toBe("WHISH");
    expect(payload.amount_usd).toBe(25);
  });
});

/** @jest-environment jsdom */

/**
 * LIRA-310 US6 — Expenses: "the vendor accepted less". Bill $52, the
 * cashier hands $50 and the vendor takes it: Waive (in the Remaining row)
 * lowers the bill to what was handed, and the expense is recorded at $50.
 * The server (ExpenseRepository._resolveManualCash → resolveKeptChange,
 * payer "shop": handed − returned − notReturned = bill) then sees an exact
 * payment — no new server path.
 *
 * Renders the REAL MultiPaymentInput (only `useApi` is mocked, with a
 * stable module-level object — rule 25); payloads are read back through the
 * shared core schema (rule 24).
 *
 * Rule 17: written before the page wiring; red run recorded in the task
 * report.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createExpenseSchema } from "@liratek/core";
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

async function fillBill(value: string) {
  render(<Expenses />);
  await waitFor(() => expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText(/description/i), {
    target: { value: "Printer ink" },
  });
  fireEvent.change(screen.getByLabelText(/bill amount/i), {
    target: { value },
  });
}

function submittedPayload() {
  return createExpenseSchema.parse(mockAddExpense.mock.calls[0][0]);
}

describe("LIRA-310 — Expenses: Waive lowers the bill to what was handed", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTodayExpenses.mockResolvedValue([]);
    mockAddExpense.mockResolvedValue({ success: true });
    window.alert = jest.fn();
  });

  it("bill $52, handed $50 → Waive → the expense is recorded at $50", async () => {
    await fillBill("52");
    fireEvent.change(screen.getByTestId(/^payment-amount-/), {
      target: { value: "50" },
    });
    fireEvent.click(await screen.findByTestId("waive-remaining"));
    await waitFor(() =>
      expect(screen.getByLabelText(/bill amount/i)).toHaveValue("50"),
    );

    fireEvent.click(screen.getByRole("button", { name: /record expense/i }));
    await waitFor(() => expect(mockAddExpense).toHaveBeenCalled());
    const payload = submittedPayload();
    expect(payload.amount_usd).toBe(50);
    expect(payload.amount_lbp).toBe(0);
    expect(payload.payments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 50 },
    ]);
    expect(payload.kept_change_usd).toBeUndefined();
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("cents: bill $18.75, handed $18.50 → Waive → bill $18.50", async () => {
    await fillBill("18.75");
    fireEvent.change(screen.getByTestId(/^payment-amount-/), {
      target: { value: "18.5" },
    });
    fireEvent.click(await screen.findByTestId("waive-remaining"));
    await waitFor(() =>
      expect(screen.getByLabelText(/bill amount/i)).toHaveValue("18.5"),
    );
  });

  it("a gap above $5 offers no Waive (bill $56, handed $50)", async () => {
    await fillBill("56");
    fireEvent.change(screen.getByTestId(/^payment-amount-/), {
      target: { value: "50" },
    });
    expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
  });
});

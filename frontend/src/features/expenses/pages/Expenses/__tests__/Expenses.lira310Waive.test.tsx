/**
 * LIRA-310 follow-up — owner rule 2026-10-12 (binding): "Waive only when
 * money comes IN to the shop and the payer hands over a little less than
 * the total. Overpaying is never a waive — it is change or customer
 * credit." An expense is money going OUT (the shop pays a vendor), so the
 * Expenses page offers NO Waive — not even for a gap under the $5 cap.
 * (Replaces the earlier US6 "the vendor accepted less" Waive.)
 *
 * Renders the REAL MultiPaymentInput (only `useApi` is mocked, with a
 * stable module-level object — rule 25); payloads are read back through the
 * shared core schema (rule 24).
 *
 * Rule 17: rewritten before the page change; red run recorded in the
 * task report.
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

describe("LIRA-310 follow-up — Expenses: no Waive (the shop is paying)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTodayExpenses.mockResolvedValue([]);
    mockAddExpense.mockResolvedValue({ success: true });
    window.alert = jest.fn();
  });

  it("bill $52, handed $50 → the Remaining row shows but there is NO Waive", async () => {
    await fillBill("52");
    fireEvent.change(screen.getByTestId(/^payment-amount-/), {
      target: { value: "50" },
    });
    expect(await screen.findByTestId("remaining-row")).toBeInTheDocument();
    expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
    // The bill is not lowered behind the cashier's back.
    expect(screen.getByLabelText(/bill amount/i)).toHaveValue("52");
  });

  it("cents: bill $18.75, handed $18.50 → no Waive", async () => {
    await fillBill("18.75");
    fireEvent.change(screen.getByTestId(/^payment-amount-/), {
      target: { value: "18.5" },
    });
    expect(await screen.findByTestId("remaining-row")).toBeInTheDocument();
    expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
  });

  it("an exact payment still records the bill as typed", async () => {
    await fillBill("52");
    fireEvent.change(screen.getByTestId(/^payment-amount-/), {
      target: { value: "52" },
    });
    fireEvent.click(screen.getByRole("button", { name: /record expense/i }));
    await waitFor(() => expect(mockAddExpense).toHaveBeenCalled());
    const payload = submittedPayload();
    expect(payload.amount_usd).toBe(52);
    expect(payload.payments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 52 },
    ]);
  });
});

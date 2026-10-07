/** @jest-environment jsdom */

/**
 * Owner decision 2026-10-07 — Expenses get a "Bill amount" field (payer =
 * "shop", docs/FEATURE_GUIDE.md "Kept change"). Two numbers: the bill (the
 * cost) and the cash handed (the payment line). The change fields appear
 * only when the cash handed is more than the bill; the change the vendor
 * returns comes back INTO the drawer (OUT legs on the same payload), and
 * change NOT returned is added to the cost (`kept_change_*`, checked by the
 * server). Paying exactly works as before.
 *
 * Renders the REAL `MultiPaymentInput` (only `useApi` is mocked, with a
 * stable module-level object — rule 25). Every payload is read back through
 * the shared core schema, so the field names asserted are the schema's own
 * (rule 24).
 *
 * Rule 17 note: written AFTER the page change — not proven failing-first.
 * (The pre-change page had no bill field, so `getByLabelText(/bill
 * amount/i)` could not have passed; that was not run.)
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

describe("Expenses — bill amount, cash handed and change back (payer = shop)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTodayExpenses.mockResolvedValue([]);
    mockAddExpense.mockResolvedValue({ success: true });
    window.alert = jest.fn();
  });

  it("paying exactly: the cash line follows the bill, no change fields, no change legs", async () => {
    await fillBill("18.50");

    expect(screen.queryByTestId("return-change")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

    await waitFor(() => expect(mockAddExpense).toHaveBeenCalled());
    const payload = submittedPayload();
    expect(payload.amount_usd).toBe(18.5);
    expect(payload.amount_lbp).toBe(0);
    expect(payload.paid_by_method).toBe("CASH");
    expect(payload.payments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 18.5 },
    ]);
    expect(payload.kept_change_usd).toBeUndefined();
    expect(payload.kept_change_lbp).toBeUndefined();
    expect(payload.tender_exchange_rate).toBe(89000);
  });

  it("owner example: bill $18.50, hand $20, get $1 back — the $1 comes back into the drawer, $0.50 is added to the cost", async () => {
    await fillBill("18.50");

    fireEvent.change(screen.getByTestId(/^payment-amount-/), {
      target: { value: "20" },
    });
    // Overpaid → the change fields appear; the vendor hands back $1.
    expect(await screen.findByTestId("return-change")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("return-lbp"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByTestId("return-usd"), {
      target: { value: "1" },
    });
    expect(await screen.findByTestId("keep-change-summary")).toHaveTextContent(
      /added to\s+the cost/i,
    );

    fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

    await waitFor(() => expect(mockAddExpense).toHaveBeenCalled());
    const payload = submittedPayload();
    // The bill stays the bill; the server derives the $19.00 cost.
    expect(payload.amount_usd).toBe(18.5);
    expect(payload.payments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 20 },
      { method: "CASH", currencyCode: "USD", amount: 1, direction: "OUT" },
    ]);
    expect(payload.kept_change_usd).toBe(0.5);
    expect(payload.kept_change_lbp ?? 0).toBe(0);
  });

  it("refuses to submit when the cash handed is less than the bill", async () => {
    await fillBill("18.50");
    fireEvent.change(screen.getByTestId(/^payment-amount-/), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

    await waitFor(() =>
      expect(window.alert).toHaveBeenCalledWith(
        "The cash handed is less than the bill.",
      ),
    );
    expect(mockAddExpense).not.toHaveBeenCalled();
  });

  it("refuses to submit without a bill amount", async () => {
    await fillBill("");
    fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

    await waitFor(() =>
      expect(window.alert).toHaveBeenCalledWith(
        "Please enter the bill amount.",
      ),
    );
    expect(mockAddExpense).not.toHaveBeenCalled();
  });
});

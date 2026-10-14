/** @jest-environment jsdom */

/**
 * LIRA-312 (T025) — the Expenses page's "Wrong number" tick. An MTC/Alfa card
 * from iPick / Katsh / Whish App recharged onto the wrong number (noticed
 * before the sale was saved) is recorded through `recordWrongNumber`, so the
 * credits sent back can be entered later. Any other item keeps today's
 * stock-use flow.
 *
 * Rule 24: the payload's field names are checked against core's own schema.
 * Rule 25: `mockApi` is a stable module-level object.
 * Rule 17 note: written after the UI, so NOT proven failing-first.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  createStockExpenseSchema,
  recordWrongNumberSchema,
} from "@liratek/core";
import Expenses from "../index";

const mockGetTodayExpenses = jest.fn();
const mockAddExpense = jest.fn();
const mockAddStockExpense = jest.fn();
const mockRecordWrongNumber = jest.fn();
const mockGetProducts = jest.fn();
const mockGetActiveMobileServiceItems = jest.fn();

const mockApi = {
  getTodayExpenses: mockGetTodayExpenses,
  addExpense: mockAddExpense,
  deleteExpense: jest.fn(),
  addStockExpense: mockAddStockExpense,
  recordWrongNumber: mockRecordWrongNumber,
  getProducts: mockGetProducts,
  getActiveMobileServiceItems: mockGetActiveMobileServiceItems,
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
    methods: [{ code: "CASH", label: "Cash" }],
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ buyRate: 89000, sellRate: 90000, isLoading: false }),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

function catalogItem(
  id: number,
  provider: string,
  category: string,
  subcategory: string,
  label: string,
  cost_lbp: number,
) {
  return { id, provider, category, subcategory, label, cost_lbp, sell_lbp: cost_lbp + 30000 };
}

async function pick(text: string) {
  fireEvent.change(screen.getByTestId("expense-stock-search"), {
    target: { value: text.split(" · ").pop() },
  });
  fireEvent.click(await screen.findByText(text));
}

describe("Expenses — Wrong number tick (LIRA-312)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.alert = jest.fn();
    mockGetTodayExpenses.mockResolvedValue([]);
    mockGetProducts.mockResolvedValue([]);
    mockAddStockExpense.mockResolvedValue({ success: true, id: 1 });
    mockRecordWrongNumber.mockResolvedValue({
      success: true,
      data: { id: 1, expense_transaction_id: 2, status: "WAITING", remaining_loss_lbp: 770000 },
    });
    mockGetActiveMobileServiceItems.mockResolvedValue([
      catalogItem(20, "iPick", "alfa", "Prepaid", "Alfa 7.58", 770000),
      catalogItem(21, "Katsh", "Gaming", "PUBG", "60 UC", 90000),
    ]);
  });

  it("an MTC/Alfa card offers the tick; ticked, it records a wrong number — not a stock use", async () => {
    render(<Expenses />);
    await waitFor(() => expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1));
    await pick("alfa · Prepaid · Alfa 7.58");

    fireEvent.click(screen.getByLabelText(/wrong number — this card/i));
    fireEvent.change(screen.getByLabelText(/^wrong number$/i), {
      target: { value: "03 111 111" },
    });
    fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

    await waitFor(() => expect(mockRecordWrongNumber).toHaveBeenCalledTimes(1));
    expect(mockAddStockExpense).not.toHaveBeenCalled();
    expect(mockAddExpense).not.toHaveBeenCalled();

    const payload = mockRecordWrongNumber.mock.calls[0][0];
    expect(recordWrongNumberSchema.parse(payload)).toEqual(
      JSON.parse(JSON.stringify(payload)),
    );
    expect(payload).toMatchObject({
      provider: "iPick",
      mobile_service_item_id: 20,
      wrong_number: "03 111 111",
    });
    expect(payload).not.toHaveProperty("sale_transaction_id");
  });

  it("without the tick, the same card keeps today's stock-use flow", async () => {
    render(<Expenses />);
    await waitFor(() => expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1));
    await pick("alfa · Prepaid · Alfa 7.58");
    fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

    await waitFor(() => expect(mockAddStockExpense).toHaveBeenCalledTimes(1));
    expect(mockRecordWrongNumber).not.toHaveBeenCalled();
    expect(createStockExpenseSchema.parse(mockAddStockExpense.mock.calls[0][0])).toMatchObject({
      source: "IPICK",
      item_id: 20,
    });
  });

  it("no tick for an item that is not an MTC/Alfa card", async () => {
    render(<Expenses />);
    await waitFor(() => expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1));
    await pick("Gaming · PUBG · 60 UC");
    expect(screen.queryByTestId("expense-wrong-number")).not.toBeInTheDocument();
  });
});

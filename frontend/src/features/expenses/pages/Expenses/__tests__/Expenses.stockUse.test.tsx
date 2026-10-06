/** @jest-environment jsdom */

/**
 * LIRA-262 — the Expenses page's "use an item from stock" search bar (the
 * same `SearchBar` the Services page uses) lists inventory products AND the
 * Katsh / iPick / Whish App catalog (never OMT App / voucher items), and
 * picking one sends ONE stock-use payload through `useApi().addStockExpense`
 * — no amount, no payment method, and never the cash-expense `addExpense`.
 *
 * Rule 24: the payload's field names are checked against core's own schema
 * (parsed through `createStockExpenseSchema`), not hand-typed.
 * Rule 25: `mockApi` is a stable module-level object.
 * Rule 17 note: written after the UI, so NOT proven failing-first.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createStockExpenseSchema } from "@liratek/core";
import Expenses from "../index";

const mockGetTodayExpenses = jest.fn();
const mockAddExpense = jest.fn();
const mockAddStockExpense = jest.fn();
const mockGetProducts = jest.fn();
const mockGetActiveMobileServiceItems = jest.fn();

const mockApi = {
  getTodayExpenses: mockGetTodayExpenses,
  addExpense: mockAddExpense,
  deleteExpense: jest.fn(),
  addStockExpense: mockAddStockExpense,
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
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

function catalogItem(
  id: number,
  provider: string,
  category: string,
  subcategory: string,
  label: string,
  cost_lbp: number,
) {
  return {
    id,
    provider,
    category,
    subcategory,
    label,
    cost_lbp,
    sell_lbp: cost_lbp + 10000,
  };
}

async function searchFor(text: string) {
  fireEvent.change(screen.getByTestId("expense-stock-search"), {
    target: { value: text },
  });
}

describe("Expenses — use an item from the shop's own stock (LIRA-262)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.alert = jest.fn();
    mockGetTodayExpenses.mockResolvedValue([]);
    mockAddStockExpense.mockResolvedValue({ success: true, id: 1 });
    mockGetProducts.mockResolvedValue([
      {
        id: 3,
        name: "Printer paper 60g",
        cost_price_usd: 2.5,
        stock_quantity: 9,
      },
    ]);
    mockGetActiveMobileServiceItems.mockResolvedValue([
      catalogItem(10, "Katsh", "Gaming", "PUBG", "60 UC", 90000),
      catalogItem(11, "iPick", "Gaming", "Free Fire", "60 Diamonds", 80000),
      catalogItem(12, "WHISH_APP", "Apps", "Netflix", "60 days", 500000),
      catalogItem(13, "OMT_APP", "Gaming", "PUBG", "60 UC OMT", 90000),
      catalogItem(14, "VOUCHER", "Cards", "Touch", "60 voucher", 90000),
    ]);
  });

  it("lists inventory products and Katsh / iPick / Whish App items — not OMT App or voucher items", async () => {
    render(<Expenses />);
    await waitFor(() => expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1));

    await searchFor("60");

    expect(await screen.findByText("Printer paper 60g")).toBeInTheDocument();
    expect(screen.getByText("Gaming · PUBG · 60 UC")).toBeInTheDocument();
    expect(
      screen.getByText("Gaming · Free Fire · 60 Diamonds"),
    ).toBeInTheDocument();
    expect(screen.getByText("Apps · Netflix · 60 days")).toBeInTheDocument();
    expect(screen.queryByText(/60 UC OMT/)).not.toBeInTheDocument();
    expect(screen.queryByText(/60 voucher/)).not.toBeInTheDocument();
    expect(mockGetProducts).toHaveBeenCalledWith("60");
  });

  it("picking a Katsh item sends one KATSH stock-use payload with the quantity — no amount, no cash expense", async () => {
    render(<Expenses />);
    await waitFor(() => expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1));

    await searchFor("60");
    fireEvent.click(await screen.findByText("Gaming · PUBG · 60 UC"));

    // The payment section is gone — no cash moves for shop use.
    expect(screen.getByTestId("expense-stock-pick")).toBeInTheDocument();
    expect(screen.queryByTestId(/^payment-amount-/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/quantity/i), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

    await waitFor(() => expect(mockAddStockExpense).toHaveBeenCalledTimes(1));
    expect(mockAddExpense).not.toHaveBeenCalled();

    const payload = mockAddStockExpense.mock.calls[0][0];
    // Every key the page sends survives the shared schema unchanged — no
    // drifted/stripped field (rules 23/24).
    expect(createStockExpenseSchema.parse(payload)).toEqual(
      JSON.parse(JSON.stringify(payload)),
    );
    expect(payload).toMatchObject({
      source: "KATSH",
      item_id: 10,
      quantity: 2,
      category: "Shop_Supply",
    });
    expect(payload).not.toHaveProperty("amount_lbp");
    expect(payload).not.toHaveProperty("paid_by_method");
  });

  it("picking an inventory product sends an INVENTORY payload", async () => {
    render(<Expenses />);
    await waitFor(() => expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1));

    await searchFor("60");
    fireEvent.click(await screen.findByText("Printer paper 60g"));
    fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

    await waitFor(() => expect(mockAddStockExpense).toHaveBeenCalledTimes(1));
    const payload = mockAddStockExpense.mock.calls[0][0];
    expect(createStockExpenseSchema.parse(payload)).toMatchObject({
      source: "INVENTORY",
      item_id: 3,
      quantity: 1,
    });
  });
});

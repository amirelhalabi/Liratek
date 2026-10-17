/** @jest-environment jsdom */

/**
 * LIRA-331 (T047, research R9): the Expenses page sends the SAME payload
 * whether the screen is in English or Arabic. Translation must never reach
 * a payload field, an option value, a stored category or a comparison.
 *
 * Every sub-type the page books is walked (rule 28d): a cash expense paid
 * exactly, one overpaid with change handed back and some not returned, an
 * LBP bill, shop use of an inventory item, shop use of a catalog card, and
 * a wrong-number card. Each scenario runs once at `en` and once at `ar`
 * through the real page and the real MultiPaymentInput, selecting only by
 * test id / input id (never by English text), and the two captured payloads
 * must be deep-equal. Each one is also parsed through the core schema, so
 * the field names are the schema's own (rule 24).
 *
 * Rule 17: not failing-first (guard against future drift). It passes before
 * the conversion by nature; it exists so a later `t()` in a payload fails.
 * Rule 25: `mockApi` is a stable module-level object.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import {
  createExpenseSchema,
  createStockExpenseSchema,
  recordWrongNumberSchema,
} from "@liratek/core";
import { i18n, loadLanguage } from "@/i18n/setup";
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

type Lang = "en" | "ar";

async function setLang(lang: Lang) {
  if (lang === "ar") await loadLanguage("ar");
  await i18n.changeLanguage(lang);
}

async function renderPage() {
  const view = render(<Expenses />);
  await waitFor(() => expect(mockGetTodayExpenses).toHaveBeenCalled());
  return view;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not rendered`);
  return el as T;
}

function record() {
  fireEvent.click(screen.getByTestId("expense-record"));
}

async function fillCash(description: string, bill: string) {
  await renderPage();
  fireEvent.change(byId("expense-description"), {
    target: { value: description },
  });
  fireEvent.change(screen.getByTestId("expense-bill-amount"), {
    target: { value: bill },
  });
}

async function pickStock(search: string, text: string) {
  await renderPage();
  fireEvent.change(screen.getByTestId("expense-stock-search"), {
    target: { value: search },
  });
  fireEvent.click(await screen.findByText(text));
}

interface Scenario {
  name: string;
  run: () => Promise<unknown>;
}

const SCENARIOS: Scenario[] = [
  {
    name: "cash expense, USD bill paid exactly",
    run: async () => {
      await fillCash("Printer ink", "18.50");
      record();
      await waitFor(() => expect(mockAddExpense).toHaveBeenCalledTimes(1));
      return createExpenseSchema.parse(mockAddExpense.mock.calls[0][0]);
    },
  },
  {
    name: "cash expense, $18.50 bill, $20 handed, $1 back, $0.50 kept",
    run: async () => {
      await fillCash("Coffee", "18.50");
      fireEvent.change(screen.getByTestId(/^payment-amount-/), {
        target: { value: "20" },
      });
      await screen.findByTestId("return-change");
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "" },
      });
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "1" },
      });
      await screen.findByTestId("keep-change-summary");
      record();
      await waitFor(() => expect(mockAddExpense).toHaveBeenCalledTimes(1));
      return createExpenseSchema.parse(mockAddExpense.mock.calls[0][0]);
    },
  },
  {
    name: "cash expense, LBP bill",
    run: async () => {
      await renderPage();
      fireEvent.click(screen.getByTestId("expense-bill-currency-LBP"));
      fireEvent.change(byId("expense-description"), {
        target: { value: "Generator" },
      });
      fireEvent.change(screen.getByTestId("expense-bill-amount"), {
        target: { value: "900000" },
      });
      record();
      await waitFor(() => expect(mockAddExpense).toHaveBeenCalledTimes(1));
      return createExpenseSchema.parse(mockAddExpense.mock.calls[0][0]);
    },
  },
  {
    name: "shop use of an inventory item, quantity 2",
    run: async () => {
      await pickStock("Printer", "Printer paper 60g");
      fireEvent.change(byId("expense-stock-qty"), { target: { value: "2" } });
      record();
      await waitFor(() =>
        expect(mockAddStockExpense).toHaveBeenCalledTimes(1),
      );
      return createStockExpenseSchema.parse(
        mockAddStockExpense.mock.calls[0][0],
      );
    },
  },
  {
    name: "shop use of a catalog card",
    run: async () => {
      await pickStock("60 UC", "Gaming · PUBG · 60 UC");
      record();
      await waitFor(() =>
        expect(mockAddStockExpense).toHaveBeenCalledTimes(1),
      );
      return createStockExpenseSchema.parse(
        mockAddStockExpense.mock.calls[0][0],
      );
    },
  },
  {
    name: "wrong-number card with the number typed",
    run: async () => {
      await pickStock("Alfa 7.58", "alfa · Prepaid · Alfa 7.58");
      const tick = screen
        .getByTestId("expense-wrong-number")
        .querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (!tick) throw new Error("no wrong-number tick");
      fireEvent.click(tick);
      fireEvent.change(byId("expense-wrong-number"), {
        target: { value: "03 111 111" },
      });
      record();
      await waitFor(() =>
        expect(mockRecordWrongNumber).toHaveBeenCalledTimes(1),
      );
      const raw = mockRecordWrongNumber.mock.calls[0][0];
      recordWrongNumberSchema.parse(raw);
      return raw;
    },
  },
];

async function runIn(lang: Lang, scenario: Scenario): Promise<unknown> {
  jest.clearAllMocks();
  mockGetTodayExpenses.mockResolvedValue([]);
  mockAddExpense.mockResolvedValue({ success: true });
  mockAddStockExpense.mockResolvedValue({ success: true, id: 1 });
  mockRecordWrongNumber.mockResolvedValue({ success: true, data: { id: 1 } });
  mockGetProducts.mockResolvedValue([
    { id: 3, name: "Printer paper 60g", cost_price_usd: 2.5, stock_quantity: 9 },
  ]);
  mockGetActiveMobileServiceItems.mockResolvedValue([
    {
      id: 20,
      provider: "iPick",
      category: "alfa",
      subcategory: "Prepaid",
      label: "Alfa 7.58",
      cost_lbp: 770000,
      sell_lbp: 800000,
    },
    {
      id: 21,
      provider: "Katsh",
      category: "Gaming",
      subcategory: "PUBG",
      label: "60 UC",
      cost_lbp: 90000,
      sell_lbp: 100000,
    },
  ]);
  window.alert = jest.fn();
  await setLang(lang);
  const payload = await scenario.run();
  expect(window.alert).not.toHaveBeenCalled();
  cleanup();
  return payload;
}

describe("Expenses — the payload is the same in English and Arabic (LIRA-331)", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  it.each(SCENARIOS.map((s) => [s.name, s] as const))(
    "%s",
    async (_name, scenario) => {
      const en = await runIn("en", scenario);
      const ar = await runIn("ar", scenario);
      expect(ar).toEqual(en);
    },
  );

  it("the ar run really renders Arabic (the comparison is not English vs English)", async () => {
    await setLang("ar");
    await renderPage();
    expect(screen.getByTestId("expense-record")).toHaveTextContent("تسجيل المصروف");
  });
});

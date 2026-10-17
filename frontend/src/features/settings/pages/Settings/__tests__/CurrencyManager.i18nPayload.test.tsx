/** @jest-environment jsdom */
/**
 * LIRA-331 — currency, rate and drawer-currency payloads must not depend on
 * the display language. Drives the real CurrencyManager through add rate
 * (weaker and stronger), edit rate, a drawer-currency toggle + save, add
 * currency, a module change + save and the active toggle, once in English and
 * once in Arabic, and asserts the captured api calls are deep-equal (codes and
 * numbers, never a label). A second case types the rates in Arabic-Indic
 * digits, which must save as the same numbers.
 *
 * Selectors are input ids, stored codes and structure, so the same steps work
 * in both languages.
 *
 * Written before CurrencyManager was converted. NOT RUN when written: the
 * owner paused all test runs until every LIRA-331 agent finishes, so neither
 * case has been seen passing or failing yet.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import CurrencyManager from "../CurrencyManager";

const mockApi = {
  getAllDrawerCurrencies: jest.fn(),
  setDrawerCurrencies: jest.fn(),
  getCurrencies: jest.fn(),
  getRates: jest.fn(),
  setRate: jest.fn(),
  deleteRate: jest.fn(),
  getToggleableModules: jest.fn(),
  getModulesForCurrency: jest.fn(),
  createCurrency: jest.fn(),
  updateCurrency: jest.fn(),
  deleteCurrency: jest.fn(),
  setModulesForCurrency: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));
jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: jest.fn(),
}));

const CURRENCIES = [
  { id: 1, code: "USD", name: "US Dollar", symbol: "$", decimal_places: 2, is_active: 1 },
  { id: 2, code: "LBP", name: "Lebanese Pound", symbol: "LBP", decimal_places: 0, is_active: 1 },
  { id: 3, code: "EUR", name: "Euro", symbol: "€", decimal_places: 2, is_active: 1 },
];
const RATES = [
  {
    id: 1,
    to_code: "LBP",
    market_rate: 89500,
    buy_rate: 89000,
    sell_rate: 90000,
    is_stronger: 1,
    updated_at: "2026-10-01 10:00:00",
  },
];

/** The rate modal: [code?] + market, buy, sell inputs; [cancel, save]. */
function modal(): HTMLElement {
  return document.querySelector(".fixed.inset-0") as HTMLElement;
}
function rateInputs(): HTMLInputElement[] {
  return Array.from(modal().querySelectorAll("input")) as HTMLInputElement[];
}
function modalSave() {
  const buttons = modal().querySelectorAll(".flex.gap-2.pt-2 > button");
  fireEvent.click(buttons[buttons.length - 1]!);
}

async function runFlow(rates: {
  market: string;
  buy: string;
  sell: string;
}): Promise<unknown[][]> {
  jest.clearAllMocks();
  mockApi.getCurrencies.mockResolvedValue(CURRENCIES);
  mockApi.getRates.mockResolvedValue(RATES);
  mockApi.getAllDrawerCurrencies.mockResolvedValue({ MTC: ["USD"] });
  mockApi.getToggleableModules.mockResolvedValue([
    { key: "pos", label: "Point of Sale" },
    { key: "debts", label: "Debts" },
  ]);
  mockApi.getModulesForCurrency.mockResolvedValue(["pos"]);
  for (const fn of [
    mockApi.setRate,
    mockApi.setDrawerCurrencies,
    mockApi.createCurrency,
    mockApi.updateCurrency,
    mockApi.setModulesForCurrency,
  ])
    fn.mockResolvedValue({ success: true });

  const { unmount, container } = render(<CurrencyManager />);
  await screen.findByText("Lebanese Pound");

  // 1. Add a stronger-than-USD rate (GBP): add button is in the rates header
  //    row, the strength Select's second option is "stronger" (-1).
  //    The rates section is the root's first child.
  await screen.findAllByText("LBP");
  const ratesSection = container.firstElementChild!
    .firstElementChild as HTMLElement;
  const addRate = ratesSection.querySelector(
    ":scope > .flex.items-center.justify-between button",
  ) as HTMLElement;
  fireEvent.click(addRate);
  const [codeInput] = rateInputs();
  fireEvent.change(codeInput!, { target: { value: "gbp" } });
  fireEvent.click(within(modal()).getAllByRole("button")[0]!); // Select trigger
  fireEvent.click((await screen.findAllByRole("option"))[1]!);
  const [, market, buy, sell] = rateInputs();
  fireEvent.change(market!, { target: { value: rates.market } });
  fireEvent.change(buy!, { target: { value: rates.buy } });
  fireEvent.change(sell!, { target: { value: rates.sell } });
  modalSave();
  await waitFor(() => expect(mockApi.setRate).toHaveBeenCalledTimes(1));

  // 2. Edit the LBP rate: its row's first action button.
  await waitFor(() => expect(modal()).toBeNull());
  const lbpRow = screen
    .getAllByText("LBP")
    .map((el) => el.closest("tr"))
    .find((tr) => tr !== null)!;
  const rowButtons = lbpRow.querySelectorAll("td:last-child button");
  fireEvent.click(rowButtons[0]!);
  const [eMarket, eBuy, eSell] = rateInputs();
  fireEvent.change(eMarket!, { target: { value: "89600" } });
  fireEvent.change(eBuy!, { target: { value: "89100" } });
  fireEvent.change(eSell!, { target: { value: "90100" } });
  modalSave();
  await waitFor(() => expect(mockApi.setRate).toHaveBeenCalledTimes(2));

  // 3. Drawer currencies: tick LBP on the MTC card, then save.
  const mtcCard = (await screen.findAllByRole("heading", { level: 4 }))
    .map((h) => h.parentElement!)
    .find((card) => within(card).queryByRole("button", { name: "LBP" }))!;
  fireEvent.click(within(mtcCard).getByRole("button", { name: "LBP" }));
  const drawerSection = mtcCard.closest(".space-y-3") as HTMLElement;
  const saveBar = drawerSection.querySelector(
    ":scope > .flex.items-center.justify-between",
  ) as HTMLElement;
  const barButtons = saveBar.querySelectorAll("button");
  fireEvent.click(barButtons[barButtons.length - 1]!);
  await waitFor(() =>
    expect(mockApi.setDrawerCurrencies).toHaveBeenCalledTimes(1),
  );

  // 4. Add a currency: the currencies header (the root's own header row
  //    holding an h3) has the button that opens the form.
  const currenciesHeader = Array.from(
    container.firstElementChild!.querySelectorAll(
      ":scope > .flex.items-center.justify-between",
    ),
  ).find((row) => row.querySelector("h3")) as HTMLElement;
  fireEvent.click(currenciesHeader.querySelector("button")!);
  await waitFor(() =>
    expect(document.getElementById("currency-code")).not.toBeNull(),
  );
  fireEvent.change(document.getElementById("currency-code")!, {
    target: { value: "try" },
  });
  fireEvent.change(document.getElementById("currency-name")!, {
    target: { value: "Turkish Lira" },
  });
  fireEvent.change(document.getElementById("currency-symbol")!, {
    target: { value: "₺" },
  });
  fireEvent.change(document.getElementById("currency-decimals")!, {
    target: { value: "2" },
  });
  // The add form's wrapper (the input itself also carries rounded-lg).
  const addForm = document
    .getElementById("currency-code")!
    .closest(".space-y-3") as HTMLElement;
  const addButtons = addForm.querySelectorAll("button");
  fireEvent.click(addButtons[addButtons.length - 1]!);
  await waitFor(() => expect(mockApi.createCurrency).toHaveBeenCalledTimes(1));
  await screen.findByText("Euro");

  // 5. Deactivate EUR: the card's first action button.
  const eurCard = screen.getByText("Euro").closest(".rounded-lg") as HTMLElement;
  fireEvent.click(eurCard.querySelectorAll(".shrink-0 > button")[0]!);
  await waitFor(() => expect(mockApi.updateCurrency).toHaveBeenCalledTimes(1));
  await screen.findByText("Euro");

  // 6. Enable "debts" for EUR in its module picker, then save.
  const eurCard2 = screen.getByText("Euro").closest(".rounded-lg") as HTMLElement;
  const picker = eurCard2.querySelector(".mt-3 button") as HTMLElement;
  fireEvent.click(picker);
  const dropdown = document.querySelector(".fixed.z-\\[9999\\]") as HTMLElement;
  const options = dropdown.querySelectorAll(":scope > button");
  fireEvent.click(options[1]!);
  const stickyBar = document.querySelector(".sticky.bottom-0") as HTMLElement;
  const stickyButtons = stickyBar.querySelectorAll("button");
  fireEvent.click(stickyButtons[stickyButtons.length - 1]!);
  await waitFor(() =>
    expect(mockApi.setModulesForCurrency).toHaveBeenCalled(),
  );

  const calls = [
    ...mockApi.setRate.mock.calls.map((c) => ["setRate", ...c]),
    ...mockApi.setDrawerCurrencies.mock.calls.map((c) => ["drawer", ...c]),
    ...mockApi.createCurrency.mock.calls.map((c) => ["create", ...c]),
    ...mockApi.updateCurrency.mock.calls.map((c) => ["update", ...c]),
    ...mockApi.setModulesForCurrency.mock.calls.map((c) => ["modules", ...c]),
  ];
  unmount();
  return calls;
}

async function inLanguage(
  lang: "en" | "ar",
  rates = { market: "1.27", buy: "1.25", sell: "1.29" },
) {
  await loadLanguage(lang);
  await i18n.changeLanguage(lang);
  return runFlow(rates);
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("CurrencyManager — payloads are identical in English and Arabic", () => {
  it("rates, drawer currencies, currencies and modules", async () => {
    const en = await inLanguage("en");
    const ar = await inLanguage("ar");
    expect(ar).toEqual(en);
    expect(en).toEqual([
      [
        "setRate",
        { to_code: "GBP", market_rate: 1.27, buy_rate: 1.25, sell_rate: 1.29, is_stronger: -1 },
      ],
      [
        "setRate",
        { to_code: "LBP", market_rate: 89600, buy_rate: 89100, sell_rate: 90100, is_stronger: 1 },
      ],
      ["drawer", "MTC", ["USD", "LBP"]],
      ["create", "TRY", "Turkish Lira", "₺", 2],
      ["update", 3, { is_active: 0 }],
      ["modules", "EUR", ["pos", "debts"]],
    ]);
  });

  it("rates typed in Arabic-Indic digits save as the same numbers", async () => {
    const en = await inLanguage("en");
    const ar = await inLanguage("ar", {
      market: "١٫٢٧",
      buy: "١٫٢٥",
      sell: "١٫٢٩",
    });
    expect(ar).toEqual(en);
  });
});

/** @jest-environment jsdom */
/**
 * CurrencyManager → "Drawer Currencies" grid
 * (docs/plans/todo_plans/GENERAL_DRAWER_UNRESTRICTED.md, Phase 3 item 7).
 *
 * Two things this screen must now get right:
 *
 * 1. **General is omitted.** It accepts every currency (Exchange deposits any
 *    currency into it), so its set is derived and the backend REFUSES any
 *    write to it. Rendering a General card meant showing checkboxes that could
 *    not do anything: the save was rejected and `load()` silently reloaded them
 *    back to all-ticked, which reads as a broken screen. A footnote replaces
 *    the card so the omission is explained rather than mysterious.
 *
 * 2. **A refused save says why.** The result envelope used to be discarded, so
 *    the ONLY feedback for a rejected save was the checkbox snapping back.
 *    That matters because of what the rejection protects: removing a currency
 *    a drawer still holds used to strip its count field at closing while the
 *    balance stayed on the Dashboard — a permanent silent variance. The live
 *    example (2026-08-22) was Katsh holding 2,957,925 LBP, which is the
 *    fixture below.
 *
 * Interaction-level per the LIRA-097/LIRA-120 lesson: these drive real DOM
 * clicks, not props.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

import CurrencyManager from "../CurrencyManager";

const mockSetDrawerCurrencies = jest.fn();
const mockGetAllDrawerCurrencies = jest.fn();

// STABLE object reference — CurrencyManager's load() is a useCallback; a fresh
// object literal per useApi() call would re-trigger the load effect forever.
const mockApi = {
  getAllDrawerCurrencies: mockGetAllDrawerCurrencies,
  setDrawerCurrencies: mockSetDrawerCurrencies,
  getCurrencies: jest.fn(),
  getRates: jest.fn().mockResolvedValue([]),
  setRate: jest.fn().mockResolvedValue({ success: true }),
  deleteRate: jest.fn().mockResolvedValue({ success: true }),
  getToggleableModules: jest.fn().mockResolvedValue([]),
  getModulesForCurrency: jest.fn().mockResolvedValue([]),
  createCurrency: jest.fn().mockResolvedValue({ success: true }),
  updateCurrency: jest.fn().mockResolvedValue({ success: true }),
  deleteCurrency: jest.fn().mockResolvedValue({ success: true }),
  setModulesForCurrency: jest.fn().mockResolvedValue({ success: true }),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: jest.fn(),
}));

const CURRENCIES = [
  {
    id: 1,
    code: "USD",
    name: "US Dollar",
    symbol: "$",
    decimal_places: 2,
    is_active: 1,
  },
  {
    id: 2,
    code: "LBP",
    name: "Lebanese Pound",
    symbol: "LBP",
    decimal_places: 0,
    is_active: 1,
  },
  {
    id: 3,
    code: "EUR",
    name: "Euro",
    symbol: "€",
    decimal_places: 2,
    is_active: 1,
  },
];

// Mirrors the live DB: General derives its set (so the backend reports every
// active currency for it), Katsh and Binance keep real allowlists.
const DRAWER_CONFIG = {
  General: ["EUR", "LBP", "USD"],
  Katsh: ["LBP", "USD"],
  Binance: ["USDT"],
};

/** The card element for a drawer, located via its heading. */
function drawerCard(label: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: label, level: 4 });
  const card = heading.parentElement;
  if (!card) throw new Error(`No card found for drawer "${label}"`);
  return card;
}

describe("CurrencyManager — Drawer Currencies grid", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllDrawerCurrencies.mockResolvedValue(DRAWER_CONFIG);
    mockApi.getCurrencies.mockResolvedValue(CURRENCIES);
    mockSetDrawerCurrencies.mockResolvedValue({ success: true });
  });

  it("omits the General drawer but still renders the configurable ones", async () => {
    render(<CurrencyManager />);

    // Configurable provider drawers are present...
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Katsh", level: 4 }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("heading", { name: "Binance", level: 4 }),
    ).toBeInTheDocument();

    // ...General is NOT a card, even though the backend reports it.
    expect(
      screen.queryByRole("heading", { name: "General", level: 4 }),
    ).not.toBeInTheDocument();
  });

  it("explains the omission instead of leaving General mysteriously absent", async () => {
    render(<CurrencyManager />);

    await waitFor(() => {
      expect(
        screen.getByText(/accepts every currency, so there is nothing/i),
      ).toBeInTheDocument();
    });
  });

  it("surfaces the reason when a save is refused, rather than silently reverting", async () => {
    mockSetDrawerCurrencies.mockResolvedValue({
      success: false,
      error:
        "Cannot remove LBP (2,957,925) from Katsh — the drawer still holds that balance. Move or spend it first, then remove the currency.",
    });

    render(<CurrencyManager />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Katsh", level: 4 }),
      ).toBeInTheDocument();
    });

    // Untick LBP on Katsh — the exact one-click action that used to strand
    // 2,957,925 LBP out of the closing count sheet.
    fireEvent.click(
      within(drawerCard("Katsh")).getByRole("button", { name: "LBP" }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(screen.getByText(/still holds that balance/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Cannot remove LBP/i)).toBeInTheDocument();
  });

  it("shows no error banner when the save succeeds", async () => {
    render(<CurrencyManager />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Katsh", level: 4 }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      within(drawerCard("Katsh")).getByRole("button", { name: "LBP" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(mockSetDrawerCurrencies).toHaveBeenCalledWith("Katsh", ["USD"]);
    });
    expect(screen.queryByText(/Cannot remove/i)).not.toBeInTheDocument();
  });
});

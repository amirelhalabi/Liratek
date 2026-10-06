/** @jest-environment jsdom */

/**
 * Exchange page — default direction (LIRA-261, owner 2026-10-06).
 *
 * "When the Exchange page opens, the direction must be pre-selected
 * From USD → To LBP."
 *
 * Before this change the page seeded its pair from `activeCurrencies[0]` →
 * `activeCurrencies[1]`, i.e. whatever order the currency settings returned.
 * There is no remembered/last-used pair (no storage, no URL, no setting), so
 * USD → LBP is now the plain default whenever both are active; if either is
 * inactive the old first-two fallback still applies.
 */

import { render, screen, waitFor, within } from "@testing-library/react";

jest.mock("@liratek/core", () => ({
  TAKE_USD: -1,
  isLotTrackedCurrency: (code: string) => !["USD", "LBP"].includes(code),
  convertFromUSD: () => ({ amountOut: 0, rate: 1 }),
  calculateExchange: () => {
    throw new Error("not exercised");
  },
  calculateAmountInForTarget: () => 0,
  computeOverrideLegProfitUsd: () => 0,
}));

import Exchange from "../index";

const mockGetRates = jest.fn().mockResolvedValue([]);
const mockUseApiReturn = {
  getRates: mockGetRates,
  getExchangeHistory: jest.fn().mockResolvedValue([]),
  addExchangeTransaction: jest.fn(),
  exchangeLots: {
    preview: jest
      .fn()
      .mockResolvedValue({ lotTracked: false, reason: "NO_RATE_ANCHOR" }),
  },
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockUseApiReturn,
}));

jest.mock("@/features/recharge/components/PaymentSheet", () => ({
  PaymentSheet: () => null,
}));

// Rule 25: stable references. The array is mutated IN PLACE per test so the
// context value keeps one identity across renders.
const mockActiveCurrencies: Array<{ code: string; name: string }> = [];
const mockCurrencyContext = {
  activeCurrencies: mockActiveCurrencies,
  getDecimals: (c: string) => (c === "LBP" ? 0 : 2),
};
jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => mockCurrencyContext,
}));

const mockSessionContext = { activeSession: null, linkTransaction: jest.fn() };
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => mockSessionContext,
}));
jest.mock("@/features/sessions/hooks/useSessionAutoFill", () => ({
  useSessionAutoFill: jest.fn(),
}));

const mockPaymentMethods = {
  methods: [{ code: "CASH", label: "Cash" }],
  drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
};
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => mockPaymentMethods,
}));

jest.mock("@/utils/liveExchangeRates", () => ({
  fetchLiveCurrencyRates: jest.fn().mockResolvedValue([]),
  fetchLiveRatesSnapshot: jest.fn().mockResolvedValue({
    raw: {},
    rates: [],
    marketRates: [],
    lastUpdatedUtc: "Fri, 31 Jul 2026 00:02:31 +0000",
    nextUpdateUnix: 1785543661,
  }),
  CURRENCY_NAMES: { USD: "US Dollar", LBP: "Lebanese Pound" },
  EXCLUDED_CURRENCIES: new Set(["USD", "LBP", "EUR"]),
  getCurrencySymbol: (code: string) =>
    ({ USD: "$", LBP: "LBP", EUR: "€" })[code] ?? code,
}));

jest.mock("@/features/partners/components/ForPartnerToggle", () => ({
  ForPartnerToggle: () => null,
  ForPartnerNotice: () => null,
}));
jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));
jest.mock("../components/HistoryModal", () => ({ HistoryModal: () => null }));
jest.mock("../components/PositionsPanel", () => ({
  PositionsPanel: () => null,
}));
jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

function setActive(codes: string[]) {
  mockActiveCurrencies.length = 0;
  for (const code of codes) mockActiveCurrencies.push({ code, name: code });
}

/** The selector block under the "From"/"To" caption. */
function selectorFor(caption: "From" | "To"): HTMLElement {
  const label = screen.getByText(caption, { selector: "span" });
  return label.parentElement as HTMLElement;
}

/** The selected button is the one carrying the "selected" styling. */
function selectedCode(caption: "From" | "To"): string | null {
  const selected = within(selectorFor(caption))
    .getAllByRole("button")
    .find((b) => b.className.includes("bg-slate-700"));
  return selected?.textContent?.trim() ?? null;
}

async function renderExchange() {
  render(<Exchange />);
  await waitFor(() => expect(mockGetRates).toHaveBeenCalled());
}

describe("Exchange page — default direction (LIRA-261)", () => {
  it("opens on USD → LBP even when settings list another currency first", async () => {
    setActive(["EUR", "LBP", "USD"]);
    await renderExchange();
    await waitFor(() => expect(selectedCode("From")).toBe("USD"));
    expect(selectedCode("To")).toBe("LBP");
  });

  it("opens on USD → LBP when settings list LBP before USD", async () => {
    setActive(["LBP", "USD"]);
    await renderExchange();
    await waitFor(() => expect(selectedCode("From")).toBe("USD"));
    expect(selectedCode("To")).toBe("LBP");
  });

  it("falls back to the first two active currencies when LBP is not active", async () => {
    setActive(["EUR", "USD"]);
    await renderExchange();
    await waitFor(() => expect(selectedCode("To")).toBe("USD"));
    // EUR lives in the "More" dropdown, whose trigger shows the code once picked.
    expect(selectedCode("From")).toBe("EUR");
  });
});

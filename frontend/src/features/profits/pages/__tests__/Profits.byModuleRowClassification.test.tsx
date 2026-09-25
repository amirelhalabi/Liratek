/** @jest-environment jsdom */

/**
 * PA-4.23 (a) — owner decision 2026-09-24 (OWNER_NOTES_2026-09-21.md §6.9).
 * The By Module expandable detail row must render one of three things per
 * currency, decided by `classifyProfitModuleRow` (`@liratek/core`,
 * `packages/core/src/constants/profitRowClass.ts`):
 *   - a real revenue/cost module (SALE, RECHARGE_*, ...): the
 *     Revenue − Cost = Profit equation (unchanged from before this ticket).
 *   - a pass-through/commission module (a FINANCIAL_SERVICE_* row whose
 *     provider is a real commission provider — OMT/WHISH/OMT_APP/WHISH_APP/
 *     BINANCE — or LOTO): a bare "Commission: <amount>" line, NOT an
 *     equation — the "revenue" there is a transfer's principal or a
 *     ticket's face value, not the shop's real revenue. A FINANCIAL_SERVICE_*
 *     row for a cost/price MOBILE provider (iPick/Katsh/BOB) and EXCHANGE
 *     (a spread, cost = revenue − profit by construction) are NOT commission
 *     rows — PFU-a-2/PFU-a-4 — and still render the equation.
 *   - a profit-only module (KEPT_CHANGE, COUNTERPARTY_DISCOUNT,
 *     SUPPLIER_COMMISSION, TOPUP_BUYBACK): a bare "Profit: <amount>" line,
 *     never "0 − 0 = X".
 *
 * Drives the REAL `Profits` page (only `useApi`, `useModules` and
 * `useCurrencyContext` mocked) — same harness as
 * `Profits.auditBatchLO.byModule.test.tsx`.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Profits from "../Profits";

const mockGetProfitByModule = jest.fn();
const mockGetProfitSummary = jest.fn().mockResolvedValue(null);

const mockApi = {
  getProfitByModule: mockGetProfitByModule,
  getProfitSummary: mockGetProfitSummary,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/contexts/ModuleContext", () => ({
  useModules: () => ({ isModuleEnabled: () => true }),
}));

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    formatAmount: (v: number, c: string) => `${v} ${c}`,
  }),
}));

jest.mock("../../../dashboard/components/CommissionsChart", () => ({
  __esModule: true,
  default: () => null,
}));

async function renderByModule() {
  const utils = render(<Profits />);
  fireEvent.click(screen.getByText("By Module"));
  await waitFor(() =>
    expect(mockGetProfitByModule).toHaveBeenCalledTimes(1),
  );
  await waitFor(() =>
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument(),
  );
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Profits By Module — PA-4.23 (a) row-class-aware expanded detail", () => {
  it("still renders the Revenue − Cost = Profit equation for a real revenue/cost module (SALE)", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "SALE",
        label: "Product Sales",
        revenue_usd: 45,
        revenue_lbp: 0,
        cost_usd: 30,
        cost_lbp: 0,
        profit_usd: 15,
        profit_lbp: 0,
        count: 1,
        margin_pct: 33.3,
        margin_converted: false,
      },
    ]);

    await renderByModule();
    fireEvent.click(screen.getByTestId("by-module-expand-SALE"));

    const usd = await screen.findByTestId("by-module-detail-SALE-usd");
    expect(usd.textContent).toContain("45 USD");
    expect(usd.textContent).toContain("30 USD");
    expect(usd.textContent).toContain("15 USD");
    expect(usd.textContent).not.toContain("Commission:");
    expect(usd.textContent).not.toContain("Profit:");
  });

  it("renders a bare 'Commission: <amount>' line for a FINANCIAL_SERVICE_* row — never the equation", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "FINANCIAL_SERVICE_OMT",
        label: "OMT",
        revenue_usd: 500,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 5,
        profit_lbp: 0,
        count: 2,
        margin_pct: 1,
        margin_converted: false,
      },
    ]);

    await renderByModule();
    fireEvent.click(screen.getByTestId("by-module-expand-FINANCIAL_SERVICE_OMT"));

    const usd = await screen.findByTestId(
      "by-module-detail-FINANCIAL_SERVICE_OMT-usd",
    );
    expect(usd.textContent).toContain("Commission:");
    expect(usd.textContent).toContain("5 USD");
    // The pass-through principal (500) must NOT appear as part of an
    // equation ("500 USD − 0 USD = 5 USD").
    expect(usd.textContent).not.toContain("500 USD");
  });

  it("renders a bare 'Commission: <amount>' line for LOTO (LBP)", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "LOTO",
        label: "Loto Tickets",
        revenue_usd: 0,
        revenue_lbp: 200000,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 0,
        profit_lbp: 20000,
        count: 3,
        margin_pct: 10,
        margin_converted: false,
      },
    ]);

    await renderByModule();
    fireEvent.click(screen.getByTestId("by-module-expand-LOTO"));

    const lbp = await screen.findByTestId("by-module-detail-LOTO-lbp");
    expect(lbp.textContent).toContain("Commission:");
    expect(lbp.textContent).toContain("20000 LBP");
    expect(lbp.textContent).not.toContain("200000 LBP −");
  });

  it("renders a bare 'Profit: <amount>' line for a profit-only module (KEPT_CHANGE) — never '0 − 0 = X'", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "KEPT_CHANGE",
        label: "Kept Change",
        revenue_usd: 0,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 3,
        profit_lbp: 0,
        count: 4,
        margin_pct: undefined,
        margin_converted: false,
      },
    ]);

    await renderByModule();
    fireEvent.click(screen.getByTestId("by-module-expand-KEPT_CHANGE"));

    const usd = await screen.findByTestId("by-module-detail-KEPT_CHANGE-usd");
    expect(usd.textContent).toContain("Profit:");
    expect(usd.textContent).toContain("3 USD");
    expect(usd.textContent).not.toContain("Commission:");
    expect(usd.textContent).not.toContain("−");
  });

  // PFU-a-2: a FINANCIAL_SERVICE_* row for a cost/price mobile provider
  // (Katsh) is a MARGIN, never a commission — the bare `FINANCIAL_SERVICE_`
  // prefix match used to mislabel it.
  it("renders the equation (not 'Commission:') for a FINANCIAL_SERVICE_Katsh row — a cost/price margin, not a commission", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "FINANCIAL_SERVICE_Katsh",
        label: "Katsh",
        revenue_usd: 10,
        revenue_lbp: 0,
        cost_usd: 8,
        cost_lbp: 0,
        profit_usd: 2,
        profit_lbp: 0,
        count: 1,
        margin_pct: 20,
        margin_converted: false,
      },
    ]);

    await renderByModule();
    fireEvent.click(
      screen.getByTestId("by-module-expand-FINANCIAL_SERVICE_Katsh"),
    );

    const usd = await screen.findByTestId(
      "by-module-detail-FINANCIAL_SERVICE_Katsh-usd",
    );
    expect(usd.textContent).toContain("10 USD");
    expect(usd.textContent).toContain("8 USD");
    expect(usd.textContent).toContain("2 USD");
    expect(usd.textContent).not.toContain("Commission:");
  });

  // PFU-a-4: EXCHANGE is a spread, not a commission.
  it("renders the equation (not 'Commission:') for EXCHANGE", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "EXCHANGE",
        label: "Currency Exchange",
        revenue_usd: 1000,
        revenue_lbp: 0,
        cost_usd: 990,
        cost_lbp: 0,
        profit_usd: 10,
        profit_lbp: 0,
        count: 1,
        margin_pct: 1,
        margin_converted: false,
      },
    ]);

    await renderByModule();
    fireEvent.click(screen.getByTestId("by-module-expand-EXCHANGE"));

    const usd = await screen.findByTestId("by-module-detail-EXCHANGE-usd");
    expect(usd.textContent).toContain("1000 USD");
    expect(usd.textContent).toContain("990 USD");
    expect(usd.textContent).not.toContain("Commission:");
  });

  // PFU-a-7: the "No cost recorded" note is only meaningful under an
  // EQUATION row (cost is not a concept for COMMISSION/PROFIT_ONLY rows).
  it("does NOT render 'No cost recorded' under a COMMISSION row with zero cost (LOTO)", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "LOTO",
        label: "Loto Tickets",
        revenue_usd: 0,
        revenue_lbp: 200000,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 0,
        profit_lbp: 20000,
        count: 3,
        margin_pct: 10,
        margin_converted: false,
      },
    ]);

    await renderByModule();
    fireEvent.click(screen.getByTestId("by-module-expand-LOTO"));
    await screen.findByTestId("by-module-detail-LOTO-lbp");

    expect(screen.queryByText(/No cost recorded/)).not.toBeInTheDocument();
  });

  // PFU-a-3: the SALE row's equation includes a "+ kept change" term so it
  // actually adds up to the ledger profit, instead of silently dropping the
  // kept-change residual (previously "50 USD - 30 USD = 22 USD", wrong).
  it("SALE row with USD kept change renders 'revenue - cost + kept change = profit'", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "SALE",
        label: "Product Sales",
        revenue_usd: 50,
        revenue_lbp: 0,
        cost_usd: 30,
        cost_lbp: 0,
        profit_usd: 22,
        profit_lbp: 0,
        sale_kept_change_usd: 2,
        count: 1,
        margin_pct: 40,
        margin_converted: false,
      },
    ]);

    await renderByModule();
    fireEvent.click(screen.getByTestId("by-module-expand-SALE"));

    const usd = await screen.findByTestId("by-module-detail-SALE-usd");
    expect(usd.textContent).toContain("50 USD");
    expect(usd.textContent).toContain("30 USD");
    expect(usd.textContent).toContain("kept change");
    expect(usd.textContent).toContain("2 USD");
    expect(usd.textContent).toContain("22 USD");
    // Must NOT render the generic off-currency kept-change note for SALE —
    // its wording ("not in this row's own Profit column") is wrong here.
    expect(
      screen.queryByTestId("by-module-kept-change-SALE"),
    ).not.toBeInTheDocument();
  });

  // PFU-a-3: LBP-only kept change on a SALE used to render the exact
  // "0 - 0 = X LBP" shape this ticket calls out as wrong — SALE carries no
  // LBP margin of its own, so its entire LBP profit IS kept change.
  it("SALE row with ONLY LBP kept change renders the kept-change term, never a bare '0 - 0 = X LBP'", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "SALE",
        label: "Product Sales",
        revenue_usd: 40,
        revenue_lbp: 0,
        cost_usd: 25,
        cost_lbp: 0,
        profit_usd: 15,
        profit_lbp: 45000,
        sale_kept_change_lbp: 45000,
        count: 1,
        margin_pct: 37.5,
        margin_converted: false,
      },
    ]);

    await renderByModule();
    fireEvent.click(screen.getByTestId("by-module-expand-SALE"));

    const lbp = await screen.findByTestId("by-module-detail-SALE-lbp");
    expect(lbp.textContent).toContain("kept change");
    expect(lbp.textContent).toContain("45000 LBP");
    // The old wrong shape: a bare "0 LBP - 0 LBP =" with no kept-change term.
    expect(lbp.textContent?.replace(/\s+/g, " ")).not.toMatch(
      /^0 LBP − 0 LBP =/,
    );
  });

  // PFU-a-3-residual (verifier round 2): a NEGATIVE sale_kept_change_usd is
  // NOT guaranteed to be genuine T3 kept change (it is a bare arithmetic
  // residual between the ledger stamp and the sale_items margin — see
  // ProfitByModule.sale_kept_change_usd's own doc comment in
  // ProfitService.ts) — the row must label it "unexplained difference", not
  // assert it as kept change.
  it("SALE row with a NEGATIVE residual renders 'unexplained difference', not 'kept change'", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "SALE",
        label: "Product Sales",
        revenue_usd: 50,
        revenue_lbp: 0,
        cost_usd: 30,
        cost_lbp: 0,
        profit_usd: 15,
        profit_lbp: 0,
        // profit(15) - (revenue(50) - cost(30)) = -5 — negative residual.
        sale_kept_change_usd: -5,
        count: 1,
        margin_pct: 30,
        margin_converted: false,
      },
    ]);

    await renderByModule();
    fireEvent.click(screen.getByTestId("by-module-expand-SALE"));

    const usd = await screen.findByTestId("by-module-detail-SALE-usd");
    expect(usd.textContent).toContain("unexplained difference");
    expect(usd.textContent).not.toContain("kept change");
    expect(usd.textContent).toContain("5 USD");
    expect(usd.textContent).toContain("15 USD");
  });

  it("still renders 'No cost recorded' under an EQUATION row with zero cost", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "CUSTOM_SERVICE",
        label: "Custom Services",
        revenue_usd: 25,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 25,
        profit_lbp: 0,
        count: 1,
        margin_pct: 100,
        margin_converted: false,
      },
    ]);

    await renderByModule();
    fireEvent.click(screen.getByTestId("by-module-expand-CUSTOM_SERVICE"));
    await screen.findByTestId("by-module-detail-CUSTOM_SERVICE-usd");

    expect(screen.queryByText(/No cost recorded/)).toBeInTheDocument();
  });
});

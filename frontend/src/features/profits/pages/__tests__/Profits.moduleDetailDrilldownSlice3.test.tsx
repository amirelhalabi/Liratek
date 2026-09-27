/** @jest-environment jsdom */

/**
 * LIRA-233 (#14 slice 3) — the By Module "Show transactions" drill-down
 * used to render its button for SALE/RECHARGE_<carrier> only (slice 2);
 * `ProfitService.getModuleDetail` now has a registry entry for every module
 * `getByModule` can emit (MAINTENANCE, KEPT_CHANGE, COUNTERPARTY_DISCOUNT,
 * SUPPLIER_COMMISSION, TOPUP_BUYBACK, FINANCIAL_SERVICE_*, CUSTOM_SERVICE,
 * LOTO, EXCHANGE, PM_FEE — see ProfitService.ts's moduleDetailRegistry), so
 * the button must render for those too, and never throw.
 *
 * Covers:
 *  - MAINTENANCE: the "Show transactions" table renders a per-row parts/
 *    labour split (mirroring the module TOTALS row's own split, scaled
 *    down to one counted transaction).
 *  - a profit-only module (KEPT_CHANGE): amount_usd/amount_lbp are 0 (no
 *    revenue/cost concept for this class — PA-4.23), but the row still
 *    renders its counted profit figure, and a not-counted row's reason is
 *    still visible.
 *
 * Drives the REAL `Profits` page (only `useApi`, `useModules` and
 * `useCurrencyContext` mocked) — same harness as
 * `Profits.moduleDetailDrilldown.test.tsx` (slice 2's own test).
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Profits from "../Profits";

const mockGetProfitByModule = jest.fn();
const mockGetProfitSummary = jest.fn().mockResolvedValue(null);
const mockGetProfitModuleDetail = jest.fn();

const mockApi = {
  getProfitByModule: mockGetProfitByModule,
  getProfitSummary: mockGetProfitSummary,
  getProfitModuleDetail: mockGetProfitModuleDetail,
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

const MAINTENANCE_ROW = {
  module: "MAINTENANCE",
  label: "Maintenance",
  revenue_usd: 100,
  revenue_lbp: 0,
  cost_usd: 40,
  cost_lbp: 0,
  profit_usd: 60,
  profit_lbp: 0,
  count: 1,
  margin_pct: 60,
  margin_converted: false,
  parts_revenue_usd: 50,
  parts_cost_usd: 40,
  parts_profit_usd: 10,
  labour_profit_usd: 50,
  labour_profit_lbp: 0,
};

const MAINTENANCE_DETAIL = {
  module: "MAINTENANCE",
  counted: [
    {
      id: 11,
      date: "2026-09-05 10:00:00",
      counterpart: "071000000",
      detail: "Screen repair",
      amount_usd: 100,
      amount_lbp: 0,
      cost_usd: 40,
      cost_lbp: 0,
      profit_usd: 60,
      profit_lbp: 0,
      counted_pct: 100,
      counted_profit_usd: 60,
      counted_profit_lbp: 0,
      reason: null,
      fee_note: null,
      parts_revenue_usd: 50,
      parts_cost_usd: 40,
      parts_profit_usd: 10,
      labour_profit_usd: 50,
      labour_profit_lbp: 0,
    },
  ],
  not_counted: [],
  counted_total_profit_usd: 60,
  counted_total_profit_lbp: 0,
};

const KEPT_CHANGE_ROW = {
  module: "KEPT_CHANGE",
  label: "Kept Change",
  revenue_usd: 0,
  revenue_lbp: 0,
  cost_usd: 0,
  cost_lbp: 0,
  profit_usd: 3,
  profit_lbp: 0,
  count: 2,
  margin_pct: undefined,
  margin_converted: false,
};

const KEPT_CHANGE_DETAIL = {
  module: "KEPT_CHANGE",
  counted: [
    {
      id: 21,
      date: "2026-09-05 10:00:00",
      counterpart: "Walk-in",
      detail: "Sale #55 kept change",
      amount_usd: 0,
      amount_lbp: 0,
      cost_usd: 0,
      cost_lbp: 0,
      profit_usd: 3,
      profit_lbp: 0,
      counted_pct: 100,
      counted_profit_usd: 3,
      counted_profit_lbp: 0,
      reason: null,
      fee_note: null,
    },
  ],
  not_counted: [
    {
      id: 22,
      date: "2026-09-06 11:00:00",
      counterpart: "Walk-in",
      detail: "Sale #56 kept change",
      amount_usd: 0,
      amount_lbp: 0,
      cost_usd: 0,
      cost_lbp: 0,
      profit_usd: 2,
      profit_lbp: 0,
      counted_pct: 0,
      counted_profit_usd: 0,
      counted_profit_lbp: 0,
      reason: "Sale #56 still pending settlement.",
      fee_note: null,
    },
  ],
  counted_total_profit_usd: 3,
  counted_total_profit_lbp: 0,
};

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

const FS_ROW = {
  module: "FINANCIAL_SERVICE_OMT",
  label: "OMT",
  revenue_usd: 0,
  revenue_lbp: 0,
  cost_usd: 0,
  cost_lbp: 0,
  profit_usd: 9,
  profit_lbp: 0,
  count: 2,
  margin_pct: undefined,
  margin_converted: false,
};

// LIRA-233 (#14 slice 3 review round, finding 2) — a `financial_services.id`
// and a `settlement_commission_allocations.id` are independent sequences
// that CAN collide (both are `5` here). Distinguishable only by `source`.
const FS_DETAIL_DUPLICATE_IDS = {
  module: "FINANCIAL_SERVICE_OMT",
  counted: [
    {
      id: 5,
      source: "financial_service_transfer",
      date: "2026-09-05 10:00:00",
      counterpart: "Ali",
      detail: "SEND transfer",
      amount_usd: 20,
      amount_lbp: 0,
      cost_usd: 0,
      cost_lbp: 0,
      profit_usd: 0,
      profit_lbp: 0,
      counted_pct: 100,
      counted_profit_usd: 0,
      counted_profit_lbp: 0,
      reason: null,
      fee_note: null,
    },
    {
      id: 5,
      source: "financial_service_allocation",
      date: "2026-09-05 10:00:00",
      counterpart: "Ali",
      detail: "SEND transfer (settlement allocation)",
      amount_usd: 0,
      amount_lbp: 0,
      cost_usd: 0,
      cost_lbp: 0,
      profit_usd: 9,
      profit_lbp: 0,
      counted_pct: 100,
      counted_profit_usd: 9,
      counted_profit_lbp: 0,
      reason: null,
      fee_note: null,
    },
  ],
  not_counted: [
    // finding 4 — a not-counted row must show its own detail label + amount,
    // not just date/client/reason.
    {
      id: 6,
      source: "financial_service_transfer",
      date: "2026-09-06 10:00:00",
      counterpart: "Sara",
      detail: "EUR transfer",
      amount_usd: 0,
      amount_lbp: 0,
      cost_usd: 0,
      cost_lbp: 0,
      profit_usd: 4,
      profit_lbp: 0,
      counted_pct: 0,
      counted_profit_usd: 0,
      counted_profit_lbp: 0,
      reason: "This transfer's currency isn't tracked as USD or LBP.",
      fee_note: null,
    },
  ],
  counted_total_profit_usd: 9,
  counted_total_profit_lbp: 0,
};

// LIRA-233 (#14 slice 3 review round, finding 9) — an "info" note (e.g. a
// positive kept-change aside) must NOT render in the same red used for a
// real fee deduction.
const KEPT_CHANGE_INFO_NOTE_DETAIL = {
  module: "KEPT_CHANGE",
  counted: [
    {
      id: 31,
      source: "kept_change",
      date: "2026-09-05 10:00:00",
      counterpart: "Walk-in",
      detail: "Kept change",
      amount_usd: 0,
      amount_lbp: 0,
      cost_usd: 0,
      cost_lbp: 0,
      profit_usd: 1,
      profit_lbp: 0,
      counted_pct: 100,
      counted_profit_usd: 1,
      counted_profit_lbp: 0,
      reason: null,
      fee_note: "kept change +1 USD",
      fee_note_kind: "info",
    },
  ],
  not_counted: [],
  counted_total_profit_usd: 1,
  counted_total_profit_lbp: 0,
};

describe("Profits By Module drill-down — slice 3 (LIRA-233, every module)", () => {
  it("renders 'Show transactions' for MAINTENANCE and shows the per-row parts/labour split", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([MAINTENANCE_ROW]);
    mockGetProfitModuleDetail.mockResolvedValueOnce(MAINTENANCE_DETAIL);

    await renderByModule();
    fireEvent.click(screen.getByTestId("by-module-expand-MAINTENANCE"));
    fireEvent.click(
      screen.getByTestId("by-module-show-transactions-MAINTENANCE"),
    );

    await waitFor(() =>
      expect(mockGetProfitModuleDetail).toHaveBeenCalledWith(
        "MAINTENANCE",
        expect.any(String),
        expect.any(String),
      ),
    );

    const table = await screen.findByTestId(
      "by-module-transactions-counted-MAINTENANCE",
    );
    expect(table.textContent).toContain("60 USD");

    const split = await screen.findByTestId(
      "by-module-transactions-parts-labour-MAINTENANCE-11",
    );
    expect(split.textContent).toContain("50 USD");
    expect(split.textContent).toContain("40 USD");
    expect(split.textContent).toContain("10 USD");
  });

  it("renders 'Show transactions' for a profit-only module (KEPT_CHANGE) and shows the counted profit + not-counted reason", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([KEPT_CHANGE_ROW]);
    mockGetProfitModuleDetail.mockResolvedValueOnce(KEPT_CHANGE_DETAIL);

    await renderByModule();
    fireEvent.click(screen.getByTestId("by-module-expand-KEPT_CHANGE"));
    fireEvent.click(
      screen.getByTestId("by-module-show-transactions-KEPT_CHANGE"),
    );

    await waitFor(() =>
      expect(mockGetProfitModuleDetail).toHaveBeenCalledWith(
        "KEPT_CHANGE",
        expect.any(String),
        expect.any(String),
      ),
    );

    const table = await screen.findByTestId(
      "by-module-transactions-counted-KEPT_CHANGE",
    );
    expect(table.textContent).toContain("3 USD");

    const notCounted = await screen.findByTestId(
      "by-module-transactions-not-counted-KEPT_CHANGE",
    );
    expect(notCounted.textContent).toContain(
      "Sale #56 still pending settlement.",
    );
  });

  // LIRA-233 (#14 slice 3 review round, finding 2) — a transfer row's
  // `financial_services.id` and a settlement_allocation row's
  // `settlement_commission_allocations.id` are independent sequences that
  // CAN collide; keying the list by bare `id` (pre-fix) makes React log a
  // "two children with the same key" warning and risks losing one row on a
  // later re-render. Failing-first: this spies on console.error and asserts
  // NO such warning fires when two rows share id=5.
  it("keys FINANCIAL_SERVICE_<provider> rows by source+id, never a bare duplicate id (finding 2)", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([FS_ROW]);
    mockGetProfitModuleDetail.mockResolvedValueOnce(
      FS_DETAIL_DUPLICATE_IDS,
    );
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      await renderByModule();
      fireEvent.click(
        screen.getByTestId("by-module-expand-FINANCIAL_SERVICE_OMT"),
      );
      fireEvent.click(
        screen.getByTestId(
          "by-module-show-transactions-FINANCIAL_SERVICE_OMT",
        ),
      );

      const table = await screen.findByTestId(
        "by-module-transactions-counted-FINANCIAL_SERVICE_OMT",
      );
      // Both duplicate-id rows must render distinctly.
      expect(table.textContent).toContain("SEND transfer");
      expect(table.textContent).toContain("SEND transfer (settlement allocation)");

      const duplicateKeyWarning = errorSpy.mock.calls.some((call) =>
        call.some(
          (arg) =>
            typeof arg === "string" &&
            arg.includes("two children with the same key"),
        ),
      );
      expect(duplicateKeyWarning).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  // LIRA-233 (#14 slice 3 review round, finding 4) — a not-counted row used
  // to show only date/client/reason; the row's OWN detail label and amount
  // were invisible, so two different not-counted rows (or a not-counted row
  // and its counted sibling above) were indistinguishable except by reason
  // text.
  it("shows the not-counted row's detail label and amount, not just its reason (finding 4)", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([FS_ROW]);
    mockGetProfitModuleDetail.mockResolvedValueOnce(
      FS_DETAIL_DUPLICATE_IDS,
    );

    await renderByModule();
    fireEvent.click(
      screen.getByTestId("by-module-expand-FINANCIAL_SERVICE_OMT"),
    );
    fireEvent.click(
      screen.getByTestId(
        "by-module-show-transactions-FINANCIAL_SERVICE_OMT",
      ),
    );

    const notCounted = await screen.findByTestId(
      "by-module-transactions-not-counted-FINANCIAL_SERVICE_OMT",
    );
    expect(notCounted.textContent).toContain("EUR transfer");
    expect(notCounted.textContent).toContain("4 USD");
    expect(notCounted.textContent).toContain(
      "This transfer's currency isn't tracked as USD or LBP.",
    );
  });

  // LIRA-233 (#14 slice 3 review round, finding 9) — every `fee_note` used
  // to render `text-red-400` unconditionally, so LOTO's positive kept-change
  // note read as a deduction. An "info"-kind note must NOT carry the red
  // fee-deduction class.
  it("renders an info-kind fee_note in a neutral colour, not the fee-deduction red (finding 9)", async () => {
    mockGetProfitByModule.mockResolvedValueOnce([
      {
        module: "KEPT_CHANGE",
        label: "Kept Change",
        revenue_usd: 0,
        revenue_lbp: 0,
        cost_usd: 0,
        cost_lbp: 0,
        profit_usd: 1,
        profit_lbp: 0,
        count: 1,
        margin_pct: undefined,
        margin_converted: false,
      },
    ]);
    mockGetProfitModuleDetail.mockResolvedValueOnce(
      KEPT_CHANGE_INFO_NOTE_DETAIL,
    );

    await renderByModule();
    fireEvent.click(screen.getByTestId("by-module-expand-KEPT_CHANGE"));
    fireEvent.click(
      screen.getByTestId("by-module-show-transactions-KEPT_CHANGE"),
    );

    const table = await screen.findByTestId(
      "by-module-transactions-counted-KEPT_CHANGE",
    );
    const note = await waitFor(() => {
      const el = Array.from(table.querySelectorAll("span")).find((span) =>
        span.textContent?.includes("kept change +1 USD"),
      );
      if (!el) throw new Error("info note span not found");
      return el;
    });
    expect(note.className).not.toContain("text-red-400");
  });
});

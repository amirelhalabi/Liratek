/** @jest-environment jsdom */
/**
 * LIRA-364 — the Monthly progress page: each KPI a row, each saved month a
 * column (newest first), USD and LBP on their own lines, the change from the
 * month before per currency, "taken late" and "not recorded" marks, and the
 * carrier credits row hidden for a shop without the recharge module.
 *
 * RULE 17 — written before the page existed.
 */

import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { KpiProgressResponse, KpiSnapshotView } from "@liratek/core";
import MonthlyProgress from "../index";

const mockGetKpiSnapshots = jest.fn<Promise<KpiProgressResponse>, []>();
// Module-level: one identity for the whole file (rule 25).
const mockApi = { getKpiSnapshots: mockGetKpiSnapshots };

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return { ...actual, useApi: () => mockApi };
});

let mockRechargeOn = true;
jest.mock("@/contexts/ModuleContext", () => ({
  useModules: () => ({
    isModuleEnabled: (key: string) =>
      key === "recharge" ? mockRechargeOn : true,
  }),
}));

function month(
  m: string,
  values: KpiSnapshotView["values"],
  over: Partial<KpiSnapshotView> = {},
): KpiSnapshotView {
  return {
    month: m,
    taken_at: `${m}-28 22:00:00`,
    is_late: false,
    usd_lbp_buy_rate: 89000,
    usd_lbp_sell_rate: 90000,
    values,
    ...over,
  };
}

const OCT = month("2026-10", {
  stock_value: { usd: 9500, lbp: 0 },
  customers_owe_shop: { usd: 170, lbp: 900000 },
  carrier_credits: { usd: 20, lbp: 0 },
});
const SEP = month("2026-09", {
  stock_value: { usd: 8000, lbp: 0 },
  customers_owe_shop: { usd: 200, lbp: 450000 },
  carrier_credits: { usd: 35, lbp: 0 },
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MonthlyProgress />
    </QueryClientProvider>,
  );
}

function row(kpiKey: string): HTMLElement {
  return screen.getByTestId(`kpi-row-${kpiKey}`);
}

describe("Monthly progress page (LIRA-364)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRechargeOn = true;
    mockGetKpiSnapshots.mockResolvedValue({
      success: true,
      enabled: true,
      snapshots: [OCT, SEP],
    });
  });

  it("shows the months as columns, newest first", async () => {
    renderPage();
    const headers = await screen.findAllByTestId(/^kpi-month-/);
    expect(headers.map((h) => h.getAttribute("data-testid"))).toEqual([
      "kpi-month-2026-10",
      "kpi-month-2026-09",
    ]);
  });

  it("shows the change from the month before, per currency", async () => {
    renderPage();
    await screen.findByTestId("kpi-month-2026-10");
    const stock = within(row("stock_value")).getByTestId("kpi-cell-2026-10");
    expect(stock).toHaveTextContent("$9,500.00");
    expect(stock).toHaveTextContent("+$1,500.00");

    const owed = within(row("customers_owe_shop")).getByTestId(
      "kpi-cell-2026-10",
    );
    expect(owed).toHaveTextContent("-$30.00");
    expect(owed).toHaveTextContent("+450,000");
  });

  it("the oldest month has no change line", async () => {
    renderPage();
    await screen.findByTestId("kpi-month-2026-09");
    const cell = within(row("stock_value")).getByTestId("kpi-cell-2026-09");
    expect(cell).not.toHaveTextContent("+");
  });

  it("a KPI missing from a month reads 'not recorded'", async () => {
    renderPage();
    await screen.findByTestId("kpi-month-2026-10");
    expect(
      within(row("shop_owes_partners")).getByTestId("kpi-cell-2026-10"),
    ).toHaveTextContent("Not recorded");
  });

  it("marks a month taken late", async () => {
    mockGetKpiSnapshots.mockResolvedValue({
      success: true,
      enabled: true,
      snapshots: [{ ...OCT, is_late: true }],
    });
    renderPage();
    expect(await screen.findByTestId("kpi-late-2026-10")).toBeInTheDocument();
  });

  it("before the first snapshot, says when it will be taken", async () => {
    mockGetKpiSnapshots.mockResolvedValue({
      success: true,
      enabled: true,
      snapshots: [],
    });
    renderPage();
    expect(await screen.findByTestId("kpi-empty")).toBeInTheDocument();
  });

  it("hides carrier credits for a shop without the recharge module", async () => {
    mockRechargeOn = false;
    renderPage();
    await screen.findByTestId("kpi-month-2026-10");
    expect(screen.queryByTestId("kpi-row-carrier_credits")).toBeNull();
    expect(row("stock_value")).toBeInTheDocument();
  });

  it("a shop without the switch sees that it is not available", async () => {
    mockGetKpiSnapshots.mockResolvedValue({
      success: true,
      enabled: false,
      snapshots: [],
    });
    renderPage();
    expect(await screen.findByTestId("kpi-disabled")).toBeInTheDocument();
  });
});

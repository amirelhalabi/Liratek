/** @jest-environment jsdom */

/**
 * "See transactions" (owner mock 2026-10-26, omt-settle-by-day §7) on the
 * Settle Account sheet (OMT account and LIRA-345 suppliers):
 *
 * - Under "… left this month" a "See transactions (N)" pill, N = the open
 *   transactions on the picked days.
 * - Pressing it shows a table of the picked days' transactions, paid ones
 *   included (from the month reads of every month with a picked day), with
 *   the name / reference column; the label turns "Hide transactions".
 * - Unticking a row there is the SAME untick as the day details: totals,
 *   pre-fill and payload follow (`buildDaySelections` with `untickedRows`).
 * - While it is open, tapping a day picks / unpicks it and the table
 *   follows; the day details stay closed. × closes the table.
 *
 * Failing-first (rule 17): written before the sheet wired the panel. Same
 * fixture as `lira343DayDetails` (today = Monday 26 Oct 2026). ONE stable
 * `useApi` object (rule 25). Payloads parsed through the core schema and
 * compared with `buildDaySelections` on the same rows (rule 24).
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildDaySelections, supplierSettleAccountSchema } from "@liratek/core";
import { AccountSettleSheet } from "../AccountSettleSheet";
import type {
  AccountBalance,
  AccountUnsettledRow,
} from "../../hooks/useSuppliers";

jest.mock("@/shared/utils/localDay", () => {
  const actual = jest.requireActual("@/shared/utils/localDay");
  return { ...actual, localDay: () => "2026-10-26" };
});

const mockSettleSupplierAccount = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
const mockGetSupplierAccountMonthRows = jest.fn();
const mockGetSupplierAccountDayDetail = jest.fn();
const mockApi = {
  settleSupplierAccount: mockSettleSupplierAccount,
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
  getSupplierAccountMonthRows: mockGetSupplierAccountMonthRows,
  getSupplierAccountDayDetail: mockGetSupplierAccountDayDetail,
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  // Rule 25: ONE stable object, never a fresh literal per useApi() call.
  return { ...actual, useApi: () => mockApi };
});

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [{ code: "CASH", label: "Cash" }],
    drawerAffectingMethods: [],
    allMethods: [],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

const ACCOUNT: AccountBalance = {
  account_supplier_id: 1,
  account_name: "OMT",
  total_usd: 516.3,
  total_lbp: 990000,
  children: [
    {
      supplier_id: 1,
      name: "OMT",
      provider: "OMT",
      drawer_name: "OMT_System",
      total_usd: 516.3,
      total_lbp: 990000,
      is_parent: true,
    },
  ],
};

function row(
  over: Partial<AccountUnsettledRow> &
    Pick<AccountUnsettledRow, "id" | "shop_day">,
): AccountUnsettledRow {
  const amountUsd = over.amount_usd ?? 0;
  const amountLbp = over.amount_lbp ?? 0;
  return {
    kind: "FINANCIAL_SERVICE",
    supplier_id: 1,
    source_provider: "OMT",
    source_name: "OMT",
    created_at: `${over.shop_day} 09:00:00`,
    entry_type: null,
    service_type: "SEND",
    commission_usd: 0,
    commission_lbp: 0,
    omt_service_type: "INTRA",
    commission_model: 0,
    covered_usd: 0,
    covered_lbp: 0,
    remaining_usd: amountUsd,
    remaining_lbp: amountLbp,
    source_ref_table: null,
    row_scope: "DAY",
    transaction_id: null,
    ...over,
    amount_usd: amountUsd,
    amount_lbp: amountLbp,
  };
}

const SEP30 = row({ id: 1, shop_day: "2026-09-30", amount_usd: 100 });
const OCT23 = row({ id: 2, shop_day: "2026-10-23", amount_usd: 120 });
const OCT24 = row({ id: 3, shop_day: "2026-10-24", amount_usd: 95 });
const OCT25 = row({
  id: 5,
  shop_day: "2026-10-25",
  amount_usd: 200,
  covered_usd: 50,
  remaining_usd: 150,
});
const OCT25_LBP = row({ id: 6, shop_day: "2026-10-25", amount_lbp: 990000 });
const ACCOUNT_CREDIT = row({
  kind: "LEDGER",
  id: 50,
  shop_day: "2026-10-20",
  entry_type: "PAYMENT",
  service_type: null,
  omt_service_type: null,
  commission_model: null,
  amount_usd: -8.7,
  row_scope: "ACCOUNT",
});
const OPEN_ROWS = [SEP30, ACCOUNT_CREDIT, OCT23, OCT24, OCT25, OCT25_LBP];
const DEFAULT_DAYS = ["2026-09-30", "2026-10-23", "2026-10-24", "2026-10-25"];

/** Paid in full on 23 Oct: only in the month read, not in the open queue. */
const OCT23_PAID = row({
  id: 9,
  shop_day: "2026-10-23",
  amount_usd: 60,
  covered_usd: 60,
  remaining_usd: 0,
  party_name: "Lea F.",
  reference: "OMT-78120",
});
const OPEN_WITH_NAMES = OPEN_ROWS.map((r) =>
  r.id === OCT23.id ? { ...r, party_name: "Rami K.", reference: "OMT-77821" } : r,
);
const MONTH_ROWS = [...OPEN_WITH_NAMES, OCT23_PAID];

function renderSheet() {
  mockGetSupplierAccountUnsettled.mockResolvedValue(OPEN_WITH_NAMES);
  mockGetSupplierAccountMonthRows.mockImplementation(
    async (_id: number, month: string) =>
      MONTH_ROWS.filter((r) => r.shop_day.startsWith(`${month}-`)),
  );
  mockGetSupplierAccountDayDetail.mockImplementation(
    async (_id: number, day: string) =>
      MONTH_ROWS.filter((r) => r.shop_day === day).map((r) => ({
        ...r,
        settlements: [],
        added_after_settlement: false,
      })),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettleSheet account={ACCOUNT} onClose={jest.fn()} onSettled={jest.fn()} />
    </QueryClientProvider>,
  );
}

async function dayButton(day: string): Promise<HTMLButtonElement> {
  const cell = await waitFor(() => {
    const el = document.querySelector(`[data-day="${day}"]`);
    if (!el) throw new Error(`day ${day} not rendered`);
    return el as HTMLElement;
  });
  return within(cell).getByRole("button") as HTMLButtonElement;
}

async function openTable(): Promise<HTMLElement> {
  const btn = await screen.findByTestId("settle-see-transactions");
  await waitFor(() => expect(btn).toHaveTextContent("5"));
  fireEvent.click(btn);
  return screen.findByTestId("settle-transactions-panel");
}

describe("AccountSettleSheet — See transactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 900 });
  });

  it("shows 'See transactions (N)' under the month line, N = open transactions on the picked days", async () => {
    renderSheet();
    const btn = await screen.findByTestId("settle-see-transactions");
    // 30 Sep, 23, 24 and 25 Oct ($ and LBP) are picked by default: 5 open.
    await waitFor(() => expect(btn).toHaveTextContent("5"));
    expect(btn).toHaveTextContent("See transactions");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("settle-transactions-panel")).not.toBeInTheDocument();
  });

  it("opens a table of the picked days, paid rows included, with name / reference; the button says Hide", async () => {
    renderSheet();
    const panel = await openTable();
    const btn = screen.getByTestId("settle-see-transactions");
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(btn).toHaveTextContent("Hide transactions");
    expect(document.getElementById(btn.getAttribute("aria-controls") ?? "")).toContainElement(panel);

    // 30 Sep comes from September's month read.
    await waitFor(() =>
      expect(mockGetSupplierAccountMonthRows).toHaveBeenCalledWith(1, "2026-09"),
    );
    expect(await within(panel).findByTestId("settle-tx-day-2026-09-30")).toBeInTheDocument();

    const paid = await within(panel).findByTestId("settle-tx-row-FINANCIAL_SERVICE:9");
    expect(within(paid).getByRole("checkbox")).toBeDisabled();
    expect(paid).toHaveTextContent("paid");
    expect(paid).toHaveTextContent("Lea F. · ref OMT-78120");

    const open = within(panel).getByTestId("settle-tx-row-FINANCIAL_SERVICE:2");
    expect(open).toHaveTextContent("Rami K. · ref OMT-77821");
    expect(open).toHaveTextContent("$120.00");
    expect(within(open).getByText("OMT")).toBeInTheDocument();

    // The day header carries what its ticked rows leave: 25 Oct $150 + LBP.
    const day25 = within(panel).getByTestId("settle-tx-day-2026-10-25");
    expect(day25).toHaveTextContent("$150.00");
    expect(day25).toHaveTextContent("990,000 LBP");
  });

  it("unticking a row in the table leaves it out: totals, pre-fill and payload follow", async () => {
    renderSheet();
    const panel = await openTable();
    await waitFor(() =>
      expect(screen.getByTestId("settle-selection-bar").textContent).toContain("990,000 LBP"),
    );
    const row6 = await within(panel).findByTestId("settle-tx-row-FINANCIAL_SERVICE:6");
    fireEvent.click(within(row6).getByRole("checkbox", { name: "Include #6 in this settlement" }));

    expect(within(row6).getByRole("checkbox")).not.toBeChecked();
    expect(row6).toHaveTextContent("unticked");
    await waitFor(() =>
      expect(screen.getByTestId("settle-selection-bar").textContent).not.toContain("LBP"),
    );
    // The calendar reads "partly picked" on 25 Oct, like the day details.
    const day25 = await dayButton("2026-10-25");
    expect(day25.getAttribute("aria-label") ?? "").toMatch(/partly picked/i);

    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() => expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1));
    const payload = mockSettleSupplierAccount.mock.calls[0][1] as Record<string, unknown>;
    const parsed = supplierSettleAccountSchema.parse({ account_supplier_id: 1, ...payload });
    const expected = buildDaySelections(OPEN_WITH_NAMES, {
      pickedDays: new Set(DEFAULT_DAYS),
      untickedRows: new Set(["FINANCIAL_SERVICE:6"]),
    });
    expect(parsed.selections).toEqual(expected.selections);
    expect(parsed.expected_owed).toEqual(expected.expected_owed);
  });

  it("while open, tapping a day picks / unpicks it and the table follows; the day details stay closed", async () => {
    renderSheet();
    const panel = await openTable();
    expect(await within(panel).findByTestId("settle-tx-day-2026-10-24")).toBeInTheDocument();

    fireEvent.click(await dayButton("2026-10-24"));
    await waitFor(() =>
      expect(within(panel).queryByTestId("settle-tx-day-2026-10-24")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("settle-see-transactions")).toHaveTextContent("4");
    expect(screen.queryByTestId("settle-day-details")).not.toBeInTheDocument();

    fireEvent.click(await dayButton("2026-10-24"));
    expect(await within(panel).findByTestId("settle-tx-day-2026-10-24")).toBeInTheDocument();
    expect(screen.queryByTestId("settle-day-details")).not.toBeInTheDocument();
  });

  it("× closes the table and the button reads See transactions again", async () => {
    renderSheet();
    const panel = await openTable();
    fireEvent.click(within(panel).getByRole("button", { name: "Close transactions" }));
    await waitFor(() =>
      expect(screen.queryByTestId("settle-transactions-panel")).not.toBeInTheDocument(),
    );
    const btn = screen.getByTestId("settle-see-transactions");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).toHaveTextContent("See transactions");
  });
});

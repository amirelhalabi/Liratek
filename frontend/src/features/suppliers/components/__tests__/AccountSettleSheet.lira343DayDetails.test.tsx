/** @jest-environment jsdom */

/**
 * LIRA-343 T033 / T037 — what a calendar day does on the settle sheet, and
 * the ↺ account marks.
 *
 * Owner decision 2026-10-27: the inline day-details panel is gone. Tapping a
 * day ONLY picks / unpicks it; the day's transfers are checked and unticked
 * in the "See transactions" table, which shares the sheet's `untickedRows`.
 *
 * - Tapping a day never renders `settle-day-details` and never reads
 *   `getSupplierAccountDayDetail` (guard; failing-first against the sheet
 *   that still opened the panel).
 * - No "See in Transactions ›" link is offered anywhere (that link lived in
 *   the panel only).
 * - Unticking an open transfer of a picked day IN THE TABLE leaves it out:
 *   totals, pre-fill and payload follow (`buildDaySelections` with
 *   `untickedRows`), and the day's circle reads "partly picked".
 * - An open account row an undo / void wrote marks its day with ↺, and the
 *   sheet lists it as an account line whose day link switches the calendar
 *   to that day's month (no details).
 *
 * Fixture (today = Monday 26 Oct 2026) as `lira343Calendar`. ONE stable
 * `useApi` object (rule 25). Payloads are parsed through the core schema and
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
/** Undo of settlement #12 left "you owe OMT $8.70" (an open account row on
 *  no day); it was written today, 26 Oct. */
const UNDO_RELIEF = row({
  kind: "LEDGER",
  id: 70,
  shop_day: "2026-10-26",
  entry_type: "SUPPLIER_PAYS_US",
  service_type: null,
  omt_service_type: null,
  commission_model: null,
  amount_usd: 8.7,
  row_scope: "ACCOUNT",
  transaction_id: 99,
  relief_origin: "UNDO",
  relief_ref: "#12",
});

const OPEN_ROWS = [SEP30, ACCOUNT_CREDIT, OCT23, OCT24, OCT25, OCT25_LBP];
const DEFAULT_DAYS = ["2026-09-30", "2026-10-23", "2026-10-24", "2026-10-25"];

function renderSheet(openRows: AccountUnsettledRow[] = OPEN_ROWS) {
  mockGetSupplierAccountUnsettled.mockResolvedValue(openRows);
  mockGetSupplierAccountMonthRows.mockImplementation(
    async (_id: number, month: string) =>
      openRows.filter((r) => r.shop_day.startsWith(`${month}-`)),
  );
  // Still mocked (the read exists on the API) so a stray call is visible.
  mockGetSupplierAccountDayDetail.mockResolvedValue([]);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettleSheet
        account={ACCOUNT}
        onClose={jest.fn()}
        onSettled={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

async function dayCell(day: string): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.querySelector(`[data-day="${day}"]`);
    if (!el) throw new Error(`day ${day} not rendered`);
    return el as HTMLElement;
  });
}

async function dayButton(day: string): Promise<HTMLButtonElement> {
  return within(await dayCell(day)).getByRole("button") as HTMLButtonElement;
}

/** Open "See transactions": the picked days' rows (5 open by default). */
async function openTable(): Promise<HTMLElement> {
  const btn = await screen.findByTestId("settle-see-transactions");
  await waitFor(() => expect(btn).toHaveTextContent("5"));
  fireEvent.click(btn);
  return screen.findByTestId("settle-transactions-panel");
}

async function includeBox(
  panel: HTMLElement,
  key: string,
): Promise<HTMLInputElement> {
  const tr = await within(panel).findByTestId(`settle-tx-row-${key}`);
  return within(tr).getByRole("checkbox") as HTMLInputElement;
}

async function confirmAndGetPayload(): Promise<Record<string, unknown>> {
  const submit = screen.getByTestId("supplier-account-settle-submit");
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  await waitFor(() =>
    expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
  );
  return mockSettleSupplierAccount.mock.calls[0][1] as Record<string, unknown>;
}

describe("AccountSettleSheet — LIRA-343 day taps, unticks in the table, ↺ marks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 900 });
  });

  // Owner decision 2026-10-27 — failing-first guard (rule 17): run against
  // the sheet that still opened the inline day details on a tap.
  it("tapping a day only picks / unpicks it: no day details, no day-detail read", async () => {
    renderSheet();

    const btn = await dayButton("2026-10-25");
    await waitFor(() => expect(btn).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(btn);
    await waitFor(async () =>
      expect(await dayButton("2026-10-25")).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
    expect(screen.queryByTestId("settle-day-details")).not.toBeInTheDocument();

    fireEvent.click(await dayButton("2026-10-25"));
    await waitFor(async () =>
      expect(await dayButton("2026-10-25")).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.queryByTestId("settle-day-details")).not.toBeInTheDocument();
    expect(mockGetSupplierAccountDayDetail).not.toHaveBeenCalled();
  });

  // Was: '"See in Transactions ›" calls onSeeInTransactions' — the link lived
  // in the removed day details; now a guard that it is not offered.
  it('offers no "See in Transactions ›" link after tapping a day', async () => {
    renderSheet();

    fireEvent.click(await dayButton("2026-10-24"));
    expect(
      screen.queryByRole("button", { name: "See in Transactions ›" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("settle-day-details")).not.toBeInTheDocument();
  });

  it("the table lists a picked day's transfers: member tag and what is left", async () => {
    renderSheet();

    const panel = await openTable();
    const transfer = await within(panel).findByTestId(
      "settle-tx-row-FINANCIAL_SERVICE:5",
    );
    expect(transfer.textContent).toContain("#5");
    expect(transfer.textContent).toContain("OMT");
    expect(transfer.textContent).toContain("$150.00");
    expect(
      within(panel).getByTestId("settle-tx-row-FINANCIAL_SERVICE:6"),
    ).toBeInTheDocument();
  });

  it("unticking an open transfer of a picked day in the table leaves it out: totals, pre-fill and payload follow", async () => {
    renderSheet();

    const panel = await openTable();
    const bar = screen.getByTestId("settle-selection-bar");
    await waitFor(() => expect(bar.textContent).toContain("990,000 LBP"));

    const box = await includeBox(panel, "FINANCIAL_SERVICE:6");
    expect(box).toHaveAccessibleName("Include #6 in this settlement");
    expect(box.checked).toBe(true);
    fireEvent.click(box);

    expect(await dayButton("2026-10-25")).toHaveAccessibleName(/partly picked/);
    await waitFor(() =>
      expect(screen.getByTestId("settle-selection-bar").textContent).not.toContain(
        "LBP",
      ),
    );
    // No LBP left to pay: only the $ section remains.
    await screen.findByTestId("supplier-account-settle-section-usd");

    const payload = await confirmAndGetPayload();
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: 1,
      ...payload,
    });
    const expected = buildDaySelections(OPEN_ROWS, {
      pickedDays: new Set(DEFAULT_DAYS),
      untickedRows: new Set(["FINANCIAL_SERVICE:6"]),
    });
    expect(parsed.selections).toEqual(expected.selections);
    expect(parsed.selections).not.toContainEqual({
      kind: "FINANCIAL_SERVICE",
      id: 6,
    });
    expect(parsed.expected_owed).toEqual(expected.expected_owed);
    expect(Object.keys(parsed.per_currency ?? {})).toEqual(["USD"]);
  });

  it("re-ticking in the table puts the transfer back", async () => {
    renderSheet();

    const panel = await openTable();
    const box = await includeBox(panel, "FINANCIAL_SERVICE:6");
    fireEvent.click(box);
    await waitFor(() =>
      expect(screen.getByTestId("settle-selection-bar").textContent).not.toContain(
        "LBP",
      ),
    );
    fireEvent.click(await includeBox(panel, "FINANCIAL_SERVICE:6"));
    await waitFor(() =>
      expect(screen.getByTestId("settle-selection-bar").textContent).toContain(
        "990,000 LBP",
      ),
    );
    expect(await dayButton("2026-10-25")).not.toHaveAccessibleName(
      /partly picked/,
    );
  });

  // LIRA-343 follow-up — failing-first: written before the sheet passed
  // `partlyPicked` to the calendar (then driven from the day details; now
  // from the table, the only place a transfer is unticked).
  it("a picked day with an unticked transfer shows the partly-picked mark on its circle; unpicking clears it", async () => {
    renderSheet();

    const panel = await openTable();
    expect(
      (await dayCell("2026-10-25")).querySelector('[data-corner="picked"]'),
    ).not.toBeNull();
    fireEvent.click(await includeBox(panel, "FINANCIAL_SERVICE:6"));

    let cell = await dayCell("2026-10-25");
    await waitFor(() =>
      expect(cell.querySelector('[data-corner="partlyPicked"]')).not.toBeNull(),
    );
    expect(cell.querySelector('[data-corner="picked"]')).toBeNull();
    expect(await dayButton("2026-10-25")).toHaveAccessibleName(/partly picked/);
    // Other picked days keep the plain ✓.
    expect(
      (await dayCell("2026-10-24")).querySelector('[data-corner="picked"]'),
    ).not.toBeNull();

    // Unpick the day: no "partly picked" mark on an unpicked day.
    fireEvent.click(await dayButton("2026-10-25"));
    cell = await dayCell("2026-10-25");
    await waitFor(async () =>
      expect(await dayButton("2026-10-25")).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
    expect(cell.querySelector('[data-corner="partlyPicked"]')).toBeNull();
    expect(await dayButton("2026-10-25")).not.toHaveAccessibleName(
      /partly picked/,
    );
  });

  it("an open undo account row puts ↺ on its day with its origin, and an account line links to that day", async () => {
    renderSheet([...OPEN_ROWS, UNDO_RELIEF]);

    const cell = await dayCell("2026-10-26");
    await waitFor(() =>
      expect(cell.querySelector("[data-account-mark]")).not.toBeNull(),
    );
    expect(within(cell).getByRole("tooltip").textContent).toBe(
      "Owed to OMT added: $8.70 (undo of #12)",
    );
    // No other day carries the mark.
    expect(
      (await dayCell("2026-10-25")).querySelector("[data-account-mark]"),
    ).toBeNull();

    const line = await screen.findByTestId(
      "supplier-account-settle-relief-line",
    );
    expect(line.textContent).toContain("Owed to OMT added: $8.70 (undo of #12)");
    // Go back a month, then the line's day link brings October back: it
    // switches the calendar to that day's month and opens nothing.
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() =>
      expect(document.querySelector('[data-day="2026-10-26"]')).toBeNull(),
    );
    expect(await dayCell("2026-09-30")).toBeInTheDocument();
    fireEvent.click(within(line).getByRole("button"));
    expect(await dayCell("2026-10-26")).toBeInTheDocument();
    expect(document.querySelector('[data-day="2026-09-30"]')).toBeNull();
    expect(screen.queryByTestId("settle-day-details")).not.toBeInTheDocument();
    expect(mockGetSupplierAccountDayDetail).not.toHaveBeenCalled();
  });
});

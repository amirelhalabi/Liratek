/** @jest-environment jsdom */

/**
 * LIRA-343 T033 (US4, FR-016 / FR-016a / FR-016c) and T037 (US5, FR-016b)
 * — the settle sheet's day details and the ↺ account marks.
 *
 * - Tapping a day opens what is behind it (`getSupplierAccountDayDetail`).
 * - On a picked day, unticking an open transfer leaves it out of the
 *   settlement: totals, pre-fill and payload follow (`buildDaySelections`
 *   with `untickedRows`), and the day reads "Partly picked".
 * - "See in Transactions ›" calls the sheet's `onSeeInTransactions(day)`.
 * - An open account row an undo / void wrote marks its day with ↺, and the
 *   sheet lists it as an account line that links to that day.
 *
 * Failing-first (rule 17): written before the sheet wired the details.
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
  AccountDayDetailRow,
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

function detail(
  r: AccountUnsettledRow,
  over: Partial<AccountDayDetailRow> = {},
): AccountDayDetailRow {
  return { ...r, settlements: [], added_after_settlement: false, ...over };
}

function renderSheet(
  openRows: AccountUnsettledRow[] = OPEN_ROWS,
  props: { onSeeInTransactions?: (day: string) => void } = {},
) {
  mockGetSupplierAccountUnsettled.mockResolvedValue(openRows);
  mockGetSupplierAccountMonthRows.mockImplementation(
    async (_id: number, month: string) =>
      openRows.filter((r) => r.shop_day.startsWith(`${month}-`)),
  );
  mockGetSupplierAccountDayDetail.mockImplementation(
    async (_id: number, day: string) =>
      openRows
        .filter((r) => r.shop_day === day)
        .map((r) =>
          r.id === OCT25.id
            ? detail(r, {
                settlements: [
                  {
                    transaction_id: 10057,
                    settled_at: "2026-10-25 21:30:00",
                    currency: "USD",
                    amount: 50,
                    source: "PAYMENT",
                  },
                ],
              })
            : detail(r),
        ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettleSheet
        account={ACCOUNT}
        onClose={jest.fn()}
        onSettled={jest.fn()}
        {...props}
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

/** Tap a picked day twice: it ends picked, with its details open. */
async function openPickedDay(day: string): Promise<HTMLElement> {
  const btn = await dayButton(day);
  await waitFor(() => expect(btn).toHaveAttribute("aria-pressed", "true"));
  fireEvent.click(btn);
  fireEvent.click(await dayButton(day));
  expect(await dayButton(day)).toHaveAttribute("aria-pressed", "true");
  return screen.findByTestId("settle-day-details");
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

describe("AccountSettleSheet — LIRA-343 day details and ↺ marks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 900 });
  });

  it("tapping a day opens its details: rows, member tag, who paid and what is left", async () => {
    renderSheet();

    fireEvent.click(await dayButton("2026-10-25"));
    const panel = await screen.findByTestId("settle-day-details");
    await waitFor(() =>
      expect(mockGetSupplierAccountDayDetail).toHaveBeenCalledWith(
        1,
        "2026-10-25",
      ),
    );
    const transfer = await within(panel).findByTestId(
      "settle-day-row-FINANCIAL_SERVICE:5",
    );
    expect(transfer.textContent).toContain("#5");
    expect(transfer.textContent).toContain("OMT");
    expect(transfer.textContent).toContain("$50.00 paid by #10057");
    expect(transfer.textContent).toContain("$150.00 left");
    expect(
      within(panel).getByTestId("settle-day-row-FINANCIAL_SERVICE:6"),
    ).toBeInTheDocument();
  });

  it("unticking an open transfer of a picked day leaves it out: totals, pre-fill and payload follow", async () => {
    renderSheet();

    const panel = await openPickedDay("2026-10-25");
    const bar = screen.getByTestId("settle-selection-bar");
    await waitFor(() => expect(bar.textContent).toContain("990,000 LBP"));

    const box = (await within(panel).findByRole("checkbox", {
      name: "Include #6 in this settlement",
    })) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);

    expect(
      within(screen.getByTestId("settle-day-details")).getByText(
        "Partly picked",
      ),
    ).toBeInTheDocument();
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

  it("re-ticking puts the transfer back", async () => {
    renderSheet();

    const panel = await openPickedDay("2026-10-25");
    const box = (await within(panel).findByRole("checkbox", {
      name: "Include #6 in this settlement",
    })) as HTMLInputElement;
    fireEvent.click(box);
    await waitFor(() =>
      expect(screen.getByTestId("settle-selection-bar").textContent).not.toContain(
        "LBP",
      ),
    );
    fireEvent.click(box);
    await waitFor(() =>
      expect(screen.getByTestId("settle-selection-bar").textContent).toContain(
        "990,000 LBP",
      ),
    );
    expect(screen.queryByText("Partly picked")).not.toBeInTheDocument();
  });

  // LIRA-343 follow-up — failing-first: written before the sheet passed
  // `partlyPicked` to the calendar.
  it("a picked day with an unticked transfer shows the partly-picked mark on its circle; unpicking clears it", async () => {
    renderSheet();

    const panel = await openPickedDay("2026-10-25");
    expect(
      (await dayCell("2026-10-25")).querySelector('[data-corner="picked"]'),
    ).not.toBeNull();
    fireEvent.click(
      await within(panel).findByRole("checkbox", {
        name: "Include #6 in this settlement",
      }),
    );

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

  it('"See in Transactions ›" calls onSeeInTransactions with the day', async () => {
    const onSeeInTransactions = jest.fn();
    renderSheet(OPEN_ROWS, { onSeeInTransactions });

    fireEvent.click(await dayButton("2026-10-24"));
    const panel = await screen.findByTestId("settle-day-details");
    fireEvent.click(
      within(panel).getByRole("button", { name: "See in Transactions ›" }),
    );
    expect(onSeeInTransactions).toHaveBeenCalledWith("2026-10-24");
  });

  it("without onSeeInTransactions the link is not offered", async () => {
    renderSheet();

    fireEvent.click(await dayButton("2026-10-24"));
    const panel = await screen.findByTestId("settle-day-details");
    expect(
      within(panel).queryByRole("button", { name: "See in Transactions ›" }),
    ).not.toBeInTheDocument();
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
    fireEvent.click(within(line).getByRole("button"));
    await waitFor(() =>
      expect(mockGetSupplierAccountDayDetail).toHaveBeenCalledWith(
        1,
        "2026-10-26",
      ),
    );
    expect(await screen.findByTestId("settle-day-details")).toBeInTheDocument();
  });
});

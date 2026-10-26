/** @jest-environment jsdom */

/**
 * LIRA-343 T041 (US7, FR-021 / FR-021a) — "Settle old history up to…": an
 * admin-only action that uses the account credits to close every open
 * transfer on or before a date, with no money (every section sent with
 * `payments: []`), through the same settle call.
 *
 * Fixture: $100 transfers on 28, 29 and 30 Sep and $120 on 23 Oct (all
 * open), and a $300 Pay / Receive credit dated 2 Oct (an ACCOUNT row).
 * Up to 30 Sep: the three September days close, 23 Oct is not touched.
 * With only $280 of credit, 30 Sep stays open with $20 left.
 *
 * Failing-first (rule 17): written before the action existed. ONE stable
 * `useApi` object (rule 25); the payload is parsed through the core schema
 * and compared with `buildDaySelections` (rule 24).
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
  total_usd: 120,
  total_lbp: 0,
  children: [
    {
      supplier_id: 1,
      name: "OMT",
      provider: "OMT",
      drawer_name: "OMT_System",
      total_usd: 120,
      total_lbp: 0,
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

const SEP28 = row({ id: 1, shop_day: "2026-09-28", amount_usd: 100 });
const SEP29 = row({ id: 2, shop_day: "2026-09-29", amount_usd: 100 });
const SEP30 = row({ id: 3, shop_day: "2026-09-30", amount_usd: 100 });
const OCT23 = row({ id: 4, shop_day: "2026-10-23", amount_usd: 120 });
const credit = (usd: number) =>
  row({
    kind: "LEDGER",
    id: 50,
    shop_day: "2026-10-02",
    entry_type: "PAYMENT",
    service_type: null,
    omt_service_type: null,
    commission_model: null,
    amount_usd: -usd,
    row_scope: "ACCOUNT",
  });

const SEPTEMBER = ["2026-09-28", "2026-09-29", "2026-09-30"];

function renderSheet(
  openRows: AccountUnsettledRow[],
  canSettleOldHistory = true,
) {
  mockGetSupplierAccountUnsettled.mockResolvedValue(openRows);
  mockGetSupplierAccountMonthRows.mockImplementation(
    async (_id: number, month: string) =>
      openRows.filter((r) => r.shop_day.startsWith(`${month}-`)),
  );
  mockGetSupplierAccountDayDetail.mockResolvedValue([]);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onSettled = jest.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettleSheet
        account={ACCOUNT}
        onClose={jest.fn()}
        onSettled={onSettled}
        canSettleOldHistory={canSettleOldHistory}
      />
    </QueryClientProvider>,
  );
  return { onSettled };
}

async function openOldHistory(upTo: string): Promise<HTMLElement> {
  fireEvent.click(
    await screen.findByRole("button", { name: "Settle old history up to…" }),
  );
  const panel = await screen.findByTestId(
    "supplier-account-settle-old-history",
  );
  fireEvent.change(within(panel).getByLabelText("Up to"), {
    target: { value: upTo },
  });
  return panel;
}

function dayStatuses(panel: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const el of within(panel).queryAllByTestId(
    "supplier-account-settle-old-day",
  )) {
    out[el.getAttribute("data-day") ?? ""] =
      el.getAttribute("data-status") ?? "";
  }
  return out;
}

describe("AccountSettleSheet — LIRA-343 settle old history (T041)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 901 });
  });

  it("is not offered without the admin flag", async () => {
    renderSheet([SEP28, SEP29, SEP30, OCT23, credit(300)], false);
    await screen.findByTestId("settle-selection-bar");
    expect(
      screen.queryByRole("button", { name: "Settle old history up to…" }),
    ).not.toBeInTheDocument();
  });

  it("previews what closes, then sends the credit-only payload through the settle call", async () => {
    const rows = [SEP28, SEP29, SEP30, OCT23, credit(300)];
    const { onSettled } = renderSheet(rows);

    const panel = await openOldHistory("2026-09-30");
    await waitFor(() =>
      expect(dayStatuses(panel)).toEqual({
        "2026-09-28": "closes",
        "2026-09-29": "closes",
        "2026-09-30": "closes",
      }),
    );
    expect(
      within(panel).getByTestId("supplier-account-settle-old-credit-used")
        .textContent,
    ).toContain("$300.00");

    const confirm = within(panel).getByTestId(
      "supplier-account-settle-old-confirm",
    );
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
    );
    const [accountId, payload] = mockSettleSupplierAccount.mock.calls[0];
    expect(accountId).toBe(1);
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: 1,
      ...payload,
    });
    for (const key of Object.keys(payload)) {
      expect(parsed).toHaveProperty(key);
    }
    const expected = buildDaySelections(rows, {
      pickedDays: new Set(SEPTEMBER),
      creditUsed: { usd: 300, lbp: 0 },
    });
    expect(parsed.selections).toEqual(expected.selections);
    expect(parsed.selections).not.toContainEqual({
      kind: "FINANCIAL_SERVICE",
      id: OCT23.id,
    });
    expect(parsed.include_account_credits).toBe(true);
    expect(parsed.per_currency).toEqual({
      USD: { direction: "PAY", payments: [] },
    });
    expect(parsed.credit_used).toEqual({ usd: 300, lbp: 0 });
    expect(parsed.expected_owed).toEqual(expected.expected_owed);
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
  });

  it("with only $280 of credit, 30 Sep stays open with $20 left", async () => {
    renderSheet([SEP28, SEP29, SEP30, OCT23, credit(280)]);

    const panel = await openOldHistory("2026-09-30");
    await waitFor(() =>
      expect(dayStatuses(panel)).toEqual({
        "2026-09-28": "closes",
        "2026-09-29": "closes",
        "2026-09-30": "open",
      }),
    );
    const sep30 = within(panel)
      .getAllByTestId("supplier-account-settle-old-day")
      .find((el) => el.getAttribute("data-day") === "2026-09-30");
    expect(sep30?.textContent).toContain("$20.00");

    fireEvent.click(
      within(panel).getByTestId("supplier-account-settle-old-confirm"),
    );
    await waitFor(() =>
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
    );
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: 1,
      ...mockSettleSupplierAccount.mock.calls[0][1],
    });
    expect(parsed.credit_used).toEqual({ usd: 280, lbp: 0 });
    expect(parsed.per_currency).toEqual({
      USD: { direction: "PAY", payments: [] },
    });
  });

  it("Confirm is off when nothing would close", async () => {
    // No credit at all: nothing can be paid without money.
    renderSheet([SEP28, SEP29, SEP30, OCT23]);
    const panel = await openOldHistory("2026-09-30");
    await within(panel).findByTestId("supplier-account-settle-old-nothing");
    expect(
      within(panel).getByTestId("supplier-account-settle-old-confirm"),
    ).toBeDisabled();

    // A date before every open day: nothing to close either.
    fireEvent.change(within(panel).getByLabelText("Up to"), {
      target: { value: "2026-09-01" },
    });
    expect(
      within(panel).getByTestId("supplier-account-settle-old-confirm"),
    ).toBeDisabled();
    expect(mockSettleSupplierAccount).not.toHaveBeenCalled();
  });

  it("Confirm is off when the credit only part-pays (nothing closes)", async () => {
    renderSheet([SEP30, OCT23, credit(8.7)]);
    const panel = await openOldHistory("2026-09-30");
    await waitFor(() =>
      expect(dayStatuses(panel)).toEqual({ "2026-09-30": "open" }),
    );
    const sep30 = within(panel).getByTestId("supplier-account-settle-old-day");
    expect(sep30.textContent).toContain("$91.30");
    expect(
      within(panel).getByTestId("supplier-account-settle-old-nothing"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByTestId("supplier-account-settle-old-confirm"),
    ).toBeDisabled();
  });
});

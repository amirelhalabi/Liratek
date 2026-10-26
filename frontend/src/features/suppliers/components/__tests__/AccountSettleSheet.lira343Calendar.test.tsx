/** @jest-environment jsdom */

/**
 * LIRA-343 (T024) — the OMT Settle Account sheet opens on a day calendar.
 *
 * Failing-first (rule 17): written before the sheet had a calendar.
 *
 * Fixture (today = Monday 26 Oct 2026, mocked through `@/shared/utils/localDay`):
 *   30 Sep  $100 transfer                          open
 *   05 Oct  $80 transfer                           settled (month rows only)
 *   23 Oct  $120 transfer                          open
 *   24 Oct  $95 transfer + $40 receive             open
 *   25 Oct  $200 transfer + 990,000 LBP bill       open
 *   26 Oct  $50 transfer (today)                   open
 *   account credit −$8.70 (row_scope ACCOUNT, sits on no day)
 *
 * Default pick = every open day before today: 30 Sep, 23, 24, 25 Oct.
 * They owe $475.00 + 990,000 LBP; the credit pre-fill is min($475, $8.70) =
 * $8.70, so the payment pre-fill is $466.30 + 990,000 LBP.
 *
 * Renders the REAL `MultiPaymentInput` and calendar (jest maps
 * "@liratek/ui" to source); only `useApi` is replaced, by ONE stable
 * module-level object (rule 25). Payloads are parsed through the core schema
 * and compared against `buildDaySelections` on the same rows (rule 24).
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
const mockApi = {
  settleSupplierAccount: mockSettleSupplierAccount,
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
  getSupplierAccountMonthRows: mockGetSupplierAccountMonthRows,
  getSupplierAccountDayDetail: jest.fn(async () => []),
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
const OCT24_RECEIVE = row({
  id: 4,
  shop_day: "2026-10-24",
  service_type: "RECEIVE",
  amount_usd: -40,
});
const OCT25 = row({ id: 5, shop_day: "2026-10-25", amount_usd: 200 });
const OCT25_LBP = row({ id: 6, shop_day: "2026-10-25", amount_lbp: 990000 });
const OCT26_TODAY = row({ id: 7, shop_day: "2026-10-26", amount_usd: 50 });
const ACCOUNT_CREDIT = row({
  kind: "LEDGER",
  id: 50,
  shop_day: "2026-10-20",
  source_name: "OMT",
  entry_type: "PAYMENT",
  service_type: null,
  omt_service_type: null,
  commission_model: null,
  amount_usd: -8.7,
  row_scope: "ACCOUNT",
});
/** Closed: only the month read returns it. */
const OCT05_SETTLED = row({
  id: 8,
  shop_day: "2026-10-05",
  amount_usd: 80,
  covered_usd: 80,
  remaining_usd: 0,
});

const OPEN_ROWS = [
  SEP30,
  ACCOUNT_CREDIT,
  OCT23,
  OCT24,
  OCT24_RECEIVE,
  OCT25,
  OCT25_LBP,
  OCT26_TODAY,
];
const DEFAULT_DAYS = ["2026-09-30", "2026-10-23", "2026-10-24", "2026-10-25"];

function renderSheet(openRows: AccountUnsettledRow[] = OPEN_ROWS) {
  mockGetSupplierAccountUnsettled.mockResolvedValue(openRows);
  mockGetSupplierAccountMonthRows.mockImplementation(
    async (_id: number, month: string) =>
      [...openRows, OCT05_SETTLED].filter((r) =>
        r.shop_day.startsWith(`${month}-`),
      ),
  );
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
      />
    </QueryClientProvider>,
  );
  return { onSettled };
}

/** The day button of `day` (`YYYY-MM-DD`) in the shown month. */
async function dayButton(day: string): Promise<HTMLButtonElement> {
  const cell = await waitFor(() => {
    const el = document.querySelector(`[data-day="${day}"]`);
    if (!el) throw new Error(`day ${day} not rendered`);
    return el as HTMLElement;
  });
  return within(cell).getByRole("button") as HTMLButtonElement;
}

async function mainSection(): Promise<HTMLElement> {
  return screen.findByTestId("supplier-account-settle-section-usd-lbp");
}

function amountInputs(section: HTMLElement): HTMLInputElement[] {
  return within(section).getAllByTestId(
    /^payment-amount-/,
  ) as HTMLInputElement[];
}

/** A payment box amount as a number (the box drops trailing zeros). */
function num(input: HTMLInputElement): number {
  return parseFloat(input.value.replace(/,/g, ""));
}

async function creditInput(): Promise<HTMLInputElement> {
  return (await screen.findByTestId(
    "supplier-account-settle-credit-usd",
  )) as HTMLInputElement;
}

async function confirmAndGetPayload(): Promise<Record<string, unknown>> {
  const submit = screen.getByTestId("supplier-account-settle-submit");
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  await waitFor(() =>
    expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
  );
  const [accountSupplierId, payload] = mockSettleSupplierAccount.mock.calls[0];
  expect(accountSupplierId).toBe(1);
  return payload as Record<string, unknown>;
}

describe("AccountSettleSheet — LIRA-343 settle by day", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 900 });
  });

  it("opens on the current month with every open day before today picked, today not", async () => {
    renderSheet();

    for (const d of ["2026-10-23", "2026-10-24", "2026-10-25"]) {
      expect(await dayButton(d)).toHaveAttribute("aria-pressed", "true");
    }
    // Today is open but never picked by default (FR-008).
    expect(await dayButton("2026-10-26")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // Settled day: not pickable.
    expect(await dayButton("2026-10-05")).not.toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // 30 Sep is picked (across months): no "unselected day in September" link.
    expect(screen.queryByText(/unselected day/i)).not.toBeInTheDocument();
    expect(mockGetSupplierAccountMonthRows).toHaveBeenCalledWith(1, "2026-10");
  });

  it("the selection bar shows the count, the range and what the picked days owe per currency", async () => {
    renderSheet();

    const bar = await screen.findByTestId("settle-selection-bar");
    await waitFor(() => expect(bar.textContent).toContain("$475.00"));
    expect(bar.textContent).toContain("990,000 LBP");
    expect(bar.textContent).toContain("4");
    expect(bar.textContent).toContain("→");
  });

  it("tapping a picked day unpicks it, flags it as left out, and the payment follows", async () => {
    renderSheet();

    const oct23 = await dayButton("2026-10-23");
    await waitFor(() => expect(oct23).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(oct23);
    expect(await dayButton("2026-10-23")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    const bar = screen.getByTestId("settle-selection-bar");
    await waitFor(() => expect(bar.textContent).toContain("$355.00"));
    expect(bar.textContent).toMatch(/1 left out/);
    // $355 − $8.70 credit = $346.30.
    await waitFor(async () =>
      expect(num(amountInputs(await mainSection())[0])).toBe(346.3),
    );

    // Tapping it again picks it back.
    fireEvent.click(await dayButton("2026-10-23"));
    expect(await dayButton("2026-10-23")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("an older month with unpicked open days shows a link that opens that month", async () => {
    renderSheet();

    await dayButton("2026-10-23");
    fireEvent.click(screen.getByText("Clear"));
    fireEvent.click(await dayButton("2026-10-23"));

    const link = await screen.findByText(/1 unselected day in September/);
    fireEvent.click(link);
    await waitFor(() =>
      expect(mockGetSupplierAccountMonthRows).toHaveBeenCalledWith(
        1,
        "2026-09",
      ),
    );
    expect(await dayButton("2026-09-30")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it('"Use OMT credit" is pre-filled with min(owed, credit) and the payment with owed − credit', async () => {
    renderSheet();

    expect((await creditInput()).value).toBe("8.70");
    expect(
      screen.getByTestId("supplier-account-settle-credit-total-usd")
        .textContent,
    ).toContain("$8.70");
    // No account credit in LBP: no LBP credit line.
    expect(
      screen.queryByTestId("supplier-account-settle-credit-lbp"),
    ).not.toBeInTheDocument();

    const [usd, lbp] = amountInputs(await mainSection());
    await waitFor(() => expect(num(usd)).toBe(466.3));
    expect(num(lbp)).toBe(990000);
  });

  it("setting the credit to 0 makes the payment the full amount owed", async () => {
    renderSheet();

    fireEvent.change(await creditInput(), { target: { value: "0" } });
    await waitFor(async () =>
      expect(num(amountInputs(await mainSection())[0])).toBe(475.0),
    );
  });

  it("the credit can never be set above what may be used", async () => {
    renderSheet();

    fireEvent.change(await creditInput(), { target: { value: "50" } });
    expect((await creditInput()).value).toBe("8.70");
  });

  it("typing a payment does not move the credit; the preview shows the part-paid transfer", async () => {
    renderSheet();

    const section = await mainSection();
    await waitFor(() => expect(num(amountInputs(section)[0])).toBe(466.3));
    fireEvent.change(amountInputs(section)[0], { target: { value: "300" } });

    expect((await creditInput()).value).toBe("8.70");
    // FR-015: $8.70 credit + $300 covers 30 Sep, 23 and 24 Oct; 25 Oct's
    // $200 transfer is part-paid with $166.30 left.
    await waitFor(() => {
      const partial = within(section)
        .getAllByTestId("supplier-account-settle-preview-row")
        .filter((r) => r.getAttribute("data-status") === "part-paid");
      expect(partial.map((r) => r.getAttribute("data-row-id"))).toEqual(["5"]);
      expect(partial[0].textContent).toContain("$166.30");
    });
    expect(
      within(section).getByTestId("supplier-account-settle-still-owed-usd")
        .textContent,
    ).toBe("$166.30");
    expect(
      within(section).getByTestId("supplier-account-settle-credit-applied-usd")
        .textContent,
    ).toContain("$8.70");
  });

  it("the payload is buildDaySelections + per_currency, with the schema's own field names (rule 22/24)", async () => {
    renderSheet();

    const [usd] = amountInputs(await mainSection());
    await waitFor(() => expect(num(usd)).toBe(466.3));
    const payload = await confirmAndGetPayload();

    const expected = buildDaySelections(OPEN_ROWS, {
      pickedDays: new Set(DEFAULT_DAYS),
    });
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: 1,
      ...payload,
    });
    // Zod strips unknown keys silently: every key sent must survive parsing.
    for (const key of Object.keys(payload)) {
      expect(parsed).toHaveProperty(key);
    }
    expect(parsed.selections).toEqual(expected.selections);
    expect(parsed.include_account_credits).toBe(true);
    expect(parsed.credit_used).toEqual(expected.credit_used);
    expect(parsed.expected_owed).toEqual(expected.expected_owed);
    expect(parsed.per_currency).toEqual({
      USD: {
        direction: "PAY",
        payments: [
          {
            method: "CASH",
            currency_code: "USD",
            amount: expected.prefill.usd,
          },
        ],
      },
      LBP: {
        direction: "PAY",
        payments: [
          {
            method: "CASH",
            currency_code: "LBP",
            amount: expected.prefill.lbp,
          },
        ],
      },
    });
    // Today's transfer is not in the selection.
    expect(parsed.selections).not.toContainEqual({
      kind: "FINANCIAL_SERVICE",
      id: OCT26_TODAY.id,
    });
  });

  it("a currency left out of per_currency sends credit_used 0 in it (the server refuses credit with no section)", async () => {
    const lbpCredit = row({
      kind: "LEDGER",
      id: 51,
      shop_day: "2026-10-19",
      entry_type: "PAYMENT",
      service_type: null,
      omt_service_type: null,
      commission_model: null,
      amount_lbp: -100000,
      row_scope: "ACCOUNT",
    });
    renderSheet([...OPEN_ROWS, lbpCredit]);

    const lbpCreditInput = (await screen.findByTestId(
      "supplier-account-settle-credit-lbp",
    )) as HTMLInputElement;
    expect(lbpCreditInput.value).toBe("100000");
    const section = await mainSection();
    await waitFor(() => expect(num(amountInputs(section)[1])).toBe(890000));
    // Pay $ only: clear the LBP line.
    fireEvent.change(amountInputs(section)[1], { target: { value: "0" } });

    const payload = await confirmAndGetPayload();
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: 1,
      ...payload,
    });
    expect(Object.keys(parsed.per_currency ?? {})).toEqual(["USD"]);
    expect(parsed.credit_used).toEqual({ usd: 8.7, lbp: 0 });
  });

  // Variant cases (rule 28d). Written AFTER the sheet change — not proven
  // failing-first (rule 17).
  it("variant: the credit covers the whole currency — no payment, section sent with payments: []", async () => {
    const small = row({ id: 60, shop_day: "2026-10-23", amount_usd: 5 });
    renderSheet([small, ACCOUNT_CREDIT]);

    expect((await creditInput()).value).toBe("5.00");
    const usd = await screen.findByTestId(
      "supplier-account-settle-section-usd",
    );
    expect(within(usd).queryAllByTestId(/^payment-amount-/)).toHaveLength(0);
    await waitFor(() =>
      expect(
        within(usd).getByTestId("supplier-account-settle-credit-applied-usd")
          .textContent,
      ).toBe("$5.00"),
    );

    const payload = await confirmAndGetPayload();
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: 1,
      ...payload,
    });
    expect(parsed.per_currency).toEqual({
      USD: { direction: "PAY", payments: [] },
    });
    expect(parsed.credit_used).toEqual({ usd: 5, lbp: 0 });
    expect(parsed.expected_owed?.usd).toBeCloseTo(-3.7, 2);
    expect(parsed.selections).toEqual([{ kind: "FINANCIAL_SERVICE", id: 60 }]);
  });

  it("variant: OMT pays the shop — COLLECT, pre-filled with the day credit plus the account credit", async () => {
    const receive = row({
      id: 61,
      shop_day: "2026-10-23",
      service_type: "RECEIVE",
      amount_usd: -100,
    });
    renderSheet([receive, ACCOUNT_CREDIT]);

    expect((await creditInput()).value).toBe("8.70");
    const usd = await screen.findByTestId(
      "supplier-account-settle-section-usd",
    );
    expect(usd.textContent).toContain("OMT pays you");
    await waitFor(() => expect(num(amountInputs(usd)[0])).toBe(108.7));
    await waitFor(() =>
      expect(
        within(usd).getByTestId("supplier-account-settle-credit-applied-usd")
          .textContent,
      ).toBe("$8.70"),
    );

    const payload = await confirmAndGetPayload();
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: 1,
      ...payload,
    });
    expect(parsed.per_currency?.USD).toEqual({
      direction: "COLLECT",
      payments: [{ method: "CASH", currency_code: "USD", amount: 108.7 }],
    });
    expect(parsed.credit_used).toEqual({ usd: 8.7, lbp: 0 });
    expect(parsed.expected_owed?.usd).toBeCloseTo(-108.7, 2);
  });

  it("SC-001: with the default selection, Confirm is the only tap needed", async () => {
    const { onSettled } = renderSheet();

    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    // Only the calendar has rendered and nothing was typed or tapped yet.
    await screen.findByTestId("settle-selection-bar");
    fireEvent.click(submit);
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1);
  });

  it("with nothing picked, Confirm is off", async () => {
    renderSheet();

    await dayButton("2026-10-23");
    fireEvent.click(screen.getByText("Clear"));
    await waitFor(() =>
      expect(
        screen.getByTestId("supplier-account-settle-submit"),
      ).toBeDisabled(),
    );
  });

  it("no account credit: no credit line, and the payment is what the picked days owe", async () => {
    renderSheet(OPEN_ROWS.filter((r) => r.row_scope !== "ACCOUNT"));

    const [usd] = amountInputs(await mainSection());
    await waitFor(() => expect(num(usd)).toBe(475.0));
    expect(
      screen.queryByTestId("supplier-account-settle-credit-usd"),
    ).not.toBeInTheDocument();
  });

  it("the old top-level Pick transfers toggle is gone (it moves into day details)", async () => {
    renderSheet();

    await screen.findByTestId("settle-selection-bar");
    expect(
      screen.queryByTestId("supplier-account-settle-pick-toggle"),
    ).not.toBeInTheDocument();
  });

  it("never reaches for window.api directly (rule 19)", async () => {
    const touched: string[] = [];
    const rawApi = new Proxy(
      {},
      {
        get(_t, prop) {
          touched.push(String(prop));
          return undefined;
        },
      },
    );
    Object.defineProperty(window, "api", {
      value: rawApi,
      configurable: true,
    });
    try {
      renderSheet();
      await confirmAndGetPayload();
      expect(touched).toEqual([]);
    } finally {
      Reflect.deleteProperty(window, "api");
    }
  });
});

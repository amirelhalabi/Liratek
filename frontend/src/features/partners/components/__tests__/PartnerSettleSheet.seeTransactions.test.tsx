/** @jest-environment jsdom */

/**
 * "See transactions" (owner mock 2026-10-26 §7) on the partner settle sheet
 * (LIRA-346): the pill under the month line, the table of the picked days'
 * entries (paid ones too, For / Through tag, notes as name / ref), and an
 * untick there leaving the entry out of the plan.
 *
 * Owner decision 2026-10-27: the inline day details are gone — a day tap
 * only picks / unpicks (guard below, failing-first against the sheet that
 * still opened them), and the ↺ line's day link only switches the month.
 *
 * Failing-first (rule 17): written before the sheet wired the panel. Same
 * fixture as `PartnerSettleSheet.test.tsx` plus a paid 20 Oct entry that
 * only the month read returns. ONE stable `useApi` object (rule 25).
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PartnerSettleRow } from "@liratek/core";
import { PartnerSettleSheet } from "../PartnerSettleSheet";

jest.mock("@/shared/utils/localDay", () => {
  const actual = jest.requireActual("@/shared/utils/localDay");
  return { ...actual, localDay: () => "2026-10-26" };
});

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

const mockSettleDays = jest.fn();
const mockGetOpenRows = jest.fn();
const mockGetMonthRows = jest.fn();
const mockGetDayDetail = jest.fn();
// Rule 25: ONE stable object, never a fresh literal per useApi() call.
const mockApi = {
  partners: {
    getSettleOpenRows: mockGetOpenRows,
    getSettleMonthRows: mockGetMonthRows,
    getSettleDayDetail: mockGetDayDetail,
    settleDays: mockSettleDays,
  },
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return { ...actual, useApi: () => mockApi };
});

function row(
  over: Partial<PartnerSettleRow> &
    Pick<PartnerSettleRow, "id" | "shop_day">,
): PartnerSettleRow {
  const usd = over.amount_usd ?? 0;
  return {
    kind: "LEDGER",
    partner_id: 7,
    currency: "USD",
    transaction_type: "FOR_POS",
    direction: usd >= 0 ? "DEBIT" : "CREDIT",
    reference_table: null,
    reference_id: null,
    notes: null,
    source_txn_id: null,
    created_at: `${over.shop_day} 09:00:00`,
    amount_lbp: 0,
    covered_usd: 0,
    covered_lbp: 0,
    remaining_usd: usd,
    remaining_lbp: 0,
    row_scope: "DAY",
    unit_class: "DAY",
    relief_origin: null,
    relief_ref: null,
    ...over,
    amount_usd: usd,
  };
}

const FOR_20 = row({ id: 11, shop_day: "2026-10-20", amount_usd: 100 });
const THROUGH_21 = row({
  id: 12,
  shop_day: "2026-10-21",
  amount_usd: -300,
  transaction_type: "THROUGH_OMT_SEND",
});
const TODAY_26 = row({ id: 15, shop_day: "2026-10-26", amount_usd: 50 });

const onSettled = jest.fn();
const onClose = jest.fn();

function renderSheet(props: { canSettleOldHistory?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PartnerSettleSheet
        partner={{ id: 7, name: "Karim" }}
        onClose={onClose}
        onSettled={onSettled}
        {...props}
      />
    </QueryClientProvider>,
  );
}

/** Paid on 20 Oct: in the month read only. */
const PAID_20 = row({
  id: 9,
  shop_day: "2026-10-20",
  amount_usd: 40,
  covered_usd: 40,
  remaining_usd: 0,
  notes: "iPhone case",
});
const OPEN = [FOR_20, { ...THROUGH_21, notes: "OMT send to Rami" }, TODAY_26];

describe("PartnerSettleSheet — See transactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOpenRows.mockResolvedValue(OPEN);
    mockGetMonthRows.mockResolvedValue([...OPEN, PAID_20]);
    mockGetDayDetail.mockResolvedValue([]);
    mockSettleDays.mockResolvedValue({ success: true, id: 99 });
  });

  it("shows the pill with N open entries on the picked days, and opens the table", async () => {
    renderSheet();
    const btn = await screen.findByTestId("settle-see-transactions");
    // 20 and 21 Oct picked by default: 2 open entries.
    await waitFor(() => expect(btn).toHaveTextContent("2"));
    fireEvent.click(btn);
    const panel = await screen.findByTestId("settle-transactions-panel");
    expect(btn).toHaveAttribute("aria-expanded", "true");

    const paid = await within(panel).findByTestId("settle-tx-row-LEDGER:9");
    expect(paid).toHaveTextContent("paid");
    expect(paid).toHaveTextContent("iPhone case");
    expect(within(paid).getByText("For")).toBeInTheDocument();

    const through = within(panel).getByTestId("settle-tx-row-LEDGER:12");
    expect(within(through).getByText("Through")).toBeInTheDocument();
    expect(through).toHaveTextContent("OMT SEND");
    expect(through).toHaveTextContent("OMT send to Rami");
    // Today (26 Oct) is not picked.
    expect(within(panel).queryByTestId("settle-tx-row-LEDGER:15")).not.toBeInTheDocument();
  });

  it("unticking the Through entry leaves it out: Karim now pays you", async () => {
    renderSheet();
    expect(await screen.findByTestId("partner-settle-payer-usd")).toHaveTextContent(
      "You pay Karim",
    );
    fireEvent.click(await screen.findByTestId("settle-see-transactions"));
    const panel = await screen.findByTestId("settle-transactions-panel");
    const through = await within(panel).findByTestId("settle-tx-row-LEDGER:12");
    fireEvent.click(within(through).getByRole("checkbox"));
    await waitFor(() =>
      expect(screen.getByTestId("partner-settle-payer-usd")).toHaveTextContent(
        "Karim pays you",
      ),
    );
    expect(within(through).getByRole("checkbox")).not.toBeChecked();
    expect(through).toHaveTextContent("unticked");
  });

  it("tapping a day only picks / unpicks it: no day details, no day-detail read", async () => {
    renderSheet();
    const cell = await waitFor(() => {
      const el = document.querySelector('[data-day="2026-10-20"] button');
      if (!el) throw new Error("calendar not rendered");
      return el as HTMLButtonElement;
    });
    await waitFor(() => expect(cell).toHaveAttribute("aria-pressed", "true"));
    fireEvent.click(cell);
    await waitFor(() =>
      expect(
        document.querySelector('[data-day="2026-10-20"] button'),
      ).toHaveAttribute("aria-pressed", "false"),
    );
    expect(screen.queryByTestId("settle-day-details")).not.toBeInTheDocument();
    expect(mockGetDayDetail).not.toHaveBeenCalled();
  });

  it("the ↺ line's day link switches the calendar to that month and opens nothing", async () => {
    const RELIEF = row({
      id: 20,
      shop_day: "2026-10-24",
      amount_usd: 30,
      row_scope: "ACCOUNT",
      relief_origin: "UNDO",
      relief_ref: "#5",
    });
    mockGetOpenRows.mockResolvedValue([...OPEN, RELIEF]);
    renderSheet();
    const line = await screen.findByTestId("partner-settle-relief-line");
    await waitFor(() =>
      expect(document.querySelector('[data-day="2026-10-24"]')).not.toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() =>
      expect(document.querySelector('[data-day="2026-10-24"]')).toBeNull(),
    );
    fireEvent.click(within(line).getByRole("button"));
    await waitFor(() =>
      expect(document.querySelector('[data-day="2026-10-24"]')).not.toBeNull(),
    );
    expect(screen.queryByTestId("settle-day-details")).not.toBeInTheDocument();
    expect(mockGetDayDetail).not.toHaveBeenCalled();
  });
});

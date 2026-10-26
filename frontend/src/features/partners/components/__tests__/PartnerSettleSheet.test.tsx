/** @jest-environment jsdom */

/**
 * LIRA-346 — the Partners page settles by day on a calendar sheet.
 *
 * Failing-first (rule 17): written before `PartnerSettleSheet.tsx` existed.
 *
 * Fixture (today = Monday 26 Oct 2026, mocked through
 * `@/shared/utils/localDay`; spec 346 P2):
 *   20 Oct  For +$100       (Karim owes the shop)       open
 *   21 Oct  Through −$300   (the shop owes Karim)       open
 *   26 Oct  For +$50        (today, never picked by default)
 *
 * Default pick = every open day before today: 20 and 21 Oct. Net: the shop
 * pays Karim $200.
 *
 * Renders the REAL calendar and `MultiPaymentInput`; only `useApi` is
 * replaced, by ONE stable module-level object (rule 25). The sent payload is
 * parsed through the core schema and compared with the page's ONE builder
 * on the same rows (rules 22 / 24).
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  partnerSettleDaysSchema,
  type PartnerSettleRow,
} from "@liratek/core";
import { PartnerSettleSheet } from "../PartnerSettleSheet";
import {
  buildPartnerOldHistoryPayload,
  buildPartnerSettleDaysPayload,
} from "../../utils/partnerSettleDaysPayload";

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
const ROWS = [FOR_20, THROUGH_21, TODAY_26];

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

/** The day button of `day` (`YYYY-MM-DD`) in the shown month. */
async function dayButton(day: string): Promise<HTMLButtonElement> {
  const cell = await waitFor(() => {
    const el = document.querySelector(`[data-day="${day}"]`);
    if (!el) throw new Error(`day ${day} not rendered`);
    return el as HTMLElement;
  });
  return within(cell).getByRole("button") as HTMLButtonElement;
}

describe("PartnerSettleSheet (LIRA-346)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOpenRows.mockResolvedValue(ROWS);
    mockGetMonthRows.mockResolvedValue(ROWS);
    mockGetDayDetail.mockResolvedValue([]);
    mockSettleDays.mockResolvedValue({ success: true, id: 99 });
  });

  it("picks every open day before today by default and says who pays", async () => {
    renderSheet();
    expect(await screen.findByText("2 days picked")).toBeInTheDocument();
    expect(await screen.findByTestId("partner-settle-payer-usd")).toHaveTextContent(
      "You pay Karim",
    );
    expect(screen.getByTestId("partner-settle-owed-usd")).toHaveTextContent(
      "$200.00",
    );
    expect(mockGetMonthRows).toHaveBeenCalledWith(7, "2026-10");
  });

  it("confirm sends the builder's payload (parsed through the schema)", async () => {
    renderSheet();
    await screen.findByTestId("partner-settle-payer-usd");
    const submit = screen.getByTestId("partner-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() => expect(mockSettleDays).toHaveBeenCalledTimes(1));
    const sent = partnerSettleDaysSchema.parse(mockSettleDays.mock.calls[0][0]);
    const expected = partnerSettleDaysSchema.parse(
      buildPartnerSettleDaysPayload({
        partnerId: 7,
        openRows: ROWS,
        pickedDays: ["2026-10-20", "2026-10-21"],
        money: {
          USD: { lines: [{ method: "CASH", currencyCode: "USD", amount: 200 }] },
        },
        exchangeRate: 89000,
      }),
    );
    expect(sent).toEqual(expected);
    expect(sent.selections).toEqual([11, 12]);
    expect(sent.per_currency.USD?.payer).toBe("SHOP");
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
  });

  it("shows the server's error and stays open", async () => {
    mockSettleDays.mockResolvedValue({
      success: false,
      error: "There is nothing to settle for the days and amounts entered.",
    });
    renderSheet();
    await screen.findByTestId("partner-settle-payer-usd");
    const submit = screen.getByTestId("partner-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    expect(await screen.findByTestId("partner-settle-error")).toHaveTextContent(
      "There is nothing to settle for the days and amounts entered.",
    );
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("only the partner's own day picked: the partner pays, Forgive is offered", async () => {
    renderSheet();
    await screen.findByTestId("partner-settle-payer-usd");
    // Unpick 21 Oct: only the For +$100 is left.
    fireEvent.click(await dayButton("2026-10-21"));
    await waitFor(() =>
      expect(screen.getByTestId("partner-settle-payer-usd")).toHaveTextContent(
        "Karim pays you",
      ),
    );
    expect(screen.getByTestId("partner-settle-forgive")).toBeInTheDocument();
  });

  it("a payment box that disappears (days now cancel out) sends no stale legs", async () => {
    const even = row({
      id: 13,
      shop_day: "2026-10-21",
      amount_usd: -100,
      transaction_type: "THROUGH_OMT_SEND",
    });
    mockGetOpenRows.mockResolvedValue([FOR_20, even]);
    mockGetMonthRows.mockResolvedValue([FOR_20, even]);
    renderSheet();
    // Both days picked: +100 and −100 cancel out, no payment box.
    expect(
      await screen.findByTestId("partner-settle-payer-usd"),
    ).toHaveTextContent("the picked days cancel out");
    // Unpick 21 Oct: the box appears and fills $100 cash.
    fireEvent.click(await dayButton("2026-10-21"));
    await screen.findByTestId("payment-exchange-rate");
    // Pick it again: the box goes away.
    fireEvent.click(await dayButton("2026-10-21"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("payment-exchange-rate"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("partner-settle-preview-usd")).toHaveTextContent(
      "Everything picked closes.",
    );
    const submit = screen.getByTestId("partner-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() => expect(mockSettleDays).toHaveBeenCalledTimes(1));
    const sent = partnerSettleDaysSchema.parse(mockSettleDays.mock.calls[0][0]);
    expect(sent.selections).toEqual([11, 13]);
    expect(sent.per_currency.USD).toEqual({ payer: "PARTNER", payments: [] });
  });

  it("old history (admin): no money, the same builder, every open day up to the date", async () => {
    renderSheet({ canSettleOldHistory: true });
    fireEvent.click(await screen.findByTestId("partner-settle-old-history-open"));
    expect(
      screen.getByText(/Nothing goes in or out of a drawer/),
    ).toBeInTheDocument();
    // Up to 21 Oct: the For +$100 and the Through −$300 net against each other.
    fireEvent.change(screen.getByTestId("partner-settle-old-history-date"), {
      target: { value: "2026-10-21" },
    });
    expect(
      screen.getByTestId("partner-settle-old-history-count"),
    ).toHaveTextContent("2 open days will be settled.");
    fireEvent.click(screen.getByTestId("partner-settle-old-history-confirm"));
    await waitFor(() => expect(mockSettleDays).toHaveBeenCalledTimes(1));
    const sent = partnerSettleDaysSchema.parse(mockSettleDays.mock.calls[0][0]);
    expect(sent).toEqual(
      partnerSettleDaysSchema.parse(
        buildPartnerOldHistoryPayload({
          partnerId: 7,
          openRows: ROWS,
          upTo: "2026-10-21",
        }),
      ),
    );
    expect(sent.selections).toEqual([11, 12]);
    expect(sent.per_currency.USD?.payments).toEqual([]);
  });

  it("old history: nothing to close with no money (a debt alone) — says so, confirm off", async () => {
    renderSheet({ canSettleOldHistory: true });
    fireEvent.click(await screen.findByTestId("partner-settle-old-history-open"));
    fireEvent.change(screen.getByTestId("partner-settle-old-history-date"), {
      target: { value: "2026-10-20" },
    });
    expect(
      screen.getByTestId("partner-settle-old-history-count"),
    ).toHaveTextContent("Nothing closes up to this date without money.");
    expect(
      screen.getByTestId("partner-settle-old-history-confirm"),
    ).toBeDisabled();
  });

  it("old history is not offered to a non-admin", async () => {
    renderSheet();
    await screen.findByTestId("partner-settle-payer-usd");
    expect(
      screen.queryByTestId("partner-settle-old-history-open"),
    ).not.toBeInTheDocument();
  });

  it("never reaches for the raw window.api bridge", async () => {
    const raw = { partners: { settleDays: jest.fn(), getSettleOpenRows: jest.fn() } };
    (window as unknown as { api?: unknown }).api = raw;
    try {
      renderSheet();
      await screen.findByTestId("partner-settle-payer-usd");
      const submit = screen.getByTestId("partner-settle-submit");
      await waitFor(() => expect(submit).not.toBeDisabled());
      fireEvent.click(submit);
      await waitFor(() => expect(mockSettleDays).toHaveBeenCalledTimes(1));
      expect(raw.partners.settleDays).not.toHaveBeenCalled();
      expect(raw.partners.getSettleOpenRows).not.toHaveBeenCalled();
    } finally {
      delete (window as unknown as { api?: unknown }).api;
    }
  });
});

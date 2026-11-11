/**
 * AccountSettleSheet — 3 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 3).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supplierSettleAccountSchema } from "@liratek/core";
import { AccountSettleSheet } from "../AccountSettleSheet";
import { type AccountUnsettledRow } from "../../hooks/useSuppliers";
import { OMT_ACCOUNT, queueRow } from "../../testing/accountSettleFixtures";
import { tickAllCoveredTypes } from "../../testing/coveredTypesPicker";

const mockSettleSupplierAccount = jest.fn();

const mockGetSupplierAccountUnsettled = jest.fn();

const mockGetOwedShares = jest.fn(async () => []);

// Module-level and stable (rule 25).
const mockApi = {
  settleSupplierAccount: mockSettleSupplierAccount,
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
  getSupplierAccountOwedShares: mockGetOwedShares,
  getSupplierAccountMonthRows: jest.fn(async () => []),
  getSupplierAccountDayDetail: jest.fn(async () => []),
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
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

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockSettleSupplierAccount as unknown as jest.Mock).mockReset();
  (mockGetSupplierAccountUnsettled as unknown as jest.Mock).mockReset();
  (mockGetOwedShares as unknown as jest.Mock).mockReset();
  (mockGetOwedShares as unknown as jest.Mock).mockImplementation(
    async () => [],
  );
  (mockApi.getSupplierAccountMonthRows as unknown as jest.Mock).mockReset();
  (
    mockApi.getSupplierAccountMonthRows as unknown as jest.Mock
  ).mockImplementation(async () => []);
  (mockApi.getSupplierAccountDayDetail as unknown as jest.Mock).mockReset();
  (
    mockApi.getSupplierAccountDayDetail as unknown as jest.Mock
  ).mockImplementation(async () => []);
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("AccountSettleSheet.lira370Sms (LIRA-370)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-370 (T015/T019/T021/T029) — the OMT Settle Account sheet settles
   * from the amount on OMT's SMS (owner 2026-11-03):
   *   - the SMS box opens at what OMT's SMS should say (owed − expected
   *     commission), so an untouched box books the expected commission;
   *   - typing the SMS figure works the commission out, the payment follows
   *     the SMS, and every picked transfer closes in one settlement;
   *   - OMT asking for more (or paying less) is a warning, never negative
   *     commission;
   *   - OMT owing us: the receive follows the SMS, no "change to return".
   *
   * Field names in the payload come from the core schema (`parse`, rule 24).
   * Not proven failing-first: written after the sheet change (rule 17).
   */

  const ledger = (id: number, usd: number, at: string): AccountUnsettledRow =>
    queueRow({
      id,
      kind: "LEDGER",
      created_at: at,
      amount_usd: usd,
      service_type: null,
      entry_type: "TOP_UP",
      omt_service_type: null,
      commission_model: null,
      source_provider: "iPick",
    });

  const send = (
    id: number,
    usd: number,
    type: string,
    commission: number,
    at: string,
  ): AccountUnsettledRow =>
    queueRow({
      id,
      created_at: at,
      amount_usd: usd,
      omt_service_type: type,
      commission_model: 1,
      expected_commission_usd: commission,
      commission_accounted_usd: 0,
    });

  /** The test shop on 2026-11-03: we owe OMT 776.50, expected commission 4.20. */
  const PAY_ROWS: AccountUnsettledRow[] = [
    ledger(323, 200, "2026-10-16 08:00:00"),
    ledger(324, 200, "2026-10-16 08:05:00"),
    send(505, 204, "CASH_TO_BUSINESS", 1, "2026-10-16 09:00:00"),
    send(507, 50.5, "ONLINE_BROKERAGE", 3, "2026-10-16 09:10:00"),
    send(508, 101, "INTRA", 0.1, "2026-10-16 09:20:00"),
    send(818, 21, "INTRA", 0.1, "2026-10-26 09:00:00"),
  ];

  /** + a $1,000 Western Union receive: OMT owes us 223.50 (expected 6.20). */
  const COLLECT_ROWS: AccountUnsettledRow[] = [
    ...PAY_ROWS,
    {
      ...send(1346, 0, "WESTERN_UNION", 2, "2026-10-30 10:00:00"),
      service_type: "RECEIVE",
      amount_usd: -1000,
      remaining_usd: -1000,
    },
  ];

  // LIRA-378 (owner 2026-11-09): the SMS sheet now opens with NOTHING ticked
  // (= OMT pays no commission). These cases are about the commission the SMS
  // works out, so each one first ticks "All types" — the old default.
  async function renderSheet(
    rows: AccountUnsettledRow[],
    settlesFromSms = true,
  ) {
    mockGetSupplierAccountUnsettled.mockResolvedValue(rows);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AccountSettleSheet
          account={OMT_ACCOUNT}
          settlesFromSms={settlesFromSms}
          onClose={jest.fn()}
          onSettled={jest.fn()}
        />
      </QueryClientProvider>,
    );
    if (settlesFromSms) {
      await screen.findByTestId("supplier-account-settle-section-usd");
      await tickAllCoveredTypes("supplier-account-settle-covered");
    }
  }

  const amountInput = (section: HTMLElement) =>
    within(section).getAllByTestId(/^payment-amount-/)[0] as HTMLInputElement;
  const smsInput = () =>
    screen.getByTestId("supplier-account-settle-sms-usd") as HTMLInputElement;
  const commissionLine = () =>
    screen.getByTestId("supplier-account-settle-sms-commission-usd")
      .textContent;

  async function submitAndParse() {
    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
    );
    const [accountSupplierId, payload] =
      mockSettleSupplierAccount.mock.calls[0];
    return supplierSettleAccountSchema.parse({
      account_supplier_id: accountSupplierId,
      ...payload,
    });
  }

  describe("AccountSettleSheet — settle OMT from the SMS amount (LIRA-370)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 900 });
    });

    it("opens at the expected figure: SMS 772.30, commission $4.20, the box pays 772.30", async () => {
      await renderSheet(PAY_ROWS);
      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd",
      );
      expect(smsInput().value).toBe("772.30");
      expect(commissionLine()).toContain("$4.20");
      await waitFor(() =>
        expect(Number(amountInput(usd).value.replace(/,/g, ""))).toBe(772.3),
      );
    });

    it("untouched box: the payload carries the expected figure and its commission (never 0)", async () => {
      await renderSheet(PAY_ROWS);
      await screen.findByTestId("supplier-account-settle-section-usd");
      const parsed = await submitAndParse();
      expect(parsed.per_currency?.USD?.sms_amount).toBe(772.3);
      expect(parsed.per_currency?.USD?.commission).toBe(4.2);
    });

    it("SMS 762.30: commission $14.20 ($4.20 + $10.00 extra), pays 762.30, every row closes", async () => {
      await renderSheet(PAY_ROWS);
      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd",
      );
      fireEvent.change(smsInput(), { target: { value: "762.30" } });
      await waitFor(() => expect(commissionLine()).toContain("$14.20"));
      expect(commissionLine()).toContain("$10.00");
      await waitFor(() =>
        expect(Number(amountInput(usd).value.replace(/,/g, ""))).toBe(762.3),
      );
      const statuses = within(usd)
        .getAllByTestId("supplier-account-settle-preview-row")
        .map((r) => r.getAttribute("data-status"));
      expect(statuses.every((s) => s === "closes")).toBe(true);
      const parsed = await submitAndParse();
      expect(parsed.per_currency?.USD).toMatchObject({
        direction: "PAY",
        sms_amount: 762.3,
        commission: 14.2,
      });
      expect(
        parsed.per_currency?.USD?.payments.reduce((s, l) => s + l.amount, 0),
      ).toBe(762.3);
    });

    it("SMS 790: OMT asks $13.50 more — a warning, commission $0.00", async () => {
      await renderSheet(PAY_ROWS);
      await screen.findByTestId("supplier-account-settle-section-usd");
      fireEvent.change(smsInput(), { target: { value: "790" } });
      await waitFor(() =>
        expect(
          screen.getByTestId("supplier-account-settle-sms-asks-more-usd")
            .textContent,
        ).toContain("$13.50"),
      );
      expect(commissionLine()).toContain("$0.00");
    });

    it("SMS 774.50: less than expected is a note, not a warning", async () => {
      await renderSheet(PAY_ROWS);
      await screen.findByTestId("supplier-account-settle-section-usd");
      fireEvent.change(smsInput(), { target: { value: "774.50" } });
      await waitFor(() =>
        expect(
          screen.getByTestId("supplier-account-settle-sms-less-usd"),
        ).toBeTruthy(),
      );
      expect(
        screen.queryByTestId("supplier-account-settle-sms-asks-more-usd"),
      ).toBeNull();
      expect(commissionLine()).toContain("$2.00");
    });

    it("OMT owes us: SMS −249.70 receives 249.70, commission $26.20, no change to return", async () => {
      await renderSheet(COLLECT_ROWS);
      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd",
      );
      expect(smsInput().value).toBe("-229.70");
      fireEvent.change(smsInput(), { target: { value: "-249.70" } });
      await waitFor(() => expect(commissionLine()).toContain("$26.20"));
      await waitFor(() =>
        expect(Number(amountInput(usd).value.replace(/,/g, ""))).toBe(249.7),
      );
      expect(within(usd).queryByText(/change to return/i)).toBeNull();
      const parsed = await submitAndParse();
      expect(parsed.per_currency?.USD).toMatchObject({
        direction: "COLLECT",
        sms_amount: -249.7,
        commission: 26.2,
      });
    });

    it("an OMT credit smaller than the days: the SMS opens net of it (758.10)", async () => {
      await renderSheet([
        ...PAY_ROWS,
        {
          ...ledger(900, 0, "2026-10-27 08:00:00"),
          amount_usd: -14.2,
          remaining_usd: -14.2,
          row_scope: "ACCOUNT",
          entry_type: "PAYMENT",
        },
      ]);
      await screen.findByTestId("supplier-account-settle-section-usd");
      await waitFor(() => expect(smsInput().value).toBe("758.10"));
    });

    // Owner 2026-11-03: the whole credit is used, so 776.50 owed − 1000
    // credit flips to "OMT pays you" 223.50; expected SMS −227.70.
    // Not proven failing-first: the sheet change was written before this
    // rewrite (the core tests for the same rule were seen failing first).
    it("an OMT credit bigger than the days flips to OMT pays you: SMS −227.70, receive 227.70, the whole credit used", async () => {
      await renderSheet([
        ...PAY_ROWS,
        {
          ...ledger(900, 0, "2026-10-27 08:00:00"),
          amount_usd: -1000,
          remaining_usd: -1000,
          row_scope: "ACCOUNT",
          entry_type: "PAYMENT",
        },
      ]);
      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd",
      );
      await waitFor(() => expect(smsInput().value).toBe("-227.70"));
      expect(commissionLine()).toContain("$4.20");
      await waitFor(() =>
        expect(Number(amountInput(usd).value.replace(/,/g, ""))).toBe(227.7),
      );
      const parsed = await submitAndParse();
      expect(parsed.per_currency?.USD).toMatchObject({
        direction: "COLLECT",
        sms_amount: -227.7,
        commission: 4.2,
      });
      expect(
        parsed.per_currency?.USD?.payments.reduce((s, l) => s + l.amount, 0),
      ).toBe(227.7);
      expect(parsed.include_account_credits).toBe(true);
      expect(parsed.credit_used?.usd).toBe(1000);
    });

    it("any other supplier keeps the plain commission field (no SMS box)", async () => {
      await renderSheet(PAY_ROWS, false);
      await screen.findByTestId("supplier-account-settle-section-usd");
      expect(
        screen.queryByTestId("supplier-account-settle-sms-usd"),
      ).toBeNull();
      expect(
        screen.getByTestId("supplier-account-settle-commission-usd"),
      ).toBeTruthy();
    });
  });
});

describe("AccountSettleSheet.lira372 (LIRA-372)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-372 (T009/T026) — the OMT Settle Account sheet gets the ONE shared
   * Discount line (`SettleDiscountLine`) in each payment box, capped at $5 /
   * 450,000 LBP. Owner 2026-11-05: typing a discount sets the payment to
   * owed − discount per currency, even a payment typed by hand (option B);
   * in a two-currency box only that currency's line moves. With the SMS
   * amount, the commission does not change (FR-006) and the summary shows
   * SMS amount, Commission and Discount separately.
   *
   * Payload keys come from the core schema (`parse`, rule 24). No Waive.
   */

  const ledger = (id: number, usd: number, at: string): AccountUnsettledRow =>
    queueRow({
      id,
      kind: "LEDGER",
      created_at: at,
      amount_usd: usd,
      service_type: null,
      entry_type: "TOP_UP",
      omt_service_type: null,
      commission_model: null,
      source_provider: "iPick",
    });

  const send = (
    id: number,
    usd: number,
    type: string,
    commission: number,
    at: string,
  ): AccountUnsettledRow =>
    queueRow({
      id,
      created_at: at,
      amount_usd: usd,
      omt_service_type: type,
      commission_model: 1,
      expected_commission_usd: commission,
      commission_accounted_usd: 0,
    });

  /** The test shop on 2026-11-03: we owe OMT 776.50, expected commission 4.20. */
  const PAY_ROWS: AccountUnsettledRow[] = [
    ledger(323, 200, "2026-10-16 08:00:00"),
    ledger(324, 200, "2026-10-16 08:05:00"),
    send(505, 204, "CASH_TO_BUSINESS", 1, "2026-10-16 09:00:00"),
    send(507, 50.5, "ONLINE_BROKERAGE", 3, "2026-10-16 09:10:00"),
    send(508, 101, "INTRA", 0.1, "2026-10-16 09:20:00"),
    send(818, 21, "INTRA", 0.1, "2026-10-26 09:00:00"),
  ];

  // LIRA-378 (owner 2026-11-09): the SMS sheet opens with NOTHING ticked (= OMT
  // pays no commission); the SMS case here is about the expected commission,
  // so it first ticks "All types" — the old default.
  async function renderSheet(
    rows: AccountUnsettledRow[],
    settlesFromSms = true,
  ) {
    mockGetSupplierAccountUnsettled.mockResolvedValue(rows);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AccountSettleSheet
          account={OMT_ACCOUNT}
          settlesFromSms={settlesFromSms}
          onClose={jest.fn()}
          onSettled={jest.fn()}
        />
      </QueryClientProvider>,
    );
    if (settlesFromSms) {
      await screen.findByTestId("supplier-account-settle-section-usd");
      await tickAllCoveredTypes("supplier-account-settle-covered");
    }
  }

  const amountInput = (section: HTMLElement) =>
    within(section).getAllByTestId(/^payment-amount-/)[0] as HTMLInputElement;
  const commissionLine = () =>
    screen.getByTestId("supplier-account-settle-sms-commission-usd")
      .textContent;

  async function submitAndParse() {
    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
    );
    const [accountSupplierId, payload] =
      mockSettleSupplierAccount.mock.calls[0];
    return supplierSettleAccountSchema.parse({
      account_supplier_id: accountSupplierId,
      ...payload,
    });
  }

  const discountUsd = () =>
    screen.getByTestId("settle-discount-usd") as HTMLInputElement;
  const num = (el: HTMLInputElement) => Number(el.value.replace(/,/g, ""));

  /** We owe OMT $412.50 (USD only), no SMS mode. */
  const USD_ROWS: AccountUnsettledRow[] = [
    ledger(901, 400, "2026-10-20 08:00:00"),
    ledger(902, 12.5, "2026-10-21 08:00:00"),
  ];
  /** We owe OMT $412.50 and 900,000 LBP. */
  const TWO_CCY_ROWS: AccountUnsettledRow[] = [
    ...USD_ROWS,
    queueRow({
      id: 903,
      kind: "LEDGER",
      created_at: "2026-10-22 08:00:00",
      amount_lbp: 900_000,
      service_type: null,
      entry_type: "TOP_UP",
      omt_service_type: null,
      commission_model: null,
      source_provider: "iPick",
    }),
  ];

  describe("AccountSettleSheet — one Discount line (LIRA-372)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 900 });
    });

    it("USD $412.50: discount 2.50 → the pay line reads 410, payload waive 2.5 + reason; no Waive", async () => {
      renderSheet(USD_ROWS, false);
      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd",
      );
      await waitFor(() => expect(num(amountInput(usd))).toBe(412.5));
      expect(
        within(usd).getByTestId("settle-discount-line"),
      ).toBeInTheDocument();
      fireEvent.change(discountUsd(), { target: { value: "2.5" } });
      await waitFor(() => expect(num(amountInput(usd))).toBe(410));
      fireEvent.change(screen.getByTestId("settle-discount-reason"), {
        target: { value: "rounded" },
      });
      expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
      const parsed = await submitAndParse();
      expect(parsed.per_currency?.USD?.waive).toBe(2.5);
      expect(parsed.discount_reason).toBe("rounded");
      expect(
        parsed.per_currency?.USD?.payments.reduce((s, l) => s + l.amount, 0),
      ).toBe(410);
    });

    it("a hand-typed $412.50 is lowered to $410 when 2.50 is typed (owner option B)", async () => {
      renderSheet(USD_ROWS, false);
      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd",
      );
      fireEvent.change(amountInput(usd), { target: { value: "412.5" } });
      fireEvent.change(discountUsd(), { target: { value: "2.5" } });
      await waitFor(() => expect(num(amountInput(usd))).toBe(410));
    });

    it("typed 6 → the cap note, and 5 is sent", async () => {
      renderSheet(USD_ROWS, false);
      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd",
      );
      fireEvent.change(discountUsd(), { target: { value: "6" } });
      expect(await screen.findByTestId("discount-cap-note")).toHaveTextContent(
        "Capped to max ($5.00)",
      );
      await waitFor(() => expect(num(amountInput(usd))).toBe(407.5));
      const parsed = await submitAndParse();
      expect(parsed.per_currency?.USD?.waive).toBe(5);
    });

    it("two currencies in one box: a USD discount moves only the USD line", async () => {
      renderSheet(TWO_CCY_ROWS, false);
      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd-lbp",
      );
      const lines = () =>
        within(usd).getAllByTestId(/^payment-amount-/) as HTMLInputElement[];
      await waitFor(() => expect(lines().map(num)).toEqual([412.5, 900_000]));
      fireEvent.change(discountUsd(), { target: { value: "2.5" } });
      await waitFor(() => expect(lines().map(num)).toEqual([410, 900_000]));
    });

    it("SMS mode: discount 2.30 → pay 770, the commission stays $4.20, three summary lines", async () => {
      await renderSheet(PAY_ROWS);
      const usd = await screen.findByTestId(
        "supplier-account-settle-section-usd",
      );
      await waitFor(() => expect(num(amountInput(usd))).toBe(772.3));
      fireEvent.change(discountUsd(), { target: { value: "2.3" } });
      await waitFor(() => expect(num(amountInput(usd))).toBe(770));
      expect(commissionLine()).toContain("$4.20");
      expect(
        screen.getByTestId("supplier-account-settle-sms-discount-usd")
          .textContent,
      ).toContain("$2.30");
      // Total Amount is the figure BEFORE the discount, After Discount the net
      // (found on the e2e screenshot; not proven failing-first in jsdom).
      const summary = within(usd).getByTestId("payment-summary");
      expect(summary.textContent).toContain("$772.30");
      expect(
        within(summary).getByTestId("after-page-discount").textContent,
      ).toContain("$770.00");
      const parsed = await submitAndParse();
      expect(parsed.per_currency?.USD).toMatchObject({
        sms_amount: 772.3,
        commission: 4.2,
        waive: 2.3,
      });
    });
  });
});

describe("AccountSettleSheet.lira378NoCommission (LIRA-378)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-378 (owner 2026-11-09) — on the OMT Settle Account sheet, nothing
   * ticked in "Which OMT commission does this SMS include?" means OMT pays NO
   * commission in this SMS:
   *   - the sheet opens with nothing ticked, so the SMS box opens at the
   *     gross owed (776.50, not 772.30) and the commission line reads $0.00;
   *   - the payload says so explicitly: `covered_omt_service_types: []`;
   *   - every transfer's expected commission is shown as "stays owed";
   *   - "All types" is one tick (the group header), and restores 772.30.
   *
   * Why: Cornertech saved an untouched prefill twice (4 Nov, 9 Nov) — the
   * sheet deducted commission OMT had not paid, because "All types" was the
   * silent default.
   *
   * Field names in the payload come from the core schema (`parse`, rule 24).
   * RULE 17 — run before the sheet change: the first three cases failed
   * (SMS box opened at 772.30, payload had no covered key).
   */

  const SP = "supplier-account-settle-covered";

  const ledger = (id: number, usd: number, at: string): AccountUnsettledRow =>
    queueRow({
      id,
      kind: "LEDGER",
      created_at: at,
      amount_usd: usd,
      service_type: null,
      entry_type: "TOP_UP",
      omt_service_type: null,
      commission_model: null,
      source_provider: "iPick",
    });

  const send = (
    id: number,
    usd: number,
    type: string,
    commission: number,
    at: string,
  ): AccountUnsettledRow =>
    queueRow({
      id,
      created_at: at,
      amount_usd: usd,
      omt_service_type: type,
      commission_model: 1,
      expected_commission_usd: commission,
      commission_accounted_usd: 0,
    });

  /** The test shop on 2026-11-03: we owe OMT 776.50, expected commission 4.20. */
  const PAY_ROWS: AccountUnsettledRow[] = [
    ledger(323, 200, "2026-10-16 08:00:00"),
    ledger(324, 200, "2026-10-16 08:05:00"),
    send(505, 204, "CASH_TO_BUSINESS", 1, "2026-10-16 09:00:00"),
    send(507, 50.5, "ONLINE_BROKERAGE", 3, "2026-10-16 09:10:00"),
    send(508, 101, "INTRA", 0.1, "2026-10-16 09:20:00"),
    send(818, 21, "INTRA", 0.1, "2026-10-26 09:00:00"),
  ];

  function renderSheet(rows: AccountUnsettledRow[]) {
    mockGetSupplierAccountUnsettled.mockResolvedValue(rows);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AccountSettleSheet
          account={OMT_ACCOUNT}
          settlesFromSms
          onClose={jest.fn()}
          onSettled={jest.fn()}
        />
      </QueryClientProvider>,
    );
  }

  const smsInput = () =>
    screen.getByTestId("supplier-account-settle-sms-usd") as HTMLInputElement;
  const commissionLine = () =>
    screen.getByTestId("supplier-account-settle-sms-commission-usd")
      .textContent;

  async function submitAndParse() {
    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
    );
    const [accountSupplierId, payload] =
      mockSettleSupplierAccount.mock.calls[0];
    return supplierSettleAccountSchema.parse({
      account_supplier_id: accountSupplierId,
      ...payload,
    });
  }

  describe("AccountSettleSheet — nothing ticked = OMT pays no commission (LIRA-378)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 900 });
    });

    it("opens with nothing ticked: SMS box at the gross 776.50, commission $0.00, 4.20 stays owed", async () => {
      renderSheet(PAY_ROWS);
      await screen.findByTestId("supplier-account-settle-section-usd");
      expect(smsInput().value).toBe("776.50");
      expect(commissionLine()).toContain("$0.00");
      expect(screen.getByTestId(SP).textContent).toContain("No commission");
      expect(
        screen.getByTestId("supplier-account-settle-sms-includes-none"),
      ).toBeTruthy();
      expect(
        screen.queryByTestId("supplier-account-settle-sms-includes"),
      ).toBeNull();
      expect(
        screen.getByTestId("supplier-account-settle-sms-stays-owed-usd")
          .textContent,
      ).toContain("$4.20");
    });

    it("untouched: the payload says no commission — covered_omt_service_types: [] and commission 0", async () => {
      renderSheet(PAY_ROWS);
      await screen.findByTestId("supplier-account-settle-section-usd");
      const parsed = await submitAndParse();
      expect(parsed.covered_omt_service_types).toEqual([]);
      expect(parsed.per_currency?.USD?.sms_amount).toBe(776.5);
      expect(parsed.per_currency?.USD?.commission).toBe(0);
    });

    it("ticking All types (one tick) brings the expected commission back: SMS 772.30, $4.20", async () => {
      renderSheet(PAY_ROWS);
      await screen.findByTestId("supplier-account-settle-section-usd");
      await tickAllCoveredTypes(SP);
      await waitFor(() => expect(smsInput().value).toBe("772.30"));
      expect(commissionLine()).toContain("$4.20");
      expect(
        screen.queryByTestId("supplier-account-settle-sms-includes-none"),
      ).toBeNull();
      expect(
        screen.getByTestId("supplier-account-settle-sms-includes"),
      ).toBeTruthy();
      const parsed = await submitAndParse();
      expect(parsed.covered_omt_service_types).toHaveLength(9);
      expect(parsed.per_currency?.USD?.commission).toBe(4.2);
    });

    // Caught by lira-web-081: "See transactions" marked every transfer as
    // waiting for its type (unticked) once the default became `[]`. In SMS
    // mode the ticked types scope the commission only — every picked
    // transfer stays in, ticked.
    it("nothing ticked keeps every transfer in scope: See transactions shows them ticked, none waiting", async () => {
      renderSheet(PAY_ROWS);
      await screen.findByTestId("supplier-account-settle-section-usd");
      await act(async () => {
        fireEvent.click(screen.getByTestId("settle-see-transactions"));
      });
      const panel = await screen.findByTestId("settle-transactions-panel");
      for (const id of [505, 507, 508, 818]) {
        const row = within(panel).getByTestId(
          `settle-tx-row-FINANCIAL_SERVICE:${id}`,
        );
        expect(
          (within(row).getByRole("checkbox") as HTMLInputElement).checked,
        ).toBe(true);
      }
      const statuses = within(
        screen.getByTestId("supplier-account-settle-section-usd"),
      )
        .getAllByTestId("supplier-account-settle-preview-row")
        .map((r) => r.getAttribute("data-status"));
      expect(statuses.every((s) => s === "closes")).toBe(true);
    });

    it("a typed SMS below the gross with nothing ticked blocks Settle: the $6.50 is commission, so a type must be ticked", async () => {
      renderSheet(PAY_ROWS);
      await screen.findByTestId("supplier-account-settle-section-usd");
      await act(async () => {
        fireEvent.change(smsInput(), { target: { value: "770" } });
      });
      await waitFor(() => expect(commissionLine()).toContain("$6.50"));
      expect(
        screen.getByTestId("supplier-account-settle-sms-needs-types-usd")
          .textContent,
      ).toContain("$6.50");
      expect(
        screen.getByTestId("supplier-account-settle-submit"),
      ).toBeDisabled();
      expect(mockSettleSupplierAccount).not.toHaveBeenCalled();
      // Ticking the types the SMS includes unblocks it. (A new choice re-opens
      // the box at its expected figure, as it always did, so 770 is retyped.)
      await tickAllCoveredTypes(SP);
      await waitFor(() =>
        expect(
          screen.queryByTestId("supplier-account-settle-sms-needs-types-usd"),
        ).toBeNull(),
      );
      await act(async () => {
        fireEvent.change(smsInput(), { target: { value: "770" } });
      });
      await waitFor(() => expect(commissionLine()).toContain("$6.50"));
      expect(
        screen.queryByTestId("supplier-account-settle-sms-needs-types-usd"),
      ).toBeNull();
      const parsed = await submitAndParse();
      expect(parsed.covered_omt_service_types).toHaveLength(9);
      expect(parsed.per_currency?.USD?.commission).toBe(6.5);
    });
  });
});

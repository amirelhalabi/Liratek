/** @jest-environment jsdom */

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

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supplierSettleAccountSchema } from "@liratek/core";
import { AccountSettleSheet } from "../AccountSettleSheet";
import type { AccountUnsettledRow } from "../../hooks/useSuppliers";
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
async function renderSheet(rows: AccountUnsettledRow[], settlesFromSms = true) {
  mockGetSupplierAccountUnsettled.mockResolvedValue(rows);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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
  screen.getByTestId("supplier-account-settle-sms-commission-usd").textContent;

async function submitAndParse() {
  const submit = screen.getByTestId("supplier-account-settle-submit");
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  await waitFor(() => expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1));
  const [accountSupplierId, payload] = mockSettleSupplierAccount.mock.calls[0];
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
    const usd = await screen.findByTestId("supplier-account-settle-section-usd");
    expect(smsInput().value).toBe("772.30");
    expect(commissionLine()).toContain("$4.20");
    await waitFor(() => expect(Number(amountInput(usd).value.replace(/,/g, ""))).toBe(772.3));
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
    const usd = await screen.findByTestId("supplier-account-settle-section-usd");
    fireEvent.change(smsInput(), { target: { value: "762.30" } });
    await waitFor(() => expect(commissionLine()).toContain("$14.20"));
    expect(commissionLine()).toContain("$10.00");
    await waitFor(() => expect(Number(amountInput(usd).value.replace(/,/g, ""))).toBe(762.3));
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
    expect(parsed.per_currency?.USD?.payments.reduce((s, l) => s + l.amount, 0)).toBe(762.3);
  });

  it("SMS 790: OMT asks $13.50 more — a warning, commission $0.00", async () => {
    await renderSheet(PAY_ROWS);
    await screen.findByTestId("supplier-account-settle-section-usd");
    fireEvent.change(smsInput(), { target: { value: "790" } });
    await waitFor(() =>
      expect(screen.getByTestId("supplier-account-settle-sms-asks-more-usd").textContent).toContain("$13.50"),
    );
    expect(commissionLine()).toContain("$0.00");
  });

  it("SMS 774.50: less than expected is a note, not a warning", async () => {
    await renderSheet(PAY_ROWS);
    await screen.findByTestId("supplier-account-settle-section-usd");
    fireEvent.change(smsInput(), { target: { value: "774.50" } });
    await waitFor(() => expect(screen.getByTestId("supplier-account-settle-sms-less-usd")).toBeTruthy());
    expect(screen.queryByTestId("supplier-account-settle-sms-asks-more-usd")).toBeNull();
    expect(commissionLine()).toContain("$2.00");
  });

  it("OMT owes us: SMS −249.70 receives 249.70, commission $26.20, no change to return", async () => {
    await renderSheet(COLLECT_ROWS);
    const usd = await screen.findByTestId("supplier-account-settle-section-usd");
    expect(smsInput().value).toBe("-229.70");
    fireEvent.change(smsInput(), { target: { value: "-249.70" } });
    await waitFor(() => expect(commissionLine()).toContain("$26.20"));
    await waitFor(() => expect(Number(amountInput(usd).value.replace(/,/g, ""))).toBe(249.7));
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
      { ...ledger(900, 0, "2026-10-27 08:00:00"), amount_usd: -14.2, remaining_usd: -14.2, row_scope: "ACCOUNT", entry_type: "PAYMENT" },
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
      { ...ledger(900, 0, "2026-10-27 08:00:00"), amount_usd: -1000, remaining_usd: -1000, row_scope: "ACCOUNT", entry_type: "PAYMENT" },
    ]);
    const usd = await screen.findByTestId("supplier-account-settle-section-usd");
    await waitFor(() => expect(smsInput().value).toBe("-227.70"));
    expect(commissionLine()).toContain("$4.20");
    await waitFor(() => expect(Number(amountInput(usd).value.replace(/,/g, ""))).toBe(227.7));
    const parsed = await submitAndParse();
    expect(parsed.per_currency?.USD).toMatchObject({
      direction: "COLLECT",
      sms_amount: -227.7,
      commission: 4.2,
    });
    expect(parsed.per_currency?.USD?.payments.reduce((s, l) => s + l.amount, 0)).toBe(227.7);
    expect(parsed.include_account_credits).toBe(true);
    expect(parsed.credit_used?.usd).toBe(1000);
  });

  it("any other supplier keeps the plain commission field (no SMS box)", async () => {
    await renderSheet(PAY_ROWS, false);
    await screen.findByTestId("supplier-account-settle-section-usd");
    expect(screen.queryByTestId("supplier-account-settle-sms-usd")).toBeNull();
    expect(screen.getByTestId("supplier-account-settle-commission-usd")).toBeTruthy();
  });
});

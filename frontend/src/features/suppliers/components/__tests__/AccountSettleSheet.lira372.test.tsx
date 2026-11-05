/** @jest-environment jsdom */

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

function renderSheet(rows: AccountUnsettledRow[], settlesFromSms = true) {
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
}

const amountInput = (section: HTMLElement) =>
  within(section).getAllByTestId(/^payment-amount-/)[0] as HTMLInputElement;
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
    const usd = await screen.findByTestId("supplier-account-settle-section-usd");
    await waitFor(() => expect(num(amountInput(usd))).toBe(412.5));
    expect(within(usd).getByTestId("settle-discount-line")).toBeInTheDocument();
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
    const usd = await screen.findByTestId("supplier-account-settle-section-usd");
    fireEvent.change(amountInput(usd), { target: { value: "412.5" } });
    fireEvent.change(discountUsd(), { target: { value: "2.5" } });
    await waitFor(() => expect(num(amountInput(usd))).toBe(410));
  });

  it("typed 6 → the cap note, and 5 is sent", async () => {
    renderSheet(USD_ROWS, false);
    const usd = await screen.findByTestId("supplier-account-settle-section-usd");
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
    renderSheet(PAY_ROWS);
    const usd = await screen.findByTestId("supplier-account-settle-section-usd");
    await waitFor(() => expect(num(amountInput(usd))).toBe(772.3));
    fireEvent.change(discountUsd(), { target: { value: "2.3" } });
    await waitFor(() => expect(num(amountInput(usd))).toBe(770));
    expect(commissionLine()).toContain("$4.20");
    expect(
      screen.getByTestId("supplier-account-settle-sms-discount-usd").textContent,
    ).toContain("$2.30");
    // Total Amount is the figure BEFORE the discount, After Discount the net
    // (found on the e2e screenshot; not proven failing-first in jsdom).
    const summary = within(usd).getByTestId("payment-summary");
    expect(summary.textContent).toContain("$772.30");
    expect(within(summary).getByTestId("after-page-discount").textContent).toContain(
      "$770.00",
    );
    const parsed = await submitAndParse();
    expect(parsed.per_currency?.USD).toMatchObject({
      sms_amount: 772.3,
      commission: 4.2,
      waive: 2.3,
    });
  });
});

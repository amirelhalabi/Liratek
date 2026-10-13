/** @jest-environment jsdom */

/**
 * LIRA-203 (owner D18 follow-up) → LIRA-315 (owner decisions 2026-10-12/13):
 * paying (or collecting) MORE than the ticked rows' net is allowed with NO
 * separate "Overpayment" field. The payment box's change section decides:
 * "Get change back" (default — the other side hands it back, an OUT leg) or
 * the "Account" button (no leg — the server books the extra on the account, opened
 * as a credit row it never auto-applies). Any credit already sitting on the
 * account is surfaced so the operator knows it can be applied by leaving
 * the credit row ticked. Rule 24: the old surplus-field cases were rewritten
 * to guard the new flow, not deleted.
 *
 * Same rendering strategy as `AccountSettleSheet.test.tsx` (real
 * `@liratek/ui` `MultiPaymentInput`, only `useApi` mocked) — a broken
 * payload shape must fail here, not only in review.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountSettleSheet } from "../AccountSettleSheet";
import type {
  AccountBalance,
  AccountUnsettledRow,
} from "../../hooks/useSuppliers";

const mockSettleSupplierAccount = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      settleSupplierAccount: mockSettleSupplierAccount,
      getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
    }),
  };
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
  total_usd: 1225,
  total_lbp: 0,
  children: [
    {
      supplier_id: 1,
      name: "OMT",
      provider: "OMT",
      drawer_name: "OMT_System",
      total_usd: 1050,
      total_lbp: 0,
      is_parent: true,
    },
    {
      supplier_id: 3,
      name: "iPick",
      provider: "iPick",
      drawer_name: "iPick",
      total_usd: 175,
      total_lbp: 0,
      is_parent: false,
    },
  ],
};

/** Same account, but with an open credit already sitting on it (e.g. a
 *  prior overpayment or a WALLET_CASHOUT) — negative total. */
const ACCOUNT_WITH_CREDIT: AccountBalance = {
  ...ACCOUNT,
  total_usd: -50,
  total_lbp: 0,
};

const ROW_OMT: AccountUnsettledRow = {
  kind: "FINANCIAL_SERVICE",
  id: 10,
  supplier_id: 1,
  source_provider: "OMT",
  source_name: "OMT",
  created_at: "2026-09-01T00:00:00Z",
  amount_usd: 1050,
  amount_lbp: 0,
  entry_type: null,
  service_type: "SEND",
  commission_usd: 0,
  commission_lbp: 0,
};

const ROW_IPICK: AccountUnsettledRow = {
  kind: "LEDGER",
  id: 30,
  supplier_id: 3,
  source_provider: "iPick",
  source_name: "iPick",
  created_at: "2026-09-03T00:00:00Z",
  amount_usd: 175,
  amount_lbp: 0,
  entry_type: "TOP_UP",
  service_type: null,
  commission_usd: 0,
  commission_lbp: 0,
};

/** A standalone overpayment credit row (LIRA-203) — same shape a
 *  WALLET_CASHOUT credit already has (negative, LEDGER, PAYMENT). */
const ROW_CREDIT: AccountUnsettledRow = {
  kind: "LEDGER",
  id: 40,
  supplier_id: 1,
  source_provider: "OMT",
  source_name: "OMT",
  created_at: "2026-09-04T00:00:00Z",
  amount_usd: -50,
  amount_lbp: 0,
  entry_type: "PAYMENT",
  service_type: null,
  commission_usd: 0,
  commission_lbp: 0,
};

function renderSheet(
  rows: AccountUnsettledRow[],
  account: AccountBalance = ACCOUNT,
) {
  mockGetSupplierAccountUnsettled.mockResolvedValue(rows);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = jest.fn();
  const onSettled = jest.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettleSheet
        account={account}
        onClose={onClose}
        onSettled={onSettled}
      />
    </QueryClientProvider>,
  );
  return { onClose, onSettled };
}

describe("AccountSettleSheet — overpayment (LIRA-203 → LIRA-315)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 555 });
  });

  it("PAY $1,275 on $1,225 with 'Account': sends the rows-only amount_usd, ONE paid leg of 1,275, no surplus field and no change leg", async () => {
    renderSheet([ROW_OMT, ROW_IPICK]);
    await screen.findAllByTestId("supplier-account-settle-row");

    const submit = await screen.findByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());

    const amountInput = await screen.findByDisplayValue("1,225");
    fireEvent.change(amountInput, { target: { value: "1275" } });
    fireEvent.click(await screen.findByTestId("change-destination-account"));
    await waitFor(() =>
      expect(
        screen.getByTestId("change-to-account-summary").textContent,
      ).toMatch(/\$50\.00 not given back stays on OMT's account/),
    );

    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1);
    });
    const [, payload] = mockSettleSupplierAccount.mock.calls[0];
    // The ROWS guard is untouched — D18.
    expect(payload.amount_usd).toBeCloseTo(1225, 2);
    expect(payload.amount_lbp).toBe(0);
    // No separate surplus field — the server derives the extra from the legs.
    expect(payload.surplus_usd).toBeUndefined();
    expect(payload.surplus_lbp).toBeUndefined();
    expect(payload.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 1275 },
    ]);
  });

  it("the default for an overpay is 'Get change back': the $275 is sent as a CASH change (OUT) leg", async () => {
    renderSheet([ROW_OMT, ROW_IPICK]);
    await screen.findAllByTestId("supplier-account-settle-row");

    const submit = await screen.findByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());

    const amountInput = await screen.findByDisplayValue("1,225");
    fireEvent.change(amountInput, { target: { value: "1500" } });

    expect(
      screen.queryByTestId("supplier-account-settle-mismatch"),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1);
    });
    const [, payload] = mockSettleSupplierAccount.mock.calls[0];
    expect(payload.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 1500 },
      { method: "CASH", currency_code: "USD", amount: 275, direction: "OUT" },
    ]);
  });

  it("no separate Overpayment field is offered — on PAY or COLLECT", async () => {
    renderSheet([ROW_OMT, ROW_IPICK]);
    await screen.findAllByTestId("supplier-account-settle-row");
    expect(
      screen.queryByTestId("supplier-account-settle-surplus-input"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId("supplier-account-settle-direction-collect"),
    );
    expect(
      screen.queryByTestId("supplier-account-settle-surplus-input"),
    ).not.toBeInTheDocument();
  });

  it("surfaces an available-credit banner when the account already carries a negative (credit) balance", async () => {
    renderSheet([ROW_OMT, ROW_IPICK, ROW_CREDIT], ACCOUNT_WITH_CREDIT);
    await screen.findAllByTestId("supplier-account-settle-row");

    const banner = await screen.findByTestId(
      "supplier-account-settle-available-credit",
    );
    expect(banner.textContent).toMatch(/available credit/i);
    expect(banner.textContent).toMatch(/\$50\.00/);
  });

  it("does NOT show the available-credit banner when the account has no credit", async () => {
    renderSheet([ROW_OMT, ROW_IPICK]);
    await screen.findAllByTestId("supplier-account-settle-row");

    expect(
      screen.queryByTestId("supplier-account-settle-available-credit"),
    ).not.toBeInTheDocument();
  });

  it('badges a negative (credit) row as "Credit" in the row list', async () => {
    renderSheet([ROW_OMT, ROW_CREDIT], ACCOUNT_WITH_CREDIT);
    const rows = await screen.findAllByTestId("supplier-account-settle-row");
    const creditRow = rows.find((r) => r.getAttribute("data-row-id") === "40")!;
    expect(within(creditRow).getByText("Credit")).toBeInTheDocument();

    const debtRow = rows.find((r) => r.getAttribute("data-row-id") === "10")!;
    expect(within(debtRow).queryByText("Credit")).not.toBeInTheDocument();
  });

  it("an UNDERpay is still a hard block (a ticked row can't be partly paid)", async () => {
    renderSheet([ROW_OMT, ROW_IPICK]);
    await screen.findAllByTestId("supplier-account-settle-row");

    const submit = await screen.findByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());

    const amountInput = await screen.findByDisplayValue("1,225");
    fireEvent.change(amountInput, { target: { value: "1000" } });

    await waitFor(() => {
      expect(
        screen.getByTestId("supplier-account-settle-mismatch").textContent,
      ).toMatch(/doesn.t cover the selected rows/i);
    });
    expect(submit).toBeDisabled();
    expect(mockSettleSupplierAccount).not.toHaveBeenCalled();
  });
});

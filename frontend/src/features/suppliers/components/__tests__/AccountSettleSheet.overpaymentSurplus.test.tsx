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
 *
 * LIRA-322 rewrite (rule 24 — intent kept): the overpay is typed into the
 * USD section's own box; the legacy `amount_*`/`surplus_*` keys are never
 * sent (`per_currency.USD.payments` carries the legs); a credit already on
 * the account nets automatically (no tick needed); there is no direction
 * toggle, so "no Overpayment field" is checked on a PAY and on a COLLECT
 * section; an UNDERpay is now a partial payment, not a block. `useApi` is
 * ONE stable object (rule 25).
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
import { supplierSettleAccountSchema } from "@liratek/core";
import type {
  AccountBalance,
  AccountUnsettledRow,
} from "../../hooks/useSuppliers";
import { queueRow } from "../../testing/accountSettleFixtures";

const mockSettleSupplierAccount = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
const mockApi = {
  settleSupplierAccount: mockSettleSupplierAccount,
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
  // LIRA-343 — the calendar's month read. Empty here: these cases test the
  // money, and the open queue (not this read) decides the picked days.
  getSupplierAccountMonthRows: jest.fn(async () => []),
  getSupplierAccountDayDetail: jest.fn(async () => []),
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    // Rule 25: ONE stable object.
    useApi: () => mockApi,
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

const ROW_OMT = queueRow({
  id: 10,
  created_at: "2026-09-01 00:00:00",
  amount_usd: 1050,
});

const ROW_IPICK = queueRow({
  kind: "LEDGER",
  id: 30,
  supplier_id: 3,
  source_provider: "iPick",
  source_name: "iPick",
  created_at: "2026-09-03 00:00:00",
  amount_usd: 175,
  entry_type: "TOP_UP",
  service_type: null,
  omt_service_type: null,
  commission_model: null,
});

/** A standalone overpayment credit row (LIRA-203) — same shape a
 *  WALLET_CASHOUT credit already has (negative, LEDGER, PAYMENT). */
const ROW_CREDIT = queueRow({
  kind: "LEDGER",
  id: 40,
  created_at: "2026-09-04 00:00:00",
  amount_usd: -50,
  entry_type: "PAYMENT",
  service_type: null,
  omt_service_type: null,
  commission_model: null,
});

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

async function usdSection() {
  return screen.findByTestId("supplier-account-settle-section-usd");
}

async function pay(value: string) {
  const usd = await usdSection();
  fireEvent.change(within(usd).getAllByTestId(/^payment-amount-/)[0], {
    target: { value },
  });
  return usd;
}

async function submitAndGetPayload() {
  const submit = screen.getByTestId("supplier-account-settle-submit");
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  await waitFor(() =>
    expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
  );
  const [accountId, payload] = mockSettleSupplierAccount.mock.calls[0];
  return {
    payload: payload as Record<string, unknown>,
    parsed: supplierSettleAccountSchema.parse({
      account_supplier_id: accountId,
      ...payload,
    }),
  };
}

describe("AccountSettleSheet — overpayment (LIRA-203 → LIRA-315)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 555 });
  });

  it("PAY $1,275 on $1,225 with 'Account': ONE paid leg of 1,275, no change leg, no surplus or amount_* keys", async () => {
    renderSheet([ROW_OMT, ROW_IPICK]);

    const usd = await pay("1275");
    fireEvent.click(
      await within(usd).findByTestId("change-destination-account"),
    );
    await waitFor(() =>
      expect(
        within(usd).getByTestId("change-to-account-summary").textContent,
      ).toMatch(/\$50\.00 not given back stays on OMT's account/),
    );
    expect(
      within(usd).getByTestId("supplier-account-settle-extra-usd").textContent,
    ).toMatch(/\$50\.00 goes on the account/);

    const { payload, parsed } = await submitAndGetPayload();
    expect(parsed.per_currency?.USD?.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 1275 },
    ]);
    for (const key of [
      "surplus_usd",
      "surplus_lbp",
      "amount_usd",
      "amount_lbp",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("the default for an overpay is 'Get change back': the $275 is sent as a CASH change (OUT) leg", async () => {
    renderSheet([ROW_OMT, ROW_IPICK]);

    await pay("1500");
    expect(
      screen.queryByTestId("supplier-account-settle-mismatch"),
    ).not.toBeInTheDocument();

    const { parsed } = await submitAndGetPayload();
    expect(parsed.per_currency?.USD?.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 1500 },
      { method: "CASH", currency_code: "USD", amount: 275, direction: "OUT" },
    ]);
  });

  it("no separate Overpayment field is offered — on a PAY or a COLLECT section", async () => {
    renderSheet([ROW_OMT, ROW_IPICK]);
    await usdSection();
    expect(
      screen.queryByTestId("supplier-account-settle-surplus-input"),
    ).not.toBeInTheDocument();
    // LBP owes nothing: open it as a COLLECT section.
    fireEvent.click(
      screen.getByTestId("supplier-account-settle-direction-collect-lbp"),
    );
    await screen.findByTestId("supplier-account-settle-section-lbp");
    expect(
      screen.queryByTestId("supplier-account-settle-surplus-input"),
    ).not.toBeInTheDocument();
  });

  // LIRA-343 rewrite (rule 24): the "available credit" banner became the
  // "Use OMT credit [x] of [total]" line (FR-012). It is driven by the
  // account rows (`row_scope = 'ACCOUNT'`, credit sitting on no day), not by
  // the account card's balance. The old banner must not come back.
  it("surfaces the 'Use OMT credit' line when the account carries an account credit", async () => {
    renderSheet(
      [ROW_OMT, ROW_IPICK, { ...ROW_CREDIT, row_scope: "ACCOUNT" }],
      ACCOUNT_WITH_CREDIT,
    );

    const line = await screen.findByTestId(
      "supplier-account-settle-credit-line-usd",
    );
    expect(line.textContent).toMatch(/Use OMT credit/);
    expect(line.textContent).toMatch(/\$50\.00/);
    expect(
      screen.queryByTestId("supplier-account-settle-available-credit"),
    ).not.toBeInTheDocument();
  });

  it("does NOT show the credit line when the account has no credit", async () => {
    renderSheet([ROW_OMT, ROW_IPICK]);
    await usdSection();

    expect(
      screen.queryByTestId("supplier-account-settle-credit-line-usd"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("supplier-account-settle-available-credit"),
    ).not.toBeInTheDocument();
  });

  // LIRA-343: the top-level picker is gone (it returns inside day details),
  // so the badge is checked in the preview and the picker is guarded absent.
  it('badges a negative (credit) row as "Credit" in the preview', async () => {
    renderSheet([ROW_OMT, ROW_CREDIT], ACCOUNT_WITH_CREDIT);
    const usd = await usdSection();
    const preview = within(usd).getAllByTestId(
      "supplier-account-settle-preview-row",
    );
    const creditRow = preview.find(
      (r) => r.getAttribute("data-row-id") === "40",
    )!;
    expect(within(creditRow).getByText("Credit")).toBeInTheDocument();
    const debtRow = preview.find(
      (r) => r.getAttribute("data-row-id") === "10",
    )!;
    expect(within(debtRow).queryByText("Credit")).not.toBeInTheDocument();

    expect(
      screen.queryByTestId("supplier-account-settle-pick-toggle"),
    ).not.toBeInTheDocument();
  });

  it("an existing credit nets automatically: with $1,050 owed and a $50 credit, the box asks for $1,000", async () => {
    renderSheet([ROW_OMT, ROW_CREDIT], ACCOUNT_WITH_CREDIT);
    const usd = await usdSection();
    expect(
      within(usd).getByTestId("supplier-account-settle-owed-usd").textContent,
    ).toBe("$1000.00");
  });

  // LIRA-322 (US2) — replaces "an UNDERpay is still a hard block".
  it("an UNDERpay is a partial payment, never a block", async () => {
    renderSheet([ROW_OMT, ROW_IPICK]);

    await pay("1000");
    expect(
      screen.queryByTestId("supplier-account-settle-mismatch"),
    ).not.toBeInTheDocument();
    const { parsed } = await submitAndGetPayload();
    expect(parsed.per_currency?.USD?.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 1000 },
    ]);
  });
});

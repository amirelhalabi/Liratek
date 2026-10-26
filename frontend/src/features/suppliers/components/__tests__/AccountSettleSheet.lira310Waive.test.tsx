/** @jest-environment jsdom */

/**
 * LIRA-310 follow-up — owner decision 2026-10-12: NO Waive anywhere on the
 * Suppliers page, including the OMT account settle sheet.
 *
 * Guards (LIRA-322 rewrite, rule 24 — intent kept):
 *   - $3 short of $1,225: the Remaining row shows but carries no Waive
 *     button, and nothing waived is sent. Since LIRA-322 the short amount is
 *     a partial payment (Settle is enabled), so the guard is on the payload:
 *     no `waive` and no legacy `discount`;
 *   - a full payment sends no waive/discount either (names checked through
 *     the core schema, `supplierSettleAccountSchema` — rule 24);
 *   - no Waive on an overpay.
 *
 * Real MultiPaymentInput, only `useApi` mocked (a stable object, rule 25).
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
import type { AccountBalance } from "../../hooks/useSuppliers";
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
  total_usd: 1225,
  total_lbp: 0,
  children: [
    {
      supplier_id: 1,
      name: "OMT",
      provider: "OMT",
      drawer_name: "OMT_System",
      total_usd: 1225,
      total_lbp: 0,
      is_parent: true,
    },
  ],
};

const ROW_A = queueRow({
  kind: "LEDGER",
  id: 10,
  created_at: "2026-09-01 00:00:00",
  amount_usd: 1050,
  entry_type: "TOP_UP",
  service_type: null,
});
const ROW_B = queueRow({
  kind: "LEDGER",
  id: 11,
  created_at: "2026-09-02 00:00:00",
  amount_usd: 175,
  entry_type: "TOP_UP",
  service_type: null,
});

function renderSheet() {
  mockGetSupplierAccountUnsettled.mockResolvedValue([ROW_A, ROW_B]);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettleSheet
        account={ACCOUNT}
        onClose={jest.fn()}
        onSettled={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

async function pay(value: string) {
  renderSheet();
  const usd = await screen.findByTestId("supplier-account-settle-section-usd");
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
  // Names from the core schema (rule 24).
  const parsed = supplierSettleAccountSchema.parse({
    ...payload,
    account_supplier_id: accountId,
  });
  return { payload: payload as Record<string, unknown>, parsed };
}

describe("AccountSettleSheet — no Waive on the Suppliers page (owner 2026-10-12)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 1 });
  });

  it("$3 short of $1,225: the Remaining row shows, no Waive button, and nothing waived is sent", async () => {
    const usd = await pay("1222");
    expect(await within(usd).findByTestId("remaining-row")).toBeInTheDocument();
    expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();

    const { payload, parsed } = await submitAndGetPayload();
    expect(parsed.per_currency?.USD?.waive).toBeUndefined();
    expect(parsed.per_currency?.USD?.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 1222 },
    ]);
    expect(payload).not.toHaveProperty("discount");
  });

  it("a full payment sends no waive and no discount", async () => {
    await pay("1225");
    const { payload, parsed } = await submitAndGetPayload();
    expect(parsed.per_currency?.USD?.waive).toBeUndefined();
    expect(parsed.discount).toBeUndefined();
    expect(payload).not.toHaveProperty("discount");
  });

  it("no Waive on an overpay either", async () => {
    await pay("1300");
    await waitFor(() =>
      expect(screen.getByTestId("return-change")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
  });
});

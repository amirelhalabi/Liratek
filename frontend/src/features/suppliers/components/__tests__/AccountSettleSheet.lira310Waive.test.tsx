/** @jest-environment jsdom */

/**
 * LIRA-310 follow-up — owner decision 2026-10-12: NO Waive anywhere on the
 * Suppliers page, including the OMT/WHISH account settle sheet. A gap is
 * recorded by typing in the Pay tab's Discount field by hand instead.
 *
 * Guards:
 *   - $3 short of the ticked rows' $1,225 net: the Remaining row shows but
 *     carries no Waive button, Settle stays disabled (no waived subtraction);
 *   - a full payment sends no `discount` (names from the core schema,
 *     `supplierSettleAccountSchema` — rule 24);
 *   - no Waive with a declared surplus either.
 *
 * Same strategy as AccountSettleSheet.test.tsx: the real MultiPaymentInput,
 * only `useApi` mocked (a stable object, rule 25).
 * Rule 17: rewritten before the change and run red against the LIRA-310
 * Waive wiring.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supplierSettleAccountSchema } from "@liratek/core";
import { AccountSettleSheet } from "../AccountSettleSheet";
import type {
  AccountBalance,
  AccountUnsettledRow,
} from "../../hooks/useSuppliers";

const mockSettleSupplierAccount = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
const mockApi = {
  settleSupplierAccount: mockSettleSupplierAccount,
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
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
      total_usd: 1225,
      total_lbp: 0,
      is_parent: true,
    },
  ],
};

const ROW_A: AccountUnsettledRow = {
  kind: "LEDGER",
  id: 10,
  supplier_id: 1,
  source_provider: "OMT",
  source_name: "OMT",
  created_at: "2026-09-01T00:00:00Z",
  amount_usd: 1050,
  amount_lbp: 0,
  entry_type: "TOP_UP",
  service_type: null,
  commission_usd: 0,
  commission_lbp: 0,
};

const ROW_B: AccountUnsettledRow = {
  ...ROW_A,
  id: 11,
  created_at: "2026-09-02T00:00:00Z",
  amount_usd: 175,
};

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

async function payLess(value: string) {
  await screen.findAllByTestId("supplier-account-settle-row");
  const amount = await screen.findByDisplayValue("1,225");
  fireEvent.change(amount, { target: { value } });
}

describe("AccountSettleSheet — no Waive on the Suppliers page (owner 2026-10-12)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 1 });
  });

  it("$3 short of $1,225: the Remaining row shows, but no Waive button — Settle stays disabled", async () => {
    renderSheet();
    await payLess("1222");
    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).toBeDisabled());
    expect(await screen.findByTestId("remaining-row")).toBeInTheDocument();
    expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("supplier-account-settle-waived"),
    ).not.toBeInTheDocument();
    expect(mockSettleSupplierAccount).not.toHaveBeenCalled();
  });

  it("a full payment sends the rows' net and no discount", async () => {
    renderSheet();
    await screen.findAllByTestId("supplier-account-settle-row");
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
    expect(parsed.amount_usd).toBeCloseTo(1225, 2);
    expect(parsed.discount).toBeUndefined();
    expect(payload).not.toHaveProperty("discount");
  });

  it("no Waive while an overpayment surplus is declared either", async () => {
    renderSheet();
    await screen.findAllByTestId("supplier-account-settle-row");
    fireEvent.change(
      screen.getByTestId("supplier-account-settle-surplus-input"),
      { target: { value: "50" } },
    );
    const amount = await screen.findByDisplayValue("1,275");
    fireEvent.change(amount, { target: { value: "1272" } });
    await waitFor(() =>
      expect(screen.getByDisplayValue("1,272")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
  });
});

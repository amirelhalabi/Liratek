/** @jest-environment jsdom */

/**
 * LIRA-310 (US3, T043) — Waive on the supplier ACCOUNT settle sheet.
 *
 * The ticked rows net to $1,225; the cashier hands over $1,222 and taps
 * Waive on the Remaining row. The sheet must:
 *   - accept the payment (Settle enabled — the waived $3 closes the gap);
 *   - send the rows' own net unchanged (`amount_usd` 1225), the legs as
 *     paid, and `discount: { amount_usd: 3, amount_lbp: 0 }` — the field
 *     names come from the core schema (`supplierSettleAccountSchema`,
 *     parsed below, rule 24);
 *   - send no `discount` when nothing was waived;
 *   - drop the waive when the payment lines change afterwards (stale);
 *   - offer no Waive while an overpayment surplus is declared (the server
 *     refuses the two together).
 *
 * Same strategy as AccountSettleSheet.test.tsx: the real MultiPaymentInput,
 * only `useApi` mocked (a stable object, rule 25).
 * Rule 17: written before the change and run red — see tasks.md T043.
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

describe("AccountSettleSheet — LIRA-310 Waive", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 1 });
  });

  it("pays $1,222 of $1,225, Waive → Settle enabled, sends discount $3 and the rows' own net", async () => {
    renderSheet();
    await payLess("1222");
    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).toBeDisabled());

    fireEvent.click(await screen.findByTestId("waive-remaining"));
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() =>
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
    );
    const [accountId, payload] = mockSettleSupplierAccount.mock.calls[0];
    // The payload must survive the real core schema (rule 24 — names from
    // the schema, not hand-typed).
    const parsed = supplierSettleAccountSchema.parse({
      ...payload,
      account_supplier_id: accountId,
    });
    expect(parsed.discount).toEqual({ amount_usd: 3, amount_lbp: 0 });
    expect(parsed.amount_usd).toBeCloseTo(1225, 2);
    expect(parsed.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 1222 },
    ]);
  });

  it("no Waive tapped: a full payment sends no discount", async () => {
    renderSheet();
    await screen.findAllByTestId("supplier-account-settle-row");
    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
    );
    const [, payload] = mockSettleSupplierAccount.mock.calls[0];
    expect(payload).not.toHaveProperty("discount");
  });

  it("changing the payment after Waive drops the waive (Settle disabled again)", async () => {
    renderSheet();
    await payLess("1222");
    fireEvent.click(await screen.findByTestId("waive-remaining"));
    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());

    fireEvent.change(screen.getByDisplayValue("1,222"), {
      target: { value: "1221" },
    });
    await waitFor(() => expect(submit).toBeDisabled());
  });

  it("no Waive while an overpayment surplus is declared", async () => {
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

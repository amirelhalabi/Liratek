/** @jest-environment jsdom */

/**
 * LIRA-344 — "Remove credit" on the OMT Settle Account sheet (admin only):
 * each open account credit gets a button; the confirm asks for a reason
 * (3–200 characters) and sends ONE payload, whose names come from the core
 * schema (rule 24). After success the open queue is read again so the
 * credit line updates.
 *
 * Rule 17: written before the panel existed.
 * Only `useApi` is mocked (a stable object, rule 25).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { removeAccountCreditSchema } from "@liratek/core";
import { AccountSettleSheet } from "../AccountSettleSheet";
import type { AccountBalance } from "../../hooks/useSuppliers";
import { queueRow } from "../../testing/accountSettleFixtures";

const mockRemove = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
const mockApi = {
  settleSupplierAccount: jest.fn(),
  removeSupplierAccountCredit: mockRemove,
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
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
  total_usd: 80,
  total_lbp: 0,
  children: [
    {
      supplier_id: 1,
      name: "OMT",
      provider: "OMT",
      drawer_name: "OMT_System",
      total_usd: 80,
      total_lbp: 0,
      is_parent: true,
    },
  ],
};

const DEBT = queueRow({
  kind: "LEDGER",
  id: 10,
  created_at: "2026-09-01 10:00:00",
  amount_usd: 120,
  entry_type: "TOP_UP",
  service_type: null,
});
/** An account credit (a manual Pay row): OMT owes the shop $40. */
const CREDIT = queueRow({
  kind: "LEDGER",
  id: 20,
  created_at: "2026-09-03 10:00:00",
  amount_usd: -40,
  entry_type: "PAYMENT",
  service_type: null,
  row_scope: "ACCOUNT",
});
/** A day credit (an OMT App cash-out): settled on its day, no button. */
const DAY_CREDIT = queueRow({
  kind: "LEDGER",
  id: 21,
  created_at: "2026-09-04 10:00:00",
  amount_usd: -15,
  entry_type: "PAYMENT",
  service_type: null,
  source_ref_table: "recharges",
});

function renderSheet(canRemoveCredit: boolean) {
  mockGetSupplierAccountUnsettled.mockResolvedValue([DEBT, CREDIT, DAY_CREDIT]);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettleSheet
        account={ACCOUNT}
        onClose={jest.fn()}
        onSettled={jest.fn()}
        canRemoveCredit={canRemoveCredit}
      />
    </QueryClientProvider>,
  );
}

describe("AccountSettleSheet — Remove credit (LIRA-344)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows a Remove button for each account credit only, and only for an admin", async () => {
    renderSheet(true);
    expect(
      await screen.findByTestId("supplier-account-settle-remove-credit-20"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("supplier-account-settle-remove-credit-21"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("supplier-account-settle-remove-credit-10"),
    ).not.toBeInTheDocument();
  });

  it("hides the action from a non-admin", async () => {
    renderSheet(false);
    await screen.findByTestId("supplier-account-settle-credit-line-usd");
    expect(
      screen.queryByTestId("supplier-account-settle-remove-credit-20"),
    ).not.toBeInTheDocument();
  });

  it("asks for a reason, sends one schema-shaped payload, then reads the queue again", async () => {
    mockRemove.mockResolvedValue({
      success: true,
      id: 99,
      transaction_id: 500,
    });
    renderSheet(true);
    fireEvent.click(
      await screen.findByTestId("supplier-account-settle-remove-credit-20"),
    );
    const dialog = screen.getByTestId(
      "supplier-account-settle-remove-credit-dialog",
    );
    expect(dialog).toHaveTextContent("$40.00");
    const confirm = screen.getByTestId(
      "supplier-account-settle-remove-credit-confirm",
    );
    expect(confirm).toBeDisabled();
    fireEvent.change(
      screen.getByTestId("supplier-account-settle-remove-credit-reason"),
      {
        target: { value: "ab" },
      },
    );
    expect(confirm).toBeDisabled();
    fireEvent.change(
      screen.getByTestId("supplier-account-settle-remove-credit-reason"),
      {
        target: { value: "OMT says it was miscalculated" },
      },
    );
    expect(confirm).not.toBeDisabled();
    const readsBefore = mockGetSupplierAccountUnsettled.mock.calls.length;
    fireEvent.click(confirm);

    await waitFor(() => expect(mockRemove).toHaveBeenCalledTimes(1));
    const [accountId, payload] = mockRemove.mock.calls[0];
    expect(accountId).toBe(1);
    // Names from the core schema (rule 24).
    const parsed = removeAccountCreditSchema.parse({
      ...payload,
      account_supplier_id: accountId,
    });
    expect(parsed.ledger_row_id).toBe(20);
    expect(parsed.reason).toBe("OMT says it was miscalculated");
    expect(parsed.expected_remaining).toEqual({ usd: -40, lbp: 0 });
    expect(parsed.client_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const key of Object.keys(payload as object)) {
      expect(Object.keys(removeAccountCreditSchema.shape)).toContain(key);
    }
    await waitFor(() =>
      expect(mockGetSupplierAccountUnsettled.mock.calls.length).toBeGreaterThan(
        readsBefore,
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("supplier-account-settle-remove-credit-dialog"),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows the server's refusal and keeps the dialog open", async () => {
    mockRemove.mockResolvedValue({
      success: false,
      error: "This OMT credit is no longer open — reopen the sheet.",
    });
    renderSheet(true);
    fireEvent.click(
      await screen.findByTestId("supplier-account-settle-remove-credit-20"),
    );
    fireEvent.change(
      screen.getByTestId("supplier-account-settle-remove-credit-reason"),
      {
        target: { value: "Shop's own cost" },
      },
    );
    fireEvent.click(
      screen.getByTestId("supplier-account-settle-remove-credit-confirm"),
    );
    expect(await screen.findByText(/no longer open/)).toBeInTheDocument();
    expect(
      screen.getByTestId("supplier-account-settle-remove-credit-dialog"),
    ).toBeInTheDocument();
  });
});

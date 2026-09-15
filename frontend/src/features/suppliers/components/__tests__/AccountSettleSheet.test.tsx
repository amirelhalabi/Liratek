/** @jest-environment jsdom */

/**
 * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-189, wave 2, lane W6) —
 * `AccountSettleSheet`: the OMT open-credit account's one-call settle sheet
 * (rule 16). INTERACTION-layer test — renders the REAL `@liratek/ui`
 * `CounterpartySettleModal`/`MultiPaymentInput` (jest.config.ts maps
 * "@liratek/ui" to packages/ui/src; only `useApi` is overridden), matching
 * `Suppliers.settleNetPayCurrency.test.tsx`'s precedent for this page's
 * settle flows — assertions are against literal rendered DOM, not
 * intercepted props.
 *
 * `useSupplierAccountUnsettledQuery` is mocked directly (bypassing the real
 * IPC/REST round trip, same as every other Suppliers test in this
 * directory) so each test controls exactly which rows are in the queue.
 * `useSettleSupplierAccountMutation` runs FOR REAL — it is this lane's own
 * new hook, exercised end-to-end down to the `useApi()` mock, so a broken
 * payload shape fails here rather than only in a human review.
 */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountSettleSheet } from "../AccountSettleSheet";
import type { AccountBalance, AccountUnsettledRow } from "../../hooks/useSuppliers";

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
  total_usd: 1124.9,
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
      supplier_id: 2,
      name: "OMT App",
      provider: "OMT_APP",
      drawer_name: "OMT_App",
      total_usd: -100.1,
      total_lbp: 0,
      is_parent: false,
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
  // Always 0 for a non-cashout row — never absent (AccountUnsettledRow's
  // own doc comment); set explicitly since the field is required.
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

/** A cashout credit — negative amount, carries the deferred cashout
 *  commission (D14) core populates on this row kind — set explicitly here
 *  to prove the sheet sums it when present. */
const ROW_CASHOUT: AccountUnsettledRow = {
  kind: "LEDGER",
  id: 20,
  supplier_id: 2,
  source_provider: "OMT_APP",
  source_name: "OMT App",
  created_at: "2026-09-05T00:00:00Z",
  amount_usd: -100.1,
  amount_lbp: 0,
  entry_type: "PAYMENT",
  service_type: null,
  commission_usd: 0.1,
  commission_lbp: 0,
};

function renderSheet(
  rows: AccountUnsettledRow[],
  overrides: Partial<{ onClose: () => void; onSettled: () => void }> = {},
) {
  mockGetSupplierAccountUnsettled.mockResolvedValue(rows);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = overrides.onClose ?? jest.fn();
  const onSettled = overrides.onSettled ?? jest.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettleSheet account={ACCOUNT} onClose={onClose} onSettled={onSettled} />
    </QueryClientProvider>,
  );
  return { onClose, onSettled };
}

describe("AccountSettleSheet (LIRA-189)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 555 });
  });

  it("pre-selects every open row oldest-first, all checked by default (D8)", async () => {
    renderSheet([ROW_CASHOUT, ROW_OMT, ROW_IPICK]);

    const rows = await screen.findAllByTestId("supplier-account-settle-row");
    expect(rows).toHaveLength(3);
    // Oldest-first: ROW_OMT (09-01), ROW_IPICK (09-03), ROW_CASHOUT (09-05).
    expect(rows.map((r) => r.getAttribute("data-row-id"))).toEqual([
      "10",
      "30",
      "20",
    ]);
    for (const row of rows) {
      expect(
        within(row).getByTestId("supplier-account-settle-row-toggle"),
      ).toBeChecked();
    }
  });

  it("nets a credit row against debt rows instead of summing magnitudes, and shows PAY by default when the net is positive", async () => {
    renderSheet([ROW_OMT, ROW_IPICK, ROW_CASHOUT]);
    await screen.findAllByTestId("supplier-account-settle-row");

    // selected total = |1050| + |175| + |-100.10| = 1325.10
    await waitFor(() => {
      expect(
        screen.getByTestId("supplier-account-settle-selected-total").textContent,
      ).toBe("$1325.10");
    });
    // net = 1050 + 175 - 100.10 = 1124.90, positive => PAY
    expect(screen.getByTestId("supplier-account-settle-net").textContent).toBe(
      "$1124.90",
    );
    expect(
      screen.getByTestId("supplier-account-settle-direction-pay"),
    ).toHaveClass("bg-red-600");
  });

  it("unticking the cashout row drops it from both the selected total and the net", async () => {
    renderSheet([ROW_OMT, ROW_IPICK, ROW_CASHOUT]);
    const rows = await screen.findAllByTestId("supplier-account-settle-row");
    const cashoutRow = rows.find((r) => r.getAttribute("data-row-id") === "20")!;
    fireEvent.click(
      within(cashoutRow).getByTestId("supplier-account-settle-row-toggle"),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("supplier-account-settle-selected-total").textContent,
      ).toBe("$1225.00");
    });
    expect(screen.getByTestId("supplier-account-settle-net").textContent).toBe(
      "$1225.00",
    );
    // The deselected row was the only one carrying a deferred commission.
    expect(
      screen.getByTestId("supplier-account-settle-deferred-commission")
        .textContent,
    ).toBe("$0.00");
  });

  it("sums the deferred cashout commission from selected rows' commission fields", async () => {
    renderSheet([ROW_OMT, ROW_CASHOUT]);
    await screen.findAllByTestId("supplier-account-settle-row");

    await waitFor(() => {
      expect(
        screen.getByTestId("supplier-account-settle-deferred-commission")
          .textContent,
      ).toBe("$0.10");
    });
  });

  it("a net-negative selection defaults to COLLECT, and the admin can switch back to PAY", async () => {
    renderSheet([ROW_CASHOUT]);
    await screen.findAllByTestId("supplier-account-settle-row");

    await waitFor(() => {
      // Signed: negative = the account owes the shop (COLLECT, §8.4).
      expect(
        screen.getByTestId("supplier-account-settle-net").textContent,
      ).toBe("-$100.10");
    });
    expect(
      screen.getByTestId("supplier-account-settle-direction-collect"),
    ).toHaveClass("bg-green-600");

    fireEvent.click(screen.getByTestId("supplier-account-settle-direction-pay"));
    expect(
      screen.getByTestId("supplier-account-settle-direction-pay"),
    ).toHaveClass("bg-red-600");
  });

  it("submits ONE call with the selection, net amount, direction and payment legs (rule 16)", async () => {
    const { onSettled } = renderSheet([ROW_OMT, ROW_IPICK]);
    await screen.findAllByTestId("supplier-account-settle-row");

    // MultiPaymentInput auto-seeds a single CASH line at the full total on
    // mount (its own single-mode auto-sync effect) — no manual entry needed
    // for the happy path.
    const submit = await screen.findByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1);
    });
    const [accountSupplierId, payload] = mockSettleSupplierAccount.mock.calls[0];
    expect(accountSupplierId).toBe(1);
    expect(payload.direction).toBe("PAY");
    expect(payload.selections).toEqual([
      { kind: "FINANCIAL_SERVICE", id: 10 },
      { kind: "LEDGER", id: 30 },
    ]);
    expect(payload.amount_usd).toBeCloseTo(1225, 2);
    expect(payload.amount_lbp).toBe(0);
    expect(payload.commission_usd).toBe(0);
    expect(payload.commission_lbp).toBe(0);
    expect(payload.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 1225 },
    ]);

    await waitFor(() => expect(onSettled).toHaveBeenCalled());
  });

  it("blocks submit when the entered payment doesn't cover the all-or-nothing selection (§9.3)", async () => {
    renderSheet([ROW_OMT, ROW_IPICK]);
    await screen.findAllByTestId("supplier-account-settle-row");

    const submit = await screen.findByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());

    // Manually shrink the auto-seeded CASH line below the selected total.
    // (DecimalInput renders the amount with a thousands separator.)
    const amountInput = await screen.findByDisplayValue("1,225");
    fireEvent.change(amountInput, { target: { value: "500" } });

    await waitFor(() => {
      expect(
        screen.getByText(/doesn't cover the selected rows/i),
      ).toBeInTheDocument();
    });
    expect(submit).toBeDisabled();
    expect(mockSettleSupplierAccount).not.toHaveBeenCalled();
  });

  // Money-safety regression (owner-reported overpay bug): a $100-equivalent
  // debt entered as $150 must never reach settleSupplierAccount as a raw IN
  // leg — SupplierRepository.settleSupplierAccount applies every payments[]
  // leg with the same sign (no IN/OUT split), so an unreconciled overpay
  // would drop the drawer by the FULL entered amount while the ledger nets
  // to 0. Proven failing-first against the pre-fix code (rule 17) before
  // this test was kept — see the ticket's failing_first_proof.
  it("blocks submit when the entered payment OVERPAYS the selection", async () => {
    renderSheet([ROW_OMT, ROW_IPICK]);
    await screen.findAllByTestId("supplier-account-settle-row");

    const submit = await screen.findByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());

    // Selected total / net is $1225 — type $1500, a $275 overpay.
    const amountInput = await screen.findByDisplayValue("1,225");
    fireEvent.change(amountInput, { target: { value: "1500" } });

    await waitFor(() => {
      expect(
        screen.getByTestId("supplier-account-settle-mismatch").textContent,
      ).toMatch(/\$275\.00 more than the net amount/i);
    });
    expect(submit).toBeDisabled();
    expect(mockSettleSupplierAccount).not.toHaveBeenCalled();
  });

  it("confirms and submits when the entered payment matches the net amount exactly", async () => {
    renderSheet([ROW_OMT, ROW_IPICK]);
    await screen.findAllByTestId("supplier-account-settle-row");

    const submit = await screen.findByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());

    // Explicitly re-type the exact target (rather than relying purely on
    // the auto-seeded value) so this proves the boundary itself reconciles,
    // not just that the untouched default happens to.
    const amountInput = await screen.findByDisplayValue("1,225");
    fireEvent.change(amountInput, { target: { value: "1225" } });

    expect(
      screen.queryByTestId("supplier-account-settle-mismatch"),
    ).not.toBeInTheDocument();
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);

    await waitFor(() => {
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1);
    });
    const [, payload] = mockSettleSupplierAccount.mock.calls[0];
    expect(payload.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 1225 },
    ]);
  });
});

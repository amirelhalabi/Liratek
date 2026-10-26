/** @jest-environment jsdom */

/**
 * LIRA-345 — the Settle Account sheet for a supplier outside the OMT
 * account (Katsh here): its own name everywhere, no OMT statement-type
 * picker, no commission field when the supplier has no commission to
 * settle, and a stale refusal recognised whatever the supplier's name.
 *
 * RULE 17 — written before the sheet took `showStatementTypes` /
 * `showCommission` and the name-agnostic stale check; the first run's
 * failures are recorded in the LIRA-345 hand-off report.
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
import type { AccountUnsettledRow } from "../../hooks/useSuppliers";
import { queueRow } from "../../testing/accountSettleFixtures";

const mockSettleSupplierAccount = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
const mockApi = {
  settleSupplierAccount: mockSettleSupplierAccount,
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
  getSupplierAccountMonthRows: jest.fn(async () => []),
  getSupplierAccountDayDetail: jest.fn(async () => []),
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  // Rule 25: ONE stable object, never a fresh literal per useApi() call.
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

const KATSH = { account_supplier_id: 7, account_name: "Katsh" };

/** A Katsh top-up still owed (a DAY row on 3 Oct). */
const TOP_UP: AccountUnsettledRow = queueRow({
  kind: "LEDGER",
  id: 501,
  supplier_id: 7,
  source_provider: "Katsh",
  source_name: "Katsh",
  created_at: "2026-10-03 09:00:00",
  amount_usd: 500,
  entry_type: "TOP_UP",
  service_type: null,
  commission_usd: 0,
  omt_service_type: null,
  commission_model: null,
});

function renderSheet() {
  mockGetSupplierAccountUnsettled.mockResolvedValue([
    { ...TOP_UP, shop_day: "2026-10-03" },
  ]);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettleSheet
        account={KATSH}
        showStatementTypes={false}
        showCommission={false}
        onClose={jest.fn()}
        onSettled={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("AccountSettleSheet — a supplier outside the OMT account (LIRA-345)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("names the supplier and hides the OMT statement types and the commission field", async () => {
    renderSheet();
    const usd = await screen.findByTestId("supplier-account-settle-section-usd");
    expect(screen.getByText("Settle Katsh account")).toBeInTheDocument();
    expect(screen.queryByTestId("supplier-account-settle-covered")).toBeNull();
    expect(
      within(usd).queryByTestId("supplier-account-settle-commission-usd"),
    ).toBeNull();
    expect(screen.queryByText(/OMT/)).toBeNull();
  });

  it("a stale refusal naming Katsh keeps the operator's picked days (FR-021)", async () => {
    mockSettleSupplierAccount.mockResolvedValue({
      success: false,
      error:
        "Katsh's balance changed since you opened this sheet. Check the new amounts. (expected $500.00 + 0 LBP, found $800.00 + 0 LBP)",
    });
    renderSheet();
    // After the refusal the queue has a new open day (4 Oct). The stale
    // path freezes the picks, so it is NOT added to them; any other error
    // leaves the default pick, which would take it.
    mockGetSupplierAccountUnsettled.mockResolvedValue([
      { ...TOP_UP, shop_day: "2026-10-03" },
      {
        ...TOP_UP,
        id: 502,
        created_at: "2026-10-04 09:00:00",
        shop_day: "2026-10-04",
        amount_usd: 300,
        remaining_usd: 300,
      },
    ]);
    const usd = await screen.findByTestId("supplier-account-settle-section-usd");
    const amount = within(usd).getAllByTestId(/^payment-amount-/)[0] as HTMLInputElement;
    fireEvent.change(amount, { target: { value: "500" } });
    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    const fetchesBefore = mockGetSupplierAccountUnsettled.mock.calls.length;
    fireEvent.click(submit);

    expect(
      (await screen.findByTestId("supplier-account-settle-error")).textContent,
    ).toMatch(/^Katsh's balance changed/);
    await waitFor(() =>
      expect(mockGetSupplierAccountUnsettled.mock.calls.length).toBeGreaterThan(
        fetchesBefore,
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("1 day picked")).toBeInTheDocument(),
    );
    expect(screen.queryByText("2 days picked")).toBeNull();
  });
});

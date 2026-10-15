/** @jest-environment jsdom */

/**
 * LIRA-322 (US3, T035 — finding F4) — commission entered at settlement is
 * per currency and travels as `per_currency.USD.commission` (the legacy
 * flat `commission_usd` is refused next to `per_currency`).
 *
 * Owner decision 2026-10-15 (replaces FR-013a): "Pay the amount in full;
 * don't let the commission amount affect the payment leg amount." The
 * commission never covers a transfer, never changes the box totals and is
 * never shown as "Extra … goes on the account" — the server credits it to
 * the account after the payment.
 *
 * Not proven failing-first: the 2026-10-15 cases were written after the
 * allocator change (frontend jest resolves @liratek/core from source, so
 * the unfixed allocator was no longer reachable without re-breaking it —
 * rule 17 forbids that). The same behaviour is proven failing-first in
 * core (accountSettleAllocation + lira322CommissionToAccount).
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
import { OMT_ACCOUNT, SIX_USD_ROWS } from "../../testing/accountSettleFixtures";

const mockSettleSupplierAccount = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
const mockApi = {
  settleSupplierAccount: mockSettleSupplierAccount,
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
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

/** The six transfers carry commission at settlement (model 1). */
const MODEL1_ROWS: AccountUnsettledRow[] = SIX_USD_ROWS.map((r) => ({
  ...r,
  commission_model: 1,
}));

function renderSheet(rows: AccountUnsettledRow[]) {
  mockGetSupplierAccountUnsettled.mockResolvedValue(rows);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettleSheet
        account={OMT_ACCOUNT}
        onClose={jest.fn()}
        onSettled={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

function amountInput(section: HTMLElement): HTMLInputElement {
  return within(section).getAllByTestId(
    /^payment-amount-/,
  )[0] as HTMLInputElement;
}

function statuses(section: HTMLElement) {
  return within(section)
    .getAllByTestId("supplier-account-settle-preview-row")
    .map((r) => r.getAttribute("data-status"));
}

describe("AccountSettleSheet — commission per currency (LIRA-322 F4)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 900 });
  });

  it("Cash $497 + commission $0.70 closes all six, shows no extra, and sends per_currency.USD.commission", async () => {
    renderSheet(MODEL1_ROWS);

    const usd = await screen.findByTestId(
      "supplier-account-settle-section-usd",
    );
    fireEvent.change(
      within(usd).getByTestId("supplier-account-settle-commission-usd"),
      { target: { value: "0.70" } },
    );
    // The commission does not touch the line amount (owner 2026-10-15).
    fireEvent.change(amountInput(usd), { target: { value: "497" } });
    expect(amountInput(usd).value).toBe("497");

    await waitFor(() => expect(statuses(usd)).toEqual(Array(6).fill("closes")));
    expect(
      within(usd).getByTestId("supplier-account-settle-still-owed-usd")
        .textContent,
    ).toBe("$0.00");
    // No "Extra $0.70 goes on the account" caused by the commission.
    expect(
      screen.queryByTestId("supplier-account-settle-extra-usd"),
    ).toBeNull();

    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
    );

    const [accountSupplierId, payload] =
      mockSettleSupplierAccount.mock.calls[0];
    const parsed = supplierSettleAccountSchema.parse({
      account_supplier_id: accountSupplierId,
      ...payload,
    });
    expect(parsed.per_currency?.USD?.commission).toBeCloseTo(0.7, 2);
    expect(parsed.per_currency?.USD?.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 497 },
    ]);
    expect(payload).not.toHaveProperty("commission_usd");
    expect(payload).not.toHaveProperty("commission_lbp");
  });

  it("Cash $496.30 + commission $0.70: the commission covers nothing — the newest $21 stays part-paid", async () => {
    renderSheet(MODEL1_ROWS);

    const usd = await screen.findByTestId(
      "supplier-account-settle-section-usd",
    );
    fireEvent.change(amountInput(usd), { target: { value: "496.30" } });
    fireEvent.change(
      within(usd).getByTestId("supplier-account-settle-commission-usd"),
      { target: { value: "0.70" } },
    );

    await waitFor(() =>
      expect(statuses(usd)).toEqual([
        "closes",
        "closes",
        "closes",
        "closes",
        "closes",
        "part-paid",
      ]),
    );
    expect(
      within(usd).getByTestId("supplier-account-settle-still-owed-usd")
        .textContent,
    ).toBe("$0.70");
    expect(
      within(usd).queryByTestId("supplier-account-settle-commission-warning-usd"),
    ).toBeNull();
  });

  it("Cash $496.30 with no commission leaves the newest $21 part-paid ($0.70 owed)", async () => {
    renderSheet(MODEL1_ROWS);

    const usd = await screen.findByTestId(
      "supplier-account-settle-section-usd",
    );
    fireEvent.change(amountInput(usd), { target: { value: "496.30" } });

    await waitFor(() =>
      expect(statuses(usd)).toEqual([
        "closes",
        "closes",
        "closes",
        "closes",
        "closes",
        "part-paid",
      ]),
    );
    expect(
      within(usd).getByTestId("supplier-account-settle-still-owed-usd")
        .textContent,
    ).toBe("$0.70");
  });
});

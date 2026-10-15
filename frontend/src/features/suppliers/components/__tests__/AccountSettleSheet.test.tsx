/** @jest-environment jsdom */

/**
 * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-189) — `AccountSettleSheet`: the OMT
 * open-credit account's one-call settle sheet (rule 16). INTERACTION-layer
 * test — renders the REAL `MultiPaymentInput` (jest maps "@liratek/ui" to
 * packages/ui/src; only `useApi` is overridden, by ONE stable object — rule
 * 25), so a broken payload shape fails here.
 *
 * LIRA-322 rewrite (rule 24 — intent kept, assertions moved to the
 * amount-first sheet): rows are previewed oldest first; credits net against
 * debts in their own currency; the deferred cash-out commission shows when
 * the credit closes; a currency OMT owes the shop is a COLLECT section; one
 * call carries the legs; an UNDERpay is now a partial payment (no longer a
 * block); an overpay is still allowed; a hand-typed rate is sent. Payloads
 * are parsed through `supplierSettleAccountSchema` (rule 24).
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

/** A cash-out credit — negative, carries the deferred cash-out commission
 *  (D14) recognised when the credit closes. */
const ROW_CASHOUT = queueRow({
  kind: "LEDGER",
  id: 20,
  supplier_id: 2,
  source_provider: "OMT_APP",
  source_name: "OMT App",
  created_at: "2026-09-05 00:00:00",
  amount_usd: -100.1,
  entry_type: "PAYMENT",
  service_type: null,
  commission_usd: 0.1,
  omt_service_type: null,
  commission_model: null,
});

function renderSheet(rows: AccountUnsettledRow[]) {
  mockGetSupplierAccountUnsettled.mockResolvedValue(rows);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = jest.fn();
  const onSettled = jest.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <AccountSettleSheet
        account={ACCOUNT}
        onClose={onClose}
        onSettled={onSettled}
      />
    </QueryClientProvider>,
  );
  return { onClose, onSettled };
}

const usdSection = () =>
  screen.findByTestId("supplier-account-settle-section-usd");

function amountInput(section: HTMLElement): HTMLInputElement {
  return within(section).getAllByTestId(
    /^payment-amount-/,
  )[0] as HTMLInputElement;
}

function previewRows(section: HTMLElement) {
  return within(section)
    .getAllByTestId("supplier-account-settle-preview-row")
    .map((r) => [r.getAttribute("data-row-id"), r.getAttribute("data-status")]);
}

async function submitAndParse() {
  const submit = screen.getByTestId("supplier-account-settle-submit");
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  await waitFor(() =>
    expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
  );
  const [accountSupplierId, payload] = mockSettleSupplierAccount.mock.calls[0];
  expect(accountSupplierId).toBe(1);
  return supplierSettleAccountSchema.parse({
    account_supplier_id: accountSupplierId,
    ...payload,
  });
}

describe("AccountSettleSheet (LIRA-189, amount-first since LIRA-322)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 555 });
  });

  it("previews every open row oldest first, and nothing is ticked by hand", async () => {
    renderSheet([ROW_CASHOUT, ROW_OMT, ROW_IPICK]);

    const usd = await usdSection();
    // Oldest first: ROW_OMT (09-01), ROW_IPICK (09-03), ROW_CASHOUT (09-05).
    expect(previewRows(usd).map(([id]) => id)).toEqual(["10", "30", "20"]);
    fireEvent.click(screen.getByTestId("supplier-account-settle-pick-toggle"));
    for (const toggle of await screen.findAllByTestId(
      "supplier-account-settle-row-toggle",
    )) {
      expect(toggle).not.toBeChecked();
    }
  });

  it("nets a credit row against the debt rows: You pay OMT $1124.90", async () => {
    renderSheet([ROW_OMT, ROW_IPICK, ROW_CASHOUT]);

    const usd = await usdSection();
    expect(usd.textContent).toContain("You pay OMT");
    expect(
      within(usd).getByTestId("supplier-account-settle-owed-usd").textContent,
    ).toBe("$1124.90");
  });

  it("the credit closes by netting, and its deferred cash-out commission shows", async () => {
    renderSheet([ROW_OMT, ROW_IPICK, ROW_CASHOUT]);

    const usd = await usdSection();
    fireEvent.change(amountInput(usd), { target: { value: "100" } });

    await waitFor(() =>
      expect(previewRows(usd)).toEqual([
        ["10", "part-paid"],
        ["30", "untouched"],
        ["20", "closes"],
      ]),
    );
    expect(
      within(usd).getByTestId("supplier-account-settle-deferred-commission-usd")
        .textContent,
    ).toBe("$0.10");
  });

  it("a currency where OMT owes the shop is a COLLECT section: OMT pays you $100.10", async () => {
    renderSheet([ROW_CASHOUT]);

    const usd = await usdSection();
    expect(usd.textContent).toContain("OMT pays you");
    expect(
      within(usd).getByTestId("supplier-account-settle-owed-usd").textContent,
    ).toBe("$100.10");

    fireEvent.change(amountInput(usd), { target: { value: "100.10" } });
    const parsed = await submitAndParse();
    expect(parsed.per_currency?.USD?.direction).toBe("COLLECT");
    expect(parsed.expected_owed?.usd).toBeCloseTo(-100.1, 2);
  });

  it("submits ONE call with the money as payment legs (rule 16)", async () => {
    const { onSettled } = renderSheet([ROW_OMT, ROW_IPICK]);

    const usd = await usdSection();
    fireEvent.change(amountInput(usd), { target: { value: "1225" } });
    const parsed = await submitAndParse();

    expect(parsed.per_currency?.USD).toEqual({
      direction: "PAY",
      payments: [{ method: "CASH", currency_code: "USD", amount: 1225 }],
    });
    expect(parsed.expected_owed?.usd).toBeCloseTo(1225, 2);
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
  });

  // LIRA-322 (US2) replaces §9.3's "a selected row is all-or-nothing": an
  // amount below what is owed is a partial payment, never a block.
  it("an underpay is accepted as a partial payment — no mismatch, Confirm enabled", async () => {
    renderSheet([ROW_OMT, ROW_IPICK]);

    const usd = await usdSection();
    fireEvent.change(amountInput(usd), { target: { value: "500" } });

    await waitFor(() =>
      expect(previewRows(usd)).toEqual([
        ["10", "part-paid"],
        ["30", "untouched"],
      ]),
    );
    expect(
      screen.queryByTestId("supplier-account-settle-mismatch"),
    ).not.toBeInTheDocument();
    const parsed = await submitAndParse();
    expect(parsed.per_currency?.USD?.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 500 },
    ]);
  });

  // LIRA-315 — an overpay is allowed: the change box decides what happens.
  it("does NOT block an overpay — the change box shows and Confirm stays enabled", async () => {
    renderSheet([ROW_OMT, ROW_IPICK]);

    const usd = await usdSection();
    fireEvent.change(amountInput(usd), { target: { value: "1500" } });

    await waitFor(() =>
      expect(within(usd).getByTestId("return-change")).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("supplier-account-settle-submit"),
    ).not.toBeDisabled();
  });

  // Owner decision 2026-10-07: a rate the cashier types by hand is sent and
  // stamped on the SUPPLIER_SETTLEMENT row (stamp-only).
  it("sends a hand-typed rate as exchange_rate", async () => {
    renderSheet([ROW_OMT, ROW_IPICK]);

    const usd = await usdSection();
    fireEvent.change(amountInput(usd), { target: { value: "1225" } });
    fireEvent.change(within(usd).getByTestId("payment-exchange-rate"), {
      target: { value: "87000" },
    });
    const parsed = await submitAndParse();
    expect(parsed.exchange_rate).toBe(87000);
  });
});

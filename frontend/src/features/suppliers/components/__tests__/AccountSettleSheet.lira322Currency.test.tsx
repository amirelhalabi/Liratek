/** @jest-environment jsdom */

/**
 * LIRA-322 (US1, T017) — the Settle Account sheet settles one currency at a
 * time. With $497 and 900,000 LBP owed it shows two separate amounts (never
 * one merged, converted figure), one payment box per currency, and paying
 * only USD sends only a USD section.
 *
 * Renders the REAL sheet + REAL `MultiPaymentInput` (jest maps @liratek/ui
 * to its source); only `useApi` is replaced, by ONE stable object (rule 25).
 * Every payload is parsed through the core schema (rule 24), so a field the
 * schema does not know, or a legacy key next to `per_currency`, fails here.
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
import {
  LBP_ROW,
  OMT_ACCOUNT,
  SIX_USD_ROWS,
  queueRow,
} from "../../testing/accountSettleFixtures";

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

function parsedPayload() {
  const [accountSupplierId, payload] = mockSettleSupplierAccount.mock.calls[0];
  return {
    raw: payload as Record<string, unknown>,
    parsed: supplierSettleAccountSchema.parse({
      account_supplier_id: accountSupplierId,
      ...payload,
    }),
  };
}

describe("AccountSettleSheet — one currency at a time (LIRA-322 US1)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 900 });
  });

  it("shows $497.00 and 900,000 LBP as two separate amounts, never a merged figure", async () => {
    renderSheet([...SIX_USD_ROWS, LBP_ROW]);

    expect(
      (await screen.findByTestId("supplier-account-settle-owed-usd"))
        .textContent,
    ).toBe("$497.00");
    expect(
      screen.getByTestId("supplier-account-settle-owed-lbp").textContent,
    ).toBe("900,000 LBP");
    expect(screen.queryByTestId("supplier-account-settle-net")).toBeNull();
  });

  it("renders one payment box per currency, each offering only its own currency", async () => {
    renderSheet([...SIX_USD_ROWS, LBP_ROW]);

    const usd = await screen.findByTestId(
      "supplier-account-settle-section-usd",
    );
    const lbp = screen.getByTestId("supplier-account-settle-section-lbp");
    for (const [section, code] of [
      [usd, "USD"],
      [lbp, "LBP"],
    ] as const) {
      const select = within(section).getAllByTestId(
        /^payment-currency-/,
      )[0] as HTMLSelectElement;
      const options = Array.from(select.querySelectorAll("option")).map(
        (o) => o.value,
      );
      expect(options).toEqual([code]);
    }
  });

  it("paying only Cash $497 sends a USD section only, with expected_owed for both currencies and no legacy keys", async () => {
    renderSheet([...SIX_USD_ROWS, LBP_ROW]);

    const usd = await screen.findByTestId(
      "supplier-account-settle-section-usd",
    );
    fireEvent.change(amountInput(usd), { target: { value: "497" } });

    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
    );

    const { raw, parsed } = parsedPayload();
    expect(parsed.account_supplier_id).toBe(1);
    expect(parsed.per_currency?.USD).toEqual({
      direction: "PAY",
      payments: [{ method: "CASH", currency_code: "USD", amount: 497 }],
    });
    expect(parsed.per_currency && "LBP" in parsed.per_currency).toBe(false);
    expect(parsed.expected_owed?.usd).toBeCloseTo(497, 2);
    expect(parsed.expected_owed?.lbp).toBe(900000);
    // Legacy whole-row keys are never sent (the schema refuses them anyway).
    for (const key of ["selections", "direction", "amount_usd", "amount_lbp"]) {
      expect(raw).not.toHaveProperty(key);
    }
  });

  it("Confirm is enabled with money in one currency only, and disabled with none", async () => {
    renderSheet([...SIX_USD_ROWS, LBP_ROW]);

    const lbp = await screen.findByTestId(
      "supplier-account-settle-section-lbp",
    );
    const submit = screen.getByTestId("supplier-account-settle-submit");
    expect(submit).toBeDisabled();

    fireEvent.change(amountInput(lbp), { target: { value: "900000" } });
    await waitFor(() => expect(submit).not.toBeDisabled());
  });

  // Which currencies go in `per_currency` decides which ledger moves. Both
  // cases below were written after the code — not proven failing-first.
  it("pure netting: a USD credit that closes a debt with nothing typed sends USD with no payments, and no LBP key", async () => {
    const debt = queueRow({
      id: 301,
      created_at: "2026-10-01 10:00:00",
      amount_usd: 152,
    });
    const credit = queueRow({
      kind: "LEDGER",
      id: 302,
      created_at: "2026-10-02 10:00:00",
      amount_usd: -60,
      entry_type: "PAYMENT",
      service_type: null,
      omt_service_type: null,
      commission_model: null,
    });
    renderSheet([debt, credit]);

    const usd = await screen.findByTestId(
      "supplier-account-settle-section-usd",
    );
    await waitFor(() =>
      expect(
        within(usd)
          .getAllByTestId("supplier-account-settle-preview-row")
          .map((r) => r.getAttribute("data-status")),
      ).toEqual(["part-paid", "closes"]),
    );
    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
    );

    const { parsed } = parsedPayload();
    expect(parsed.per_currency?.USD).toEqual({
      direction: "PAY",
      payments: [],
    });
    expect(parsed.per_currency && "LBP" in parsed.per_currency).toBe(false);
  });

  it("FR-002: money in USD only leaves LBP out of the payload even when LBP netting could close something", async () => {
    const lbpCredit = queueRow({
      kind: "LEDGER",
      id: 202,
      created_at: "2026-10-08 10:00:00",
      amount_lbp: -100000,
      entry_type: "PAYMENT",
      service_type: null,
      omt_service_type: null,
      commission_model: null,
    });
    renderSheet([...SIX_USD_ROWS, LBP_ROW, lbpCredit]);

    const usd = await screen.findByTestId(
      "supplier-account-settle-section-usd",
    );
    fireEvent.change(amountInput(usd), { target: { value: "497" } });

    const lbp = screen.getByTestId("supplier-account-settle-section-lbp");
    await waitFor(() =>
      expect(
        within(lbp)
          .getAllByTestId("supplier-account-settle-preview-row")
          .map((r) => r.getAttribute("data-status")),
      ).toEqual(["untouched", "untouched"]),
    );

    const submit = screen.getByTestId("supplier-account-settle-submit");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
    );
    const { parsed } = parsedPayload();
    expect(Object.keys(parsed.per_currency ?? {})).toEqual(["USD"]);
    expect(parsed.expected_owed?.lbp).toBe(800000);
  });
});

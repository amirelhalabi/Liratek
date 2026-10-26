/** @jest-environment jsdom */

/**
 * LIRA-322 (US1, T017) — the Settle Account sheet settles one currency at a
 * time. With $497 and 900,000 LBP owed it shows two separate amounts (never
 * one merged, converted figure), and paying only USD sends only a USD
 * section.
 *
 * Owner 2026-10-15 (one-box follow-up): both currencies share ONE payment
 * box — a USD line and an LBP line, pre-filled with what is owed — whose
 * Total / Paid / Remaining rows keep each currency in its own currency
 * (`perCurrencyTotals`). Lines go back to their own currency's section;
 * change goes to the section of the currency that was overpaid. These
 * one-box cases were written AFTER the sheet change — not proven
 * failing-first (the box-level behaviour they rely on is, in
 * MultiPaymentInput.perCurrencyTotals.test.tsx).
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
import {
  buildDaySelections,
  openDaysBefore,
  supplierSettleAccountSchema,
} from "@liratek/core";
import { localDay } from "@/shared/utils/localDay";
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

const BOTH = "supplier-account-settle-section-usd-lbp";

/** The one box's lines, in seed order: [USD, LBP]. */
function lineInputs(box: HTMLElement): HTMLInputElement[] {
  return within(box).getAllByTestId(/^payment-amount-/) as HTMLInputElement[];
}

function setLines(box: HTMLElement, usd: string, lbp: string): void {
  const [usdInput, lbpInput] = lineInputs(box);
  fireEvent.change(usdInput, { target: { value: usd } });
  fireEvent.change(lbpInput, { target: { value: lbp } });
}

async function submitOnce() {
  const submit = screen.getByTestId("supplier-account-settle-submit");
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  await waitFor(() =>
    expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
  );
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

  it("shows $497.00 and 900,000 LBP as two separate amounts in one header, never a merged figure", async () => {
    renderSheet([...SIX_USD_ROWS, LBP_ROW]);

    const box = await screen.findByTestId(BOTH);
    expect(
      within(box).getByTestId("supplier-account-settle-owed-usd").textContent,
    ).toBe("$497.00");
    expect(
      within(box).getByTestId("supplier-account-settle-owed-lbp").textContent,
    ).toBe("900,000 LBP");
    expect(box.textContent).toContain("You pay OMT$497.00 · 900,000 LBP");
    expect(screen.queryByTestId("supplier-account-settle-net")).toBeNull();
  });

  it("renders ONE payment box with a USD line and an LBP line, pre-filled with what is owed", async () => {
    renderSheet([...SIX_USD_ROWS, LBP_ROW]);

    const box = await screen.findByTestId(BOTH);
    expect(
      screen.queryByTestId("supplier-account-settle-section-usd"),
    ).toBeNull();
    expect(
      screen.queryByTestId("supplier-account-settle-section-lbp"),
    ).toBeNull();
    expect(within(box).getAllByTestId("payment-summary")).toHaveLength(1);

    const currencies = (
      within(box).getAllByTestId(/^payment-currency-/) as HTMLSelectElement[]
    ).map((s) => s.value);
    expect(currencies).toEqual(["USD", "LBP"]);
    expect(lineInputs(box).map((i) => i.value)).toEqual(["497", "900,000"]);
    // The box's own rows keep each currency in its own currency.
    expect(within(box).getByTestId("payment-summary").textContent).toContain(
      "Total Amount$497.00 · 900,000 LBP",
    );
  });

  it("confirming straight away settles both currencies in full, each in its own section", async () => {
    renderSheet([...SIX_USD_ROWS, LBP_ROW]);
    await screen.findByTestId(BOTH);

    await submitOnce();
    const { parsed } = parsedPayload();
    expect(parsed.per_currency?.USD).toEqual({
      direction: "PAY",
      payments: [{ method: "CASH", currency_code: "USD", amount: 497 }],
    });
    expect(parsed.per_currency?.LBP).toEqual({
      direction: "PAY",
      payments: [{ method: "CASH", currency_code: "LBP", amount: 900000 }],
    });
  });

  it("paying only Cash $497 (LBP line cleared) sends a USD section only, with expected_owed for both currencies and no legacy keys", async () => {
    renderSheet([...SIX_USD_ROWS, LBP_ROW]);

    const box = await screen.findByTestId(BOTH);
    setLines(box, "497", "0");
    // The unpaid LBP is shown by itself, never netted into a $ figure.
    await waitFor(() =>
      expect(within(box).getByTestId("remaining-amount").textContent).toBe(
        "900,000 LBP",
      ),
    );

    await submitOnce();
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
    for (const key of ["direction", "amount_usd", "amount_lbp"]) {
      expect(raw).not.toHaveProperty(key);
    }
    // LIRA-343 — `selections` is now always sent: the picked days' open
    // rows (every open day before today by default), from the ONE builder.
    expect(parsed.selections).toEqual(
      buildDaySelections([...SIX_USD_ROWS, LBP_ROW], {
        pickedDays: openDaysBefore([...SIX_USD_ROWS, LBP_ROW], localDay()),
      }).selections,
    );
    expect(parsed.selections).toHaveLength(7);
  });

  it("Confirm is enabled with money in one currency only, and disabled with none", async () => {
    renderSheet([...SIX_USD_ROWS, LBP_ROW]);

    const box = await screen.findByTestId(BOTH);
    const submit = screen.getByTestId("supplier-account-settle-submit");
    setLines(box, "0", "0");
    await waitFor(() => expect(submit).toBeDisabled());

    fireEvent.change(lineInputs(box)[1], { target: { value: "900000" } });
    await waitFor(() => expect(submit).not.toBeDisabled());
  });

  it("$600 + LBP cleared: the $103 USD overpay is change in the USD section; LBP is not sent", async () => {
    renderSheet([...SIX_USD_ROWS, LBP_ROW]);

    const box = await screen.findByTestId(BOTH);
    setLines(box, "600", "0");
    await waitFor(() =>
      expect(within(box).getByTestId("change-due").textContent).toContain(
        "$103.00",
      ),
    );

    await submitOnce();
    const { parsed } = parsedPayload();
    expect(parsed.per_currency?.USD?.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 600 },
      { method: "CASH", currency_code: "USD", amount: 103, direction: "OUT" },
    ]);
    expect(parsed.per_currency && "LBP" in parsed.per_currency).toBe(false);
  });

  it("an LBP overpay handed back in $ is change in the LBP section, never subtracted from USD", async () => {
    renderSheet([...SIX_USD_ROWS, LBP_ROW]);

    const box = await screen.findByTestId(BOTH);
    setLines(box, "497", "989000");
    await waitFor(() =>
      expect(within(box).getByTestId("return-change")).toBeInTheDocument(),
    );
    fireEvent.click(within(box).getByTestId("return-all-usd"));

    await submitOnce();
    const { parsed } = parsedPayload();
    expect(parsed.per_currency?.USD?.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 497 },
    ]);
    expect(parsed.per_currency?.LBP?.payments).toEqual([
      { method: "CASH", currency_code: "LBP", amount: 989000 },
      { method: "CASH", currency_code: "USD", amount: 1, direction: "OUT" },
    ]);
  });

  it("both currencies overpaid: each change leg goes to its own currency's section", async () => {
    renderSheet([...SIX_USD_ROWS, LBP_ROW]);

    const box = await screen.findByTestId(BOTH);
    setLines(box, "500", "989000");
    await waitFor(() =>
      expect(within(box).getByTestId("change-due").textContent).toContain(
        "$4.00",
      ),
    );

    await submitOnce();
    const { parsed } = parsedPayload();
    expect(parsed.per_currency?.USD?.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 500 },
      { method: "CASH", currency_code: "USD", amount: 3, direction: "OUT" },
    ]);
    expect(parsed.per_currency?.LBP?.payments).toEqual([
      { method: "CASH", currency_code: "LBP", amount: 989000 },
      { method: "CASH", currency_code: "LBP", amount: 89000, direction: "OUT" },
    ]);
  });

  // Which currencies go in `per_currency` decides which ledger moves. Both
  // cases below were written after the code — not proven failing-first.
  it("pure netting: a USD credit that closes a debt with the line cleared sends USD with no payments, and no LBP key", async () => {
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
    fireEvent.change(lineInputs(usd)[0], { target: { value: "0" } });
    await waitFor(() =>
      expect(
        within(usd)
          .getAllByTestId("supplier-account-settle-preview-row")
          .map((r) => r.getAttribute("data-status")),
      ).toEqual(["part-paid", "closes"]),
    );
    await submitOnce();

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

    const box = await screen.findByTestId(BOTH);
    setLines(box, "497", "0");

    const lbpPreview = within(box).getByTestId(
      "supplier-account-settle-preview-lbp",
    );
    await waitFor(() =>
      expect(
        within(lbpPreview)
          .getAllByTestId("supplier-account-settle-preview-row")
          .map((r) => r.getAttribute("data-status")),
      ).toEqual(["untouched", "untouched"]),
    );

    await submitOnce();
    const { parsed } = parsedPayload();
    expect(Object.keys(parsed.per_currency ?? {})).toEqual(["USD"]);
    expect(parsed.expected_owed?.lbp).toBe(800000);
  });

  it("OMT pays you in both currencies: one box, COLLECT in both sections, 'OMT still owes' rows per currency", async () => {
    const credit = (id: number, over: Partial<AccountUnsettledRow>) =>
      queueRow({
        kind: "LEDGER",
        id,
        created_at: `2026-10-0${id - 400} 10:00:00`,
        entry_type: "PAYMENT",
        service_type: null,
        omt_service_type: null,
        commission_model: null,
        ...over,
      });
    renderSheet([
      credit(401, { amount_usd: -40 }),
      credit(402, { amount_lbp: -500000 }),
    ]);

    const box = await screen.findByTestId(BOTH);
    expect(box.textContent).toContain("OMT pays you$40.00 · 500,000 LBP");
    // Pre-filled in full: nothing left, said per currency.
    expect(within(box).getByTestId("owed-after-row").textContent).toBe(
      "OMT still owes$0.00 · 0 LBP",
    );
    fireEvent.change(lineInputs(box)[1], { target: { value: "300000" } });
    await waitFor(() =>
      expect(within(box).getByTestId("remaining-row").textContent).toBe(
        "OMT still owes200,000 LBP",
      ),
    );

    await submitOnce();
    const { parsed } = parsedPayload();
    expect(parsed.per_currency?.USD).toEqual({
      direction: "COLLECT",
      payments: [{ method: "CASH", currency_code: "USD", amount: 40 }],
    });
    expect(parsed.per_currency?.LBP).toEqual({
      direction: "COLLECT",
      payments: [{ method: "CASH", currency_code: "LBP", amount: 300000 }],
    });
  });

  // LIRA-343 (FR-010): every payment box is pre-filled per currency with
  // what the picked days owe, so the small opposite-direction box is no
  // longer empty (rule 24: the "starts empty" assertion was rewritten).
  it("mixed directions (shop owes $, OMT owes LBP): the LBP side keeps its own small box, pre-filled", async () => {
    const lbpCredit = queueRow({
      kind: "LEDGER",
      id: 203,
      created_at: "2026-10-08 10:00:00",
      amount_lbp: -500000,
      entry_type: "PAYMENT",
      service_type: null,
      omt_service_type: null,
      commission_model: null,
    });
    renderSheet([...SIX_USD_ROWS, lbpCredit]);

    const usd = await screen.findByTestId(
      "supplier-account-settle-section-usd",
    );
    const lbp = screen.getByTestId("supplier-account-settle-section-lbp");
    expect(screen.queryByTestId(BOTH)).toBeNull();
    expect(usd.textContent).toContain("You pay OMT");
    expect(lbp.textContent).toContain("OMT pays you");
    // Both boxes pre-filled with what is owed in their own currency.
    expect(lineInputs(usd)[0].value).toBe("497");
    expect(lineInputs(lbp)[0].value).toBe("500,000");
  });
});

/** @jest-environment jsdom */

/**
 * LIRA-322 (US5, T047) — ticking transfers narrowed what a settlement covers.
 *
 * LIRA-343 rewrite (rule 24, intent kept): the top-level "Pick transfers"
 * toggle is gone (single transfers return inside a day's details, US4). The
 * scope is now narrowed by picking DAYS on the calendar. The same three
 * intents are guarded:
 *   - the sheet opens with the default scope and no top-level picker;
 *   - narrowing (now: unpicking days) narrows the preview, `expected_owed`
 *     and `selections`;
 *   - "Clear" no longer means "the whole account": with nothing picked
 *     Confirm is off, so a payload never goes out without `selections`
 *     (the server reads a missing list as the whole account); "Pick all
 *     open" brings every open day back.
 * Today is fixed at 26 Oct 2026; the six fixture transfers sit on 1–6 Oct.
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

jest.mock("@/shared/utils/localDay", () => {
  const actual = jest.requireActual("@/shared/utils/localDay");
  return { ...actual, localDay: () => "2026-10-26" };
});

const mockSettleSupplierAccount = jest.fn();
const mockGetSupplierAccountUnsettled = jest.fn();
const mockApi = {
  settleSupplierAccount: mockSettleSupplierAccount,
  getSupplierAccountUnsettled: mockGetSupplierAccountUnsettled,
  // LIRA-343 — the calendar's month read: the same six October rows, so
  // their days can be tapped.
  getSupplierAccountMonthRows: jest.fn(async () => SIX_USD_ROWS),
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

/** Tap the calendar day `2026-10-DD`. */
async function tapDay(dd: string) {
  const cell = await waitFor(() => {
    const el = document.querySelector(`[data-day="2026-10-${dd}"]`);
    if (!el) throw new Error(`day ${dd} not rendered`);
    return el as HTMLElement;
  });
  const button = within(cell).getByRole("button");
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
}

async function submitAndParse() {
  const submit = screen.getByTestId("supplier-account-settle-submit");
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  await waitFor(() =>
    expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1),
  );
  const [accountSupplierId, payload] = mockSettleSupplierAccount.mock.calls[0];
  return {
    raw: payload as Record<string, unknown>,
    parsed: supplierSettleAccountSchema.parse({
      account_supplier_id: accountSupplierId,
      ...payload,
    }),
  };
}

describe("AccountSettleSheet — narrowing the scope (LIRA-322 US5 → LIRA-343 days)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 900 });
  });

  it("opens with every open day picked and no top-level transfer picker", async () => {
    renderSheet(SIX_USD_ROWS);

    const usd = await screen.findByTestId(
      "supplier-account-settle-section-usd",
    );
    expect(
      within(usd).getByTestId("supplier-account-settle-owed-usd").textContent,
    ).toBe("$497.00");
    expect(
      screen.queryByTestId("supplier-account-settle-pick-toggle"),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("supplier-account-settle-row")).toHaveLength(
      0,
    );
  });

  it("unpicking 1–4 Oct narrows the preview to the two $21 transfers and sends them as selections", async () => {
    renderSheet(SIX_USD_ROWS);

    for (const dd of ["01", "02", "03", "04"]) await tapDay(dd);

    const usd = screen.getByTestId("supplier-account-settle-section-usd");
    await waitFor(() =>
      expect(
        within(usd).getByTestId("supplier-account-settle-owed-usd").textContent,
      ).toBe("$42.00"),
    );
    fireEvent.change(amountInput(usd), { target: { value: "30" } });
    await waitFor(() =>
      expect(previewRows(usd)).toEqual([
        ["105", "closes"],
        ["106", "part-paid"],
      ]),
    );

    const { parsed } = await submitAndParse();
    expect(parsed.selections).toEqual([
      { kind: "FINANCIAL_SERVICE", id: 105 },
      { kind: "FINANCIAL_SERVICE", id: 106 },
    ]);
    expect(parsed.expected_owed?.usd).toBeCloseTo(42, 2);
    expect(parsed.expected_owed?.lbp).toBe(0);
  });

  it("Clear turns Confirm off (never a payload without selections); Pick all open brings every day back", async () => {
    renderSheet(SIX_USD_ROWS);

    await screen.findByTestId("supplier-account-settle-section-usd");
    fireEvent.click(screen.getByText("Clear"));
    await waitFor(() =>
      expect(
        screen.getByTestId("supplier-account-settle-submit"),
      ).toBeDisabled(),
    );
    expect(mockSettleSupplierAccount).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Pick all open"));
    const usd = await screen.findByTestId(
      "supplier-account-settle-section-usd",
    );
    await waitFor(() =>
      expect(
        within(usd).getByTestId("supplier-account-settle-owed-usd").textContent,
      ).toBe("$497.00"),
    );

    const { raw, parsed } = await submitAndParse();
    expect(raw).toHaveProperty("selections");
    expect(parsed.selections).toHaveLength(6);
    expect(parsed.expected_owed?.usd).toBeCloseTo(497, 2);
  });
});

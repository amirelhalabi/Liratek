/** @jest-environment jsdom */

/**
 * LIRA-322 (US5, T047) — ticking transfers is an optional override. The
 * sheet opens with NOTHING ticked behind a collapsed "Pick transfers"
 * toggle; the whole account is in scope. Ticking rows narrows the preview
 * (and `expected_owed`) to them and sends `selections`; "Clear" goes back to
 * the whole account and omits `selections`.
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

async function tick(rowId: number) {
  const row = (
    await screen.findAllByTestId("supplier-account-settle-row")
  ).find((r) => r.getAttribute("data-row-id") === String(rowId))!;
  fireEvent.click(
    within(row).getByTestId("supplier-account-settle-row-toggle"),
  );
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

describe("AccountSettleSheet — optional transfer picker (LIRA-322 US5)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 900 });
  });

  it("opens with the picker collapsed and nothing ticked", async () => {
    renderSheet(SIX_USD_ROWS);

    const toggle = await screen.findByTestId(
      "supplier-account-settle-pick-toggle",
    );
    expect(screen.queryAllByTestId("supplier-account-settle-row")).toHaveLength(
      0,
    );

    fireEvent.click(toggle);
    const rows = await screen.findAllByTestId("supplier-account-settle-row");
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(
        within(row).getByTestId("supplier-account-settle-row-toggle"),
      ).not.toBeChecked();
    }
  });

  it("ticking the two $21 transfers narrows the preview and sends them as selections", async () => {
    renderSheet(SIX_USD_ROWS);

    fireEvent.click(
      await screen.findByTestId("supplier-account-settle-pick-toggle"),
    );
    await tick(105);
    await tick(106);

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

  it("Clear returns to the whole account and omits selections", async () => {
    renderSheet(SIX_USD_ROWS);

    fireEvent.click(
      await screen.findByTestId("supplier-account-settle-pick-toggle"),
    );
    await tick(105);
    fireEvent.click(screen.getByTestId("supplier-account-settle-pick-clear"));

    const usd = screen.getByTestId("supplier-account-settle-section-usd");
    await waitFor(() =>
      expect(
        within(usd).getByTestId("supplier-account-settle-owed-usd").textContent,
      ).toBe("$497.00"),
    );
    fireEvent.change(amountInput(usd), { target: { value: "497" } });

    const { raw, parsed } = await submitAndParse();
    expect(raw).not.toHaveProperty("selections");
    expect(parsed.expected_owed?.usd).toBeCloseTo(497, 2);
  });
});

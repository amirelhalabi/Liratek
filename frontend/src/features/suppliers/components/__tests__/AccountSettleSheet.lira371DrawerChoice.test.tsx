/** @jest-environment jsdom */

/**
 * LIRA-371 T024 — the Settle Account sheet offers "OMT Cash Drawer |
 * General" for the main-system supplier when a cash line is paid. "Comes
 * from" on PAY, "Goes to" on COLLECT. Picking General adds
 * `cash_drawer: "GENERAL"` to the ONE settle payload (parsed through the
 * core schema, rule 24); no control and no key for Katsh / product
 * suppliers (`systemCashDrawer={null}`) or a non-cash-only payment.
 *
 * REAL sheet + REAL MultiPaymentInput; one stable useApi mock (rule 25).
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { supplierSettleAccountSchema } from "@liratek/core";
import { AccountSettleSheet } from "../AccountSettleSheet";
import type { AccountUnsettledRow } from "../../hooks/useSuppliers";
import {
  OMT_ACCOUNT,
  SIX_USD_ROWS,
  queueRow,
} from "../../testing/accountSettleFixtures";

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
  return { ...actual, useApi: () => mockApi };
});

const METHODS = [
  { code: "CASH", label: "Cash", drawer_name: "General", affects_drawer: 1 },
  { code: "WHISH", label: "Whish", drawer_name: "Whish_App", affects_drawer: 1 },
];
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: METHODS,
    drawerAffectingMethods: METHODS,
    allMethods: METHODS,
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

const COLLECT_ROWS: AccountUnsettledRow[] = [
  queueRow({
    id: 90,
    created_at: "2026-10-01 09:00:00",
    service_type: "RECEIVE",
    amount_usd: -1000,
  }),
];

function renderSheet(
  rows: AccountUnsettledRow[],
  systemCashDrawer: "OMT_System" | "Whish_System" | null,
) {
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
        systemCashDrawer={systemCashDrawer}
      />
    </QueryClientProvider>,
  );
}

async function submitAndParse() {
  const submit = screen.getByTestId("supplier-account-settle-submit");
  await waitFor(() => expect(submit).not.toBeDisabled());
  fireEvent.click(submit);
  await waitFor(() => expect(mockSettleSupplierAccount).toHaveBeenCalledTimes(1));
  const [accountSupplierId, payload] = mockSettleSupplierAccount.mock.calls[0];
  return {
    raw: payload as Record<string, unknown>,
    parsed: supplierSettleAccountSchema.parse({
      account_supplier_id: accountSupplierId,
      ...payload,
    }),
  };
}

describe("AccountSettleSheet — LIRA-371 cash drawer choice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSettleSupplierAccount.mockResolvedValue({ success: true, id: 900 });
  });

  it("PAY with a pre-filled cash line: the choice shows, OMT selected, 'Comes from'", async () => {
    renderSheet(SIX_USD_ROWS, "OMT_System");
    const choice = await screen.findByTestId("cash-drawer-choice");
    expect(choice.textContent).toContain("Comes from");
    expect(screen.getByTestId("cash-drawer-choice-system")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("COLLECT says 'Goes to'", async () => {
    renderSheet(COLLECT_ROWS, "OMT_System");
    const choice = await screen.findByTestId("cash-drawer-choice");
    expect(choice.textContent).toContain("Goes to");
  });

  it("picking General sends cash_drawer GENERAL", async () => {
    renderSheet(SIX_USD_ROWS, "OMT_System");
    fireEvent.click(await screen.findByTestId("cash-drawer-choice-general"));
    const { parsed } = await submitAndParse();
    expect(parsed.cash_drawer).toBe("GENERAL");
  });

  it("the default sends cash_drawer SYSTEM", async () => {
    renderSheet(SIX_USD_ROWS, "OMT_System");
    await screen.findByTestId("cash-drawer-choice");
    const { parsed } = await submitAndParse();
    expect(parsed.cash_drawer).toBe("SYSTEM");
  });

  it("Katsh / product supplier (systemCashDrawer null): no control, no key", async () => {
    renderSheet(SIX_USD_ROWS, null);
    await screen.findByTestId("supplier-account-settle-submit");
    expect(screen.queryByTestId("cash-drawer-choice")).toBeNull();
    const { raw } = await submitAndParse();
    expect("cash_drawer" in raw).toBe(false);
  });

  it("a non-cash-only payment: no control, no key", async () => {
    renderSheet(SIX_USD_ROWS, "OMT_System");
    await screen.findByTestId("cash-drawer-choice");
    const box = screen.getByTestId("supplier-account-settle-paid-total")
      .parentElement as HTMLElement;
    const select = within(box).getAllByTestId(/^payment-method-/)[0] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "WHISH" } });
    await waitFor(() =>
      expect(screen.queryByTestId("cash-drawer-choice")).toBeNull(),
    );
    const { raw } = await submitAndParse();
    expect("cash_drawer" in raw).toBe(false);
  });
});

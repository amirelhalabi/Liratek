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

  // LIRA-399 (owner 2026-11-18, option A): the drawer is chosen ON the cash
  // line — the method list offers "Cash · OMT Cash Drawer" (CASH) and
  // "Cash · General" (CASH_GENERAL); the leg carries `cash_drawer`. No
  // "Comes from" row, no settlement-level key. RULE 17 — run before the
  // change: the General option did not exist (select had 2 options).
  const methodSelect = () =>
    within(screen.getByTestId("supplier-account-settle-section-usd")).getAllByTestId(
      /^payment-method-/,
    )[0] as HTMLSelectElement;
  const optionLabels = () => [...methodSelect().options].map((o) => o.textContent);

  it("PAY: the method list splits Cash by drawer, OMT drawer selected by default, no 'Comes from' row", async () => {
    renderSheet(SIX_USD_ROWS, "OMT_System");
    await screen.findByTestId("supplier-account-settle-section-usd");
    expect(optionLabels()).toEqual(["Cash · OMT Cash Drawer", "Cash · General", "Whish"]);
    expect(methodSelect().value).toBe("CASH");
    expect(screen.queryByTestId("cash-drawer-choice")).toBeNull();
  });

  it("picking 'Cash · General' sends the leg as CASH with cash_drawer GENERAL, no settlement-level key", async () => {
    renderSheet(SIX_USD_ROWS, "OMT_System");
    await screen.findByTestId("supplier-account-settle-section-usd");
    fireEvent.change(methodSelect(), { target: { value: "CASH_GENERAL" } });
    const { parsed, raw } = await submitAndParse();
    expect(parsed.per_currency?.USD?.payments[0]).toMatchObject({
      method: "CASH",
      cash_drawer: "GENERAL",
    });
    expect("cash_drawer" in raw).toBe(false);
  });

  it("the default (OMT drawer) sends a plain CASH leg: no cash_drawer anywhere", async () => {
    renderSheet(SIX_USD_ROWS, "OMT_System");
    await screen.findByTestId("supplier-account-settle-section-usd");
    const { parsed, raw } = await submitAndParse();
    expect(parsed.per_currency?.USD?.payments[0]?.method).toBe("CASH");
    expect("cash_drawer" in (parsed.per_currency?.USD?.payments[0] ?? {})).toBe(false);
    expect("cash_drawer" in raw).toBe(false);
  });

  it("COLLECT lists the same two Cash entries", async () => {
    renderSheet(COLLECT_ROWS, "OMT_System");
    await screen.findByTestId("supplier-account-settle-section-usd");
    expect(optionLabels()).toEqual(["Cash · OMT Cash Drawer", "Cash · General", "Whish"]);
  });

  it("Katsh / product supplier (systemCashDrawer null): plain Cash only, no key", async () => {
    renderSheet(SIX_USD_ROWS, null);
    await screen.findByTestId("supplier-account-settle-section-usd");
    expect(optionLabels()).toEqual(["Cash", "Whish"]);
    const { raw } = await submitAndParse();
    expect("cash_drawer" in raw).toBe(false);
  });

  it("a wallet line carries no cash_drawer", async () => {
    renderSheet(SIX_USD_ROWS, "OMT_System");
    await screen.findByTestId("supplier-account-settle-section-usd");
    fireEvent.change(methodSelect(), { target: { value: "WHISH" } });
    const { parsed } = await submitAndParse();
    expect(parsed.per_currency?.USD?.payments[0]).toMatchObject({ method: "WHISH" });
    expect("cash_drawer" in (parsed.per_currency?.USD?.payments[0] ?? {})).toBe(false);
  });
});

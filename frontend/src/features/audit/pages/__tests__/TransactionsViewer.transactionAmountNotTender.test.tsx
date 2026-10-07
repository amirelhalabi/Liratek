/** @jest-environment jsdom */
/**
 * Production test 2026-10-07 — the Transactions table, rendered for real
 * (TransactionsViewer + the real DataTable), for Sale #99 and the rows that
 * reverse it. Pure-helper coverage lives in
 * `__tests__/transactionAmountDisplay.test.ts` and
 * `__tests__/cashFlow.reversalDirection.test.ts`; this spec proves the cells
 * actually use them (a wiring mistake in a cell is invisible to the helpers).
 *
 * Rows are found by IDENTITY (their own summary text), never by position
 * (rule 15).
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { REFUND_KEPT_CHANGE_META } from "@liratek/core";
import TransactionsViewer from "../TransactionsViewer";

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "tester", role: "staff" } }),
}));
import { getRecentTransactions } from "@/api/backendApi";

jest.mock("@/api/backendApi", () => ({
  getRecentTransactions: jest.fn(),
  voidTransaction: jest.fn(),
  refundTransaction: jest.fn(),
  voidCheckoutGroup: jest.fn(),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [],
    drawerAffectingMethods: [],
    allMethods: [],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Test Shop", phone: "", location: "", logo: "" }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getSessionItemRefundPreview: jest.fn(),
    refundSessionBasketItem: jest.fn(),
  }),
}));

const mockGetRecentTransactions = getRecentTransactions as jest.MockedFunction<
  typeof getRecentTransactions
>;

// Time(0) Summary(1) Type(2) Client(3) Amount(4) …
const AMOUNT_COL_INDEX = 4;

function rowFor(text: string): HTMLTableRowElement {
  // Exact match: "Sale #99 widget" is a substring of its own void's summary.
  const el = screen.getByText(text);
  const tr = el.closest("tr");
  if (!tr) throw new Error(`No <tr> for "${text}"`);
  return tr as HTMLTableRowElement;
}
const amountCellFor = (text: string) =>
  rowFor(text).querySelectorAll("td")[AMOUNT_COL_INDEX]?.textContent ?? "";

function leg(direction: "in" | "out", amount: number, reversal = false) {
  return {
    direction,
    amount,
    signed_amount: direction === "out" ? -amount : amount,
    currency_code: "USD",
    method: "CASH",
    drawer_name: "General",
    ...(reversal ? { reversal: true } : {}),
  };
}

function baseRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    type: "SALE",
    status: "ACTIVE",
    source_table: "sales",
    source_id: 99,
    user_id: 1,
    amount_usd: 0,
    amount_lbp: 0,
    exchange_rate: null,
    client_id: null,
    reverses_id: null,
    summary: null,
    metadata_json: null,
    device_id: null,
    created_at: "2026-10-07 10:00:00",
    username: "admin",
    client_name: null,
    session_id: null,
    reversed_by_id: null,
    payments: [],
    ...overrides,
  };
}

const SALE = "Sale #99 widget";
const VOID = "VOID: Sale #99 widget";
const REFUND = "REFUND: Sale #99 other";
const TOPUP_RECEIVE_ID = 300;
const BASKET = "Basket sale #77";

const saleRow = baseRow({
  id: 99,
  status: "VOIDED",
  amount_usd: 4.25,
  summary: SALE,
  payments: [leg("in", 5), leg("out", 0.5)],
});
const voidRow = baseRow({
  id: 100,
  amount_usd: -4.25,
  reverses_id: 99,
  summary: VOID,
  created_at: "2026-10-07 10:05:00",
  payments: [leg("out", 5), leg("in", 0.5)],
});
const refundRow = baseRow({
  id: 101,
  type: "REFUND",
  amount_usd: -4.25,
  reverses_id: 98,
  summary: REFUND,
  created_at: "2026-10-07 10:06:00",
  payments: [leg("out", 4)],
  metadata_json: JSON.stringify({ [REFUND_KEPT_CHANGE_META.usd]: 0.25 }),
});
const omtReceiveAutoRow = baseRow({
  id: TOPUP_RECEIVE_ID,
  type: "SUPPLIER_PAYMENT",
  source_table: "supplier_ledger",
  amount_usd: -100,
  summary: "Supplier TOP_UP: $-100 + 0 LBP",
  created_at: "2026-10-07 10:07:00",
  // Not is_auto here: is_auto rows are hidden by default and this spec is
  // about the label, which is the same either way.
  metadata_json: JSON.stringify({
    supplier_id: 3,
    entry_type: "TOP_UP",
    counterparty: {
      kind: "supplier",
      id: 3,
      name: "OMT",
      flow: "OUT",
      method: "LEDGER",
    },
  }),
});
const voidedBasketRow = baseRow({
  id: 200,
  status: "VOIDED",
  amount_usd: 5,
  summary: BASKET,
  session_id: 77,
  created_at: "2026-10-07 09:00:00",
  session_payments: [
    leg("in", 5),
    leg("out", 0.5),
    leg("out", 5, true),
    leg("in", 0.5, true),
  ],
});

async function renderRows(rows: unknown[]) {
  mockGetRecentTransactions.mockResolvedValue(rows as never);
  render(
    <TransactionsViewer
      limit="50"
      selectedFilters={[]}
      search=""
      from=""
      to=""
    />,
  );
}

describe("TransactionsViewer — the Amount column shows the transaction amount", () => {
  beforeEach(() => mockGetRecentTransactions.mockReset());

  it("sale, its void and a refund: $4.25 / −$4.25 / −$4.25 — not $5 / $0.5 / $-4.25", async () => {
    await renderRows([saleRow, voidRow, refundRow]);
    await waitFor(() => screen.getByText(VOID, { exact: false }));

    expect(amountCellFor(SALE)).toBe("$4.25");
    expect(amountCellFor(VOID)).toBe("−$4.25");
    expect(amountCellFor(REFUND)).toBe("−$4.25");
  });

  it("the cash movement is a secondary line in words", async () => {
    await renderRows([saleRow, voidRow, refundRow]);
    await waitFor(() => screen.getByText(VOID, { exact: false }));

    const legsOf = (t: string) =>
      within(rowFor(t)).getByTestId("payment-legs").textContent;
    expect(legsOf(SALE)).toBe("paid $5.00 · change $0.50");
    expect(legsOf(VOID)).toBe("handed back $5.00 · change taken back $0.50");
    expect(legsOf(REFUND)).toBe("handed back $4.00 · kept $0.25");
  });

  it("the badge carries the transaction amount and the arrow follows the reversal", async () => {
    await renderRows([saleRow, voidRow, refundRow]);
    await waitFor(() => screen.getByText(VOID, { exact: false }));

    const badgeOf = (t: string) =>
      within(rowFor(t)).getByTestId("cash-flow-badge");
    expect(badgeOf(SALE).getAttribute("data-direction")).toBe("in");
    expect(badgeOf(SALE).textContent).toContain("$4.25");
    expect(badgeOf(VOID).getAttribute("data-direction")).toBe("out");
    expect(badgeOf(VOID).textContent).toContain("$4.25");
    expect(badgeOf(REFUND).getAttribute("data-direction")).toBe("out");
    expect(badgeOf(REFUND).textContent).toContain("$4.25");
  });

  it("an OMT RECEIVE's supplier row says what it means, not 'Supplier TOP_UP'", async () => {
    await renderRows([omtReceiveAutoRow]);
    await waitFor(() =>
      screen.getByText("Owed to OMT reduced by $100.00", { exact: false }),
    );
    expect(screen.queryByText(/Supplier TOP_UP/)).toBeNull();
  });

  it("a voided basket shows its payment and its reversal apart, not 'in: $5.5 · out: $5.5'", async () => {
    await renderRows([voidedBasketRow]);
    await waitFor(() => screen.getByText(BASKET, { exact: false }));

    const tr = rowFor(BASKET);
    expect(within(tr).getByTestId("session-payment-legs").textContent).toBe(
      "Session: in: $5 · out: $0.5",
    );
    expect(within(tr).getByTestId("session-reversal-legs").textContent).toBe(
      "Basket reversed: handed back $5.00 · change taken back $0.50",
    );

    // The payment detail (always included in Excel/PDF export) marks the
    // reversal legs too, instead of listing them as more checkout legs.
    fireEvent.click(
      within(tr).getByTestId(`toggle-legs-${voidedBasketRow.id}`),
    );
    const pooled = screen.getByTestId(
      `session-legs-detail-${voidedBasketRow.id}`,
    );
    const lines = within(pooled)
      .getAllByText(/^(In|Out)/)
      .map((el) => el.textContent);
    expect(lines).toEqual([
      "In — Cash: $5",
      "Out — Cash: $0.5",
      "Out — Cash: $5 (basket reversal)",
      "In — Cash: $0.5 (basket reversal)",
    ]);
  });
});

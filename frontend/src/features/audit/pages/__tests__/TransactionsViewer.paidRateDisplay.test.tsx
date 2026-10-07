/** @jest-environment jsdom */
/**
 * Owner decision 2026-10-07 — the Transactions table's "@ rate" shows the
 * rate the customer actually PAID at. A session-basket member's own
 * `exchange_rate` is its CART-time stamp; the basket's checkout rate comes
 * back from `getRecent` as `display_exchange_rate` (core:
 * `DISPLAY_EXCHANGE_RATE_SQL`, the same order the session-item refund
 * defaults its rate by). A row with no amount and no legs (e.g. a session's
 * KEPT_CHANGE profit row) shows no lone "@ rate" at all.
 *
 * Rows are found by IDENTITY (their own summary text), never by position
 * (rule 15).
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import TransactionsViewer from "../TransactionsViewer";
import { getRecentTransactions } from "@/api/backendApi";

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "tester", role: "staff" } }),
}));

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

// Rule 25: a useApi() mock MUST return a stable reference.
const mockApi = {
  getSessionItemRefundPreview: jest.fn(),
  refundSessionBasketItem: jest.fn(),
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const mockGetRecentTransactions = getRecentTransactions as jest.MockedFunction<
  typeof getRecentTransactions
>;

function baseRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    type: "RECHARGE",
    status: "ACTIVE",
    source_table: "recharges",
    source_id: 1,
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

const MEMBER = "Recharge in basket #5";
const KEPT = "Kept change (session checkout): $2";
const STANDALONE = "Standalone expense";

const memberRow = baseRow({
  id: 10,
  amount_usd: 10,
  summary: MEMBER,
  session_id: 5,
  exchange_rate: 89_500,
  display_exchange_rate: 87_000,
});
const keptRow = baseRow({
  id: 11,
  type: "KEPT_CHANGE",
  source_table: "customer_sessions",
  source_id: 5,
  summary: KEPT,
  session_id: 5,
  exchange_rate: 87_000,
  display_exchange_rate: 87_000,
  created_at: "2026-10-07 10:00:01",
});
const standaloneRow = baseRow({
  id: 12,
  type: "EXPENSE",
  source_table: "expenses",
  amount_usd: -5,
  summary: STANDALONE,
  exchange_rate: 86_000,
  display_exchange_rate: 86_000,
  created_at: "2026-10-07 09:00:00",
});

function rowFor(text: string): HTMLTableRowElement {
  const tr = screen.getByText(text).closest("tr");
  if (!tr) throw new Error(`No <tr> for "${text}"`);
  return tr as HTMLTableRowElement;
}

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
  await waitFor(() => screen.getByText(STANDALONE, { exact: false }));
}

describe("TransactionsViewer — '@ rate' is the rate the customer paid at", () => {
  beforeEach(() => mockGetRecentTransactions.mockReset());

  it("a session member shows the basket's checkout rate, not its cart-time stamp", async () => {
    await renderRows([memberRow, keptRow, standaloneRow]);
    const text = within(rowFor(MEMBER)).getByTestId("payment-legs").textContent;
    expect(text).toContain("@ 87,000");
    expect(text).not.toContain("89,500");
  });

  it("a row outside any basket still shows its own rate", async () => {
    await renderRows([memberRow, keptRow, standaloneRow]);
    expect(
      within(rowFor(STANDALONE)).getByTestId("payment-legs").textContent,
    ).toContain("@ 86,000");
  });

  it("a 0/0 row with no legs (session kept change) shows no lone '@ rate'", async () => {
    await renderRows([memberRow, keptRow, standaloneRow]);
    expect(within(rowFor(KEPT)).queryByTestId("payment-legs")).toBeNull();
  });
});

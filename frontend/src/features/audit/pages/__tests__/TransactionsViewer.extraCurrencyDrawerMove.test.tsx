/** @jest-environment jsdom */
/**
 * Owner report (2026-08-28): a General drawer top-up of €100 rendered as
 *
 *   ↓ —  Drawer Top-Up: General  @ 89,500 | General Top-up | — | — | — | Admin
 *
 * — no currency, no amount, no method. Verified against the owner's live db
 * (transactions#401): `amount_usd`/`amount_lbp` are 0/0 (a top-up in a
 * currency other than USD/LBP carries its money in
 * `metadata_json.extra_currencies`, exactly like the sibling Cash Out flow),
 * and the real EUR `payments` leg — method CASH, drawer General — IS written
 * by `DrawerTopUpRepository.createTopUp`, but
 * `TransactionRepository._attachPaymentLegs` strips it one layer before this
 * page ever sees the row: `isInternalLegJs` treats every non-USD/LBP leg as
 * internal (`CUSTOMER_CASH_CURRENCIES`), which is what keeps USDT/crypto legs
 * out of the cash-flow report and must NOT change.
 *
 * Same shape, and the same display-only remedy, as the bills-only commission
 * bug in `TransactionsViewer.amountColumn.test.tsx`: read the figure back
 * from the metadata the repository already stamps, never from the stored
 * `amount_usd`/`amount_lbp`, and never by loosening the leg filter.
 *
 * Interaction-level (rule 17): renders the REAL page so a helper that is
 * correct but unwired still fails.
 */
import { render, screen, waitFor } from "@testing-library/react";
import TransactionsViewer from "../TransactionsViewer";
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

const mockGetRecentTransactions = getRecentTransactions as jest.MockedFunction<
  typeof getRecentTransactions
>;

// Column order in buildTr: Time(0) Summary(1) Type(2) Client(3) Amount(4)
// Method(5) User(6) Status(7) Reverses(8) Actions(9).
const AMOUNT_COL_INDEX = 4;
const METHOD_COL_INDEX = 5;

function rowFor(summaryText: string): HTMLTableRowElement {
  const summarySpan = screen.getByText(summaryText, { exact: false });
  const row = summarySpan.closest("tr");
  if (!row) throw new Error(`No <tr> ancestor found for "${summaryText}"`);
  return row as HTMLTableRowElement;
}

function cellFor(summaryText: string, index: number): string {
  return rowFor(summaryText).querySelectorAll("td")[index]?.textContent ?? "";
}

function badgeFor(summaryText: string): HTMLElement {
  const badge = rowFor(summaryText).querySelector(
    '[data-testid="cash-flow-badge"]',
  );
  if (!badge) throw new Error(`No cash-flow-badge in row for "${summaryText}"`);
  return badge as HTMLElement;
}

function baseRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    type: "DRAWER_TOPUP",
    status: "ACTIVE",
    source_table: "drawer_topups",
    source_id: 1,
    user_id: 1,
    amount_usd: 0,
    amount_lbp: 0,
    exchange_rate: 89500,
    client_id: null,
    reverses_id: null,
    summary: null,
    metadata_json: null,
    device_id: null,
    created_at: "2026-08-28 09:54:53",
    username: "admin",
    client_name: null,
    session_id: null,
    reversed_by_id: null,
    // Empty on purpose: this mirrors what the page actually receives — the
    // EUR leg exists in the `payments` table but is filtered out upstream.
    payments: [],
    ...overrides,
  };
}

const EUR_TOPUP_SUMMARY = "Drawer Top-Up: General";
const eurTopUpRow = baseRow({
  id: 401,
  summary: EUR_TOPUP_SUMMARY,
  metadata_json: JSON.stringify({
    drawer: "General",
    notes: null,
    extra_currencies: [{ currency_code: "EUR", amount: 100 }],
  }),
});

// Mixed top-up: the USD leg survives the upstream filter (USD is customer
// cash), the two foreign legs do not — the row must show BOTH sides.
const MIXED_TOPUP_SUMMARY = "Drawer Top-Up: General - mixed deposit";
const mixedTopUpRow = baseRow({
  id: 402,
  amount_usd: 50,
  summary: MIXED_TOPUP_SUMMARY,
  metadata_json: JSON.stringify({
    drawer: "General",
    notes: "mixed deposit",
    extra_currencies: [
      { currency_code: "EUR", amount: 100 },
      { currency_code: "AED", amount: 200 },
    ],
  }),
  payments: [
    {
      direction: "in",
      amount: 50,
      signed_amount: 50,
      currency_code: "USD",
      method: "CASH",
    },
  ],
});

// Sibling flow, sign-flipped (DrawerCashoutRepository): metadata holds the
// POSITIVE entered amount, the transaction row holds the negated USD/LBP.
const EUR_CASHOUT_SUMMARY = "Cash Out: General - owner draw";
const eurCashoutRow = baseRow({
  id: 403,
  type: "DRAWER_CASHOUT",
  source_table: "drawer_cashouts",
  summary: EUR_CASHOUT_SUMMARY,
  metadata_json: JSON.stringify({
    drawer: "General",
    notes: "owner draw",
    extra_currencies: [{ currency_code: "EUR", amount: 100 }],
  }),
});

// Plain USD top-up — no extra_currencies at all. Regression guard: this row
// already rendered correctly and must be untouched by the fix.
const USD_TOPUP_SUMMARY = "Drawer Top-Up: General - cash deposit";
const usdTopUpRow = baseRow({
  id: 404,
  amount_usd: 50,
  summary: USD_TOPUP_SUMMARY,
  metadata_json: JSON.stringify({
    drawer: "General",
    notes: "cash deposit",
    extra_currencies: null,
  }),
  payments: [
    {
      direction: "in",
      amount: 50,
      signed_amount: 50,
      currency_code: "USD",
      method: "CASH",
    },
  ],
});

// Malformed metadata must degrade to today's blank row, never throw.
const MALFORMED_SUMMARY = "Drawer Top-Up: General - malformed";
const malformedRow = baseRow({
  id: 405,
  summary: MALFORMED_SUMMARY,
  metadata_json: "{not valid json",
});

function renderViewer() {
  render(
    <TransactionsViewer
      limit="50"
      selectedFilter="All"
      search=""
      from=""
      to=""
    />,
  );
}

describe("TransactionsViewer — extra-currency drawer top-up / cash-out", () => {
  beforeEach(() => {
    mockGetRecentTransactions.mockReset();
  });

  it("shows the foreign amount and CASH method for a EUR-only top-up", async () => {
    mockGetRecentTransactions.mockResolvedValue([eurTopUpRow]);
    renderViewer();
    await waitFor(() => screen.getByText(EUR_TOPUP_SUMMARY, { exact: false }));

    expect(cellFor(EUR_TOPUP_SUMMARY, AMOUNT_COL_INDEX)).toContain("100 EUR");
    expect(cellFor(EUR_TOPUP_SUMMARY, AMOUNT_COL_INDEX)).not.toContain("—");
    expect(cellFor(EUR_TOPUP_SUMMARY, METHOD_COL_INDEX)).toBe("Cash");

    const badge = badgeFor(EUR_TOPUP_SUMMARY);
    expect(badge.getAttribute("data-direction")).toBe("in");
    expect(badge.textContent).toContain("100 EUR");
    expect(badge.textContent).not.toContain("—");
  });

  it("lists every currency of a mixed USD + foreign top-up", async () => {
    mockGetRecentTransactions.mockResolvedValue([mixedTopUpRow]);
    renderViewer();
    await waitFor(() =>
      screen.getByText(MIXED_TOPUP_SUMMARY, { exact: false }),
    );

    const amount = cellFor(MIXED_TOPUP_SUMMARY, AMOUNT_COL_INDEX);
    expect(amount).toContain("$50");
    expect(amount).toContain("100 EUR");
    expect(amount).toContain("200 AED");
    expect(cellFor(MIXED_TOPUP_SUMMARY, METHOD_COL_INDEX)).toBe("Cash");
  });

  it("shows the foreign amount and CASH method for a EUR-only cash-out", async () => {
    mockGetRecentTransactions.mockResolvedValue([eurCashoutRow]);
    renderViewer();
    await waitFor(() =>
      screen.getByText(EUR_CASHOUT_SUMMARY, { exact: false }),
    );

    expect(cellFor(EUR_CASHOUT_SUMMARY, AMOUNT_COL_INDEX)).toContain("100 EUR");
    expect(cellFor(EUR_CASHOUT_SUMMARY, METHOD_COL_INDEX)).toBe("Cash");

    const badge = badgeFor(EUR_CASHOUT_SUMMARY);
    expect(badge.getAttribute("data-direction")).toBe("out");
    expect(badge.textContent).toContain("100 EUR");
  });

  it("leaves a plain USD top-up rendering exactly as before", async () => {
    mockGetRecentTransactions.mockResolvedValue([usdTopUpRow]);
    renderViewer();
    await waitFor(() => screen.getByText(USD_TOPUP_SUMMARY, { exact: false }));

    expect(cellFor(USD_TOPUP_SUMMARY, AMOUNT_COL_INDEX)).toBe("$50");
    expect(cellFor(USD_TOPUP_SUMMARY, METHOD_COL_INDEX)).toBe("Cash");
  });

  it("degrades to a blank amount on malformed metadata instead of throwing", async () => {
    mockGetRecentTransactions.mockResolvedValue([malformedRow]);
    renderViewer();
    await waitFor(() => screen.getByText(MALFORMED_SUMMARY, { exact: false }));

    expect(cellFor(MALFORMED_SUMMARY, AMOUNT_COL_INDEX)).toBe("—");
    expect(cellFor(MALFORMED_SUMMARY, METHOD_COL_INDEX)).toBe("—");
  });
});

/** @jest-environment jsdom */
/**
 * LIRA-137 residual — Transactions viewer Amount column for a bills-only
 * commission settlement.
 *
 * Owner report: a Katsh bills-only settlement (e.g. "Katsh credited
 * 100,000 LBP commission") rendered `$0.00` in the Amount column — the real
 * figure only ever appeared inside the free-text Summary. Root cause: the
 * commission is booked as a real `payments` leg on the settlement's own
 * transaction (SupplierRepository._bookBillsCommissionDrawerTopUp), but that
 * leg's `drawer_name` ("Katsh"/"iPick") is a member of
 * `TransactionRepository`'s `PROVIDER_STOCK_DRAWERS` set, so
 * `_attachPaymentLegs`'s `toLeg` (via `isInternalLegJs`) strips it out of
 * `row.payments` ONE LAYER BEFORE this page ever receives the row — there is
 * no leg here to read. This spec exercises the fix instead: reading the
 * SAME commission figure off `row.metadata_json.commission_usd`/
 * `commission_lbp`, which `SupplierRepository.settleTransactions` stamps
 * from the identical settlement input that funded the (unreachable) drawer
 * leg — display-only, never touching the stored `amount_usd`/`amount_lbp`.
 *
 * Interaction-level (rule 17): renders the REAL `TransactionsViewer` page
 * with the REAL `DataTable` (`@liratek/ui`) and asserts the Amount `<td>`'s
 * rendered text — a props-level assertion on the helper alone would not
 * catch a wiring mistake in `buildTr` (every display bug this session was
 * invisible to non-rendering tests).
 */
import {
  render,
  screen,
  waitFor,
  within,
  fireEvent,
} from "@testing-library/react";
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

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

const mockGetRecentTransactions = getRecentTransactions as jest.MockedFunction<
  typeof getRecentTransactions
>;

// Column order in buildTr: Time(0) Summary(1) Type(2) Client(3) Amount(4)
// Method(5) User(6) Status(7) Reverses(8) Actions(9).
const AMOUNT_COL_INDEX = 4;
const SUMMARY_COL_INDEX = 1;

function amountCellFor(summaryText: string): string {
  const summarySpan = screen.getByText(summaryText, { exact: false });
  const row = summarySpan.closest("tr");
  if (!row) throw new Error(`No <tr> ancestor found for "${summaryText}"`);
  const cells = row.querySelectorAll("td");
  return cells[AMOUNT_COL_INDEX]?.textContent ?? "";
}

// Owner follow-up (2026-08-13, request #4): the real backend
// (SupplierRepository's `_formatCommissionMoneyForSummary`) now drops the
// zero USD side and the "(drawer top-up)" parenthetical — this fixture
// mirrors that CURRENT format, not the pre-fix one this file used to encode.
const BILLS_ONLY_SUMMARY =
  "Settlement: 2 txns — Katsh credited 100,000 LBP commission";
const LEGACY_SUMMARY = "Settlement: 3 txns, net $25.00";
const SALE_SUMMARY = "Sale of a widget";

function baseRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    type: "SALE",
    status: "ACTIVE",
    source_table: "sales",
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
    created_at: "2026-08-12 01:10:00",
    username: "admin",
    client_name: null,
    session_id: null,
    reversed_by_id: null,
    payments: [],
    ...overrides,
  };
}

const billsOnlySettlementRow = baseRow({
  id: 101,
  type: "SUPPLIER_SETTLEMENT",
  source_table: "supplier_ledger",
  amount_usd: 0,
  amount_lbp: 0,
  summary: BILLS_ONLY_SUMMARY,
  created_at: "2026-08-12 01:10:00",
  metadata_json: JSON.stringify({
    supplier_id: 5,
    financial_service_ids: [1, 2],
    commission_usd: 0,
    commission_lbp: 100000,
    commission_model: 1,
    entry_mode: "LUMP",
    counterparty: {
      kind: "supplier",
      id: 5,
      name: "Katsh",
      flow: "IN",
      method: "CASH",
    },
  }),
});

// Legacy OMT/WHISH-shaped settlement (commission_model = 0): a real net
// payment OUT, with amount_usd/amount_lbp genuinely nonzero. Also carries an
// (informational-only, per SupplierRepository's own doc comment) nonzero
// commission_lbp field to prove the gate keys on commission_model/flow, not
// merely "does metadata have a commission field".
const legacySettlementRow = baseRow({
  id: 102,
  type: "SUPPLIER_SETTLEMENT",
  source_table: "supplier_ledger",
  amount_usd: 25,
  amount_lbp: 0,
  summary: LEGACY_SUMMARY,
  created_at: "2026-08-12 01:09:00",
  metadata_json: JSON.stringify({
    supplier_id: 6,
    financial_service_ids: [3, 4, 5],
    commission_usd: 0,
    commission_lbp: 20000,
    commission_model: 0,
    counterparty: { kind: "supplier", id: 6, name: "OMT", flow: "OUT" },
  }),
});

const normalSaleRow = baseRow({
  id: 103,
  type: "SALE",
  amount_usd: 50,
  amount_lbp: 0,
  summary: SALE_SUMMARY,
  created_at: "2026-08-12 01:08:00",
  metadata_json: null,
});

// A bills-only-shaped SUPPLIER_SETTLEMENT with malformed metadata_json — must
// degrade to today's $0.00, never throw or blank the row.
const malformedMetadataRow = baseRow({
  id: 104,
  type: "SUPPLIER_SETTLEMENT",
  amount_usd: 0,
  amount_lbp: 0,
  summary: "Settlement: malformed metadata row",
  created_at: "2026-08-12 01:07:00",
  metadata_json: "{not valid json",
});

// Owner report (2026-08-12): the Amount <td> fix above left a SECOND render
// site of the same figure untouched — the CashFlowBadge (Summary column,
// the small "↓ <amount>" chip next to the free-text summary). It computes
// its own displayed magnitude from the row's stored amount_usd/amount_lbp
// (0/0 for a bills-only settlement), independent of the Amount <td>'s
// billsOnlyCommissionAmount() derivation, so it rendered "—" even after the
// Amount column was fixed.
function badgeInRowFor(summaryText: string): HTMLElement {
  const summarySpan = screen.getByText(summaryText, { exact: false });
  const row = summarySpan.closest("tr");
  if (!row) throw new Error(`No <tr> ancestor found for "${summaryText}"`);
  const badge = row.querySelector('[data-testid="cash-flow-badge"]');
  if (!badge) {
    throw new Error(`No cash-flow-badge found in row for "${summaryText}"`);
  }
  return badge as HTMLElement;
}

describe("TransactionsViewer — CashFlowBadge for a bills-only settlement", () => {
  beforeEach(() => {
    mockGetRecentTransactions.mockReset();
  });

  it("shows the commission amount in the badge, not an em dash", async () => {
    mockGetRecentTransactions.mockResolvedValue([billsOnlySettlementRow]);

    render(
      <TransactionsViewer
        limit="50"
        selectedFilter="All"
        search=""
        from=""
        to=""
      />,
    );

    await waitFor(() => screen.getByText(BILLS_ONLY_SUMMARY, { exact: false }));

    const badge = badgeInRowFor(BILLS_ONLY_SUMMARY);
    expect(badge.getAttribute("data-direction")).toBe("in");
    expect(badge.textContent).toContain("100,000 LBP");
    expect(badge.textContent).not.toContain("—");
  });

  it("leaves a legacy (commission_model = 0) settlement badge rendering exactly as before", async () => {
    mockGetRecentTransactions.mockResolvedValue([legacySettlementRow]);

    render(
      <TransactionsViewer
        limit="50"
        selectedFilter="All"
        search=""
        from=""
        to=""
      />,
    );

    await waitFor(() => screen.getByText(LEGACY_SUMMARY, { exact: false }));

    const badge = badgeInRowFor(LEGACY_SUMMARY);
    expect(badge.getAttribute("data-direction")).toBe("out");
    expect(badge.textContent).toContain("$25");
  });

  it("degrades a malformed metadata_json on a bills-only-shaped row to today's unaffected badge instead of throwing", async () => {
    mockGetRecentTransactions.mockResolvedValue([malformedMetadataRow]);

    render(
      <TransactionsViewer
        limit="50"
        selectedFilter="All"
        search=""
        from=""
        to=""
      />,
    );

    await waitFor(() =>
      screen.getByText("Settlement: malformed metadata row", {
        exact: false,
      }),
    );

    const badge = badgeInRowFor("Settlement: malformed metadata row");
    expect(badge.getAttribute("data-direction")).toBe("out");
    expect(badge.textContent).toContain("—");
  });
});

// ---------------------------------------------------------------------------
// LIRA-140 — provider-balance marker (amber "+") vs the plain green cash-in
// arrow.
//
// `isProviderBalanceInflow` (../../transactionDisplay.ts) widens the amber
// marker's gate from `isSupplierCredit` alone to ALSO cover a LIRA-137
// bills-only settlement whose commission was collected via a provider
// drawer top-up (`commission_collection_mode` TOP_UP or absent) — that
// money never touched a till, unlike an OTHER_PAYMENT-mode settlement or an
// ordinary cash receipt. Interaction-level (rule 17): renders the REAL page
// + REAL DataTable, matches rows by identity (a unique summary substring,
// never row position — rule 15).
// ---------------------------------------------------------------------------

const TOP_UP_EXPLICIT_SUMMARY =
  "Settlement: 1 txns — iPick credited 250,000 LBP commission";
const topUpExplicitRow = baseRow({
  id: 105,
  type: "SUPPLIER_SETTLEMENT",
  source_table: "supplier_ledger",
  amount_usd: 0,
  amount_lbp: 0,
  summary: TOP_UP_EXPLICIT_SUMMARY,
  created_at: "2026-08-12 01:11:00",
  metadata_json: JSON.stringify({
    supplier_id: 7,
    financial_service_ids: [6],
    commission_usd: 0,
    commission_lbp: 250000,
    commission_model: 1,
    entry_mode: "LUMP",
    commission_collection_mode: "TOP_UP",
    counterparty: {
      kind: "supplier",
      id: 7,
      name: "iPick",
      flow: "IN",
      method: "iPick",
    },
  }),
});

const OTHER_PAYMENT_SUMMARY_140 =
  "Settlement: 1 txns — iPick credited 300,000 LBP commission";
const otherPaymentRow140 = baseRow({
  id: 106,
  type: "SUPPLIER_SETTLEMENT",
  source_table: "supplier_ledger",
  amount_usd: 0,
  amount_lbp: 0,
  summary: OTHER_PAYMENT_SUMMARY_140,
  created_at: "2026-08-12 01:12:00",
  payments: [
    {
      direction: "in",
      amount: 300000,
      signed_amount: 300000,
      currency_code: "LBP",
      method: "CASH",
    },
  ],
  metadata_json: JSON.stringify({
    supplier_id: 7,
    financial_service_ids: [7],
    commission_usd: 0,
    commission_lbp: 300000,
    commission_model: 1,
    entry_mode: "LUMP",
    commission_collection_mode: "OTHER_PAYMENT",
    counterparty: {
      kind: "supplier",
      id: 7,
      name: "iPick",
      flow: "IN",
      method: "CASH",
    },
  }),
});

// Legacy cashless SUPPLIER_PAYMENT receivable — `is_credit: true`, no
// `is_auto` key. Per verified fact 7 (`isSupplierPaymentVisible`,
// auditConstants.ts:111): with `selectedFilter="All"` the active filter
// option is undefined, so visibility is `!isAutoSupplierPayment(metaJson)` —
// an `is_auto: true` row would be hidden and the assertion below would fail
// for the wrong reason.
const LEGACY_CREDIT_SUMMARY = "Legacy supplier credit — bill commission";
const legacyCreditRow = baseRow({
  id: 107,
  type: "SUPPLIER_PAYMENT",
  source_table: "supplier_ledger",
  amount_usd: 0,
  amount_lbp: 45000,
  summary: LEGACY_CREDIT_SUMMARY,
  created_at: "2026-08-12 01:13:00",
  metadata_json: JSON.stringify({
    supplier_id: 8,
    is_credit: true,
  }),
});

describe("TransactionsViewer — LIRA-140 provider-balance marker", () => {
  beforeEach(() => {
    mockGetRecentTransactions.mockReset();
  });

  it("bills-only settlement, explicit commission_collection_mode TOP_UP: amber provider marker, data-direction stays in", async () => {
    mockGetRecentTransactions.mockResolvedValue([topUpExplicitRow]);

    render(
      <TransactionsViewer
        limit="50"
        selectedFilter="All"
        search=""
        from=""
        to=""
      />,
    );

    await waitFor(() =>
      screen.getByText(TOP_UP_EXPLICIT_SUMMARY, { exact: false }),
    );

    const badge = badgeInRowFor(TOP_UP_EXPLICIT_SUMMARY);
    expect(badge.getAttribute("data-cash-location")).toBe("provider");
    expect(badge.textContent).toContain("+");
    // Guards the lira-141 e2e contract (assertCashFlowBadge): direction
    // stays "in" regardless of location — only the location differs.
    expect(badge.getAttribute("data-direction")).toBe("in");
  });

  it("bills-only settlement, commission_collection_mode field ABSENT: also amber (core's documented TOP_UP default)", async () => {
    mockGetRecentTransactions.mockResolvedValue([billsOnlySettlementRow]);

    render(
      <TransactionsViewer
        limit="50"
        selectedFilter="All"
        search=""
        from=""
        to=""
      />,
    );

    await waitFor(() => screen.getByText(BILLS_ONLY_SUMMARY, { exact: false }));

    const badge = badgeInRowFor(BILLS_ONLY_SUMMARY);
    expect(badge.getAttribute("data-cash-location")).toBe("provider");
    expect(badge.getAttribute("data-direction")).toBe("in");
  });

  it("bills-only settlement, explicit commission_collection_mode OTHER_PAYMENT: no provider marker, plain green in", async () => {
    mockGetRecentTransactions.mockResolvedValue([otherPaymentRow140]);

    render(
      <TransactionsViewer
        limit="50"
        selectedFilter="All"
        search=""
        from=""
        to=""
      />,
    );

    await waitFor(() =>
      screen.getByText(OTHER_PAYMENT_SUMMARY_140, { exact: false }),
    );

    const badge = badgeInRowFor(OTHER_PAYMENT_SUMMARY_140);
    expect(badge.getAttribute("data-cash-location")).toBeNull();
    expect(badge.getAttribute("data-direction")).toBe("in");
  });

  it("legacy is_credit SUPPLIER_PAYMENT row: provider marker still present (legacy rows undisturbed)", async () => {
    mockGetRecentTransactions.mockResolvedValue([legacyCreditRow]);

    render(
      <TransactionsViewer
        limit="50"
        selectedFilter="All"
        search=""
        from=""
        to=""
      />,
    );

    // Confirm the row actually renders before asserting on it (verified
    // fact 7 — an is_auto row would silently be filtered out instead).
    await waitFor(() =>
      screen.getByText(LEGACY_CREDIT_SUMMARY, { exact: false }),
    );

    const badge = badgeInRowFor(LEGACY_CREDIT_SUMMARY);
    expect(badge.getAttribute("data-cash-location")).toBe("provider");
  });

  it("ordinary cash receipt (SALE): plain green in, no provider marker", async () => {
    mockGetRecentTransactions.mockResolvedValue([normalSaleRow]);

    render(
      <TransactionsViewer
        limit="50"
        selectedFilter="All"
        search=""
        from=""
        to=""
      />,
    );

    await waitFor(() => screen.getByText(SALE_SUMMARY, { exact: false }));

    const badge = badgeInRowFor(SALE_SUMMARY);
    expect(badge.getAttribute("data-cash-location")).toBeNull();
    expect(badge.getAttribute("data-direction")).toBe("in");
  });
});

describe("TransactionsViewer — Amount column for a bills-only settlement", () => {
  beforeEach(() => {
    mockGetRecentTransactions.mockReset();
  });

  it("renders the commission in LBP for a bills-only settlement row", async () => {
    mockGetRecentTransactions.mockResolvedValue([billsOnlySettlementRow]);

    render(
      <TransactionsViewer
        limit="50"
        selectedFilter="All"
        search=""
        from=""
        to=""
      />,
    );

    await waitFor(() => screen.getByText(BILLS_ONLY_SUMMARY, { exact: false }));

    expect(amountCellFor(BILLS_ONLY_SUMMARY)).toBe("100,000 LBP");
  });

  it("leaves a legacy (commission_model = 0) settlement row rendering exactly as before", async () => {
    mockGetRecentTransactions.mockResolvedValue([legacySettlementRow]);

    render(
      <TransactionsViewer
        limit="50"
        selectedFilter="All"
        search=""
        from=""
        to=""
      />,
    );

    await waitFor(() => screen.getByText(LEGACY_SUMMARY, { exact: false }));

    // Real net-payment settlement: renders its own stored amount, untouched
    // by the commission-derivation gate (commission_model is 0, not 1).
    expect(amountCellFor(LEGACY_SUMMARY)).toBe("$25");
  });

  it("leaves an ordinary cash row (SALE) untouched", async () => {
    mockGetRecentTransactions.mockResolvedValue([normalSaleRow]);

    render(
      <TransactionsViewer
        limit="50"
        selectedFilter="All"
        search=""
        from=""
        to=""
      />,
    );

    await waitFor(() => screen.getByText(SALE_SUMMARY, { exact: false }));

    expect(amountCellFor(SALE_SUMMARY)).toBe("$50");
  });

  it("degrades a malformed metadata_json on a bills-only-shaped row to today's unaffected rendering instead of throwing", async () => {
    mockGetRecentTransactions.mockResolvedValue([malformedMetadataRow]);

    render(
      <TransactionsViewer
        limit="50"
        selectedFilter="All"
        search=""
        from=""
        to=""
      />,
    );

    await waitFor(() =>
      screen.getByText("Settlement: malformed metadata row", {
        exact: false,
      }),
    );

    // formatAmount(0, 0, <unparseable metadata_json>) renders "—" today for
    // ANY zero/zero-amount row (its own metaJson fallback only matches a
    // top-level `amount`/`currency` shape, which this row doesn't have
    // either way) — this is the pre-existing, unrelated-to-this-fix
    // behavior. The point of this case is that a parse failure inside
    // `billsOnlyCommissionAmount` must silently fall back to it (no thrown
    // error, no blanked row), not that the string happens to be "$0.00".
    expect(amountCellFor("Settlement: malformed metadata row")).toBe("—");
  });

  it("proves the stored amount_usd/amount_lbp on the row are never mutated by the derivation", async () => {
    mockGetRecentTransactions.mockResolvedValue([billsOnlySettlementRow]);

    render(
      <TransactionsViewer
        limit="50"
        selectedFilter="All"
        search=""
        from=""
        to=""
      />,
    );

    await waitFor(() => screen.getByText(BILLS_ONLY_SUMMARY, { exact: false }));

    // Display changed; the source fixture object (standing in for the
    // stored row) is untouched — this is a display-layer derivation only.
    expect(billsOnlySettlementRow.amount_usd).toBe(0);
    expect(billsOnlySettlementRow.amount_lbp).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// LIRA-139 — Amount column SORT ORDER for mixed USD/LBP rows.
//
// Bug: the Amount column's sortKey is "amount_usd" and the old
// `getSortValue` branch answered `row.amount_usd ?? 0` directly — an
// LBP-primary row (amount_usd: 0) always sorted as worthless, and every LBP
// row tied at 0 (not even ordered among themselves). Fix: `amountSortValue`
// (../../amountSort.ts) converts each row's total to USD using the row's OWN
// stamped `exchange_rate` (falling back to the live buy rate only when no
// rate was ever stamped) and adds both currency sides.
//
// Interaction-level (rule 17), same rationale as the rest of this file:
// renders the REAL TransactionsViewer + REAL DataTable, clicks the REAL
// "Amount" header, and reads the REAL rendered row order — a props-level
// assertion on amountSortValue alone would not catch a wiring mistake
// between the helper and DataTable's getSortValue callback.
describe("TransactionsViewer — LIRA-139 Amount column sort order", () => {
  beforeEach(() => {
    mockGetRecentTransactions.mockReset();
  });

  // USD-equivalents (hand-verified, and re-derived by the "arithmetic" note
  // on each fixture below):
  //   LBP_100:     8,500,000 LBP @ 85,000            = $100.00
  //   USD_50:      $50 flat, no LBP side               = $50.00
  //   MIXED_30:    $10 + 1,700,000 LBP @ 85,000        = $10 + $20 = $30.00
  //   NULL_USD_20: (runtime-null) usd + 1,780,000 LBP @ 89,000
  //                                                     = $0 + $20 = $20.00
  //   USD_12:      $12 flat, no LBP side                = $12.00
  //   LBP_5:       445,000 LBP @ 89,000                 = $5.00
  // Descending order therefore interleaves LBP rows between USD rows in
  // both directions: 100(LBP) → 50(USD) → 30(mixed) → 20(null-usd+LBP) →
  // 12(USD) → 5(LBP) — a broken comparator that collapses LBP rows to 0
  // cannot accidentally satisfy this.
  const SUMMARY_LBP_100 = "LIRA139 fixture A — 8.5M LBP @85k (~$100)";
  const SUMMARY_USD_50 = "LIRA139 fixture B — flat $50";
  const SUMMARY_MIXED_30 =
    "LIRA139 fixture C — mixed $10 + 1.7M LBP@85k (~$30)";
  const SUMMARY_NULL_USD_20 =
    "LIRA139 fixture D — null amount_usd + 1.78M LBP@89k (~$20)";
  const SUMMARY_USD_12 = "LIRA139 fixture E — flat $12";
  const SUMMARY_LBP_5 = "LIRA139 fixture F — 445k LBP@89k (~$5)";

  const lbp100Row = baseRow({
    id: 301,
    amount_usd: 0,
    amount_lbp: 8_500_000,
    exchange_rate: 85_000,
    summary: SUMMARY_LBP_100,
    created_at: "2026-08-20 01:01:00",
  });
  const usd50Row = baseRow({
    id: 302,
    amount_usd: 50,
    amount_lbp: 0,
    exchange_rate: null,
    summary: SUMMARY_USD_50,
    created_at: "2026-08-20 01:02:00",
  });
  const mixed30Row = baseRow({
    id: 303,
    amount_usd: 10,
    amount_lbp: 1_700_000,
    exchange_rate: 85_000,
    summary: SUMMARY_MIXED_30,
    created_at: "2026-08-20 01:03:00",
  });
  // Runtime-null amount_usd — the shape LIRA-139 documents arriving at
  // runtime even though TransactionRow declares `amount_usd: number`.
  // `baseRow`'s `overrides: Record<string, unknown>` accepts `null` here
  // with no `any`/unsafe cast needed.
  const nullUsd20Row = baseRow({
    id: 304,
    amount_usd: null,
    amount_lbp: 1_780_000,
    exchange_rate: 89_000,
    summary: SUMMARY_NULL_USD_20,
    created_at: "2026-08-20 01:04:00",
  });
  const usd12Row = baseRow({
    id: 305,
    amount_usd: 12,
    amount_lbp: 0,
    exchange_rate: null,
    summary: SUMMARY_USD_12,
    created_at: "2026-08-20 01:05:00",
  });
  const lbp5Row = baseRow({
    id: 306,
    amount_usd: 0,
    amount_lbp: 445_000,
    exchange_rate: 89_000,
    summary: SUMMARY_LBP_5,
    created_at: "2026-08-20 01:06:00",
  });

  const DESCENDING_ORDER = [
    SUMMARY_LBP_100, // $100
    SUMMARY_USD_50, // $50
    SUMMARY_MIXED_30, // $30
    SUMMARY_NULL_USD_20, // $20
    SUMMARY_USD_12, // $12
    SUMMARY_LBP_5, // $5
  ];
  const ASCENDING_ORDER = [...DESCENDING_ORDER].reverse();

  /** Reads the ACTUAL rendered row order from the real DataTable's tbody,
   *  matching each row by IDENTITY (a unique summary substring) rather than
   *  by array position — per rule 15's row-identity guidance. */
  function renderedFixtureOrder(): string[] {
    const tbody = document.querySelector('[data-testid="data-table"] tbody');
    if (!tbody) throw new Error('No [data-testid="data-table"] tbody found');
    const rows = Array.from(tbody.querySelectorAll("tr"));
    return rows
      .map((tr) => {
        const summaryCell = tr.querySelectorAll("td")[SUMMARY_COL_INDEX];
        const text = summaryCell?.textContent ?? "";
        return DESCENDING_ORDER.find((s) => text.includes(s));
      })
      .filter((s): s is string => Boolean(s));
  }

  /** Clicks the "Amount" column header — scoped to the table's own <thead>
   *  so it can never collide with the export column-picker menu, which
   *  renders its own "Amount" label elsewhere on the page. */
  function clickAmountHeader() {
    const thead = document.querySelector('[data-testid="data-table"] thead');
    if (!thead) throw new Error('No [data-testid="data-table"] thead found');
    const header = within(thead as HTMLElement).getByText("Amount");
    fireEvent.click(header);
  }

  it("orders mixed USD/LBP rows by their true USD-equivalent value, interleaved in both directions", async () => {
    // Shuffled fetch order — proves the table is actually re-sorting rows,
    // not just echoing fetch order.
    mockGetRecentTransactions.mockResolvedValue([
      mixed30Row,
      lbp100Row,
      nullUsd20Row,
      usd50Row,
      lbp5Row,
      usd12Row,
    ] as never);

    render(
      <TransactionsViewer
        limit="50"
        selectedFilter="All"
        search=""
        from=""
        to=""
      />,
    );

    await waitFor(() => screen.getByText(SUMMARY_LBP_100, { exact: false }));

    // First click on a not-yet-sorted NUMERIC column: TanStack's own
    // `getAutoSortDir` defaults numeric columns to DESCENDING first (only
    // string-valued columns default to ascending-first) — verified against
    // the actual rendered order, not assumed.
    clickAmountHeader();
    await waitFor(() =>
      expect(renderedFixtureOrder()).toEqual(DESCENDING_ORDER),
    );

    // Second click: ascending.
    clickAmountHeader();
    await waitFor(() =>
      expect(renderedFixtureOrder()).toEqual(ASCENDING_ORDER),
    );
  });
});

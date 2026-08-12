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

function amountCellFor(summaryText: string): string {
  const summarySpan = screen.getByText(summaryText, { exact: false });
  const row = summarySpan.closest("tr");
  if (!row) throw new Error(`No <tr> ancestor found for "${summaryText}"`);
  const cells = row.querySelectorAll("td");
  return cells[AMOUNT_COL_INDEX]?.textContent ?? "";
}

const BILLS_ONLY_SUMMARY =
  "Settlement: 2 txns — Katsh credited $0.00 + 100,000 LBP commission (drawer top-up)";
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

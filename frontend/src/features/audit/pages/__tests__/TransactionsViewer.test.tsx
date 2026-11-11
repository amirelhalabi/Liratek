/**
 * TransactionsViewer — 7 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 7).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
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
import {
  CHECKPOINT_ADJUSTMENT_METHOD,
  REFUND_KEPT_CHANGE_META,
} from "@liratek/core";

// LIRA-147 — TransactionsViewer now calls useAuth() (to gate the
// admin-only "Undo refund" button); this suite mounts the page with no
// AuthProvider, so the real hook would throw "useAuth must be used
// within an AuthProvider". Mock it as a non-admin by default — none of
// this file's own assertions are about LIRA-147, so admin visibility is
// irrelevant here; dedicated coverage lives in
// ActionsCell.undoRefund.test.tsx.
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

// LIRA-232 — TransactionsViewer now calls useSessionItemRefund(), which
// calls useApi() (@liratek/ui) unconditionally. This file doesn't exercise
// the session-item-refund flow, so a minimal mock is enough to satisfy
// ApiProvider's context requirement (rule 25 — deliberately a fresh object
// literal per render; nothing here puts `api` in an auto-firing effect).
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getSessionItemRefundPreview: jest.fn(),
    refundSessionBasketItem: jest.fn(),
  }),
}));

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("TransactionsViewer.amountColumn (LIRA-137)", () => {
  beforeAll(resetBetweenFiles);

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

  const mockGetRecentTransactions =
    getRecentTransactions as jest.MockedFunction<typeof getRecentTransactions>;

  // Column order in buildTr: Time(0) Summary(1) Type(2) Client(3) Amount(4)
  // Method(5) User(6) Actions(7).
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
          selectedFilters={[]}
          search=""
          from=""
          to=""
        />,
      );

      await waitFor(() =>
        screen.getByText(BILLS_ONLY_SUMMARY, { exact: false }),
      );

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
          selectedFilters={[]}
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
          selectedFilters={[]}
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
  // auditConstants.ts:111): with `selectedFilters={[]}` the active filter
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
          selectedFilters={[]}
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
          selectedFilters={[]}
          search=""
          from=""
          to=""
        />,
      );

      await waitFor(() =>
        screen.getByText(BILLS_ONLY_SUMMARY, { exact: false }),
      );

      const badge = badgeInRowFor(BILLS_ONLY_SUMMARY);
      expect(badge.getAttribute("data-cash-location")).toBe("provider");
      expect(badge.getAttribute("data-direction")).toBe("in");
    });

    it("bills-only settlement, explicit commission_collection_mode OTHER_PAYMENT: no provider marker, plain green in", async () => {
      mockGetRecentTransactions.mockResolvedValue([otherPaymentRow140]);

      render(
        <TransactionsViewer
          limit="50"
          selectedFilters={[]}
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
          selectedFilters={[]}
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
          selectedFilters={[]}
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
          selectedFilters={[]}
          search=""
          from=""
          to=""
        />,
      );

      await waitFor(() =>
        screen.getByText(BILLS_ONLY_SUMMARY, { exact: false }),
      );

      expect(amountCellFor(BILLS_ONLY_SUMMARY)).toBe("100,000 LBP");
    });

    it("leaves a legacy (commission_model = 0) settlement row rendering exactly as before", async () => {
      mockGetRecentTransactions.mockResolvedValue([legacySettlementRow]);

      render(
        <TransactionsViewer
          limit="50"
          selectedFilters={[]}
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
          selectedFilters={[]}
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
          selectedFilters={[]}
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
          selectedFilters={[]}
          search=""
          from=""
          to=""
        />,
      );

      await waitFor(() =>
        screen.getByText(BILLS_ONLY_SUMMARY, { exact: false }),
      );

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
      // Not SALE: a sale is USD-priced, so its amount_lbp is a legacy LBP
      // tender, not value, and is neither shown nor sorted on (production
      // test 2026-10-07, displayAmountFields). A debt repayment genuinely
      // carries money on both sides.
      type: "DEBT_REPAYMENT",
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
          selectedFilters={[]}
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
});

describe("TransactionsViewer.billsOnlyCommissionModeDetail (LIRA-137)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-137 owner follow-up (2026-08-15) — "either method picked, should
   * appear in the payment detail in the transaction metadata", referring to
   * the Top-up | Other payment toggle on a Katsh bills-only supplier
   * settlement. Owner-approved before/after:
   *
   *   TOP_UP row today:
   *     no payment detail at all (methodLegsFor(row) is empty — the drawer
   *     top-up leg's drawer_name ("Katsh") is a PROVIDER_STOCK_DRAWERS member,
   *     stripped from row.payments one layer before this page ever sees it —
   *     see billsOnlyCommissionAmount's own doc comment).
   *   After:
   *     a ▸ payment detail disclosure appears, and expanding it shows
   *     "Top-up → Katsh drawer  861,369 LBP".
   *
   * The OTHER_PAYMENT mode already has a disclosure (a real leg posts to a
   * real drawer, so methodLegsFor(row) is non-empty) — this spec proves the
   * mode line joins it there rather than replacing it, and proves a legless,
   * non-bills-only row (e.g. a plain SALE with no payment legs) still shows NO
   * disclosure at all — the widening is scoped to this exact row shape only,
   * not a global relaxation of the empty-legs gate.
   *
   * Interaction-level (rule 17): renders the REAL TransactionsViewer with the
   * REAL DataTable, clicks the REAL toggle button, and asserts the rendered
   * detail row's text — a props-level assertion on a helper alone would not
   * catch a wiring mistake in buildTr/buildLegDetailTr (the amountColumn test
   * file's own rationale for the same reason).
   */

  const mockGetRecentTransactions =
    getRecentTransactions as jest.MockedFunction<typeof getRecentTransactions>;

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
      exchange_rate: 89500,
      client_id: null,
      reverses_id: null,
      summary: null,
      metadata_json: null,
      device_id: null,
      created_at: "2026-08-15 01:10:00",
      username: "admin",
      client_name: null,
      session_id: null,
      reversed_by_id: null,
      payments: [],
      ...overrides,
    };
  }

  const TOP_UP_SUMMARY =
    "Settlement: 1 txns — Katsh credited 861,369 LBP commission";
  const topUpRow = baseRow({
    id: 201,
    type: "SUPPLIER_SETTLEMENT",
    source_table: "supplier_ledger",
    amount_usd: 0,
    amount_lbp: 0,
    summary: TOP_UP_SUMMARY,
    payments: [], // stripped by PROVIDER_STOCK_DRAWERS before this page sees it
    metadata_json: JSON.stringify({
      supplier_id: 5,
      financial_service_ids: [1],
      commission_usd: 0,
      commission_lbp: 861369,
      commission_model: 1,
      entry_mode: "LUMP",
      commission_collection_mode: "TOP_UP",
      counterparty: {
        kind: "supplier",
        id: 5,
        name: "Katsh",
        flow: "IN",
        // Post-fix value: the real provider drawer the leg posted to
        // (SupplierRepository._bookBillsCommissionDrawerTopUp), not "CASH".
        method: "Katsh",
      },
    }),
  });

  const OTHER_PAYMENT_SUMMARY =
    "Settlement: 1 txns — Katsh credited 947,371 LBP commission";
  const otherPaymentRow = baseRow({
    id: 202,
    type: "SUPPLIER_SETTLEMENT",
    source_table: "supplier_ledger",
    amount_usd: 0,
    amount_lbp: 0,
    summary: OTHER_PAYMENT_SUMMARY,
    payments: [
      {
        direction: "in",
        amount: 947371,
        signed_amount: 947371,
        currency_code: "LBP",
        method: "CASH",
      },
    ],
    metadata_json: JSON.stringify({
      supplier_id: 5,
      financial_service_ids: [2],
      commission_usd: 0,
      commission_lbp: 947371,
      commission_model: 1,
      entry_mode: "LUMP",
      commission_collection_mode: "OTHER_PAYMENT",
      counterparty: {
        kind: "supplier",
        id: 5,
        name: "Katsh",
        flow: "IN",
        method: "CASH",
      },
    }),
  });

  const PLAIN_SALE_SUMMARY = "Sale of a widget, no legs";
  const plainLeglessRow = baseRow({
    id: 203,
    type: "SALE",
    amount_usd: 50,
    amount_lbp: 0,
    summary: PLAIN_SALE_SUMMARY,
    payments: [],
    metadata_json: null,
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
    await waitFor(() =>
      // Any one row's summary text proves the initial load settled.
      expect(mockGetRecentTransactions).toHaveBeenCalled(),
    );
  }

  describe("TransactionsViewer — bills-only commission mode in the payment detail (LIRA-137 owner follow-up)", () => {
    beforeEach(() => {
      mockGetRecentTransactions.mockReset();
    });

    it("TOP_UP mode: shows a ▸ payment detail toggle even with zero customer-facing legs, and expanding it names the mode, drawer, and amount", async () => {
      await renderRows([topUpRow]);
      await waitFor(() => screen.getByText(TOP_UP_SUMMARY, { exact: false }));

      const toggle = screen.getByTestId("toggle-legs-201");
      expect(toggle).toBeTruthy();

      fireEvent.click(toggle);

      const detail = await screen.findByTestId("payment-legs-detail-201");
      const modeLine = detail.querySelector(
        '[data-testid="commission-mode-201"]',
      );
      expect(modeLine).toBeTruthy();
      expect(modeLine!.textContent).toContain("Top-up");
      expect(modeLine!.textContent).toContain("Katsh");
      expect(modeLine!.textContent).toContain("861,369 LBP");
    });

    it("OTHER_PAYMENT mode: the mode line JOINS the existing real-leg line, it does not replace it", async () => {
      await renderRows([otherPaymentRow]);
      await waitFor(() =>
        screen.getByText(OTHER_PAYMENT_SUMMARY, { exact: false }),
      );

      const toggle = screen.getByTestId("toggle-legs-202");
      fireEvent.click(toggle);

      const detail = await screen.findByTestId("payment-legs-detail-202");
      const modeLine = detail.querySelector(
        '[data-testid="commission-mode-202"]',
      );
      expect(modeLine).toBeTruthy();
      expect(modeLine!.textContent).toContain("Other payment");
      // The real leg's own line is still there, untouched.
      expect(detail.textContent).toContain("947,371 LBP");
    });

    it("leaves an ordinary legless row (e.g. a SALE with no payment legs) with NO disclosure at all — the widening is scoped to the bills-only commission row shape only", async () => {
      await renderRows([plainLeglessRow]);
      await waitFor(() =>
        screen.getByText(PLAIN_SALE_SUMMARY, { exact: false }),
      );

      expect(screen.queryByTestId("toggle-legs-203")).toBeNull();
    });
  });
});

describe("TransactionsViewer.checkpointDrawerLabel", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Guards the WIRING between `legMethodLabel` (transactionDisplay.ts) and the
   * real page, not the helper's own logic — `legMethodLabel.test.ts` already
   * covers that in isolation (a CHECKPOINT_ADJUSTMENT leg with a `drawer_name`
   * renders "Checkpoint <Drawer>" instead of the generic "Checkpoint
   * Adjustment"). A unit test on the helper cannot catch a viewer that computes
   * the right string and then never calls it, or calls the old expression
   * instead — only rendering the REAL `TransactionsViewer`, expanding the REAL
   * "▸ payment detail" disclosure, and reading the REAL DOM proves the helper
   * actually reaches the screen through `buildLegDetailTr`
   * (TransactionsViewer.tsx).
   *
   * Same shape and rationale as
   * `TransactionsViewer.billsOnlyCommissionModeDetail.test.tsx` (which guards
   * the neighboring `billsCommissionModeLine` wiring on this identical detail
   * row) — mirrored closely rather than re-inventing the render/mock harness.
   *
   * `buildLegDetailTr`'s own doc comment notes this row is "printed on export
   * unconditionally" — the export path renders the same JSX this test drives
   * on screen, so this spec also guards that path.
   */

  const mockGetRecentTransactions =
    getRecentTransactions as jest.MockedFunction<typeof getRecentTransactions>;

  function baseRow(overrides: Record<string, unknown>) {
    return {
      id: 1,
      type: "CHECKPOINT",
      status: "ACTIVE",
      source_table: "checkpoints",
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
      created_at: "2026-09-16 08:00:00",
      username: "admin",
      client_name: null,
      session_id: null,
      reversed_by_id: null,
      payments: [],
      ...overrides,
    };
  }

  // Mirrors the owner's real data: one checkpoint reconciliation posting
  // several CHECKPOINT_ADJUSTMENT legs across different drawers and
  // currencies in a single row.
  const CHECKPOINT_SUMMARY = "Checkpoint reconciliation";
  const checkpointRow = baseRow({
    id: 501,
    summary: CHECKPOINT_SUMMARY,
    payments: [
      {
        direction: "in",
        amount: 13531,
        signed_amount: 13531,
        currency_code: "USD",
        method: CHECKPOINT_ADJUSTMENT_METHOD,
        drawer_name: "General",
      },
      {
        direction: "in",
        amount: 83458000,
        signed_amount: 83458000,
        currency_code: "LBP",
        method: CHECKPOINT_ADJUSTMENT_METHOD,
        drawer_name: "General",
      },
      {
        direction: "in",
        amount: 45000000,
        signed_amount: 45000000,
        currency_code: "LBP",
        method: CHECKPOINT_ADJUSTMENT_METHOD,
        drawer_name: "OMT_System",
      },
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
    await waitFor(() => expect(mockGetRecentTransactions).toHaveBeenCalled());
  }

  describe("TransactionsViewer — checkpoint leg drawer name reaches the payment-detail row", () => {
    beforeEach(() => {
      mockGetRecentTransactions.mockReset();
    });

    it("names each CHECKPOINT_ADJUSTMENT leg's own drawer, not the generic 'Checkpoint Adjustment' label", async () => {
      await renderRows([checkpointRow]);
      await waitFor(() =>
        screen.getByText(CHECKPOINT_SUMMARY, { exact: false }),
      );

      const toggle = screen.getByTestId("toggle-legs-501");
      fireEvent.click(toggle);

      const detail = await screen.findByTestId("payment-legs-detail-501");

      // LIRA-304 (FR-019): one line per method + direction, currencies joined.
      expect(detail.textContent).toContain(
        "In — Checkpoint General: $13,531 + 83,458,000 LBP",
      );
      expect(detail.textContent).toContain(
        "In — Checkpoint OMT_System: 45,000,000 LBP",
      );
      expect(detail.textContent).not.toContain("Checkpoint Adjustment");
    });
  });
});

describe("TransactionsViewer.extraCurrencyDrawerMove", () => {
  beforeAll(resetBetweenFiles);

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

  const mockGetRecentTransactions =
    getRecentTransactions as jest.MockedFunction<typeof getRecentTransactions>;

  // Column order in buildTr (TransactionCells.tsx): Time(0) Summary(1) Type(2)
  // Client(3) Amount(4) Method(5) User(6) Actions(7). Owner decision
  // 2026-10-16 removed Ret. Credits, Status and Reverses (they are Summary
  // tags now), which moved Method back from 6 to 5.
  const AMOUNT_COL_INDEX = 4;
  const SUMMARY_COL_INDEX = 1;
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
    if (!badge)
      throw new Error(`No cash-flow-badge in row for "${summaryText}"`);
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
        selectedFilters={[]}
        search=""
        from=""
        to=""
      />,
    );
  }

  describe("TransactionsViewer — extra-currency drawer top-up / cash-out (LIRA-223: not proven failing-first — written 2026-09-23, batch process forbade running tests mid-batch)", () => {
    beforeEach(() => {
      mockGetRecentTransactions.mockReset();
    });

    it("shows the foreign amount and CASH method for a EUR-only top-up", async () => {
      mockGetRecentTransactions.mockResolvedValue([eurTopUpRow]);
      renderViewer();
      await waitFor(() =>
        screen.getByText(EUR_TOPUP_SUMMARY, { exact: false }),
      );

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

      expect(cellFor(EUR_CASHOUT_SUMMARY, AMOUNT_COL_INDEX)).toContain(
        "100 EUR",
      );
      expect(cellFor(EUR_CASHOUT_SUMMARY, METHOD_COL_INDEX)).toBe("Cash");

      const badge = badgeFor(EUR_CASHOUT_SUMMARY);
      expect(badge.getAttribute("data-direction")).toBe("out");
      expect(badge.textContent).toContain("100 EUR");
    });

    it("leaves a plain USD top-up rendering exactly as before", async () => {
      mockGetRecentTransactions.mockResolvedValue([usdTopUpRow]);
      renderViewer();
      await waitFor(() =>
        screen.getByText(USD_TOPUP_SUMMARY, { exact: false }),
      );

      expect(cellFor(USD_TOPUP_SUMMARY, AMOUNT_COL_INDEX)).toBe("$50");
      expect(cellFor(USD_TOPUP_SUMMARY, METHOD_COL_INDEX)).toBe("Cash");
    });

    it("degrades to a blank amount on malformed metadata instead of throwing", async () => {
      mockGetRecentTransactions.mockResolvedValue([malformedRow]);
      renderViewer();
      await waitFor(() =>
        screen.getByText(MALFORMED_SUMMARY, { exact: false }),
      );

      expect(cellFor(MALFORMED_SUMMARY, AMOUNT_COL_INDEX)).toBe("—");
      expect(cellFor(MALFORMED_SUMMARY, METHOD_COL_INDEX)).toBe("—");
    });
  });

  // Owner decision 2026-10-16 — the Ret. Credits, Status and Reverses columns
  // are gone; the rare cases show as small tags in the Summary cell instead
  // (`rowBadges`). This block was LIRA-205's Ret. Credits column test; it now
  // asserts the same values where they moved (rule 24), plus the column set
  // itself. Written before the change and seen failing (rule 17).

  const CREDIT_RETURN_SUMMARY = "Only-Days: MTC card return";
  const creditReturnRow = baseRow({
    id: 501,
    type: "FINANCIAL_SERVICE",
    source_table: "financial_services",
    amount_usd: 25,
    summary: CREDIT_RETURN_SUMMARY,
    returned_credits_usd: 3,
  });

  const NO_CREDIT_RETURN_SUMMARY = "Only-Days: no credit returned";
  const noCreditReturnRow = baseRow({
    id: 502,
    type: "FINANCIAL_SERVICE",
    source_table: "financial_services",
    amount_usd: 25,
    summary: NO_CREDIT_RETURN_SUMMARY,
    // returned_credits_usd deliberately omitted — absent, not 0 (see
    // TransactionRepository._attachPaymentLegs' presence-keyed accumulator).
  });

  const VOIDED_SUMMARY = "Voided card sale";
  const voidedRow = baseRow({
    id: 503,
    type: "FINANCIAL_SERVICE",
    source_table: "financial_services",
    amount_usd: 25,
    status: "VOIDED",
    summary: VOIDED_SUMMARY,
  });

  const REFUNDED_SUMMARY = "Refunded card sale";
  const refundedRow = baseRow({
    id: 504,
    type: "FINANCIAL_SERVICE",
    source_table: "financial_services",
    amount_usd: 25,
    // A refunded original stays ACTIVE; only reversed_by_id marks it.
    reversed_by_id: 505,
    summary: REFUNDED_SUMMARY,
  });

  const REVERSAL_SUMMARY = "Refund of card sale";
  const reversalRow = baseRow({
    id: 505,
    type: "REFUND",
    source_table: "financial_services",
    amount_usd: -25,
    reverses_id: 504,
    returned_credits_usd: -3,
    summary: REVERSAL_SUMMARY,
  });

  function summaryCellOf(summaryText: string): HTMLElement {
    return rowFor(summaryText).querySelectorAll("td")[
      SUMMARY_COL_INDEX
    ] as HTMLElement;
  }

  function tagsIn(summaryText: string): string[] {
    return Array.from(
      summaryCellOf(summaryText).querySelectorAll('[data-testid="row-badge"]'),
    ).map((el) => el.textContent ?? "");
  }

  describe("TransactionsViewer — Summary tags replace Ret. Credits / Status / Reverses", () => {
    beforeEach(() => {
      mockGetRecentTransactions.mockReset();
    });

    it("the table has no Ret. Credits, Status or Reverses column, and every row has one cell per header", async () => {
      mockGetRecentTransactions.mockResolvedValue([creditReturnRow]);
      renderViewer();
      await waitFor(() =>
        screen.getByText(CREDIT_RETURN_SUMMARY, { exact: false }),
      );

      const headers = Array.from(document.querySelectorAll("thead th")).map(
        (th) => (th.textContent ?? "").trim(),
      );
      expect(headers.join("|")).not.toMatch(/Ret\. Credits|Status|Reverses/i);
      expect(headers).toHaveLength(8);
      // The export is the Transactions export template (owner decision
      // 2026-10-16), which picks its own columns — no column picker.
      expect(screen.queryByTestId("export-column-picker-button")).toBeNull();
      // Every row has one cell per header.
      expect(rowFor(CREDIT_RETURN_SUMMARY).querySelectorAll("td")).toHaveLength(
        headers.length,
      );
    });

    it("credits returned show as a +$X credits back tag in the Summary cell", async () => {
      mockGetRecentTransactions.mockResolvedValue([creditReturnRow]);
      renderViewer();
      await waitFor(() =>
        screen.getByText(CREDIT_RETURN_SUMMARY, { exact: false }),
      );

      expect(tagsIn(CREDIT_RETURN_SUMMARY)).toEqual(["+$3 credits back"]);
    });

    it("a normal active row with no credits returned has no tag", async () => {
      mockGetRecentTransactions.mockResolvedValue([noCreditReturnRow]);
      renderViewer();
      await waitFor(() =>
        screen.getByText(NO_CREDIT_RETURN_SUMMARY, { exact: false }),
      );

      expect(tagsIn(NO_CREDIT_RETURN_SUMMARY)).toEqual([]);
    });

    it("voided, refunded and reversal rows carry their status / ↩ tags", async () => {
      mockGetRecentTransactions.mockResolvedValue([
        voidedRow,
        refundedRow,
        reversalRow,
      ]);
      renderViewer();
      await waitFor(() => screen.getByText(VOIDED_SUMMARY, { exact: false }));

      expect(tagsIn(VOIDED_SUMMARY)).toEqual(["VOIDED"]);
      expect(tagsIn(REFUNDED_SUMMARY)).toEqual(["REFUNDED"]);
      expect(tagsIn(REVERSAL_SUMMARY)).toEqual(["↩ #504", "−$3 credits back"]);
    });
  });
});

describe("TransactionsViewer.sessionGroupDisplay (LIRA-201)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * NOT RUN — proven at the end-of-batch gate (owner process rule, 2026-09-24
   * batch: build first, verify once at the end).
   *
   * LIRA-201b (owner note #11-B) — session group display: "The pooled in/out
   * and payment detail shows ONCE, on the session group, and each member row
   * shows only its own amount and legs."
   *
   * Interaction-level (rule 17, mirrors the sibling
   * TransactionsViewer.billsOnlyCommissionModeDetail.test.tsx): renders the
   * REAL TransactionsViewer with the REAL DataTable so a wiring mistake in
   * buildTr/buildLegDetailTr/MethodCell is caught, not just a helper-level
   * unit test. Reverting TransactionsViewer's `deriveRow(row,
   * isRowGroupHeader(row))` back to plain `deriveRow(row)` (dropping the
   * header flag) must make every assertion here that checks for exactly ONE
   * marker/one payment-legs line fail — both rows would render identically
   * again (both blank, since `payments` is now always own-only — see
   * TransactionRepository._attachPaymentLegs).
   *
   * Fix round (M2/M3) — the pooled basket total now renders on a SEPARATE
   * `session-payment-legs` line (never merged into the row's own `payment-legs`
   * line or the Method column, which are ALWAYS own-only, even on the header
   * row), and a session with no pooled legs anywhere in it gets no marker at
   * all. See sessionGroupHeaders.test.ts for the pure-logic half of the same
   * two fixes.
   */

  const mockGetRecentTransactions =
    getRecentTransactions as jest.MockedFunction<typeof getRecentTransactions>;

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
      created_at: "2026-09-24 10:00:00",
      username: "cashier",
      client_name: null,
      session_id: null,
      reversed_by_id: null,
      payments: [],
      ...overrides,
    };
  }

  // Owner's own example (#11-A/B): $50 handed over, $40 + 10,000 LBP change —
  // the SAME pooled basket legs attached to EVERY member of session 7.
  const POOLED_LEGS = [
    {
      direction: "in",
      amount: 50,
      signed_amount: 50,
      currency_code: "USD",
      method: "CASH",
    },
    {
      direction: "out",
      amount: 40,
      signed_amount: -40,
      currency_code: "USD",
      method: "CASH",
    },
    {
      direction: "out",
      amount: 10000,
      signed_amount: -10000,
      currency_code: "LBP",
      method: "CASH",
    },
  ];

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
    await waitFor(() => expect(mockGetRecentTransactions).toHaveBeenCalled());
  }

  describe("TransactionsViewer — session group display (LIRA-201b, owner note #11-B)", () => {
    beforeEach(() => {
      mockGetRecentTransactions.mockReset();
    });

    it("shows the pooled marker + a labelled Session in/out line ONCE, on the lowest-id member, and the other member shows only its own amount with a blank Method", async () => {
      const prizeRow = baseRow({
        id: 10,
        type: "LOTO_CASH_PRIZE",
        session_id: 7,
        amount_lbp: -400000,
        summary: "Loto cash prize",
        payments: [],
        session_payments: POOLED_LEGS,
      });
      const ticketRow = baseRow({
        id: 11,
        type: "SALE",
        session_id: 7,
        amount_lbp: 1280000,
        summary: "Loto ticket",
        payments: [],
        session_payments: POOLED_LEGS,
      });

      // Deliberately inserted with the HIGHER id first — the header choice is
      // id-based, not array-position-based (sessionGroupHeaders.ts).
      await renderRows([ticketRow, prizeRow]);
      await waitFor(() =>
        screen.getByText("Loto cash prize", { exact: false }),
      );

      // Exactly ONE session-group marker, on row 10 (the lowest id).
      const markers = screen.getAllByTestId("session-group-header-7");
      expect(markers).toHaveLength(1);

      // Neither row has legs of its OWN, so the own-only "payment-legs" line
      // (M3 fix round: always own-only, never the pooled merge) renders for
      // neither.
      expect(screen.queryAllByTestId("payment-legs")).toHaveLength(0);

      // Exactly ONE labelled pooled line, with the owner's own figures.
      const sessionLegsLines = screen.getAllByTestId("session-payment-legs");
      expect(sessionLegsLines).toHaveLength(1);
      expect(sessionLegsLines[0].textContent).toContain("Session:");
      expect(sessionLegsLines[0].textContent).toContain("in: $50");
      expect(sessionLegsLines[0].textContent).toContain(
        "out: $40 + 10,000 LBP",
      );

      // Method column: own-only (M3 fix round) — neither row has an own leg,
      // so neither shows "Cash" there; the pooled method only appears in the
      // labelled Session line/expanded detail, never the Method column.
      expect(screen.queryAllByText("Cash")).toHaveLength(0);

      // ticketRow (11, the non-header member) still shows its OWN amount. It
      // has no legs of its own — it was paid at the session checkout — so its
      // Method names the session (owner decision 2026-10-16; was "—"). Column
      // index 5: Time,Summary,Type,Client,Amount,Method — see
      // TransactionCells.tsx's DOM contract.
      const ticketTr = screen
        .getByText("Loto ticket", { exact: false })
        .closest("tr")!;
      expect(ticketTr.querySelectorAll("td")[5]!.textContent).toBe(
        "Session #7",
      );
      expect(ticketTr.textContent).toContain("1,280,000 LBP");
      // And it carries NO group-header marker of its own.
      expect(
        ticketTr.querySelector('[data-testid="session-group-header-7"]'),
      ).toBeNull();
    });

    it("the header row's expanded payment detail lists the pooled legs; the member row has no detail to expand at all", async () => {
      const prizeRow = baseRow({
        id: 10,
        type: "LOTO_CASH_PRIZE",
        session_id: 7,
        amount_lbp: -400000,
        summary: "Loto cash prize",
        payments: [],
        session_payments: POOLED_LEGS,
      });
      const ticketRow = baseRow({
        id: 11,
        type: "SALE",
        session_id: 7,
        amount_lbp: 1280000,
        summary: "Loto ticket",
        payments: [],
        session_payments: POOLED_LEGS,
      });

      await renderRows([prizeRow, ticketRow]);
      await waitFor(() =>
        screen.getByText("Loto cash prize", { exact: false }),
      );

      // The member row (11) never got a toggle — methodLegsFor(row, false)
      // is empty for it.
      expect(screen.queryByTestId("toggle-legs-11")).toBeNull();

      const toggle = screen.getByTestId("toggle-legs-10");
      fireEvent.click(toggle);

      const detail = await screen.findByTestId("payment-legs-detail-10");
      expect(detail.textContent).toContain("In — Cash: $50");
      // LIRA-304 (FR-019): one line per method + direction, currencies joined.
      expect(detail.textContent).toContain("Out — Cash: $40 + 10,000 LBP");
    });

    it("a session member WITH its own leg keeps it, and still is not the pooled header when a lower id exists", async () => {
      const headerRow = baseRow({
        id: 5,
        type: "LOTO_CASH_PRIZE",
        session_id: 3,
        amount_lbp: -200000,
        summary: "Header member",
        payments: [],
        session_payments: [
          {
            direction: "in",
            amount: 20,
            signed_amount: 20,
            currency_code: "USD",
            method: "CASH",
          },
        ],
      });
      const ownLegRow = baseRow({
        id: 6,
        type: "SALE",
        session_id: 3,
        amount_usd: 12,
        summary: "Has its own leg",
        payments: [
          {
            direction: "in",
            amount: 12,
            signed_amount: 12,
            currency_code: "USD",
            method: "OMT",
          },
        ],
        session_payments: [
          {
            direction: "in",
            amount: 20,
            signed_amount: 20,
            currency_code: "USD",
            method: "CASH",
          },
        ],
      });

      await renderRows([headerRow, ownLegRow]);
      await waitFor(() =>
        screen.getByText("Has its own leg", { exact: false }),
      );

      // Only row 5 is the marked header.
      expect(screen.getAllByTestId("session-group-header-3")).toHaveLength(1);
      // Row 6's own Method cell shows its OWN method (OMT), not the pooled
      // Cash — it is a member, not the header, so no session pooling merges
      // into it.
      expect(screen.getByText("Omt", { exact: false })).toBeTruthy();
    });

    // --- M3 (fix round): the CHOSEN header row itself has an own leg ------

    it("a header member that ALSO has its own leg shows its own line AND the pooled line separately — never merged", async () => {
      const headerRow = baseRow({
        id: 5,
        type: "FINANCIAL_SERVICE",
        session_id: 9,
        amount_usd: 12,
        summary: "Linked exchange, header member",
        payments: [
          {
            direction: "in",
            amount: 12,
            signed_amount: 12,
            currency_code: "USD",
            method: "OMT",
          },
        ],
        session_payments: [
          {
            direction: "in",
            amount: 50,
            signed_amount: 50,
            currency_code: "USD",
            method: "CASH",
          },
        ],
      });
      const memberRow = baseRow({
        id: 6,
        type: "SALE",
        session_id: 9,
        summary: "Plain member",
        payments: [],
        session_payments: [
          {
            direction: "in",
            amount: 50,
            signed_amount: 50,
            currency_code: "USD",
            method: "CASH",
          },
        ],
      });

      await renderRows([headerRow, memberRow]);
      await waitFor(() =>
        screen.getByText("Linked exchange, header member", { exact: false }),
      );

      // Exactly one header, on row 5 (lowest id, both are pooled candidates).
      expect(screen.getAllByTestId("session-group-header-9")).toHaveLength(1);

      // Row 5's OWN in/out line is its own $12 only — never mixed with the
      // pooled $50.
      const ownLine = screen.getByTestId("payment-legs");
      expect(ownLine.textContent).toContain("in: $12");
      expect(ownLine.textContent).not.toContain("50");

      // The pooled $50 renders on its OWN separate, labelled line.
      const pooledLine = screen.getByTestId("session-payment-legs");
      expect(pooledLine.textContent).toContain("Session:");
      expect(pooledLine.textContent).toContain("in: $50");
      expect(pooledLine.textContent).not.toContain("$12");

      // Method column stays own-only: "Omt" (row 5's own method), never
      // "Cash" (the pooled method) merged in.
      expect(screen.getByText("Omt", { exact: false })).toBeTruthy();

      // Expanded detail keeps the two apart too: own leg unlabelled, pooled
      // leg under its own "Session #9 pooled:" section.
      fireEvent.click(screen.getByTestId("toggle-legs-5"));
      const detail = await screen.findByTestId("payment-legs-detail-5");
      expect(detail.textContent).toContain("In — Omt: $12");
      const pooledSection = screen.getByTestId("session-legs-detail-5");
      expect(pooledSection.textContent).toContain("Session #9 pooled:");
      expect(pooledSection.textContent).toContain("In — Cash: $50");
    });

    // --- M2 (fix round): no pooled legs anywhere in the session -----------

    it("a session with NO pooled legs on any member shows no marker and no Session line at all", async () => {
      const rowA = baseRow({
        id: 20,
        type: "SALE",
        session_id: 4,
        summary: "Linked, no basket payment",
        payments: [],
      });
      const rowB = baseRow({
        id: 21,
        type: "SALE",
        session_id: 4,
        summary: "Also linked, also no basket payment",
        payments: [],
      });

      await renderRows([rowA, rowB]);
      await waitFor(() =>
        screen.getByText("Linked, no basket payment", { exact: false }),
      );

      expect(screen.queryByTestId("session-group-header-4")).toBeNull();
      expect(screen.queryAllByTestId("session-payment-legs")).toHaveLength(0);
    });
  });
});

describe("TransactionsViewer.topUpCashFlowDirection", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Top-Up Cash-Flow Direction Audit (TOPUP_CASHFLOW_DIRECTION_AUDIT.md) —
   * interaction-level proof for the four mis-badged/no-badge RECHARGE_TOPUP /
   * DRAWER_TOPUP shapes fixed in `cashFlow.ts`.
   *
   * Rule 17: a props-level assertion on `getCashFlowDirection` alone (see
   * `cashFlow.test.ts`) does not count as the guard for a display bug — every
   * display bug this project has shipped was invisible to non-rendering tests.
   * This file renders the REAL `TransactionsViewer` page (real `DataTable`,
   * real `CashFlowBadge`) with fixture rows shaped exactly like the real
   * producers' `metadata_json` (RechargeRepository.topUpFromSupplier /
   * topUpFromClient / topUpApp, DrawerTopUpRepository.createTopUp /
   * createTopUpFromDrawer) and asserts the rendered `data-direction` DOM
   * attribute — the same pattern as
   * `TransactionsViewer.amountColumn.test.tsx`.
   *
   * Proven failing-first (rule 17) against the pre-fix `cashFlow.ts` (the
   * `RECHARGE_TOPUP` case that read only `partnerId`/`cashPaid` and defaulted
   * to "out"; `DRAWER_TOPUP` entirely absent from the switch → null/no badge):
   *   - Katsh supplier top-up (topUpFromSupplier, the owner's reported bug):
   *     expected "in", pre-fix rendered "out".
   *   - Whish App "from client" top-up with cashPaid > 0: expected "both",
   *     pre-fix rendered "in".
   *   - OMT App top-up "from drawer" (topUpApp, generic): expected "both",
   *     pre-fix rendered "out".
   *   - General "External (Cash In)" top-up: expected "in", pre-fix rendered
   *     NO BADGE AT ALL (data-testid="cash-flow-badge" did not exist in the
   *     row).
   *   - General "From Drawer" top-up: expected "both", pre-fix rendered NO
   *     BADGE AT ALL.
   * (Reproduced by temporarily reverting `cashFlow.ts`'s RECHARGE_TOPUP/
   * DRAWER_TOPUP cases and re-running this file — see the cashFlow.test.ts
   * unit-level rule-17 proof in the same commit for the captured console
   * output; identical root cause, same two case blocks.)
   */

  const mockGetRecentTransactions =
    getRecentTransactions as jest.MockedFunction<typeof getRecentTransactions>;

  function baseRow(overrides: Record<string, unknown>) {
    return {
      id: 1,
      type: "SALE",
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
      created_at: "2026-08-12 01:10:00",
      username: "admin",
      client_name: null,
      session_id: null,
      reversed_by_id: null,
      payments: [],
      ...overrides,
    };
  }

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

  async function renderWithRow(row: ReturnType<typeof baseRow>) {
    mockGetRecentTransactions.mockResolvedValue([row]);
    render(
      <TransactionsViewer
        limit="50"
        selectedFilters={[]}
        search=""
        from=""
        to=""
      />,
    );
    await waitFor(() =>
      screen.getByText(row.summary as unknown as string, { exact: false }),
    );
  }

  describe("TransactionsViewer — RECHARGE_TOPUP cash-flow badge (Top-Up Cash-Flow Direction Audit)", () => {
    beforeEach(() => {
      mockGetRecentTransactions.mockReset();
    });

    // Owner's reported bug: a Katsh supplier top-up (funded by NEW supplier
    // debt, zero payment legs, `sourceDrawer: "SUPPLIER"`) rendered a red ↑
    // even though no drawer was ever debited.
    it("topUpFromSupplier (Katsh, owner's reported bug): renders green in, not out", async () => {
      const summary = "Katsh supplier top-up → Katsh: 1000000 LBP";
      await renderWithRow(
        baseRow({
          id: 201,
          type: "RECHARGE_TOPUP",
          amount_usd: 0,
          amount_lbp: 1000000,
          summary,
          metadata_json: JSON.stringify({
            provider: "Katsh",
            amount: 1000000,
            currency: "LBP",
            sourceDrawer: "SUPPLIER",
            destDrawer: "Katsh",
          }),
        }),
      );

      const badge = badgeInRowFor(summary);
      expect(badge.getAttribute("data-direction")).toBe("in");
    });

    // Most serious of the four (per the audit): a Whish App "from client"
    // top-up really debits General by cashPaid — a genuine till decrease that
    // the pre-fix single "in" badge hid entirely.
    it("topUpFromClient with cashPaid > 0: renders both (green+red), not a plain in", async () => {
      const summary =
        "Whish App top-up from client: +100 credits, -90 USD cash";
      await renderWithRow(
        baseRow({
          id: 202,
          type: "RECHARGE_TOPUP",
          amount_usd: 100,
          amount_lbp: 0,
          profit_usd: 10,
          summary,
          metadata_json: JSON.stringify({
            provider: "WHISH_APP",
            amount: 100,
            cashPaid: 90,
            currency: "USD",
            clientId: null,
            clientName: null,
            sourceDrawer: "General",
            destDrawer: "Whish_App",
          }),
        }),
      );

      const badge = badgeInRowFor(summary);
      expect(badge.getAttribute("data-direction")).toBe("both");
    });

    it("topUpFromClient with cashPaid === 0: stays in (no real debit)", async () => {
      const summary = "Whish App top-up from client: +100 credits, -0 USD cash";
      await renderWithRow(
        baseRow({
          id: 203,
          type: "RECHARGE_TOPUP",
          amount_usd: 100,
          amount_lbp: 0,
          summary,
          metadata_json: JSON.stringify({
            provider: "WHISH_APP",
            amount: 100,
            cashPaid: 0,
            currency: "USD",
            clientId: null,
            clientName: null,
            sourceDrawer: "General",
            destDrawer: "Whish_App",
          }),
        }),
      );

      const badge = badgeInRowFor(summary);
      expect(badge.getAttribute("data-direction")).toBe("in");
    });

    // topUpApp (generic "from drawer") into OMT_App — the only destination
    // reachable from the current TopUpModal UI for this generic path.
    it("topUpApp into OMT_App: renders both, not out", async () => {
      const summary = "OMT App top-up: General → OMT_App: 100 USD";
      await renderWithRow(
        baseRow({
          id: 204,
          type: "RECHARGE_TOPUP",
          amount_usd: 100,
          amount_lbp: 0,
          summary,
          metadata_json: JSON.stringify({
            provider: "OMT_APP",
            amount: 100,
            currency: "USD",
            sourceDrawer: "General",
            destDrawer: "OMT_App",
          }),
        }),
      );

      const badge = badgeInRowFor(summary);
      expect(badge.getAttribute("data-direction")).toBe("both");
    });
  });

  describe("TransactionsViewer — DRAWER_TOPUP cash-flow badge (Top-Up Cash-Flow Direction Audit finding #4)", () => {
    beforeEach(() => {
      mockGetRecentTransactions.mockReset();
    });

    it('"External (Cash In)" mode: renders green in, was previously blank (no badge)', async () => {
      const summary = "Drawer Top-Up: General - owner deposit";
      await renderWithRow(
        baseRow({
          id: 205,
          type: "DRAWER_TOPUP",
          amount_usd: 200,
          amount_lbp: 0,
          summary,
          metadata_json: JSON.stringify({
            drawer: "General",
            notes: "owner deposit",
            extra_currencies: null,
          }),
        }),
      );

      const badge = badgeInRowFor(summary);
      expect(badge.getAttribute("data-direction")).toBe("in");
    });

    it('"From Drawer" mode: renders both, was previously blank (no badge)', async () => {
      const summary = "Drawer Top-Up: OMT_System → General";
      await renderWithRow(
        baseRow({
          id: 206,
          type: "DRAWER_TOPUP",
          amount_usd: 150,
          amount_lbp: 0,
          summary,
          metadata_json: JSON.stringify({
            drawer: "General",
            source_drawer: "OMT_System",
            notes: null,
          }),
        }),
      );

      const badge = badgeInRowFor(summary);
      expect(badge.getAttribute("data-direction")).toBe("both");
    });
  });
});

describe("TransactionsViewer.transactionAmountNotTender", () => {
  beforeAll(resetBetweenFiles);

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

  const mockGetRecentTransactions =
    getRecentTransactions as jest.MockedFunction<typeof getRecentTransactions>;

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
});

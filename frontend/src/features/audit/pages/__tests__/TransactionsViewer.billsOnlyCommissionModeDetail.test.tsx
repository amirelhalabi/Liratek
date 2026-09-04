/** @jest-environment jsdom */
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
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
      selectedFilter="All"
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
    await waitFor(() => screen.getByText(PLAIN_SALE_SUMMARY, { exact: false }));

    expect(screen.queryByTestId("toggle-legs-203")).toBeNull();
  });
});

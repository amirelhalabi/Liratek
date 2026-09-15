/** @jest-environment jsdom */
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
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import TransactionsViewer from "../TransactionsViewer";
import { getRecentTransactions } from "@/api/backendApi";
import { CHECKPOINT_ADJUSTMENT_METHOD } from "@liratek/core";

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
    await waitFor(() => screen.getByText(CHECKPOINT_SUMMARY, { exact: false }));

    const toggle = screen.getByTestId("toggle-legs-501");
    fireEvent.click(toggle);

    const detail = await screen.findByTestId("payment-legs-detail-501");

    expect(detail.textContent).toContain("In — Checkpoint General: $13,531");
    expect(detail.textContent).toContain(
      "In — Checkpoint General: 83,458,000 LBP",
    );
    expect(detail.textContent).toContain(
      "In — Checkpoint OMT_System: 45,000,000 LBP",
    );
    expect(detail.textContent).not.toContain("Checkpoint Adjustment");
  });
});

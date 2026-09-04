/** @jest-environment jsdom */
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
      selectedFilter="All"
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
    const summary = "Whish App top-up from client: +100 credits, -90 USD cash";
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

/** @jest-environment jsdom */
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
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    await waitFor(() => screen.getByText("Loto cash prize", { exact: false }));

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
    expect(sessionLegsLines[0].textContent).toContain("out: $40 + 10,000 LBP");

    // Method column: own-only (M3 fix round) — neither row has an own leg,
    // so neither shows "Cash" there; the pooled method only appears in the
    // labelled Session line/expanded detail, never the Method column.
    expect(screen.queryAllByText("Cash")).toHaveLength(0);

    // ticketRow (11, the non-header member) still shows its OWN amount, and
    // its OWN (blank) Method — column index 6: Time,Summary,Type,Client,
    // Amount,Ret.Credits,Method — see TransactionCells.tsx's DOM contract.
    const ticketTr = screen
      .getByText("Loto ticket", { exact: false })
      .closest("tr")!;
    expect(ticketTr.querySelectorAll("td")[6]!.textContent).toBe("—");
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
    await waitFor(() => screen.getByText("Loto cash prize", { exact: false }));

    // The member row (11) never got a toggle — methodLegsFor(row, false)
    // is empty for it.
    expect(screen.queryByTestId("toggle-legs-11")).toBeNull();

    const toggle = screen.getByTestId("toggle-legs-10");
    fireEvent.click(toggle);

    const detail = await screen.findByTestId("payment-legs-detail-10");
    expect(detail.textContent).toContain("In — Cash: $50");
    expect(detail.textContent).toContain("Out — Cash: $40");
    expect(detail.textContent).toContain("Out — Cash: 10,000 LBP");
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
    await waitFor(() => screen.getByText("Has its own leg", { exact: false }));

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

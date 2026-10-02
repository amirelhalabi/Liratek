/** @jest-environment jsdom */
/**
 * LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md) — the Transactions page's generic
 * "Refund" action (non-session rows) passes RefundMethodModal a `bookedRate`/
 * `bookedRateSource`, and forwards whatever rate the popup reports back to
 * `refundTransaction` as its 4th argument.
 *
 * Integration-gap follow-up (2026-09-27 coordinator review): the popup's
 * rate now comes from the SERVER (`getRefundBookedRate` →
 * `TransactionService.getRefundBookedRate`, wired end-to-end but never
 * called from the frontend), not from a second, UI-local derivation off
 * `row.exchange_rate` (rule 14 — one definition of the rule). This file's
 * ORIGINAL tests (still in git history) asserted the OLD architecture —
 * `bookedRate` sourced from `row.exchange_rate` directly, with no server
 * call at all — and are rewritten here per rule 24 into guards that the OLD
 * path is no longer taken: `row.exchange_rate` is deliberately set to a
 * DIFFERENT value than what `getRefundBookedRate` returns in every case
 * below, and the popup is asserted to show the SERVER's value.
 *
 * Written failing-first (this pass): at authoring time TransactionsViewer
 * never called `getRefundBookedRate` at all — these tests fail with
 * "getRefundBookedRate is not a function" against that state (the mock
 * factory below didn't yet stub it, and the component didn't yet import it),
 * then pass once the component fetches it and threads the result through.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TransactionsViewer from "../TransactionsViewer";

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
import {
  getRecentTransactions,
  refundTransaction,
  getRefundBookedRate,
} from "@/api/backendApi";

jest.mock("@/api/backendApi", () => ({
  getRecentTransactions: jest.fn(),
  voidTransaction: jest.fn(),
  refundTransaction: jest.fn(),
  voidCheckoutGroup: jest.fn(),
  voidSessionBasket: jest.fn(),
  refundSessionBasket: jest.fn(),
  getSaleItems: jest.fn(),
  getProductUnitsForSaleItems: jest.fn().mockResolvedValue([]),
  getRefundBookedRate: jest.fn(),
}));

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getSessionItemRefundPreview: jest.fn(),
    refundSessionBasketItem: jest.fn(),
  }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [],
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
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

// Thin stub — same rationale as SaleDetailModal.refundOverride.test.tsx and
// TransactionsViewer.sessionItemRefund.test.tsx; RefundMethodModal.test.tsx
// already covers its own internals.
jest.mock("@/features/audit/components/RefundMethodModal", () => ({
  RefundMethodModal: ({
    exchangeRate,
    bookedRateSource,
    onConfirm,
    onCancel,
  }: {
    exchangeRate?: number;
    bookedRateSource?: string;
    onConfirm: (
      refundLegs: undefined,
      unitExtras?: unknown,
      rate?: number,
    ) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="refund-method-modal">
      <span data-testid="refund-modal-exchange-rate">{exchangeRate}</span>
      <span data-testid="refund-modal-booked-rate-source">
        {bookedRateSource ?? ""}
      </span>
      <button onClick={() => onConfirm(undefined)}>Confirm Refund (stub)</button>
      <button onClick={() => onConfirm(undefined, undefined, 92000)}>
        Confirm Refund With Rate (stub)
      </button>
      <button onClick={onCancel}>Cancel (stub)</button>
    </div>
  ),
}));

const mockGetRecentTransactions = getRecentTransactions as jest.MockedFunction<
  typeof getRecentTransactions
>;
const mockRefundTransaction = refundTransaction as jest.MockedFunction<
  typeof refundTransaction
>;
const mockGetRefundBookedRate = getRefundBookedRate as jest.MockedFunction<
  typeof getRefundBookedRate
>;

function baseRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    type: "SALE",
    status: "ACTIVE",
    source_table: "sales",
    source_id: 1,
    user_id: 1,
    amount_usd: 100,
    amount_lbp: 0,
    exchange_rate: null,
    client_id: null,
    reverses_id: null,
    summary: "Sale #1",
    metadata_json: null,
    device_id: null,
    created_at: "2026-09-24 10:00:00",
    username: "cashier",
    client_name: null,
    session_id: null,
    reversed_by_id: null,
    payments: [
      {
        direction: "in",
        amount: 100,
        signed_amount: 100,
        currency_code: "USD",
        method: "CASH",
      },
    ],
    ...overrides,
  };
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
  await waitFor(() => expect(mockGetRecentTransactions).toHaveBeenCalled());
}

describe("TransactionsViewer — generic 'Refund' passes/forwards the SERVER's rate (LIRA-236)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRecentTransactions.mockReset();
    mockGetRefundBookedRate.mockReset();
  });

  it("fetches getRefundBookedRate(row.id) when the popup opens, and passes its bookedRate/bookedRateSource through — NOT the row's own exchange_rate", async () => {
    mockGetRefundBookedRate.mockResolvedValue({
      success: true,
      bookedRate: 91500,
      bookedRateSource: "sale",
    });
    // Deliberately a DIFFERENT value than the server returns, proving the
    // popup no longer reads this field at all (the old, removed path).
    await renderRows([baseRow({ id: 1, exchange_rate: 80000 })]);

    fireEvent.click(await screen.findByRole("button", { name: "Refund" }));
    await screen.findByTestId("refund-method-modal");

    expect(mockGetRefundBookedRate).toHaveBeenCalledWith(1);
    expect(screen.getByTestId("refund-modal-exchange-rate")).toHaveTextContent(
      "91500",
    );
    expect(
      screen.getByTestId("refund-modal-booked-rate-source"),
    ).toHaveTextContent("sale");
  });

  it("shows the server's 'fallback' source (and today's rate) when getRefundBookedRate reports nothing was recorded", async () => {
    mockGetRefundBookedRate.mockResolvedValue({
      success: true,
      bookedRate: 89000,
      bookedRateSource: "fallback",
    });
    await renderRows([baseRow({ id: 2, exchange_rate: 80000 })]);

    fireEvent.click(await screen.findByRole("button", { name: "Refund" }));
    await screen.findByTestId("refund-method-modal");

    expect(screen.getByTestId("refund-modal-exchange-rate")).toHaveTextContent(
      "89000",
    );
    expect(
      screen.getByTestId("refund-modal-booked-rate-source"),
    ).toHaveTextContent("fallback");
  });

  it("falls back to today's client-side rate with source 'fallback' when the server call itself fails (never blocks the popup)", async () => {
    mockGetRefundBookedRate.mockResolvedValue({
      success: false,
      error: "boom",
    });
    await renderRows([baseRow({ id: 5, exchange_rate: 80000 })]);

    fireEvent.click(await screen.findByRole("button", { name: "Refund" }));
    await screen.findByTestId("refund-method-modal");

    // useSellRate mock above returns buyRate 89000.
    expect(screen.getByTestId("refund-modal-exchange-rate")).toHaveTextContent(
      "89000",
    );
    expect(
      screen.getByTestId("refund-modal-booked-rate-source"),
    ).toHaveTextContent("fallback");
  });

  it("forwards the rate RefundMethodModal reports to refundTransaction as the 4th argument", async () => {
    mockRefundTransaction.mockResolvedValue({ success: true, refundId: 42 });
    mockGetRefundBookedRate.mockResolvedValue({
      success: true,
      bookedRate: 91000,
      bookedRateSource: "sale",
    });
    await renderRows([baseRow({ id: 3, exchange_rate: 91000 })]);

    fireEvent.click(await screen.findByRole("button", { name: "Refund" }));
    await screen.findByTestId("refund-method-modal");

    fireEvent.click(screen.getByText("Confirm Refund With Rate (stub)"));

    await waitFor(() =>
      expect(mockRefundTransaction).toHaveBeenCalledWith(
        3,
        undefined,
        undefined,
        92000,
      ),
    );
  });

  it("an untouched confirm forwards no rate (undefined 4th argument)", async () => {
    mockRefundTransaction.mockResolvedValue({ success: true, refundId: 43 });
    mockGetRefundBookedRate.mockResolvedValue({
      success: true,
      bookedRate: 91000,
      bookedRateSource: "sale",
    });
    await renderRows([baseRow({ id: 4, exchange_rate: 91000 })]);

    fireEvent.click(await screen.findByRole("button", { name: "Refund" }));
    await screen.findByTestId("refund-method-modal");

    fireEvent.click(screen.getByText("Confirm Refund (stub)"));

    await waitFor(() =>
      expect(mockRefundTransaction).toHaveBeenCalledWith(
        4,
        undefined,
        undefined,
        undefined,
      ),
    );
  });
});

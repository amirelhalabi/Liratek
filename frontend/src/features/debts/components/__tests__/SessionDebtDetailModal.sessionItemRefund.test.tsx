/** @jest-environment jsdom */
/**
 * LIRA-232 (SESSION_ITEM_REFUND_PLAN.md §4, owner Q4 — read-only, no Refund
 * button here) — the Debts page's session basket view must show an item
 * refund: the REFUND row (linked into `customer_session_transactions` by the
 * core `refundSessionBasketItem` change, which is out of this build's scope
 * — see the plan doc's build handoff) and the reduced Basket Debt figure.
 *
 * `SessionDebtDetailModal` already renders EVERY row `session.getTransactions`
 * returns generically (no hardcoded transaction-type allow-list — see its
 * `CustomerSessionRepository.getSessionTransactions`, which selects by
 * `session_id` alone, no `transaction_type` filter) and already renders
 * whatever `debtAmountUsd`/`debtAmountLbp` its caller (Debts page) passes in
 * for the "Basket Debt" summary line — both are just displayed, not computed
 * here. This test proves that generic path renders a refund-shaped row and a
 * reduced summary correctly WITHOUT a frontend code change, so once the core
 * change lands (a linked row + a smaller aggregate), this page needs nothing
 * further. Not a rule-17 failing-first proof — no display bug was found; this
 * is a forward-looking regression guard.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { SessionDebtDetailModal } from "../SessionDebtDetailModal";

const mockCartGet = jest.fn();
const mockGetTransactions = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    session: {
      cartGet: mockCartGet,
      getTransactions: mockGetTransactions,
    },
  }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

describe("SessionDebtDetailModal — item refund row + reduced Basket Debt (LIRA-232)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCartGet.mockResolvedValue({ success: true, items: [] });
  });

  it("renders a linked REFUND transaction row as a negative (credit) line", async () => {
    mockGetTransactions.mockResolvedValue({
      success: true,
      transactions: [
        {
          id: 900,
          transaction_type: "refund",
          amount_usd: -1500,
          amount_lbp: 0,
          created_at: "2026-09-26 10:05:00",
        },
      ],
    });

    render(
      <SessionDebtDetailModal
        sessionId={1}
        debtAmountUsd={135}
        debtAmountLbp={0}
        onClose={jest.fn()}
      />,
    );

    await waitFor(() => expect(mockGetTransactions).toHaveBeenCalledWith(1));

    expect(await screen.findByText("refund")).toBeInTheDocument();
    expect(screen.getByText("-$1500.00")).toBeInTheDocument();
  });

  it("shows the reduced Basket Debt figure the caller passes in (post-refund $135, not the original $1,635)", async () => {
    mockGetTransactions.mockResolvedValue({ success: true, transactions: [] });

    render(
      <SessionDebtDetailModal
        sessionId={1}
        debtAmountUsd={135}
        debtAmountLbp={0}
        onClose={jest.fn()}
      />,
    );

    await waitFor(() => expect(mockGetTransactions).toHaveBeenCalled());

    expect(screen.getByText("Basket Debt")).toBeInTheDocument();
    expect(screen.getByText("$135.00")).toBeInTheDocument();
    expect(screen.queryByText("$1635.00")).not.toBeInTheDocument();
  });

  // LIRA-232 round-3 review (finding 5) — core hides a 0/0 "Refund Reversal"
  // debt_ledger marker row from `findClientHistory` (written when a
  // whole-basket reversal has nothing left to reverse in a currency because
  // prior item refunds already consumed it). This modal reads a DIFFERENT
  // source (`session.getTransactions`), which core's hide never reaches, so
  // the SAME "hide a 0/0 row" rule must apply here too — otherwise a
  // basket's transaction list shows a bare `transaction_type` label with no
  // amount at all. NOT proven failing-first (rule 17/MEMORY): the filter
  // (`SessionDebtDetailModal.tsx`'s `displayTransactions`) landed in the
  // same pass as this test, but the bug was verified by reading the pre-fix
  // source first — `nonZero` only hid each currency SPAN inside a row, never
  // the row itself, so a 0/0 row rendered with an empty amount cell.
  it("hides a session transaction row whose amount_usd AND amount_lbp are both ~0 (a 0/0 marker row)", async () => {
    mockGetTransactions.mockResolvedValue({
      success: true,
      transactions: [
        {
          id: 901,
          transaction_type: "refund reversal",
          amount_usd: 0,
          amount_lbp: 0,
          created_at: "2026-09-26 10:06:00",
        },
        {
          id: 902,
          transaction_type: "sale",
          amount_usd: 50,
          amount_lbp: 0,
          created_at: "2026-09-26 10:00:00",
        },
      ],
    });

    render(
      <SessionDebtDetailModal
        sessionId={1}
        debtAmountUsd={0}
        debtAmountLbp={0}
        onClose={jest.fn()}
      />,
    );

    await waitFor(() => expect(mockGetTransactions).toHaveBeenCalledWith(1));

    // The 0/0 row never renders at all...
    expect(screen.queryByText("refund reversal")).not.toBeInTheDocument();
    // ...while a real, non-zero row in the same list still does.
    expect(await screen.findByText("sale")).toBeInTheDocument();
  });
});

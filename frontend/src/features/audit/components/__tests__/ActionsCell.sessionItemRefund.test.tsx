/**
 * LIRA-232 (SESSION_ITEM_REFUND_PLAN.md §4) — session-basket member rows get
 * a per-item "Refund item" action alongside the whole-basket "Void
 * basket"/"Refund basket" buttons. Written failing-first: at authoring time
 * `ActionsCell` rendered no such button for ANY session member type.
 *
 * LIRA-381 (owner 2026-11-11: "any item of a session can be refunded") — the
 * button now shows on EVERY live member, by core's own rule
 * (`isSessionItemRefundableMember`): a loto ticket or prize, a transfer or
 * cash-out, an exchange, a repair as well. Only the basket's own checkout
 * lines (kept change, …) stay whole-basket-only. The LIRA-381 cases below
 * were added after the change (not proven failing-first by a run).
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionsCell, type RowActionHandlers } from "../TransactionCells";
import { deriveRow } from "../../rowDerived";
import type { TransactionRow } from "../../hooks/useTransactionRows";

function buildSessionRow(
  overrides: Partial<TransactionRow> = {},
): TransactionRow {
  return {
    id: 42,
    type: "SALE",
    status: "ACTIVE",
    source_table: "sales",
    source_id: 1,
    user_id: 1,
    amount_usd: 10,
    amount_lbp: 0,
    exchange_rate: 89000,
    client_id: null,
    reverses_id: null,
    summary: "Test sale",
    metadata_json: null,
    device_id: null,
    created_at: "2026-09-24T10:00:00Z",
    username: "admin",
    client_name: null,
    session_id: 7,
    ...overrides,
  } as TransactionRow;
}

function buildHandlers(): RowActionHandlers {
  return {
    onPrintReceipt: jest.fn(),
    onVoid: jest.fn(),
    onRefund: jest.fn(),
    onVoidCheckoutGroup: jest.fn(),
    onVoidSessionBasket: jest.fn(),
    onRefundSessionBasket: jest.fn(),
    onRefundSessionItem: jest.fn(),
    onUndoRefund: jest.fn(),
    onWrongNumber: jest.fn(),
  };
}

function renderCell(row: TransactionRow, handlers: RowActionHandlers) {
  return render(
    <table>
      <tbody>
        <tr>
          <ActionsCell
            row={row}
            derived={deriveRow(row)}
            sessionId={7}
            refundLookupRowId={null}
            handlers={handlers}
          />
        </tr>
      </tbody>
    </table>,
  );
}

describe("ActionsCell — per-item session refund action (LIRA-232)", () => {
  it.each([
    "SALE",
    "CUSTOM_SERVICE",
    "RECHARGE",
    // LIRA-381
    "LOTO",
    "LOTO_CASH_PRIZE",
    "FINANCIAL_SERVICE",
    "EXCHANGE",
    "MAINTENANCE",
  ])("renders a 'Refund item' button for a %s session member", (type) => {
    const row = buildSessionRow({ type: type as TransactionRow["type"] });
    const handlers = buildHandlers();
    renderCell(row, handlers);

    expect(
      screen.getByRole("button", { name: "Refund item" }),
    ).toBeInTheDocument();
  });

  it("'Refund item' calls onRefundSessionItem with the row, not the whole-basket handlers", () => {
    const row = buildSessionRow();
    const handlers = buildHandlers();
    renderCell(row, handlers);

    fireEvent.click(screen.getByRole("button", { name: "Refund item" }));

    expect(handlers.onRefundSessionItem).toHaveBeenCalledWith(row);
    expect(handlers.onRefundSessionBasket).not.toHaveBeenCalled();
    expect(handlers.onVoidSessionBasket).not.toHaveBeenCalled();
  });

  it("still renders 'Void basket'/'Refund basket' alongside the new button", () => {
    const row = buildSessionRow();
    const handlers = buildHandlers();
    renderCell(row, handlers);

    expect(
      screen.getByRole("button", { name: "Void basket" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refund basket" }),
    ).toBeInTheDocument();
  });

  // LIRA-381 rewrite (rule 24): was "FINANCIAL_SERVICE / KEPT_CHANGE stay
  // whole-basket-only". A transfer is now an item; kept change is still a
  // basket-level line.
  it.each([
    "KEPT_CHANGE",
    "WAIVED_SHORTFALL",
    "EXTRA_CHARGE",
    "BASKET_DISCOUNT",
  ])(
    "does NOT render 'Refund item' for a basket-level %s line (it belongs to the whole basket)",
    (type) => {
      const row = buildSessionRow({ type: type as TransactionRow["type"] });
      const handlers = buildHandlers();
      renderCell(row, handlers);

      expect(
        screen.queryByRole("button", { name: "Refund item" }),
      ).not.toBeInTheDocument();
    },
  );

  it("LIRA-381: does NOT render 'Refund item' on a member that was already refunded", () => {
    const row = buildSessionRow({
      type: "LOTO_CASH_PRIZE" as TransactionRow["type"],
      reversed_by_id: 99,
    });
    const handlers = buildHandlers();
    renderCell(row, handlers);

    expect(
      screen.queryByRole("button", { name: "Refund item" }),
    ).not.toBeInTheDocument();
  });

  it("does NOT render 'Refund item' for a non-session row (sessionId null)", () => {
    const row = buildSessionRow({ session_id: null });
    const handlers = buildHandlers();
    render(
      <table>
        <tbody>
          <tr>
            <ActionsCell
              row={row}
              derived={deriveRow(row)}
              sessionId={null}
              refundLookupRowId={null}
              handlers={handlers}
            />
          </tr>
        </tbody>
      </table>,
    );

    expect(
      screen.queryByRole("button", { name: "Refund item" }),
    ).not.toBeInTheDocument();
  });
});

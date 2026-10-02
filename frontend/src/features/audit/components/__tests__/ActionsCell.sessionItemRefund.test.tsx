/**
 * LIRA-232 (SESSION_ITEM_REFUND_PLAN.md §4) — each sold-item session-basket
 * member row (SALE, CUSTOM_SERVICE, RECHARGE — core's
 * SESSION_ITEM_REFUNDABLE_TYPES) gets a per-item "Refund item" action
 * alongside the existing whole-basket "Void basket"/"Refund basket" buttons.
 * Payouts (FINANCIAL_SERVICE) and KEPT_CHANGE stay whole-basket-only. Written
 * failing-first: at authoring time `ActionsCell` renders no such button for
 * ANY session member type.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionsCell, type RowActionHandlers } from "../TransactionCells";
import { deriveRow } from "../../rowDerived";
import type { TransactionRow } from "../../hooks/useTransactionRows";

function buildSessionRow(overrides: Partial<TransactionRow> = {}): TransactionRow {
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
  it.each(["SALE", "CUSTOM_SERVICE", "RECHARGE"])(
    "renders a 'Refund item' button for a %s session member",
    (type) => {
      const row = buildSessionRow({ type: type as TransactionRow["type"] });
      const handlers = buildHandlers();
      renderCell(row, handlers);

      expect(
        screen.getByRole("button", { name: "Refund item" }),
      ).toBeInTheDocument();
    },
  );

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

  it.each(["FINANCIAL_SERVICE", "KEPT_CHANGE"])(
    "does NOT render 'Refund item' for a non-refundable %s session member (payouts/kept-change stay whole-basket-only)",
    (type) => {
      const row = buildSessionRow({ type: type as TransactionRow["type"] });
      const handlers = buildHandlers();
      renderCell(row, handlers);

      expect(
        screen.queryByRole("button", { name: "Refund item" }),
      ).not.toBeInTheDocument();
    },
  );

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

/**
 * LIRA-147 — admin-only "Undo refund" button on a REFUND row. Before this
 * change, a REFUND(item) row showed a bare "Can't refund here" explanation
 * with no way to actually act on it (LIRA-079's own addition); this test
 * fails against that pre-button render by construction (rule 17 — the
 * button and the admin gate are both new, proven here directly).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { ActionsCell, type RowActionHandlers } from "../TransactionCells";
import { deriveRow } from "../../rowDerived";
import type { TransactionRow } from "../../hooks/useTransactionRows";

function buildRefundRow(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 10,
    type: "REFUND",
    status: "ACTIVE",
    source_table: "sales",
    source_id: 1,
    user_id: 1,
    amount_usd: -50,
    amount_lbp: 0,
    exchange_rate: 89000,
    client_id: null,
    reverses_id: null,
    summary: "ITEM REFUND",
    metadata_json: JSON.stringify({
      refundType: "item",
      saleItemId: 5,
      refundQuantity: 1,
      originalSaleId: 1,
    }),
    device_id: null,
    created_at: "2026-09-24T10:00:00Z",
    username: "admin",
    client_name: null,
    session_id: null,
    ...overrides,
  };
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

function renderCell(row: TransactionRow, handlers: RowActionHandlers, isAdmin: boolean) {
  return render(
    <table>
      <tbody>
        <tr>
          <ActionsCell
            row={row}
            derived={deriveRow(row)}
            sessionId={null}
            refundLookupRowId={null}
            handlers={handlers}
            isAdmin={isAdmin}
          />
        </tr>
      </tbody>
    </table>,
  );
}

describe("ActionsCell — Undo refund (LIRA-147)", () => {
  it("shows 'Undo refund' for an admin on an active per-item REFUND row", () => {
    const handlers = buildHandlers();
    renderCell(buildRefundRow(), handlers, true);

    const button = screen.getByRole("button", { name: "Undo refund" });
    expect(button).toBeInTheDocument();
    expect(
      screen.queryByTestId("non-reversible-reason"),
    ).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(handlers.onUndoRefund).toHaveBeenCalledWith(
      expect.objectContaining({ id: 10 }),
    );
  });

  it("does NOT show 'Undo refund' for a non-admin — falls back to the explanation", () => {
    const handlers = buildHandlers();
    renderCell(buildRefundRow(), handlers, false);

    expect(
      screen.queryByRole("button", { name: "Undo refund" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("non-reversible-reason")).toBeInTheDocument();
  });

  // LIRA-253 — the button now ALSO covers a session-basket item refund: one
  // shared handler, dispatched server-side off the refund row's own
  // metadata (rule 24 — this replaces the pre-LIRA-253 assertion that it
  // was hidden, which held only while that undo path did not exist yet).
  it("shows 'Undo refund' for an admin on an active session-basket item REFUND row (refundType: sessionItem)", () => {
    const handlers = buildHandlers();
    renderCell(
      buildRefundRow({
        metadata_json: JSON.stringify({
          refundType: "sessionItem",
          sessionId: 3,
          saleItemIds: [5],
        }),
      }),
      handlers,
      true,
    );

    const button = screen.getByRole("button", { name: "Undo refund" });
    expect(button).toBeInTheDocument();
    expect(
      screen.queryByTestId("non-reversible-reason"),
    ).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(handlers.onUndoRefund).toHaveBeenCalledWith(
      expect.objectContaining({ id: 10 }),
    );
  });

  it("does NOT show 'Undo refund' for a whole-sale (non-item) refund even for an admin", () => {
    const handlers = buildHandlers();
    renderCell(
      buildRefundRow({ metadata_json: JSON.stringify({}) }),
      handlers,
      true,
    );

    expect(
      screen.queryByRole("button", { name: "Undo refund" }),
    ).not.toBeInTheDocument();
  });

  it("does NOT show 'Undo refund' for a VOIDED refund row even for an admin", () => {
    const handlers = buildHandlers();
    renderCell(buildRefundRow({ status: "VOIDED" }), handlers, true);

    expect(
      screen.queryByRole("button", { name: "Undo refund" }),
    ).not.toBeInTheDocument();
  });
});

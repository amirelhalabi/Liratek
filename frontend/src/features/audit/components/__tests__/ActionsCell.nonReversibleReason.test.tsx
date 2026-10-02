/**
 * LIRA-079 — the Transactions page used to render a bare "—" for any row
 * whose type the generic Void/Refund path can't safely undo (anything in
 * core's NON_REVERSIBLE_TRANSACTION_TYPES), with no indication why the
 * buttons are gone or where to actually correct the entry. `ActionsCell`
 * now renders a short "Can't refund here" label carrying the real
 * explanation (`getNonReversibleReason`) as its tooltip — this test
 * fails against the old bare-"—" render by construction (rule 17: this is
 * additive UI, proven here by asserting against the OLD behavior too).
 */

import { render, screen } from "@testing-library/react";
import { ActionsCell, type RowActionHandlers } from "../TransactionCells";
import { deriveRow } from "../../rowDerived";
import type { TransactionRow } from "../../hooks/useTransactionRows";

function buildRow(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 1,
    type: "CHECKPOINT",
    status: "ACTIVE",
    source_table: "daily_closings",
    source_id: 1,
    user_id: 1,
    amount_usd: 0,
    amount_lbp: 0,
    exchange_rate: 89000,
    client_id: null,
    reverses_id: null,
    summary: "Checkpoint",
    metadata_json: null,
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

function renderCell(row: TransactionRow) {
  return render(
    <table>
      <tbody>
        <tr>
          <ActionsCell
            row={row}
            derived={deriveRow(row)}
            sessionId={null}
            refundLookupRowId={null}
            handlers={buildHandlers()}
          />
        </tr>
      </tbody>
    </table>,
  );
}

describe("ActionsCell — non-reversible reason (LIRA-079)", () => {
  it("shows a labelled, explained reason instead of a bare '—' for a CHECKPOINT row", () => {
    renderCell(buildRow({ type: "CHECKPOINT" }));

    expect(screen.queryByText("—")).not.toBeInTheDocument();
    const label = screen.getByTestId("non-reversible-reason");
    expect(label).toHaveTextContent("Can't refund here");
    expect(label.title).toMatch(/new checkpoint/i);
  });

  it("names the Undo-refund path for a REFUND row", () => {
    renderCell(buildRow({ type: "REFUND" }));

    const label = screen.getByTestId("non-reversible-reason");
    expect(label.title).toMatch(/undo (it|refund)/i);
  });

  it("names the Hold Money page for a HOLD_MONEY_COLLECT row", () => {
    renderCell(buildRow({ type: "HOLD_MONEY_COLLECT" }));

    const label = screen.getByTestId("non-reversible-reason");
    expect(label.title).toMatch(/hold money/i);
  });

  it("still shows a bare '—' for a type with no listed reason (unknown/never-classified)", () => {
    renderCell(buildRow({ type: "SOME_FUTURE_TYPE_NOT_YET_CLASSIFIED" }));

    expect(
      screen.queryByTestId("non-reversible-reason"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("still shows real Void/Refund buttons for a reversible type (SALE) — unaffected", () => {
    renderCell(buildRow({ type: "SALE" }));

    expect(
      screen.queryByTestId("non-reversible-reason"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Void" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refund" }),
    ).toBeInTheDocument();
  });
});

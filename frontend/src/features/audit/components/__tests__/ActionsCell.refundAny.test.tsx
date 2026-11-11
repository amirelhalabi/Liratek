/**
 * LIRA-388 (SC-003) — the Transactions page offers ONE action, "Refund", on
 * every refundable row type; no per-row "Void" anywhere; "Can't refund here"
 * only on the rows core plans "none" for, each with its true reason.
 *
 * Table-driven over EVERY TransactionType (core's own list), so a new type
 * is classified here automatically. Which types refund is read from core's
 * one classification, never hand-typed (rule 24).
 *
 * Rule 17 disclosure: written after the ActionsCell change — NOT proven
 * failing-first. The pre-change behaviour was pinned failing by the three
 * rewritten ActionsCell.test.tsx cases (see tasks.md red log).
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionsCell, type RowActionHandlers } from "../TransactionCells";
import { deriveRow } from "../../rowDerived";
import { type TransactionRow } from "../../hooks/useTransactionRows";
import { TRANSACTION_TYPES } from "../../../../../../packages/core/src/constants/transactionTypes";
import { NON_REFUNDABLE_TRANSACTION_TYPES } from "../../../../../../packages/core/src/constants/refundKinds";
import { NON_REVERSIBLE_REASONS } from "../../nonReversibleReasons";

const CARRIER_VALUES = JSON.stringify({
  reason: "edited",
  credits_before: 5,
  credits_after: 9,
});

function buildRow(type: string, overrides: Partial<TransactionRow> = {}) {
  return {
    id: 1,
    type,
    status: "ACTIVE",
    source_table: "x",
    source_id: 1,
    user_id: 1,
    amount_usd: 10,
    amount_lbp: 0,
    exchange_rate: 89000,
    client_id: null,
    reverses_id: null,
    summary: type,
    metadata_json: type === "CARRIER_LINE_ADJUSTMENT" ? CARRIER_VALUES : null,
    device_id: null,
    created_at: "2026-11-11T10:00:00Z",
    username: "admin",
    client_name: null,
    session_id: null,
    ...overrides,
  } as TransactionRow;
}

function handlers(): RowActionHandlers {
  return {
    onPrintReceipt: jest.fn(),
    onRefund: jest.fn(),
    onVoidCheckoutGroup: jest.fn(),
    onVoidSessionBasket: jest.fn(),
    onRefundSessionBasket: jest.fn(),
    onRefundSessionItem: jest.fn(),
    onUndoRefund: jest.fn(),
    onWrongNumber: jest.fn(),
  };
}

function renderRow(row: TransactionRow, h = handlers()) {
  render(
    <table>
      <tbody>
        <tr>
          <ActionsCell
            row={row}
            derived={deriveRow(row)}
            sessionId={null}
            refundLookupRowId={null}
            handlers={h}
          />
        </tr>
      </tbody>
    </table>,
  );
  return h;
}

const ALL = Object.values(TRANSACTION_TYPES) as string[];
const REFUNDABLE = ALL.filter(
  (t) =>
    !NON_REFUNDABLE_TRANSACTION_TYPES.has(
      t as Parameters<typeof NON_REFUNDABLE_TRANSACTION_TYPES.has>[0],
    ),
);
const REFUSED = ALL.filter((t) => !REFUNDABLE.includes(t));

describe("LIRA-388 — one Refund, no Void, honest reasons", () => {
  it.each(REFUNDABLE)("%s: exactly one Refund button, no Void", (type) => {
    const h = renderRow(buildRow(type));
    expect(screen.queryByRole("button", { name: /^void/i })).toBeNull();
    const refunds = screen.getAllByRole("button", { name: "Refund" });
    expect(refunds).toHaveLength(1);
    expect(screen.queryByTestId("non-reversible-reason")).toBeNull();
    fireEvent.click(refunds[0]);
    expect(h.onRefund).toHaveBeenCalledTimes(1);
  });

  it.each(REFUSED)(
    '%s: "Can\'t refund here" with its true reason, no button',
    (type) => {
      // A REFUND row carries reverses_id; the reason must still be its own.
      renderRow(buildRow(type, type === "REFUND" ? { reverses_id: 9 } : {}));
      expect(screen.queryByRole("button", { name: /^void/i })).toBeNull();
      expect(screen.queryByRole("button", { name: "Refund" })).toBeNull();
      const label = screen.getByTestId("non-reversible-reason");
      expect(label).toHaveTextContent("Can't refund here");
      expect(label.title).toBe(NON_REVERSIBLE_REASONS[type]);
    },
  );

  it("a carrier-line edit without recorded credits says why", () => {
    renderRow(
      buildRow("CARRIER_LINE_ADJUSTMENT", {
        metadata_json: JSON.stringify({ reason: "edited" }),
      }),
    );
    expect(screen.queryByRole("button", { name: "Refund" })).toBeNull();
    expect(screen.getByTestId("non-reversible-reason").title).toBe(
      NON_REVERSIBLE_REASONS.carrierLineNoValues,
    );
  });

  it("an already-refunded row shows neither Refund nor a reason", () => {
    renderRow(buildRow("LOTO_CASH_PRIZE", { reversed_by_id: 77 }));
    expect(screen.queryByRole("button", { name: "Refund" })).toBeNull();
  });
});

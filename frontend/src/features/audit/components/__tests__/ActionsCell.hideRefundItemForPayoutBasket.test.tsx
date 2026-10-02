/**
 * LIRA-232 round-3 review (finding 2) — core now refuses
 * `refundSessionBasketItem` on a session basket that contains ANY payout
 * member (a loto cash prize, an OMT/Whish/Binance wallet cash-out, a
 * custom-service booked as a payout) — those were netted against the
 * basket's other items at checkout, so per-item math can no longer reverse
 * cleanly and core tells the cashier to refund the whole basket instead. The
 * Transactions page must therefore HIDE "Refund item" for every otherwise-
 * refundable member (SALE/CUSTOM_SERVICE/RECHARGE) of such a basket, not
 * just offer it and let it 500 on click — mirroring the existing
 * `hideVoidBasket` pattern for the same reason.
 *
 * Written failing-first: at authoring time `ActionsCell` had no
 * `hideRefundItem` prop at all, so passing it was a TypeScript error and the
 * suite never got as far as exercising the button (rule 24/17 — the same
 * "a compile error stops it from running" failure mode CLAUDE.md documents
 * for `Debts.tenderExchangeRate.test.tsx`).
 */
import { render, screen } from "@testing-library/react";
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

function renderCell(
  row: TransactionRow,
  handlers: RowActionHandlers,
  hideRefundItem?: boolean,
) {
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
            {...(hideRefundItem !== undefined ? { hideRefundItem } : {})}
          />
        </tr>
      </tbody>
    </table>,
  );
}

describe("ActionsCell — hides 'Refund item' on a basket that has a payout member (LIRA-232 round-3)", () => {
  it("hides 'Refund item' when hideRefundItem is true, for an otherwise-refundable SALE member", () => {
    const row = buildSessionRow();
    const handlers = buildHandlers();
    renderCell(row, handlers, true);

    expect(
      screen.queryByRole("button", { name: "Refund item" }),
    ).not.toBeInTheDocument();
  });

  it("still shows 'Void basket'/'Refund basket' when hideRefundItem is true — only the per-item action is hidden", () => {
    const row = buildSessionRow();
    const handlers = buildHandlers();
    renderCell(row, handlers, true);

    expect(
      screen.getByRole("button", { name: "Void basket" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refund basket" }),
    ).toBeInTheDocument();
  });

  it("renders 'Refund item' as normal when hideRefundItem is false/omitted (default)", () => {
    const row = buildSessionRow();
    const handlers = buildHandlers();
    renderCell(row, handlers);

    expect(
      screen.getByRole("button", { name: "Refund item" }),
    ).toBeInTheDocument();
  });
});

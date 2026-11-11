/**
 * HISTORY (superseded by LIRA-381, see the describe below).
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

// LIRA-381 rewrite (rule 24): this file used to prove "Refund item" is
// HIDDEN on every member of a basket holding a payout (`hideRefundItem`).
// The owner overruled that rule on 2026-11-11 and the prop is gone; the
// cases now guard the opposite: a sold item AND the payout itself both keep
// "Refund item" in such a basket. (Rewritten after the change — not proven
// failing-first by a run.)
describe("ActionsCell — a basket that holds a payout keeps 'Refund item' (LIRA-381)", () => {
  it("shows 'Refund item' on a sold SALE member of a payout basket", () => {
    const row = buildSessionRow({ is_session_payout: false });
    renderCell(row, buildHandlers());

    expect(
      screen.getByRole("button", { name: "Refund item" }),
    ).toBeInTheDocument();
  });

  it("shows 'Refund item' on the payout row itself (a loto cash prize)", () => {
    const row = buildSessionRow({
      type: "LOTO_CASH_PRIZE" as TransactionRow["type"],
      amount_usd: 0,
      amount_lbp: -500000,
      is_session_payout: true,
    });
    renderCell(row, buildHandlers());

    expect(
      screen.getByRole("button", { name: "Refund item" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refund basket" }),
    ).toBeInTheDocument();
  });

  it("shows 'Refund item' on a loto ticket row", () => {
    const row = buildSessionRow({
      type: "LOTO" as TransactionRow["type"],
      source_table: "loto_tickets",
      amount_usd: 0,
      amount_lbp: 300000,
    });
    renderCell(row, buildHandlers());

    expect(
      screen.getByRole("button", { name: "Refund item" }),
    ).toBeInTheDocument();
  });
});

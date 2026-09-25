/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule for this
 * batch). LIRA-201c (OWNER_NOTES_REMAINING_BUILD.md #11-C): `ActionsCell`
 * previously rendered a dead-end "Basket item — see admin to reverse" span
 * for any reversible session-basket row; it now renders real "Void basket"
 * / "Refund basket" buttons wired to `onVoidSessionBasket`/
 * `onRefundSessionBasket`. This test fails against the pre-fix span-only
 * render by construction (rule 17).
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
  };
}

describe("ActionsCell — session-basket whole-basket reversal buttons (LIRA-201c)", () => {
  it("renders 'Void basket' / 'Refund basket' buttons (not the old dead-end span) for a reversible session-basket row", () => {
    const row = buildSessionRow();
    const handlers = buildHandlers();

    render(
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

    expect(
      screen.queryByText(/see admin to reverse/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Void basket" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refund basket" }),
    ).toBeInTheDocument();
  });

  it("'Void basket' calls onVoidSessionBasket with the session id", () => {
    const row = buildSessionRow();
    const handlers = buildHandlers();

    render(
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

    fireEvent.click(screen.getByRole("button", { name: "Void basket" }));
    expect(handlers.onVoidSessionBasket).toHaveBeenCalledWith(7);
    expect(handlers.onRefundSessionBasket).not.toHaveBeenCalled();
  });

  it("'Refund basket' calls onRefundSessionBasket with the session id", () => {
    const row = buildSessionRow();
    const handlers = buildHandlers();

    render(
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

    fireEvent.click(screen.getByRole("button", { name: "Refund basket" }));
    expect(handlers.onRefundSessionBasket).toHaveBeenCalledWith(7);
    expect(handlers.onVoidSessionBasket).not.toHaveBeenCalled();
  });

  it("a non-session row (sessionId null) still gets plain Void/Refund buttons, not the basket buttons", () => {
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
      screen.queryByRole("button", { name: "Void basket" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Void" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refund" }),
    ).toBeInTheDocument();
  });
});

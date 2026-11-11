/**
 * ActionsCell — 5 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 5).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { ActionsCell, type RowActionHandlers } from "../TransactionCells";
import { deriveRow } from "../../rowDerived";
import { type TransactionRow } from "../../hooks/useTransactionRows";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("ActionsCell.hideRefundItemForPayoutBasket (LIRA-381)", () => {
  beforeAll(resetBetweenFiles);

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
});

describe("ActionsCell.nonReversibleReason (LIRA-079)", () => {
  beforeAll(resetBetweenFiles);

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
      onWrongNumber: jest.fn(),
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
});

describe("ActionsCell.sessionBasketButtons (LIRA-201)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * NOT RUN — proven at the end-of-batch gate (owner process rule for this
   * batch). LIRA-201c (OWNER_NOTES_REMAINING_BUILD.md #11-C): `ActionsCell`
   * previously rendered a dead-end "Basket item — see admin to reverse" span
   * for any reversible session-basket row; it now renders real "Void basket"
   * / "Refund basket" buttons wired to `onVoidSessionBasket`/
   * `onRefundSessionBasket`. This test fails against the pre-fix span-only
   * render by construction (rule 17).
   */

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
      onWrongNumber: jest.fn(),
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
      expect(screen.getByRole("button", { name: "Void" })).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Refund" }),
      ).toBeInTheDocument();
    });

    // LIRA-232 round-2 review (finding 2) — once a session has ANY per-item
    // refund, `voidSessionBasket` hard-refuses it server-side (nothing left to
    // cleanly void), so the button must be HIDDEN, not just left to error on
    // click. "Refund basket" (reverses only what's left) stays. Written
    // failing-first: at authoring time `ActionsCell` had no `hideVoidBasket`
    // prop at all, so passing it was a no-op and "Void basket" still rendered.
    it("hides 'Void basket' (keeps 'Refund basket') when hideVoidBasket is true", () => {
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
                hideVoidBasket
              />
            </tr>
          </tbody>
        </table>,
      );

      expect(
        screen.queryByRole("button", { name: "Void basket" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Refund basket" }),
      ).toBeInTheDocument();
    });

    it("hideVoidBasket defaults to false — 'Void basket' still renders when the prop is omitted (backward compatible)", () => {
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
        screen.getByRole("button", { name: "Void basket" }),
      ).toBeInTheDocument();
    });

    // LIRA-232 round-2 review (finding 3) — a member row that core has already
    // marked reversed (`reversed_by_id` set — note 21d) must show NONE of
    // Void basket / Refund basket / Refund item, the same way a plain
    // non-session row's Void/Refund pair already disappears (actionGating.ts,
    // `isReversibleRow`). Regression guard: `ActionsCell`'s entire session
    // block is gated on `isReversibleRow(row)`, which already reads
    // `reversed_by_id` — this pins that the session branch was never given a
    // weaker gate of its own.
    it("hides Void basket / Refund basket / Refund item entirely once the row is already reversed (reversed_by_id set)", () => {
      const row = buildSessionRow({ reversed_by_id: 999 });
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
        screen.queryByRole("button", { name: "Void basket" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Refund basket" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Refund item" }),
      ).not.toBeInTheDocument();
    });
  });
});

describe("ActionsCell.sessionItemRefund (LIRA-232)", () => {
  beforeAll(resetBetweenFiles);

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
});

describe("ActionsCell.undoRefund (LIRA-147)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-147 — admin-only "Undo refund" button on a REFUND row. Before this
   * change, a REFUND(item) row showed a bare "Can't refund here" explanation
   * with no way to actually act on it (LIRA-079's own addition); this test
   * fails against that pre-button render by construction (rule 17 — the
   * button and the admin gate are both new, proven here directly).
   */

  function buildRefundRow(
    overrides: Partial<TransactionRow> = {},
  ): TransactionRow {
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
      onWrongNumber: jest.fn(),
    };
  }

  function renderCell(
    row: TransactionRow,
    handlers: RowActionHandlers,
    isAdmin: boolean,
  ) {
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
});

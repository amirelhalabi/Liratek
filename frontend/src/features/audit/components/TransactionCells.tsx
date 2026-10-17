/**
 * The eight cells of one transaction row, one component each.
 *
 * `buildTr` in `pages/TransactionsViewer.tsx` was a single 256-line function
 * rendering every cell, with ternaries nested four deep in the actions cell —
 * you could not read one cell's logic without scrolling past another's. Each
 * cell is now independently readable and independently renderable in a test.
 * Owner decision 2026-10-16 removed the Ret. Credits, Status and Reverses
 * cells: their rare cases are tags in `SummaryCell` (`../rowBadges`) and
 * facts in the Details panel.
 *
 * DOM contract: every component here renders exactly ONE `<td>`, in the
 * declared column order (Time, Summary, Type, Client, Amount, Method, User,
 * Actions — eight total). The page's specs address cells by index, and
 * `DataTable`'s column headers are declared separately — so a cell that
 * renders zero or two `<td>`s would silently misalign the whole table (and
 * its Excel/PDF export, which reads cells by header index).
 *
 * Per-row derivations that more than one cell needs (`deriveRow`) are
 * computed ONCE by the caller and passed in, rather than each cell
 * re-parsing `metadata_json` for itself.
 */
import { useTranslation } from "react-i18next";
import {
  SESSION_ITEM_REFUNDABLE_TYPES,
  type TransactionType,
} from "@liratek/core";
import { formatNumber } from "@liratek/ui/i18n/format";
import type { EN_RESOURCES } from "@liratek/ui/i18n/resources";
import { isReceiptableRow } from "../receiptGating";
import {
  isReversibleRow,
  offersWholeVoidRefund,
  isWrongNumberEligible,
  wrongNumberRecordTarget,
  wrongNumberSaleProvider,
} from "../actionGating";
import type { WrongNumberDialogTarget } from "@/features/wrongNumbers/components/WrongNumberDialog";
import { getNonReversibleReason } from "../nonReversibleReasons";
import { parseMetaSafe } from "../auditConstants";
import { formatPaymentLegs } from "../cashFlow";
import {
  cashLegsFor,
  cashMovementLine,
  displayAmountFields,
  displaySummary,
  formatCheckpointAmounts,
  getTypeColor,
  getTypeLabel,
  methodLegsFor,
  sessionPooledCashLegsFor,
  sessionPooledMethodLegsFor,
  sessionReversalLine,
} from "../transactionDisplay";
import { CashFlowBadge } from "./CashFlowBadge";
import { amountCellText, type RowDerived } from "../rowDerived";
import { rowBadges, rowStatus, signedCreditsText } from "../rowBadges";
import { translateTitle } from "../typeTitleText";
import {
  clientText,
  methodBrand,
  methodColumnLegs,
  methodText,
  timeText,
  userText,
} from "../transactionCellText";
import { ProviderLogo } from "@/shared/components/ProviderLogo";
import type { TransactionRow } from "../hooks/useTransactionRows";

/** Strike-through applied to a VOIDED row's type/summary/amount text. */
const voidedText = (row: TransactionRow) =>
  row.status === "VOIDED" ? "line-through opacity-60" : "";

type NonReversibleKey = keyof (typeof EN_RESOURCES)["audit"]["nonReversible"];

export function TimeCell({ row }: { row: TransactionRow }) {
  const { i18n } = useTranslation("audit");
  return (
    <td className="p-2 truncate" style={{ width: 160 }}>
      {timeText(row, i18n.language)}
    </td>
  );
}

export function SummaryCell({
  row,
  derived,
  isLegDetailExpanded,
  onToggleLegDetail,
}: {
  row: TransactionRow;
  derived: RowDerived;
  isLegDetailExpanded: boolean;
  onToggleLegDetail: (rowId: number) => void;
}) {
  const { t } = useTranslation("audit");
  const { commissionAmount, isGroupHeader } = derived;
  // Production test 2026-10-07: the badge carries the TRANSACTION amount
  // (Sale #99 → $4.25), never the cash handed over ($5) — the cash has its
  // own line below.
  const amount = commissionAmount ?? displayAmountFields(row);
  const summaryText = displaySummary(row);
  return (
    <td className="p-2">
      <div className="flex flex-col gap-0.5">
        {/* LIRA-201b (owner note #11-B): the ONE row chosen to carry its
            session's pooled in/out + payment detail gets a small marker so
            the operator understands why this row's summary covers the
            whole basket, not just this line item. */}
        {isGroupHeader && (
          <span
            data-testid={`session-group-header-${row.session_id}`}
            className="self-start text-[10px] font-medium text-sky-400"
          >
            {t("cells.sessionPooledTotal", { id: row.session_id })}
          </span>
        )}
        {(() => {
          // Owner decision 2026-10-16: voided / refunded / reversal /
          // credits-returned rows get a small tag; a normal row gets none.
          const badges = rowBadges(row);
          if (badges.length === 0) return null;
          return (
            <span className="flex flex-wrap gap-1">
              {badges.map((b) => (
                <span
                  key={b.key}
                  data-testid="row-badge"
                  className={b.className}
                >
                  {b.key === "status"
                    ? (() => {
                        const status = rowStatus(row);
                        return status === "ACTIVE"
                          ? b.label
                          : t(`badges.${status}`);
                      })()
                    : b.key === "credits" && row.returned_credits_usd != null
                      ? t("badges.creditsBack", {
                          amount: signedCreditsText(row.returned_credits_usd),
                        })
                      : b.label}
                </span>
              ))}
            </span>
          );
        })()}
        <CashFlowBadge
          type={row.type}
          amountUsd={amount.usd}
          amountLbp={amount.lbp}
          metaJson={row.metadata_json}
          legs={row.payments}
          reversesId={row.reverses_id}
          signedAmounts={{ usd: row.amount_usd, lbp: row.amount_lbp }}
          providerBalance={derived.providerBalance}
        />
        {summaryText && (
          <span className="text-slate-400 truncate max-w-[480px]">
            {summaryText}
          </span>
        )}
        {row.type === "CHECKPOINT" &&
          (() => {
            const amountDetail = formatCheckpointAmounts(row.metadata_json);
            if (!amountDetail) return null;
            return (
              <span className="text-[10px] font-mono text-slate-500 truncate max-w-[480px]">
                {amountDetail}
              </span>
            );
          })()}
        {row.type !== "CHECKPOINT" &&
          (() => {
            // LIRA-201b fix round (M3): always THIS row's own legs only —
            // never merged with the session's pooled basket legs, even on
            // the chosen group-header row. See cashLegsFor's doc.
            // A sale / its void / a refund: the cash in words ("paid $5.00
            // · change $0.50"); every other type keeps "in: … · out: …".
            const legs =
              cashMovementLine(row) ?? formatPaymentLegs(cashLegsFor(row));
            // Owner decision 2026-10-07: show the rate the customer PAID at
            // — a basket member's checkout rate (`display_exchange_rate`,
            // core's DISPLAY_EXCHANGE_RATE_SQL), else the row's own stamp.
            // A row that moves no amount and has no legs (a session's
            // KEPT_CHANGE profit row) shows no lone "@ rate".
            const shownRate = row.display_exchange_rate ?? row.exchange_rate;
            const movesNothing = !legs && !row.amount_usd && !row.amount_lbp;
            const rate =
              shownRate && !movesNothing
                ? `@ ${formatNumber(Math.round(shownRate))}`
                : null;
            const text = [legs, rate].filter(Boolean).join(" · ");
            if (!text) return null;
            return (
              <span
                data-testid="payment-legs"
                className="text-[11px] font-mono text-slate-500 truncate max-w-[480px]"
              >
                {text}
              </span>
            );
          })()}
        {row.type !== "CHECKPOINT" &&
          isGroupHeader &&
          (() => {
            // LIRA-201b fix round (M3): the session basket's pooled total,
            // on its OWN labelled line — never mixed with the line above.
            // Production test 2026-10-07: a voided/refunded basket's pooled
            // list also holds the reversal legs — summed together they read
            // "in: $5.5 · out: $5.5". The checkout's own legs stay on this
            // line; the reversal gets its own line in words.
            const pooled = sessionPooledCashLegsFor(row);
            const legs = formatPaymentLegs(pooled.filter((l) => !l.reversal));
            const reversal = sessionReversalLine(pooled);
            if (!legs && !reversal) return null;
            return (
              <>
                {legs && (
                  <span
                    data-testid="session-payment-legs"
                    className="text-[11px] font-mono text-sky-500/70 truncate max-w-[480px]"
                  >
                    {t("cells.sessionLegs", { legs })}
                  </span>
                )}
                {reversal && (
                  <span
                    data-testid="session-reversal-legs"
                    className="text-[11px] font-mono text-sky-500/70 truncate max-w-[480px]"
                  >
                    {reversal}
                  </span>
                )}
              </>
            );
          })()}
        {(methodLegsFor(row).length > 0 ||
          (isGroupHeader && sessionPooledMethodLegsFor(row).length > 0) ||
          commissionAmount !== null) && (
          <button
            onClick={() => onToggleLegDetail(row.id)}
            data-testid={`toggle-legs-${row.id}`}
            className="self-start text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
            title={
              isLegDetailExpanded
                ? t("cells.hidePaymentDetail")
                : t("cells.showPaymentDetail")
            }
          >
            {isLegDetailExpanded
              ? t("cells.paymentDetailOpen")
              : t("cells.paymentDetailClosed")}
          </button>
        )}
      </div>
    </td>
  );
}

export function TypeCell({ row }: { row: TransactionRow }) {
  const { t, i18n } = useTranslation("audit");
  return (
    <td className="p-2 truncate" style={{ width: 160 }}>
      <span className={`${getTypeColor(row)} ${voidedText(row)}`}>
        {translateTitle(getTypeLabel(row), t, i18n.language)}
      </span>
    </td>
  );
}

export function ClientCell({ row }: { row: TransactionRow }) {
  return (
    <td className="p-2 truncate" style={{ width: 140 }}>
      {clientText(row)}
    </td>
  );
}

export function AmountCell({
  row,
  derived,
}: {
  row: TransactionRow;
  derived: RowDerived;
}) {
  // The transaction amount, signed (a void/refund reads "−$4.25") — never the
  // tender (production test 2026-10-07). One definition, shared with the
  // Details panel: `amountCellText`.
  return (
    <td className="p-2 truncate" style={{ width: 160 }}>
      <span className={voidedText(row)}>{amountCellText(row, derived)}</span>
    </td>
  );
}

export function MethodCell({
  row,
  methodLabelByCode,
}: {
  row: TransactionRow;
  methodLabelByCode: Map<string, string>;
}) {
  const { t } = useTranslation("audit");
  // Whish/OMT icon only when every leg the column names is that one wallet
  // (`methodBrand` reads the same legs as `methodText`).
  const brand = methodBrand(row);
  // `methodText` stays English for the export and the sort; only its
  // "Session #N" wording is shown in the displayed language here.
  const sessionId =
    row.type === "CHECKPOINT" ? null : methodColumnLegs(row).sessionId;
  return (
    <td className="p-2 truncate" style={{ width: 120 }}>
      {brand && (
        <ProviderLogo
          brand={brand}
          variant="icon"
          size={14}
          className="me-1 align-middle"
        />
      )}
      {/* LIRA-201b fix round (M3): always THIS row's own legs only,
          including on the session group-header row — the pooled basket
          method(s) render on their own labelled line/detail section
          instead (SummaryCell's "Session:" line, buildLegDetailTr's
          "Session:" block), never merged in here. */}
      {sessionId !== null
        ? t("cells.sessionMethod", { id: sessionId })
        : methodText(row, methodLabelByCode)}
    </td>
  );
}

export function UserCell({ row }: { row: TransactionRow }) {
  return (
    <td className="p-2 truncate" style={{ width: 90 }}>
      {userText(row)}
    </td>
  );
}

export interface RowActionHandlers {
  onPrintReceipt: (id: number) => void;
  onVoid: (id: number) => void;
  onRefund: (row: TransactionRow) => void;
  onVoidCheckoutGroup: (groupId: string, units: number | null) => void;
  /** LIRA-201c (OWNER_NOTES_REMAINING_BUILD.md #11-C) — whole-basket
   *  void/refund, replacing the "Basket item — see admin to reverse" dead
   *  end below. */
  onVoidSessionBasket: (sessionId: number) => void;
  onRefundSessionBasket: (sessionId: number) => void;
  /** LIRA-232 (SESSION_ITEM_REFUND_PLAN.md §4) — refund ONE sold-item session
   *  member (a product line/quantity, a service, a recharge) instead of the
   *  whole basket. Offered only for SESSION_ITEM_REFUNDABLE_TYPES rows. */
  onRefundSessionItem: (row: TransactionRow) => void;
  /** LIRA-147 — admin-only undo of a standalone per-item refund. */
  onUndoRefund: (row: TransactionRow) => void;
  /** LIRA-312 — "Wrong number…" on a card sale, "Credits…" on a credits
   *  entry or a wrong-number expense. */
  onWrongNumber: (target: WrongNumberDialogTarget) => void;
  /** Owner request 2026-10-16 — open the Details panel (everything saved
   *  with this transaction). Optional so callers that build handlers
   *  without it are unaffected; the button shows only when it is passed. */
  onShowDetails?: (row: TransactionRow) => void;
}

export function ActionsCell({
  row,
  derived,
  sessionId,
  refundLookupRowId,
  handlers,
  hideVoidBasket = false,
  hideRefundItem = false,
  hideBasketActions = false,
  isAdmin = false,
}: {
  row: TransactionRow;
  derived: RowDerived;
  sessionId: number | null;
  /** Row whose linked-units lookup is in flight — disables just its button. */
  refundLookupRowId: number | null;
  handlers: RowActionHandlers;
  /** LIRA-147 — gates the "Undo refund" button (admin only). Defaults to
   *  `false` so every existing caller that doesn't pass it is unaffected;
   *  the backend's own `requireRole(["admin"])` remains the real
   *  authority — this is a UI-level convenience, not the enforcement. */
  isAdmin?: boolean;
  /** LIRA-232 round-2 review (finding 2) — true when this row's session has
   *  ANY per-item refund already: `voidSessionBasket` hard-refuses a basket
   *  once it's been touched by an item refund, so "Void basket" is hidden
   *  (never disabled — same convention as every other action-visibility gate
   *  in this cell), leaving "Refund basket" (which reverses only what's
   *  left) and "Refund item" available. Defaults to `false` so every
   *  existing caller that doesn't pass it is unaffected. */
  hideVoidBasket?: boolean;
  /** LIRA-232 round-3 review (finding 2) — true when this row's session has
   *  ANY payout member (a loto cash prize, a wallet/Binance cash-out, a
   *  custom-service booked as a payout — anything the basket netted against
   *  its other items at checkout): core refuses `refundSessionBasketItem`
   *  for EVERY member of such a basket, not just the payout row itself, so
   *  "Refund item" is hidden (never disabled — same convention as
   *  `hideVoidBasket`) for an otherwise-refundable SALE/CUSTOM_SERVICE/
   *  RECHARGE row too, leaving "Void basket"/"Refund basket" as the only
   *  way to touch that basket. Defaults to `false` so every existing caller
   *  that doesn't pass it is unaffected. */
  hideRefundItem?: boolean;
  /** Coordinator follow-up (2026-09-27), item 5 — true when this row's
   *  session has already been refunded item by item in FULL
   *  (`row.session_fully_refunded`/`TransactionRepository
   *  .isSessionBasketFullyRefunded`): the server now REFUSES both
   *  `voidSessionBasket` and `refundSessionBasket` on such a basket
   *  ("Everything in this basket has already been refunded item by item —
   *  there is nothing left to refund"), so BOTH "Void basket" and "Refund
   *  basket" are hidden — unlike `hideVoidBasket` above, which still leaves
   *  "Refund basket" offered (it reverses what's left). Defaults to `false`
   *  so every existing caller that doesn't pass it is unaffected. */
  hideBasketActions?: boolean;
}) {
  const { t } = useTranslation("audit");
  const { splitGroup } = derived;
  return (
    <td className="p-2" style={{ width: 110 }}>
      <div className="flex items-center gap-1">
        {/* Owner request 2026-10-16 — on every row: what was saved with it.
            Same look as Print. */}
        {handlers.onShowDetails && (
          <button
            onClick={() => handlers.onShowDetails?.(row)}
            title={t("actions.detailsTitle")}
            className="px-1.5 py-0.5 text-[10px] rounded bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors"
          >
            {t("actions.details")}
          </button>
        )}
        {/* Reprint a detailed service receipt (RCP-3) — available on any
            service transaction, including voided/older ones. Provider-
            aware gate (LIRA-069 W1.a) — excludes OMT/Whish System,
            OMT App / Whish App transfers, and Binance even though
            they're FINANCIAL_SERVICE rows. */}
        {isReceiptableRow(row) && (
          <button
            onClick={() => handlers.onPrintReceipt(row.id)}
            title={t("actions.printTitle")}
            className="px-1.5 py-0.5 text-[10px] rounded bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors"
          >
            {t("actions.print")}
          </button>
        )}
        {/* LIRA-312 — not a refund: the sale stays as it is (it becomes the
            right number's recharge), so this is offered next to Void/Refund
            and on a session basket member too. */}
        {isWrongNumberEligible(row) && (
          <button
            onClick={() =>
              handlers.onWrongNumber({
                kind: "sale",
                saleTransactionId: row.id,
                provider: wrongNumberSaleProvider(row)!,
                saleText: row.summary,
              })
            }
            title={t("actions.wrongNumberTitle")}
            className="px-1.5 py-0.5 text-[10px] rounded bg-violet-900/70 text-violet-200 hover:bg-violet-900/40 hover:text-violet-300 transition-colors"
          >
            {t("actions.wrongNumber")}
          </button>
        )}
        {(() => {
          const target = wrongNumberRecordTarget(row);
          return target ? (
            <button
              onClick={() => handlers.onWrongNumber(target)}
              title={t("actions.creditsTitle")}
              className="px-1.5 py-0.5 text-[10px] rounded bg-violet-900/70 text-violet-200 hover:bg-violet-900/40 hover:text-violet-300 transition-colors"
            >
              {t("actions.credits")}
            </button>
          ) : null;
        })()}
        {isReversibleRow(row) ? (
          splitGroup ? (
            // CARRIER_LEGS_VOID_ASYMMETRY.md (design B+): this row is one
            // unit of a multi-unit split checkout — a lone void/refund is
            // blocked by the repository guard (the customer's full
            // tender/debt books against only ONE unit, the carrier).
            // Offer the whole-checkout action instead of a button that
            // would just surface the guard's error.
            <button
              onClick={() =>
                handlers.onVoidCheckoutGroup(
                  splitGroup.groupId,
                  splitGroup.units,
                )
              }
              title={t("actions.voidCheckoutTitle")}
              className="px-1.5 py-0.5 text-[10px] rounded bg-red-900/70 text-red-200 hover:bg-red-900/40 hover:text-red-300 transition-colors"
            >
              {splitGroup.units
                ? t("actions.voidCheckoutUnits", { count: splitGroup.units })
                : t("actions.voidCheckout")}
            </button>
          ) : sessionId != null ? (
            // LIRA-115 → LIRA-201c: this row's customer-cash leg (and/or its
            // CUSTOMER_ACCOUNT charge) is POOLED across every item in the
            // session basket — a lone void/refund can only ever reverse
            // this item's OWN legs (e.g. a cost outflow), never the pooled
            // customer money, so the repository hard-refuses it
            // (`TransactionRepository._assertReversible`). Offer the
            // whole-basket action instead, mirroring the split_group
            // treatment above — `voidSessionBasket`/`refundSessionBasket`
            // reverse every item plus the pooled leg(s) and pooled debt in
            // ONE transaction.
            <>
              {!hideVoidBasket && !hideBasketActions && (
                <button
                  onClick={() => handlers.onVoidSessionBasket(sessionId)}
                  title={t("actions.voidBasketTitle")}
                  className="px-1.5 py-0.5 text-[10px] rounded bg-red-900/70 text-red-200 hover:bg-red-900/40 hover:text-red-300 transition-colors"
                >
                  {t("actions.voidBasket")}
                </button>
              )}
              {!hideBasketActions && (
                <button
                  onClick={() => handlers.onRefundSessionBasket(sessionId)}
                  title={t("actions.refundBasketTitle")}
                  className="px-1.5 py-0.5 text-[10px] rounded bg-rose-900/70 text-rose-200 hover:bg-rose-900/40 hover:text-rose-300 transition-colors"
                >
                  {t("actions.refundBasket")}
                </button>
              )}
              {!hideRefundItem &&
                SESSION_ITEM_REFUNDABLE_TYPES.has(
                  row.type as TransactionType,
                ) && (
                  <button
                    onClick={() => handlers.onRefundSessionItem(row)}
                    title={t("actions.refundItemTitle")}
                    className="px-1.5 py-0.5 text-[10px] rounded bg-rose-900/70 text-rose-200 hover:bg-rose-900/40 hover:text-rose-300 transition-colors"
                  >
                    {t("actions.refundItem")}
                  </button>
                )}
            </>
          ) : offersWholeVoidRefund(row) ? (
            <>
              <button
                onClick={() => handlers.onVoid(row.id)}
                className="px-1.5 py-0.5 text-[10px] rounded bg-red-900/70 text-red-200 hover:bg-red-900/40 hover:text-red-300 transition-colors"
              >
                {t("actions.void")}
              </button>
              <button
                onClick={() => handlers.onRefund(row)}
                disabled={refundLookupRowId === row.id}
                className="px-1.5 py-0.5 text-[10px] rounded bg-rose-900/70 text-rose-200 hover:bg-rose-900/40 hover:text-rose-300 transition-colors disabled:opacity-50"
              >
                {refundLookupRowId === row.id ? "…" : t("actions.refund")}
              </button>
            </>
          ) : null
        ) : isAdmin &&
          row.type === "REFUND" &&
          row.status === "ACTIVE" &&
          (parseMetaSafe(row.metadata_json).refundType === "item" ||
            parseMetaSafe(row.metadata_json).refundType === "sessionItem") ? (
          // LIRA-147 — admin-only undo of a STANDALONE per-item refund (the
          // generic void/refund path can never reach a REFUND row —
          // NON_REVERSIBLE_TRANSACTION_TYPES — this is a dedicated action,
          // not a bypass of that gate). LIRA-253 extends the SAME button to
          // a session-basket item refund (`refundType === "sessionItem"`) —
          // one shared `onUndoRefund` handler/IPC channel for both shapes,
          // dispatched server-side from the refund row's own metadata (see
          // `SalesRepository.undoSaleItemRefund`'s own doc). The repository
          // still refuses an already-undone, dependent-activity, or
          // FIFO-untraceable case with a clear error (surfaced via the same
          // `alert()` pattern every other action here uses).
          <button
            onClick={() => handlers.onUndoRefund(row)}
            title={t("actions.undoRefundTitle")}
            className="px-1.5 py-0.5 text-[10px] rounded bg-amber-900/70 text-amber-200 hover:bg-amber-900/40 hover:text-amber-300 transition-colors"
          >
            {t("actions.undoRefund")}
          </button>
        ) : isReceiptableRow(row) ? null : (
          (() => {
            const reason = getNonReversibleReason(row.type);
            return reason ? (
              <span
                className="text-[10px] text-slate-500 italic cursor-help"
                title={t(`nonReversible.${row.type as NonReversibleKey}`, {
                  defaultValue: reason,
                })}
                data-testid="non-reversible-reason"
              >
                {t("actions.cantRefund")}
              </span>
            ) : handlers.onShowDetails ? null : (
              // The Details button already fills the cell.
              "—"
            );
          })()
        )}
      </div>
    </td>
  );
}

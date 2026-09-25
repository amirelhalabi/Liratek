/**
 * The eleven cells of one transaction row, one component each.
 *
 * `buildTr` in `pages/TransactionsViewer.tsx` was a single 256-line function
 * rendering all ten (this file's original count), with ternaries nested four
 * deep in the actions cell — you could not read the Status logic without
 * scrolling past the Summary logic. Each cell is now independently readable
 * and independently renderable in a test. `ReturnedCreditsCell` (LIRA-205)
 * was added later, bringing the row to eleven.
 *
 * DOM contract: every component here renders exactly ONE `<td>`, in the
 * declared column order (Time, Summary, Type, Client, Amount, Ret. Credits,
 * Method, User, Status, Reverses, Actions — eleven total). The page's specs
 * address cells by index, and `DataTable`'s column headers are declared
 * separately — so a cell that renders zero or two `<td>`s would silently
 * misalign the whole table.
 *
 * Per-row derivations that more than one cell needs (`deriveRow`) are
 * computed ONCE by the caller and passed in, rather than each cell
 * re-parsing `metadata_json` for itself.
 */
import { isReceiptableRow } from "../receiptGating";
import { isReversibleRow } from "../actionGating";
import { formatPaymentLegs } from "../cashFlow";
import {
  cashLegsFor,
  checkpointPhysicalTotals,
  formatAmount,
  formatCheckpointAmounts,
  formatPaymentMethods,
  getTypeColor,
  getTypeLabel,
  methodLegsFor,
  sessionPooledCashLegsFor,
  sessionPooledMethodLegsFor,
} from "../transactionDisplay";
import { CashFlowBadge } from "./CashFlowBadge";
import type { RowDerived } from "../rowDerived";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import type { TransactionRow } from "../hooks/useTransactionRows";

/** Strike-through applied to a VOIDED row's type/summary/amount text. */
const voidedText = (row: TransactionRow) =>
  row.status === "VOIDED" ? "line-through opacity-60" : "";

export function TimeCell({ row }: { row: TransactionRow }) {
  return (
    <td className="p-2 truncate" style={{ width: 160 }}>
      {row.created_at
        ? (() => {
            try {
              return parseDbDate(row.created_at).toLocaleString("en-GB", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              });
            } catch {
              return row.created_at;
            }
          })()
        : ""}
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
  const { tender, commissionAmount, isGroupHeader } = derived;
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
            Session #{row.session_id} — pooled basket total
          </span>
        )}
        <CashFlowBadge
          type={row.type}
          amountUsd={commissionAmount?.usd ?? tender?.usd ?? row.amount_usd}
          amountLbp={commissionAmount?.lbp ?? tender?.lbp ?? row.amount_lbp}
          metaJson={row.metadata_json}
          legs={row.payments}
          providerBalance={derived.providerBalance}
        />
        {row.summary && (
          <span className="text-slate-400 truncate max-w-[480px]">
            {row.summary}
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
            const legs = formatPaymentLegs(cashLegsFor(row));
            const rate = row.exchange_rate
              ? `@ ${Math.round(row.exchange_rate).toLocaleString()}`
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
            const legs = formatPaymentLegs(sessionPooledCashLegsFor(row));
            if (!legs) return null;
            return (
              <span
                data-testid="session-payment-legs"
                className="text-[11px] font-mono text-sky-500/70 truncate max-w-[480px]"
              >
                Session: {legs}
              </span>
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
                ? "Hide payment detail"
                : "Show payment detail"
            }
          >
            {isLegDetailExpanded ? "▾ payment detail" : "▸ payment detail"}
          </button>
        )}
      </div>
    </td>
  );
}

export function TypeCell({ row }: { row: TransactionRow }) {
  return (
    <td className="p-2 truncate" style={{ width: 160 }}>
      <span className={`${getTypeColor(row)} ${voidedText(row)}`}>
        {getTypeLabel(row)}
      </span>
    </td>
  );
}

export function ClientCell({ row }: { row: TransactionRow }) {
  return (
    <td className="p-2 truncate" style={{ width: 140 }}>
      {row.client_name || "—"}
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
  const { credit, partnerSigned, tender, commissionAmount } = derived;
  return (
    <td className="p-2 truncate" style={{ width: 160 }}>
      <span className={voidedText(row)}>
        {row.type === "CHECKPOINT"
          ? (() => {
              const totals = checkpointPhysicalTotals(row.metadata_json);
              return formatAmount(
                totals?.usd ?? row.amount_usd,
                totals?.lbp ?? row.amount_lbp,
                null,
              );
            })()
          : formatAmount(
              commissionAmount?.usd ??
                tender?.usd ??
                (credit || partnerSigned
                  ? Math.abs(row.amount_usd)
                  : row.amount_usd),
              commissionAmount?.lbp ??
                tender?.lbp ??
                (credit || partnerSigned
                  ? Math.abs(row.amount_lbp)
                  : row.amount_lbp),
              row.metadata_json,
              row.type,
            )}
      </span>
    </td>
  );
}

/**
 * LIRA-205 — net telecom credit returned to the shop on this transaction
 * (Only-Days sale of an MTC/Alfa card through iPick/Katsh), sourced from
 * `TransactionRow.returned_credits_usd` (`TransactionRepository.getRecent`,
 * USD-only — see that repository's `_attachPaymentLegs` doc comment).
 *
 * Blank (em dash) when the row posted no CREDIT_RETURN leg: `v === undefined`
 * is the ONLY blank condition — a `0` here would claim a return happened and
 * came to nothing, which is why the field is presence-keyed rather than
 * defaulted to 0 upstream. Signed — a VOID/REFUND row shows the negated
 * mirror `_reversePayments` writes. Deliberately not `formatAmount`
 * (../transactionDisplay.ts): it renders a negative as `$-73` via bare
 * `toLocaleString()`.
 */
export function ReturnedCreditsCell({ row }: { row: TransactionRow }) {
  const v = row.returned_credits_usd;
  return (
    <td className={`p-2 truncate ${voidedText(row)}`} style={{ width: 120 }}>
      {v === undefined
        ? "—"
        : `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString()}`}
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
  return (
    <td className="p-2 truncate" style={{ width: 120 }}>
      {row.type === "CHECKPOINT"
        ? "—"
        : formatPaymentMethods(
            // LIRA-201b fix round (M3): always THIS row's own legs only,
            // including on the session group-header row — the pooled
            // basket method(s) render on their own labelled line/detail
            // section instead (SummaryCell's "Session:" line,
            // buildLegDetailTr's "Session:" block), never merged in here.
            methodLegsFor(row),
            methodLabelByCode,
          )}
    </td>
  );
}

export function UserCell({ row }: { row: TransactionRow }) {
  return (
    <td className="p-2 truncate" style={{ width: 90 }}>
      {row.username || `#${row.user_id}`}
    </td>
  );
}

export function StatusCell({ row }: { row: TransactionRow }) {
  return (
    <td className="p-2" style={{ width: 80 }}>
      {row.status === "VOIDED" ? (
        <span className="bg-red-900/50 text-red-300 text-[10px] px-1.5 py-0.5 rounded font-medium">
          VOIDED
        </span>
      ) : row.reversed_by_id ? (
        // note 21d: an ACTIVE original that has already been refunded —
        // gets the same small badge treatment as VOIDED (and, below,
        // loses its Void/Refund buttons the same way), but deliberately
        // NOT the line-through styling VOIDED rows get on the
        // type/summary cells: a void means "this transaction is
        // cancelled, its amount doesn't count" (the source record itself
        // is voided), whereas a refunded row's sale/service genuinely
        // happened — the amount stays real history, only the money was
        // reversed via a separate REFUND row. Badge-only, distinct color
        // so the two states still read apart.
        <span className="bg-rose-900/50 text-rose-300 text-[10px] px-1.5 py-0.5 rounded font-medium">
          REFUNDED
        </span>
      ) : (
        <span className="text-green-500/80 text-[10px] font-medium">
          ACTIVE
        </span>
      )}
    </td>
  );
}

export function ReversesCell({ row }: { row: TransactionRow }) {
  return (
    <td className="p-2" style={{ width: 60 }}>
      {row.reverses_id ? `#${row.reverses_id}` : "—"}
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
}

export function ActionsCell({
  row,
  derived,
  sessionId,
  refundLookupRowId,
  handlers,
}: {
  row: TransactionRow;
  derived: RowDerived;
  sessionId: number | null;
  /** Row whose linked-units lookup is in flight — disables just its button. */
  refundLookupRowId: number | null;
  handlers: RowActionHandlers;
}) {
  const { splitGroup } = derived;
  return (
    <td className="p-2" style={{ width: 110 }}>
      <div className="flex items-center gap-1">
        {/* Reprint a detailed service receipt (RCP-3) — available on any
            service transaction, including voided/older ones. Provider-
            aware gate (LIRA-069 W1.a) — excludes OMT/Whish System,
            OMT App / Whish App transfers, and Binance even though
            they're FINANCIAL_SERVICE rows. */}
        {isReceiptableRow(row) && (
          <button
            onClick={() => handlers.onPrintReceipt(row.id)}
            title="Print receipt"
            className="px-1.5 py-0.5 text-[10px] rounded bg-slate-700 text-slate-200 hover:bg-slate-600 transition-colors"
          >
            Print
          </button>
        )}
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
              title="This transaction is part of a multi-unit checkout — void them all together"
              className="px-1.5 py-0.5 text-[10px] rounded bg-red-900/70 text-red-200 hover:bg-red-900/40 hover:text-red-300 transition-colors"
            >
              Void entire checkout
              {splitGroup.units ? ` (${splitGroup.units} units)` : ""}
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
              <button
                onClick={() => handlers.onVoidSessionBasket(sessionId)}
                title="Void the entire session basket — every item's money, cost, and profit is reversed together."
                className="px-1.5 py-0.5 text-[10px] rounded bg-red-900/70 text-red-200 hover:bg-red-900/40 hover:text-red-300 transition-colors"
              >
                Void basket
              </button>
              <button
                onClick={() => handlers.onRefundSessionBasket(sessionId)}
                title="Refund the entire session basket — every item's money, cost, and profit is reversed together."
                className="px-1.5 py-0.5 text-[10px] rounded bg-rose-900/70 text-rose-200 hover:bg-rose-900/40 hover:text-rose-300 transition-colors"
              >
                Refund basket
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => handlers.onVoid(row.id)}
                className="px-1.5 py-0.5 text-[10px] rounded bg-red-900/70 text-red-200 hover:bg-red-900/40 hover:text-red-300 transition-colors"
              >
                Void
              </button>
              <button
                onClick={() => handlers.onRefund(row)}
                disabled={refundLookupRowId === row.id}
                className="px-1.5 py-0.5 text-[10px] rounded bg-rose-900/70 text-rose-200 hover:bg-rose-900/40 hover:text-rose-300 transition-colors disabled:opacity-50"
              >
                {refundLookupRowId === row.id ? "…" : "Refund"}
              </button>
            </>
          )
        ) : isReceiptableRow(row) ? null : (
          "—"
        )}
      </div>
    </td>
  );
}

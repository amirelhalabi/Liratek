/**
 * The plain text of the Transactions table's simple cells — ONE definition
 * shared by the on-screen cells (`components/TransactionCells.tsx`), the
 * Excel/PDF export (`TransactionsViewer`'s `exportRow`) and the Details
 * panel, so the three never disagree (rule 14).
 *
 * Why the export needs it: the table's cells are React components, and the
 * shared DataTable export reads text only from plain `<td>` elements — it
 * cannot see inside a component. Since the cells became components
 * (3a2be48e) every transaction row exported blank. The export now builds its
 * `<td>`s from these functions instead.
 */
import { parseDbDate } from "@/shared/utils/parseDbDate";
import {
  formatPaymentMethods,
  methodLegsFor,
  paymentMethodsBrand,
} from "./transactionDisplay";
import {
  getRowCashFlowDirection,
  type TransactionPaymentLeg,
} from "./cashFlow";
import type { ProviderBrandKey } from "@/shared/brand/providerBrands";
import type { TransactionRow } from "./hooks/useTransactionRows";

function formatCreatedAt(
  createdAt: string,
  opts: Intl.DateTimeFormatOptions,
): string {
  if (!createdAt) return "";
  try {
    return parseDbDate(createdAt).toLocaleString("en-GB", opts);
  } catch {
    return createdAt;
  }
}

/** The Time column: "16 Oct, 09:30". */
export function timeText(row: Pick<TransactionRow, "created_at">): string {
  return formatCreatedAt(row.created_at, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** With the year — the Details panel and the export's extra sheets:
 *  "16 Oct 2026, 09:30". */
export function fullTimeText(row: Pick<TransactionRow, "created_at">): string {
  return formatCreatedAt(row.created_at, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function clientText(row: Pick<TransactionRow, "client_name">): string {
  return row.client_name || "—";
}

export function userText(
  row: Pick<TransactionRow, "username" | "user_id">,
): string {
  return row.username || `#${row.user_id}`;
}

/**
 * The legs the Method column names (owner decision 2026-10-16): the legs
 * that carried the row's MAIN money — in on a row whose money comes in (what
 * the customer paid with), out on a payout (how it left). That excludes
 * change handed back on a sale (an out leg on an in row) and a fee collected
 * on a receive (an in leg on an out row).
 *
 * The direction is the summary badge's own (`getRowCashFlowDirection`, the
 * ↓/↑ arrow — void/refund flips included), never re-derived here. When the
 * badge says "both" only because the row's legs go both ways (a fee-on-top
 * receive), the same function asked WITHOUT the legs gives the principal's
 * direction (a receive → out). A type that is "both" by nature (exchange,
 * drawer transfer) stays "both" and keeps the previous rule.
 *
 * The legs carry no fee/change marker of their own (`TransactionPaymentLeg`
 * has only direction, method, amount, currency, drawer), so the direction
 * is the only signal: a fee paid in the SAME direction as the principal
 * would still be named — none of today's flows does that.
 *
 * `sessionId` is set when the row has no legs in its direction but belongs
 * to a customer session — its money was paid at the session checkout.
 */
export function methodColumnLegs(row: TransactionRow): {
  legs: TransactionPaymentLeg[];
  sessionId: number | null;
} {
  if (row.type === "CHECKPOINT") return { legs: [], sessionId: null };
  const all = methodLegsFor(row);
  let direction = getRowCashFlowDirection(row);
  if (direction === "both") {
    const principal = getRowCashFlowDirection({ ...row, payments: undefined });
    if (principal === "in" || principal === "out") direction = principal;
  }
  const mine =
    direction === "in" || direction === "out"
      ? all.filter((l) => l.direction === direction)
      : all;
  if (mine.length > 0) return { legs: mine, sessionId: null };
  if (row.session_id != null) return { legs: [], sessionId: row.session_id };
  // No legs in the row's direction and no session: the previous rule.
  return { legs: all, sessionId: null };
}

/** The Method column's text — screen cell, export and sort. "—" for a
 *  checkpoint (it moves no customer money). */
export function methodText(
  row: TransactionRow,
  methodLabelByCode: Map<string, string>,
): string {
  if (row.type === "CHECKPOINT") return "—";
  const { legs, sessionId } = methodColumnLegs(row);
  if (sessionId !== null) return `Session #${sessionId}`;
  return formatPaymentMethods(legs, methodLabelByCode);
}

/** The Whish/OMT icon in front of the Method text (null = no icon) — from
 *  the same legs as the text. */
export function methodBrand(row: TransactionRow): ProviderBrandKey | null {
  return paymentMethodsBrand(methodColumnLegs(row).legs);
}

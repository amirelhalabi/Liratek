/**
 * What the Transactions Excel/PDF export adds about each transaction (owner
 * decision 2026-10-16), always included:
 *
 *  - a "Details" text per row — one readable line;
 *  - a "Details" sheet — one row per saved field;
 *  - a "Payments" sheet — one row per payment line, change returned, kept
 *    change and the session that paid.
 *
 * All three come from `buildTransactionDetailsView`, the Details panel's own
 * derivation (rule 14), so the export shows exactly what the panel shows —
 * cost / profit / commission fields only when `isAdmin` (its `isCostKey`).
 * The Status / Reverses / Returned credits facts (no longer table columns)
 * come from `rowBadges`, the same as the table's tags and the panel.
 *
 * Pure: rows in, strings out.
 */
import type { ExportSheet } from "@liratek/ui";
import type { TransactionRow } from "./hooks/useTransactionRows";
import {
  buildTransactionDetailsView,
  readableTitle,
  type DetailRow,
  type TransactionDetailsView,
} from "./transactionDetailsView";
import {
  hasReturnedCredits,
  returnedCreditsText,
  reversedTransactionId,
  rowStatusText,
} from "./rowBadges";
import { fullTimeText } from "./transactionCellText";
import { getTypeLabel } from "./transactionDisplay";

export interface ExportContext {
  isAdmin: boolean;
  /** Payment-method code → label, as the panel gets it. */
  methodLabel: (code: string) => string;
}

type Section = "Transaction" | "Details" | "Other saved data";

interface FieldRow {
  section: Section;
  field: string;
  value: string;
}

/** "Items" → "Item", "Parts" → "Part"; anything else as it is. */
function singular(label: string): string {
  return /[^s]s$/.test(label) ? label.slice(0, -1) : label;
}

/** The panel's rows as flat "field: value" pairs. A group's fields are
 *  prefixed with its label; a list of items gives one field per item per
 *  column ("Item 1 · IMEI"). */
function flatten(
  rows: DetailRow[],
  prefix = "",
): { field: string; value: string }[] {
  const out: { field: string; value: string }[] = [];
  for (const r of rows) {
    const name = `${prefix}${r.label}`;
    const v = r.value;
    if (v.kind === "text") {
      out.push({ field: name, value: v.text });
    } else if (v.kind === "group") {
      out.push(...flatten(v.rows, `${name} · `));
    } else {
      v.rows.forEach((cells, i) => {
        cells.forEach((cell, j) => {
          const column = v.columns[j];
          if (cell === "" || !column) return;
          out.push({
            field: `${prefix}${singular(r.label)} ${i + 1} · ${column.label}`,
            value: cell,
          });
        });
      });
    }
  }
  return out;
}

/** Status (when not active), Reverses, Returned credits — only when they
 *  apply. */
function transactionFacts(row: TransactionRow): FieldRow[] {
  const facts: FieldRow[] = [];
  const status = rowStatusText(row);
  if (status !== "Active") {
    facts.push({ section: "Transaction", field: "Status", value: status });
  }
  const reverses = reversedTransactionId(row);
  if (reverses) {
    facts.push({
      section: "Transaction",
      field: "Reverses",
      value: `#${reverses}`,
    });
  }
  if (hasReturnedCredits(row)) {
    facts.push({
      section: "Transaction",
      field: "Returned credits",
      value: returnedCreditsText(row.returned_credits_usd),
    });
  }
  return facts;
}

function viewOf(
  row: TransactionRow,
  ctx: ExportContext,
): TransactionDetailsView {
  return buildTransactionDetailsView(row.metadata_json, {
    isAdmin: ctx.isAdmin,
    methodLabel: ctx.methodLabel,
    row,
  });
}

function fieldRows(row: TransactionRow, ctx: ExportContext): FieldRow[] {
  const view = viewOf(row, ctx);
  return [
    ...transactionFacts(row),
    ...flatten(view.details).map((f) => ({
      section: "Details" as const,
      ...f,
    })),
    ...flatten(view.other).map((f) => ({
      section: "Other saved data" as const,
      ...f,
    })),
  ];
}

/** "Service type: Cash to business · Reference: R-123 · …"; "" when the
 *  row has nothing. Payments are on their own sheet, not in this line. */
export function detailsLineText(
  row: TransactionRow,
  ctx: ExportContext,
): string {
  return fieldRows(row, ctx)
    .map((f) => `${f.field}: ${f.value}`)
    .join(" · ");
}

function rowKey(row: TransactionRow): string[] {
  return [String(row.id), fullTimeText(row), readableTitle(getTypeLabel(row))];
}

export const DETAILS_SHEET_HEADERS = [
  "Txn #",
  "Time",
  "Type",
  "Section",
  "Field",
  "Value",
];

export function detailsSheetRows(
  rows: TransactionRow[],
  ctx: ExportContext,
): string[][] {
  return rows.flatMap((row) => {
    const key = rowKey(row);
    return fieldRows(row, ctx).map((f) => [
      ...key,
      f.section,
      f.field,
      f.value,
    ]);
  });
}

export const PAYMENTS_SHEET_HEADERS = [
  "Txn #",
  "Time",
  "Type",
  "Kind",
  "In/Out",
  "Method",
  "Currency",
  "Amount",
  "Note",
];

export function paymentsSheetRows(
  rows: TransactionRow[],
  ctx: ExportContext,
): string[][] {
  return rows.flatMap((row) => {
    const payment = viewOf(row, ctx).payment;
    if (!payment) return [];
    const key = rowKey(row);
    return [
      ...payment.lines.map((l) => [
        // A void/refund's own legs (it saves no snapshot).
        payment.reversal ? "reversal" : "line",
        l.direction,
        l.method,
        l.currency,
        l.amount,
        l.note ?? "",
      ]),
      ...payment.changeItems.map((c) => [
        // On a payout the change came back IN to the shop.
        payment.changeLabel.toLowerCase(),
        payment.changeLabel === "Change received" ? "In" : "Out",
        c.method,
        c.currency,
        c.amount,
        "",
      ]),
      ...payment.keptItems.map((k) => [
        payment.keptLabel === "Change kept by them" ? "kept by them" : "kept",
        "",
        "",
        k.currency,
        k.amount,
        "",
      ]),
      ...(payment.sessionId !== null
        ? [["paid in session", "", "", "", "", `Session #${payment.sessionId}`]]
        : []),
    ].map((cells) => [...key, ...cells]);
  });
}

/** The two extra Excel sheets, for the exported rows in their order. */
export function transactionExtraSheets(
  rows: TransactionRow[],
  ctx: ExportContext,
): ExportSheet[] {
  return [
    {
      name: "Details",
      headers: DETAILS_SHEET_HEADERS,
      rows: detailsSheetRows(rows, ctx),
    },
    {
      name: "Payments",
      headers: PAYMENTS_SHEET_HEADERS,
      rows: paymentsSheetRows(rows, ctx),
    },
  ];
}

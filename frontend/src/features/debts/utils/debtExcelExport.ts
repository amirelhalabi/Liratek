import * as XLSX from "xlsx";
import type { DebtLedgerEntity } from "@liratek/ui";
import { parseDbDate } from "@/shared/utils/parseDbDate";

/**
 * Ledger types shown on the Payments (right) side of a client's account —
 * everything else is a Purchase (left side). One definition, shared by the
 * Debts page's two history tables and the Excel export, so the file always
 * splits rows exactly the way the screen does.
 *
 * CREDIT_DEPOSIT reduces what the client owes (or raises the shop's debt to
 * the client) → payment side. CREDIT_USED charges against credit → purchase.
 */
export const PAYMENT_LEDGER_TYPES: ReadonlySet<string> = new Set([
  "Repayment",
  "CREDIT_DEPOSIT",
]);

export function isPaymentLedgerType(type: string): boolean {
  return PAYMENT_LEDGER_TYPES.has(type);
}

export interface DebtExportClient {
  name: string;
  phone: string;
  history: DebtLedgerEntity[];
}

/** Sheet names the import skips or treats specially — never reuse them. */
const RESERVED_SHEET_NAMES = new Set(["list name", "sheet1", "sheet2"]);
const MAX_SHEET_NAME = 31;

/** Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 chars. */
function sheetNameFor(raw: string, used: Set<string>): string {
  const base =
    raw
      .replace(/[:\\/?*[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      // The import skips every sheet starting "NAME (".
      .replace(/^NAME \(/i, "NAME-(")
      .slice(0, MAX_SHEET_NAME)
      .trim() || "Client";
  let name = base;
  for (let n = 2; ; n++) {
    const key = name.toLowerCase();
    if (!used.has(key) && !RESERVED_SHEET_NAMES.has(key)) break;
    const suffix = ` (${n})`;
    name = base.slice(0, MAX_SHEET_NAME - suffix.length).trimEnd() + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

function ledgerTypeLabel(type: string): string {
  if (type === "CREDIT_DEPOSIT") return "Credit Deposit";
  if (type === "CREDIT_USED") return "Credit Used";
  if (type === "Repayment" || type === "Sale Debt") return "";
  return type;
}

function describe(entry: DebtLedgerEntity): string {
  const parts = [ledgerTypeLabel(entry.transaction_type), entry.note ?? ""]
    .map((s) => s.trim())
    .filter(Boolean);
  let text = parts.join(" — ");
  if (entry.is_refunded) text = text ? `${text} (refunded)` : "(refunded)";
  return text;
}

/** Day-only date cell (time dropped), shown as dd/mm/yyyy like the template. */
function dateCell(createdAt: string): XLSX.CellObject {
  const d = parseDbDate(createdAt);
  const day = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  return { t: "d", v: day, z: "dd/mm/yyyy" };
}

function numCell(value: number): XLSX.CellObject | null {
  return value ? { t: "n", v: value } : null;
}

function sumCell(
  col: string,
  firstRow: number,
  lastRow: number,
  value: number,
): XLSX.CellObject {
  // `v` carries the computed total so viewers that don't recalculate still
  // show it; the formula keeps it live when the owner edits the sheet.
  return lastRow >= firstRow
    ? { t: "n", f: `SUM(${col}${firstRow}:${col}${lastRow})`, v: value }
    : { t: "n", v: 0 };
}

function byDateAsc(a: DebtLedgerEntity, b: DebtLedgerEntity): number {
  return (
    parseDbDate(a.created_at).getTime() - parseDbDate(b.created_at).getTime() ||
    a.id - b.id
  );
}

/**
 * One client's page, in the same layout the Excel import reads:
 *   row 1  CUSTOMER NAME : | <name> | mobile # | <phone>
 *   row 2  DATE | USD | LBP | DESCRIPTION | | DATE | PAID IN USD | PAID IN LBP | DESCRIPTION
 *   rows   purchases on the left, payments on the right, oldest first
 *   then   TOTAL ON ACCOUNT / TOTAL PAID and Balance Remaining in USD / LBP
 *
 * Payments are written as positive amounts (the ledger stores them negative),
 * so Balance Remaining = total on account − total paid = the ledger's sum,
 * i.e. the same balance the Debts page shows.
 */
function buildClientSheet(client: DebtExportClient): XLSX.WorkSheet {
  const debts = client.history
    .filter((e) => !isPaymentLedgerType(e.transaction_type))
    .sort(byDateAsc);
  const payments = client.history
    .filter((e) => isPaymentLedgerType(e.transaction_type))
    .sort(byDateAsc);

  const rows: (XLSX.CellObject | string | null)[][] = [
    ["CUSTOMER NAME :", client.name, "mobile # ", client.phone],
    [
      "DATE",
      "USD",
      "LBP",
      "DESCRIPTION",
      null,
      "DATE",
      "PAID IN USD",
      "PAID IN LBP",
      "DESCRIPTION",
    ],
  ];

  const count = Math.max(debts.length, payments.length);
  for (let i = 0; i < count; i++) {
    const d = debts[i];
    const p = payments[i];
    rows.push([
      d ? dateCell(d.created_at) : null,
      d ? numCell(d.amount_usd) : null,
      d ? numCell(d.amount_lbp) : null,
      d ? describe(d) : null,
      null,
      p ? dateCell(p.created_at) : null,
      p ? numCell(-p.amount_usd) : null,
      p ? numCell(-p.amount_lbp) : null,
      p ? describe(p) : null,
    ]);
  }

  const sum = (list: DebtLedgerEntity[], key: "amount_usd" | "amount_lbp") =>
    list.reduce((s, e) => s + e[key], 0);
  const onAccountUsd = sum(debts, "amount_usd");
  const onAccountLbp = sum(debts, "amount_lbp");
  const paidUsd = -sum(payments, "amount_usd");
  const paidLbp = -sum(payments, "amount_lbp");

  const firstDataRow = 3; // 1-based Excel rows
  const lastDataRow = firstDataRow + count - 1;
  const totalRow = lastDataRow + 2;

  rows.push([]);
  rows.push([
    "TOTAL ON ACCOUNT",
    sumCell("B", firstDataRow, lastDataRow, onAccountUsd),
    sumCell("C", firstDataRow, lastDataRow, onAccountLbp),
    null,
    null,
    "TOTAL PAID",
    sumCell("G", firstDataRow, lastDataRow, paidUsd),
    sumCell("H", firstDataRow, lastDataRow, paidLbp),
  ]);
  rows.push([]);
  rows.push([
    null,
    null,
    null,
    "Balance Remaining in USD",
    { t: "n", f: `B${totalRow}-G${totalRow}`, v: onAccountUsd - paidUsd },
  ]);
  rows.push([]);
  rows.push([
    null,
    null,
    null,
    "Balance Remaining in LBP",
    { t: "n", f: `C${totalRow}-H${totalRow}`, v: onAccountLbp - paidLbp },
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 18 },
    { wch: 12 },
    { wch: 14 },
    { wch: 32 },
    { wch: 4 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 32 },
  ];
  return ws;
}

/**
 * The whole accounts workbook in the import template: a "List Name" sheet
 * (NAME | Phone, one row per client) followed by one sheet per client.
 */
export function buildDebtExportWorkbook(
  clients: DebtExportClient[],
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const list = XLSX.utils.aoa_to_sheet([
    ["NAME", "Phone "],
    ...clients.map((c) => [c.name, c.phone]),
  ]);
  list["!cols"] = [{ wch: 36 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, list, "List Name");

  const used = new Set<string>();
  for (const client of clients) {
    XLSX.utils.book_append_sheet(
      wb,
      buildClientSheet(client),
      sheetNameFor(client.name, used),
    );
  }
  return wb;
}

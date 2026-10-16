import * as XLSX from "xlsx";
import type { ApiAdapter, DebtLedgerEntity } from "@liratek/ui";
import { parseDbDate } from "@/shared/utils/parseDbDate";

/**
 * Ledger types shown on the Payments (right) side of a client's account on
 * the Debts page — everything else is a Purchase (left side). One definition
 * for the page's two history tables. (The Excel export splits by sign
 * instead — see `buildClientSheet` — because the import only reads amounts
 * above zero.)
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

/**
 * Custom document property our export stamps on the workbook. The import
 * trusts a file's dates only when it carries this marker: the shop's old
 * handwritten ledgers hold mistyped dates, so for them every row keeps the
 * "yesterday" stamp it has always had.
 */
export const EXPORT_MARKER_PROP = "LiraTekAccountsExport";
export const EXPORT_MARKER_VERSION = "1";

export function isLiraTekAccountsExport(wb: XLSX.WorkBook): boolean {
  const props = wb.Custprops as Record<string, unknown> | undefined;
  return props?.[EXPORT_MARKER_PROP] === EXPORT_MARKER_VERSION;
}

/**
 * The real time of an exported row, as an ISO string for the import, or null
 * when the cell holds no usable date. Excel stores times as fractions of a
 * day, so they come back a millisecond off — rounded to the second here,
 * which keeps the import's same-row duplicate check exact.
 */
export function exportedRowDate(cell: unknown): string | null {
  if (!(cell instanceof Date) || Number.isNaN(cell.getTime())) return null;
  return new Date(Math.round(cell.getTime() / 1000) * 1000).toISOString();
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
  // Imported rows: the label would be re-imported into the note each round.
  if (type === "Repayment" || type === "Sale Debt" || type === "Imported Debt")
    return "";
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

/**
 * Shown as dd/mm/yyyy like the template, but the cell keeps the full time so
 * an import of this file restores each row exactly.
 */
function dateCell(createdAt: string): XLSX.CellObject {
  return { t: "d", v: parseDbDate(createdAt), z: "dd/mm/yyyy" };
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

/** One side of one ledger row, amounts always ≥ 0. */
interface SideRow {
  entry: DebtLedgerEntity;
  usd: number;
  lbp: number;
}

function byDateAsc(a: SideRow, b: SideRow): number {
  return (
    parseDbDate(a.entry.created_at).getTime() -
      parseDbDate(b.entry.created_at).getTime() || a.entry.id - b.entry.id
  );
}

/**
 * Split by SIGN, per currency: what adds to the balance goes on the left,
 * what takes from it goes on the right as a positive amount. A refund or
 * reversal (negative purchase) therefore shows as money back on the paid
 * side — the import reads only amounts above zero, so a negative left-side
 * figure would be dropped and the imported balance would be wrong.
 */
function splitBySign(history: DebtLedgerEntity[]): {
  left: SideRow[];
  right: SideRow[];
} {
  const left: SideRow[] = [];
  const right: SideRow[] = [];
  for (const entry of history) {
    const up = {
      usd: Math.max(entry.amount_usd, 0),
      lbp: Math.max(entry.amount_lbp, 0),
    };
    const down = {
      usd: Math.max(-entry.amount_usd, 0),
      lbp: Math.max(-entry.amount_lbp, 0),
    };
    if (up.usd || up.lbp) left.push({ entry, ...up });
    if (down.usd || down.lbp) right.push({ entry, ...down });
  }
  return { left: left.sort(byDateAsc), right: right.sort(byDateAsc) };
}

/**
 * One client's page, in the same layout the Excel import reads:
 *   row 1  CUSTOMER NAME : | <name> | mobile # | <phone>
 *   row 2  DATE | USD | LBP | DESCRIPTION | | DATE | PAID IN USD | PAID IN LBP | DESCRIPTION
 *   rows   purchases on the left, payments on the right, oldest first
 *   then   TOTAL ON ACCOUNT / TOTAL PAID and Balance Remaining in USD / LBP
 *
 * Every amount is written positive (see `splitBySign`), so Balance Remaining
 * = total on account − total paid = the ledger's sum, i.e. the same balance
 * the Debts page shows.
 */
function buildClientSheet(client: DebtExportClient): XLSX.WorkSheet {
  const { left: debts, right: payments } = splitBySign(client.history);

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
      d ? dateCell(d.entry.created_at) : null,
      d ? numCell(d.usd) : null,
      d ? numCell(d.lbp) : null,
      d ? describe(d.entry) : null,
      null,
      p ? dateCell(p.entry.created_at) : null,
      p ? numCell(p.usd) : null,
      p ? numCell(p.lbp) : null,
      p ? describe(p.entry) : null,
    ]);
  }

  const sum = (list: SideRow[], key: "usd" | "lbp") =>
    list.reduce((s, r) => s + r[key], 0);
  const onAccountUsd = sum(debts, "usd");
  const onAccountLbp = sum(debts, "lbp");
  const paidUsd = sum(payments, "usd");
  const paidLbp = sum(payments, "lbp");

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
  wb.Custprops = { [EXPORT_MARKER_PROP]: EXPORT_MARKER_VERSION };

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

/** What the same-shop check needs from one parsed client page. */
export interface ImportedPageForShopCheck {
  phone: string;
  entries: {
    amount_usd: number;
    amount_lbp: number;
    type: "debt" | "payment";
  }[];
}

/** What the same-shop check needs from this shop's account list. */
export interface ShopBalanceForShopCheck {
  phone_number: string | null;
  total_debt_usd: number;
  total_debt_lbp: number;
}

const digitsOnly = (raw: string | null | undefined) =>
  String(raw ?? "").replace(/\D/g, "");

/**
 * True when importing this exported file here would add balances the shop
 * already holds — i.e. it is being imported back into the shop it came from
 * (or one that already received it). The import writes new "Imported Debt"
 * rows that never match the shop's original rows, so going ahead would double
 * every one of those clients' balances.
 *
 * Test: of the file's clients with a non-zero balance, at least half are
 * found here by phone with the SAME balance in both currencies. A genuinely
 * new shop matches none. A shop that moved on since the export (a few
 * clients paid or bought more) still matches most of them.
 */
export function looksLikeSameShop(
  pages: ImportedPageForShopCheck[],
  shopBalances: ShopBalanceForShopCheck[],
): boolean {
  const byPhone = new Map<string, ShopBalanceForShopCheck>();
  for (const b of shopBalances) {
    const phone = digitsOnly(b.phone_number);
    if (phone) byPhone.set(phone, b);
  }

  let withBalance = 0;
  let matching = 0;
  for (const page of pages) {
    let usd = 0;
    let lbp = 0;
    for (const e of page.entries) {
      const sign = e.type === "payment" ? -1 : 1;
      usd += sign * e.amount_usd;
      lbp += sign * e.amount_lbp;
    }
    if (Math.abs(usd) < 0.005 && Math.abs(lbp) < 0.5) continue;
    withBalance++;
    const here = byPhone.get(digitsOnly(page.phone));
    if (
      here &&
      Math.abs(here.total_debt_usd - usd) < 0.005 &&
      Math.abs(here.total_debt_lbp - lbp) < 0.5
    ) {
      matching++;
    }
  }
  return matching > 0 && matching * 2 >= withBalance;
}

/**
 * Every client with account history and that history, ready for
 * `buildDebtExportWorkbook`, sorted by name.
 */
export async function loadAccountsForExport(
  api: Pick<ApiAdapter, "getDebtors" | "getAllDebtHistory">,
): Promise<DebtExportClient[]> {
  // TWO requests for the whole shop. One history request per client made
  // ~400 web requests for a real shop, past the API's per-user rate limit.
  const [allDebtors, allHistory] = await Promise.all([
    api.getDebtors(),
    api.getAllDebtHistory(),
  ]);
  const byClient = new Map<number, DebtLedgerEntity[]>();
  for (const row of allHistory ?? []) {
    const list = byClient.get(row.client_id);
    if (list) list.push(row);
    else byClient.set(row.client_id, [row]);
  }
  return allDebtors
    .map((d) => ({
      name: d.full_name,
      phone: d.phone_number ?? "",
      history: byClient.get(d.id) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

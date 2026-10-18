/**
 * LIRA-330 — the Accounts Excel export, built to work like the shop's own
 * debt workbook (the file the Excel import was made for), so the shop can
 * keep working on an exported file exactly as on its own:
 *
 *  - every client page keeps SPARE_ROWS empty rows INSIDE its totals, so a
 *    line typed later is counted by TOTAL ON ACCOUNT / TOTAL PAID and by the
 *    Balance Remaining formulas;
 *  - the same look: Calibri 16, grey labels, thin borders, yellow totals,
 *    $ and LBP accounting formats, the short-date format, merged balances,
 *    the same column widths;
 *  - the List Name sheet links each name to its page and shows each client's
 *    balance as a live formula pointing at that page.
 *
 * Written with `xlsx-js-style` (SheetJS plus cell styles — the free SheetJS
 * cannot write borders or fills). Loaded only when the owner exports, so the
 * Accounts page itself does not carry it.
 */
import * as XLSX from "xlsx-js-style";
import type { CellObject, CellStyle, WorkBook, WorkSheet } from "xlsx-js-style";
import type { TFunction } from "i18next";
import type { DebtLedgerEntity } from "@liratek/ui";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import {
  EXPORT_MARKER_PROP,
  EXPORT_MARKER_VERSION,
  type DebtExportClient,
} from "./debtExcelExport";

/**
 * Empty rows left inside each page's totals for lines added by hand later.
 * The shop's own pages leave 4 to 16 (15 most often).
 */
export const SPARE_ROWS = 20;

/** The first sheet: every client's name and phone (read by the import). */
const LIST_SHEET = "List Name";

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

/** `'Sheet name'` as Excel writes it in a reference (any ' doubled). */
function quoteSheet(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

// ── Look (taken from the shop's own workbook) ────────────────────────────

const USD_FORMAT =
  '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)';
const LBP_FORMAT =
  '_([$LBP]\\ * #,##0.00_);_([$LBP]\\ * \\(#,##0.00\\);_([$LBP]\\ * "-"??_);_(@_)';
/** Excel's built-in short date (format 14): shown in the PC's own date order. */
const DATE_FORMAT = "m/d/yy";

const THIN = { style: "thin", color: { rgb: "000000" } } as const;
const BOX = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const FONT = { name: "Calibri", sz: 16 };
const SMALL_FONT = { name: "Calibri", sz: 11 };
const GREY = { patternType: "solid", fgColor: { rgb: "BFBFBF" } } as const;
const YELLOW = { patternType: "solid", fgColor: { rgb: "FFFF00" } } as const;
const LIGHT_BLUE = {
  patternType: "solid",
  fgColor: { rgb: "D9E1F2" },
} as const;
const LINK_FONT = { ...FONT, color: { rgb: "0070C0" }, underline: true };
const CENTER = { horizontal: "center", vertical: "center" } as const;

const S = {
  label: { font: FONT, fill: GREY, border: BOX, alignment: CENTER },
  value: { font: FONT, alignment: CENTER },
  date: { font: FONT, border: BOX, alignment: CENTER, numFmt: DATE_FORMAT },
  usd: { font: FONT, border: BOX, alignment: CENTER, numFmt: USD_FORMAT },
  lbp: { font: FONT, border: BOX, alignment: CENTER, numFmt: LBP_FORMAT },
  descLeft: { font: FONT, border: BOX },
  descRight: { font: SMALL_FONT, border: BOX },
  total: { font: FONT, fill: YELLOW, border: BOX, alignment: CENTER },
  balanceUsd: {
    font: FONT,
    fill: YELLOW,
    border: BOX,
    alignment: CENTER,
    numFmt: USD_FORMAT,
  },
  balanceLbp: {
    font: FONT,
    fill: YELLOW,
    border: BOX,
    alignment: CENTER,
    numFmt: LBP_FORMAT,
  },
  link: { font: LINK_FONT },
  listHeader: {
    font: { ...FONT, bold: true, color: { rgb: "0070C0" } },
    fill: LIGHT_BLUE,
    border: BOX,
    alignment: CENTER,
  },
  listName: { font: LINK_FONT, border: BOX, alignment: CENTER },
  listPhone: { font: FONT, border: BOX, alignment: CENTER },
  listUsd: { font: FONT, border: BOX, alignment: CENTER, numFmt: USD_FORMAT },
  listLbp: { font: FONT, border: BOX, alignment: CENTER, numFmt: LBP_FORMAT },
} satisfies Record<string, CellStyle>;

type Cell = CellObject | null;

const text = (v: string, s: CellStyle): CellObject => ({ t: "s", v, s });
/** An empty cell that still carries the border/format of its column. */
const blank = (s: CellStyle): CellObject => ({ t: "s", v: "", s });
const num = (v: number, s: CellStyle): CellObject =>
  v ? { t: "n", v, s } : blank(s);
const formula = (f: string, v: number, s: CellStyle): CellObject => ({
  t: "n",
  f,
  v,
  s,
});

/** A text cell that jumps to cell A1 of another sheet in the same workbook. */
function linkToSheet(
  label: string,
  sheetName: string,
  s: CellStyle,
): CellObject {
  return {
    t: "s",
    v: label,
    l: { Target: `#${quoteSheet(sheetName)}!A1` },
    s,
  };
}

// ── Content ──────────────────────────────────────────────────────────────

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
  let out = parts.join(" — ");
  if (entry.is_refunded) out = out ? `${out} (refunded)` : "(refunded)";
  return out;
}

/** The full time stays in the cell so an import of this file restores it. */
function dateCell(createdAt: string): CellObject {
  return { t: "d", v: parseDbDate(createdAt), s: S.date };
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
      lbp: Math.max(entry.amount_lbp ?? 0, 0),
    };
    const down = {
      usd: Math.max(-entry.amount_usd, 0),
      lbp: Math.max(-(entry.amount_lbp ?? 0), 0),
    };
    if (up.usd || up.lbp) left.push({ entry, ...up });
    if (down.usd || down.lbp) right.push({ entry, ...down });
  }
  return { left: left.sort(byDateAsc), right: right.sort(byDateAsc) };
}

// ── Headings (LIRA-331) ──────────────────────────────────────────────────

/**
 * LIRA-331 (FR-024): the cosmetic headings of a client page, in the
 * exporting user's language. The import never reads these cells (it starts
 * at row 3 and only looks at dates and amounts). What it DOES read stays
 * English and is not part of this set: the "List Name" sheet and its "NAME"
 * header, and the "TOTAL ON ACCOUNT" / "TOTAL PAID" markers it uses to skip
 * the footer. Row descriptions are re-imported as notes, so they stay as
 * stored too.
 */
export interface DebtExportHeadings {
  customerName: string;
  mobile: string;
  date: string;
  usd: string;
  lbp: string;
  description: string;
  paidUsd: string;
  paidLbp: string;
  balanceUsd: string;
  balanceLbp: string;
  /** Link text on each client page back to the List Name sheet. */
  backToList: string;
}

/** The headings of the template the import was built from. */
export const ENGLISH_EXPORT_HEADINGS: DebtExportHeadings = {
  customerName: "CUSTOMER NAME :",
  mobile: "mobile # ",
  date: "DATE",
  usd: "USD",
  lbp: "LBP",
  description: "DESCRIPTION", // i18n-exempt: English template default
  paidUsd: "PAID IN USD",
  paidLbp: "PAID IN LBP",
  balanceUsd: "Balance Remaining in USD",
  balanceLbp: "Balance Remaining in LBP",
  backToList: "← Back to list",
};

/** The headings from the `debts` catalog — what the Accounts page passes. */
export function debtExportHeadings(t: TFunction<"debts">): DebtExportHeadings {
  return {
    customerName: t("export.customerName"),
    mobile: t("export.mobile"),
    date: t("export.date"),
    usd: t("export.usd"),
    lbp: t("export.lbp"),
    description: t("export.description"),
    paidUsd: t("export.paidUsd"),
    paidLbp: t("export.paidLbp"),
    balanceUsd: t("export.balanceUsd"),
    balanceLbp: t("export.balanceLbp"),
    backToList: t("export.backToList"),
  };
}

/** Footer markers the import skips by text ("total") — never translated. */
const TOTAL_ON_ACCOUNT = "TOTAL ON ACCOUNT"; // i18n-exempt: import marker
const TOTAL_PAID = "TOTAL PAID"; // i18n-exempt: import marker

// ── Client page ──────────────────────────────────────────────────────────

/** Where a built page put its balances, for the List Name formulas. */
interface PageLayout {
  balanceUsdRow: number;
  balanceLbpRow: number;
  balanceUsd: number;
  balanceLbp: number;
}

/**
 * One client's page, in the layout the Excel import reads and the shop's own
 * workbook uses:
 *   row 1   CUSTOMER NAME : | <name> | mobile # | <phone> | | ← Back to list
 *   row 2   DATE | USD | LBP | DESCRIPTION | | DATE | PAID IN USD | PAID IN LBP | DESCRIPTION
 *   rows    purchases left, payments right, oldest first, then SPARE_ROWS
 *           empty bordered rows — all inside the totals
 *   then    TOTAL ON ACCOUNT / TOTAL PAID (SUM over every row above),
 *           and 7 / 9 rows lower Balance Remaining in USD / LBP (E:F merged)
 *
 * Every amount is written positive (see `splitBySign`), so Balance Remaining
 * = total on account − total paid = the ledger's sum, i.e. the same balance
 * the Debts page shows.
 */
function buildClientSheet(
  client: DebtExportClient,
  h: DebtExportHeadings,
): { ws: WorkSheet; layout: PageLayout } {
  const { left: debts, right: payments } = splitBySign(client.history);

  const rows: Cell[][] = [
    // F1 links back to the list; the import reads only B1 and D1 here.
    [
      text(h.customerName, S.label),
      text(client.name, S.value),
      text(h.mobile, S.label),
      text(client.phone, S.value),
      null,
      linkToSheet(h.backToList, LIST_SHEET, S.link),
    ],
    [
      text(h.date, S.label),
      text(h.usd, S.label),
      text(h.lbp, S.label),
      text(h.description, S.label),
      null,
      text(h.date, S.label),
      text(h.paidUsd, S.label),
      text(h.paidLbp, S.label),
      text(h.description, S.label),
    ],
  ];

  const count = Math.max(debts.length, payments.length);
  for (let i = 0; i < count + SPARE_ROWS; i++) {
    const d = debts[i];
    const p = payments[i];
    rows.push([
      d ? dateCell(d.entry.created_at) : blank(S.date),
      d ? num(d.usd, S.usd) : blank(S.usd),
      d ? num(d.lbp, S.lbp) : blank(S.lbp),
      d ? text(describe(d.entry), S.descLeft) : blank(S.descLeft),
      null,
      p ? dateCell(p.entry.created_at) : blank(S.date),
      p ? num(p.usd, S.usd) : blank(S.usd),
      p ? num(p.lbp, S.lbp) : blank(S.lbp),
      p ? text(describe(p.entry), S.descRight) : blank(S.descRight),
    ]);
  }

  const sum = (list: SideRow[], key: "usd" | "lbp") =>
    list.reduce((s, r) => s + r[key], 0);
  const onAccountUsd = sum(debts, "usd");
  const onAccountLbp = sum(debts, "lbp");
  const paidUsd = sum(payments, "usd");
  const paidLbp = sum(payments, "lbp");

  const first = 3; // 1-based Excel rows
  const last = first + count + SPARE_ROWS - 1; // spare rows included
  const totalRow = last + 1;
  const balanceUsdRow = totalRow + 7;
  const balanceLbpRow = totalRow + 9;
  // `v` carries the computed value so viewers that don't recalculate still
  // show it; the formula keeps it live when the shop edits the page.
  const range = (col: string) => `SUM(${col}${first}:${col}${last})`;

  rows.push([
    text(TOTAL_ON_ACCOUNT, S.total),
    formula(range("B"), onAccountUsd, S.usd),
    formula(range("C"), onAccountLbp, S.lbp),
    null,
    null,
    text(TOTAL_PAID, S.total),
    formula(range("G"), paidUsd, S.usd),
    formula(range("H"), paidLbp, S.lbp),
  ]);
  while (rows.length < balanceUsdRow - 1) rows.push([]);
  rows.push([
    null,
    null,
    null,
    text(h.balanceUsd, S.label),
    formula(`B${totalRow}-G${totalRow}`, onAccountUsd - paidUsd, S.balanceUsd),
    blank(S.balanceUsd),
  ]);
  rows.push([]);
  rows.push([
    null,
    null,
    null,
    text(h.balanceLbp, S.label),
    formula(`C${totalRow}-H${totalRow}`, onAccountLbp - paidLbp, S.balanceLbp),
    blank(S.balanceLbp),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!merges"] = [balanceUsdRow, balanceLbpRow].map((r) => ({
    s: { r: r - 1, c: 4 },
    e: { r: r - 1, c: 5 },
  }));
  ws["!cols"] = [27.3, 33.7, 26.6, 34.7, 22.6, 27.3, 17, 24.9, 24].map(
    (wch) => ({ wch }),
  );
  return {
    ws,
    layout: {
      balanceUsdRow,
      balanceLbpRow,
      balanceUsd: onAccountUsd - paidUsd,
      balanceLbp: onAccountLbp - paidLbp,
    },
  };
}

// ── Workbook ─────────────────────────────────────────────────────────────

/**
 * The whole accounts workbook: a "List Name" sheet (NAME | Phone, each name
 * linking to its page, then the client's live balances) followed by one page
 * per client. `headings` are in the exporting user's language (default
 * English); numbers stay numeric cells either way.
 *
 * The import reads only columns A and B of List Name; the balance columns
 * are for the shop.
 */
export function buildDebtExportWorkbook(
  clients: DebtExportClient[],
  headings: DebtExportHeadings = ENGLISH_EXPORT_HEADINGS,
): WorkBook {
  const wb = XLSX.utils.book_new();
  wb.Custprops = { [EXPORT_MARKER_PROP]: EXPORT_MARKER_VERSION };

  const used = new Set<string>();
  const sheetNames = clients.map((c) => sheetNameFor(c.name, used));
  const pages = clients.map((c) => buildClientSheet(c, headings));

  const list = XLSX.utils.aoa_to_sheet([
    [
      text("NAME", S.listHeader),
      text("Phone ", S.listHeader),
      // English like NAME / Phone: List Name is the same in every language.
      text("Balance USD", S.listHeader), // i18n-exempt: List Name stays English
      text("Balance LBP", S.listHeader), // i18n-exempt: List Name stays English
    ],
    ...clients.map((c, i) => {
      const ref = quoteSheet(sheetNames[i]!);
      const { layout } = pages[i]!;
      return [
        // The cell text stays the plain name, so the import reads it as before.
        linkToSheet(c.name, sheetNames[i]!, S.listName),
        text(c.phone, S.listPhone),
        formula(
          `${ref}!E${layout.balanceUsdRow}`,
          layout.balanceUsd,
          S.listUsd,
        ),
        formula(
          `${ref}!E${layout.balanceLbpRow}`,
          layout.balanceLbp,
          S.listLbp,
        ),
      ];
    }),
  ]);
  list["!cols"] = [48.6, 31.9, 30.6, 30.6].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, list, LIST_SHEET);

  pages.forEach(({ ws }, i) =>
    XLSX.utils.book_append_sheet(wb, ws, sheetNames[i]),
  );
  return wb;
}

/** The .xlsx bytes, written by the styling library so the look survives. */
export function writeDebtExportFile(wb: WorkBook): ArrayBuffer {
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

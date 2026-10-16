/**
 * The Transactions page's export template (owner decisions 2026-10-16):
 *
 *  Excel — four sheets:
 *   - Summary: report header (shop, period, filters, exported by / at),
 *     money In / Out / Net per currency, and a By-type table;
 *   - Transactions: one row per transaction, In / Out per currency as real
 *     numbers (Excel can add them), status, key details; totals row;
 *   - Payments: one row per money line (paid, change, kept, reversal);
 *   - Details: one row per saved field (the Details panel's fields).
 *  PDF — a landscape report grouped by day with day totals; each
 *  transaction a bold line and a grey key-details line.
 *
 * In / Out = the row's OWN money legs (`row.payments`: what physically moved
 * through a drawer, summed per currency by the leg's direction), plus a
 * drawer top-up / cash-out's other-currency money (`extraCurrencyLegs`). A
 * customer-session basket's pooled legs count ONCE, on the member the
 * table itself picks to carry them (`computeSessionGroupHeaders`). It is
 * NOT the Amount column (the sale's value): a $823 sale paid $700 + LBP
 * shows the $700 and the LBP that came in and the change that went out.
 * Money that never enters a USD/LBP drawer (a customer's USDT / wallet
 * transfer, the EUR side of an exchange — `row.payments` holds USD/LBP
 * customer cash only) is not in these columns; the Payments sheet lists it
 * as "not in cash totals" and Key details names it.
 *
 * Costs (unit cost, commission, profit) follow the Details panel's own
 * rule — only for admins — because every detail here comes from
 * `buildTransactionDetailsView` (its `isCostKey`), never from raw metadata.
 */
import {
  computeSessionGroupHeaders,
  extraChargeText,
  extraCurrencyLegs,
  fallbackMethodLabel,
  type TransactionDetailsKind,
} from "@liratek/core";
import {
  exportFacts,
  exportTable,
  type ExportColumn,
  type ExportSheetSpec,
  type ExportTemplate,
  type PdfCell,
  type PdfItem,
  type PdfReport,
} from "@liratek/ui";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { getCurrencyDecimals } from "@/utils/currency";
import type { TransactionRow } from "../hooks/useTransactionRows";
import {
  getRowCashFlowDirection,
  type TransactionPaymentLeg,
} from "../cashFlow";
import {
  buildTransactionDetailsView,
  formatDetailMoney,
  readableTitle,
  type DetailRow,
  type TransactionDetailsView,
} from "../transactionDetailsView";
import { fieldRows, type ExportContext } from "../transactionExport";
import {
  hasReturnedCredits,
  returnedCreditsText,
  reversedTransactionId,
  rowStatus,
  rowStatusText,
} from "../rowBadges";
import { methodText } from "../transactionCellText";
import { displaySummary, getTypeLabel } from "../transactionDisplay";
import { amountCellText, deriveRow } from "../rowDerived";

export interface TransactionsExportOptions {
  isAdmin: boolean;
  methodLabelByCode: Map<string, string>;
  shopName?: string | undefined;
  /** Who is exporting (the signed-in user's name). */
  exportedBy: string;
  /** The page's filters, for the report header. */
  filters: { from: string; to: string; search: string; types: string[] };
}

/* ------------------------------------------------------------------ */
/*  Money per row                                                      */
/* ------------------------------------------------------------------ */

type Money = Record<string, number>;
export interface RowMoney {
  in: Money;
  out: Money;
}

function roundTo(value: number, currency: string): number {
  const f = 10 ** getCurrencyDecimals(currency);
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** The legs a row's money columns read: its own, its other-currency
 *  drawer move, and — on the session member carrying them — the basket's
 *  pooled legs. */
function moneyLegs(
  row: TransactionRow,
  pooled: TransactionPaymentLeg[] | null,
): TransactionPaymentLeg[] {
  if (row.type === "CHECKPOINT") return [];
  return [
    ...(row.payments ?? []),
    ...extraCurrencyLegs(row.type, row.metadata_json),
    ...(pooled ?? []),
  ];
}

/** Per currency: money in, money out (rounded to the currency). */
export function rowMoney(
  row: TransactionRow,
  pooled: TransactionPaymentLeg[] | null,
): RowMoney {
  const money: RowMoney = { in: {}, out: {} };
  for (const leg of moneyLegs(row, pooled)) {
    const side = leg.direction === "out" ? money.out : money.in;
    side[leg.currency_code] = (side[leg.currency_code] ?? 0) + leg.amount;
  }
  for (const side of [money.in, money.out]) {
    for (const c of Object.keys(side)) side[c] = roundTo(side[c]!, c);
  }
  return money;
}

/** USD, LBP, then any other currency in first-seen order. */
function currenciesOf(moneys: RowMoney[]): string[] {
  const seen = new Set<string>(["USD", "LBP"]);
  const extra: string[] = [];
  for (const m of moneys) {
    for (const c of [...Object.keys(m.in), ...Object.keys(m.out)]) {
      if (!seen.has(c)) {
        seen.add(c);
        extra.push(c);
      }
    }
  }
  return ["USD", "LBP", ...extra];
}

/** The row's principal direction — the table's ↓/↑ badge; a "both" badge
 *  caused only by a fee / change leg asks again without the legs (as the
 *  Method column does). */
function principalDirection(row: TransactionRow): "in" | "out" | null {
  let d = getRowCashFlowDirection(row);
  if (d === "both")
    d = getRowCashFlowDirection({ ...row, payments: undefined });
  return d === "in" || d === "out" ? d : null;
}

function isReversal(row: TransactionRow): boolean {
  return reversedTransactionId(row) !== null || row.type === "REFUND";
}

/* ------------------------------------------------------------------ */
/*  Key details                                                        */
/* ------------------------------------------------------------------ */

/**
 * The 2–4 fields that say what a transaction was, per details kind — keys
 * of the Details panel's rows. Exhaustive over core's kinds: a new kind is
 * a compile error until it is listed ([] = the fallback: the first three
 * non-empty fields).
 */
const KEY_FIELDS: Record<TransactionDetailsKind, readonly string[]> = {
  omt_whish_transfer: [
    "serviceType",
    "reference",
    "sender",
    "receiver",
    "partner",
  ],
  custom_service: ["description", "partner"],
  hold_money: ["action", "notes"],
  telecom_recharge: ["carrier", "type", "phone"],
  telecom_buyback: ["carrier", "credits", "phone"],
  catalog_sale: ["provider", "items"],
  provider_bill: ["provider", "amount"],
  wallet_transfer: ["provider", "direction", "counterparty"],
  crypto_transfer: ["direction", "amountUsdt", "walletOrReference"],
  wallet_topup: ["provider", "source"],
  wrong_number: ["wrongNumber", "rightNumber"],
  pos_sale: ["items"],
  maintenance_job: ["device", "status", "jobId"],
  warranty_claim: ["action", "notes"],
  exchange: [],
  loto_sale: ["saleAmount"],
  loto_prize: ["ticketNumber"],
  expense: ["category", "description"],
  account_entry: ["action", "note"],
  supplier_entry: ["supplierId", "action", "note"],
  partner_entry: ["partnerId", "action", "note", "reason"],
  session_sibling: ["role"],
  reversal: ["refundUnits", "reason"],
};

/** Fields whose value reads alone ("Cash to business", not "Service type:
 *  Cash to business"). */
const BARE_KEYS = new Set([
  "items",
  "description",
  "device",
  "carrier",
  "provider",
  "category",
  "action",
  "serviceType",
  "direction",
  "type",
  "source",
  "note",
  "notes",
  "partner",
  "partnerId",
  "supplierId",
  "status",
]);

const MAX_PART = 100;

function clip(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > MAX_PART ? `${one.slice(0, MAX_PART - 1)}…` : one;
}

/** A list value ("Items") in one line: "1× iPhone 15 (IMEI 3569…)". */
function tableText(
  value: Extract<DetailRow["value"], { kind: "table" }>,
): string {
  const col = (k: string) => value.columns.findIndex((c) => c.key === k);
  const nameIdx = ["name", "description", "key"].map(col).find((i) => i >= 0);
  const qtyIdx = col("quantity");
  const imeiIdx = col("imei");
  return value.rows
    .map((cells) => {
      if (nameIdx === undefined) return cells.filter(Boolean).join(" ");
      const qty = qtyIdx >= 0 ? cells[qtyIdx] : "";
      const imei = imeiIdx >= 0 ? cells[imeiIdx] : "";
      return `${qty ? `${qty}× ` : ""}${cells[nameIdx]}${imei ? ` (IMEI ${imei})` : ""}`;
    })
    .join(", ");
}

function rowText(r: DetailRow): string {
  const v = r.value;
  if (v.kind === "text") return v.text;
  if (v.kind === "table") return tableText(v);
  return v.rows.map(rowText).filter(Boolean).join(" · ");
}

function part(r: DetailRow): string {
  const text = clip(rowText(r));
  if (!text) return "";
  return BARE_KEYS.has(r.key) ? text : `${r.label}: ${text}`;
}

function detailsKind(row: TransactionRow): TransactionDetailsKind | null {
  try {
    const m = JSON.parse(row.metadata_json ?? "null") as {
      details?: { kind?: unknown };
    } | null;
    const k = m?.details?.kind;
    return typeof k === "string" && k in KEY_FIELDS
      ? (k as TransactionDetailsKind)
      : null;
  } catch {
    return null;
  }
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

/**
 * The few fields that say what the transaction was ("iPhone 15 (IMEI …)",
 * "Cash to business · Reference: C2B-889120", "€50.00 → 5,162,000 LBP"),
 * plus "Reverses #N" on a void / refund and returned credits. Only fields
 * the Details panel shows this user (costs for admins only).
 */
export function keyDetailsText(
  row: TransactionRow,
  ctx: ExportContext,
): string {
  const view = viewOf(row, ctx);
  const parts: string[] = [];
  const reverses = reversedTransactionId(row);
  if (reverses) parts.push(`Reverses #${reverses}`);

  const kind = detailsKind(row);
  const byKey = new Map(view.details.map((d) => [d.key, d]));
  if (kind === "exchange") {
    const given = byKey.get("amountIn");
    const got = byKey.get("amountOut");
    if (given && got) parts.push(`${rowText(given)} → ${rowText(got)}`);
  } else if (kind) {
    for (const key of KEY_FIELDS[kind]) {
      const d = byKey.get(key);
      const p = d ? part(d) : "";
      if (p) parts.push(p);
      if (parts.length >= 4) break;
    }
  }
  // A void / refund that saved nothing more is fully described by
  // "Reverses #N" (its other fields only repeat the original's).
  if (parts.length === (reverses ? 1 : 0) && kind !== "reversal") {
    // No kind, or none of its key fields: the first non-empty fields.
    for (const d of [...view.details, ...view.other]) {
      const p = part(d);
      if (p) parts.push(p);
      if (parts.length >= (reverses ? 4 : 3)) break;
    }
  }
  // LIRA-319: the extra charged on top of the price (originals only — a
  // void / refund never repeats it), as the table's payment detail says.
  const extra =
    reverses === null && row.type !== "REFUND" ? extraChargeText(row) : null;
  if (extra) parts.push(`Extra charged: ${extra}`);
  if (hasReturnedCredits(row)) {
    parts.push(
      `Credits back: ${returnedCreditsText(row.returned_credits_usd)}`,
    );
  }
  return parts.join(" · ");
}

/* ------------------------------------------------------------------ */
/*  Payments sheet rows                                                */
/* ------------------------------------------------------------------ */

export interface PaymentLineRow {
  row: TransactionRow;
  kind: string;
  inOut: "In" | "Out" | null;
  method: string;
  currency: string;
  amount: number;
  note: string;
}

function paymentLines(
  row: TransactionRow,
  pooled: TransactionPaymentLeg[] | null,
  ctx: ExportContext,
): PaymentLineRow[] {
  const out: PaymentLineRow[] = [];
  const view = viewOf(row, ctx);
  const payment = view.payment;
  const reversal = isReversal(row);
  const principal = principalDirection(row);
  const own = [
    ...(row.type === "CHECKPOINT" ? [] : (row.payments ?? [])),
    ...extraCurrencyLegs(row.type, row.metadata_json),
  ];

  const line = (
    leg: TransactionPaymentLeg,
    kind: string,
    note = "",
  ): PaymentLineRow => ({
    row,
    kind,
    inOut: leg.direction === "out" ? "Out" : "In",
    method: ctx.methodLabel(leg.method),
    currency: leg.currency_code,
    amount: roundTo(leg.amount, leg.currency_code),
    note,
  });

  // Main money first, then change, so a line reads paid → change back.
  const main = own.filter(
    (l) => reversal || !principal || l.direction === principal,
  );
  const change = own.filter((l) => !main.includes(l));
  for (const l of main) out.push(line(l, reversal ? "reversal" : "line"));
  for (const l of change) {
    out.push(
      line(l, principal === "out" ? "change received" : "change returned"),
    );
  }
  for (const l of pooled ?? []) {
    out.push(line(l, "session checkout", `Session #${row.session_id}`));
  }

  // Snapshot lines no leg carries: a customer's wallet / USDT side, the
  // EUR of an exchange, change put on the customer's account.
  if (payment && !payment.reversal) {
    const unused = [...own];
    const accountLabel = ctx.methodLabel("CUSTOMER_ACCOUNT");
    for (const l of payment.lines) {
      const i = unused.findIndex(
        (u) =>
          u.currency_code === l.currency &&
          Math.abs(u.amount - l.value) < 0.005,
      );
      if (i >= 0) {
        unused.splice(i, 1);
        continue;
      }
      out.push({
        row,
        kind:
          l.method === accountLabel
            ? "on customer account"
            : "not in cash totals",
        inOut: null,
        method: l.method,
        currency: l.currency,
        amount: roundTo(l.value, l.currency),
        note: l.note ?? "",
      });
    }
    for (const k of payment.keptItems) {
      out.push({
        row,
        kind:
          payment.keptLabel === "Change kept by them" ? "kept by them" : "kept",
        inOut: null,
        method: "",
        currency: k.currency,
        amount: roundTo(k.value, k.currency),
        note: payment.keptLabel,
      });
    }
  }
  if (out.length === 0 && payment?.sessionId != null) {
    out.push({
      row,
      kind: "paid in session",
      inOut: null,
      method: "",
      currency: "",
      amount: Number.NaN,
      note: `Session #${payment.sessionId}`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Shared row facts                                                   */
/* ------------------------------------------------------------------ */

interface Prepared {
  row: TransactionRow;
  when: Date;
  type: string;
  money: RowMoney;
  pooled: TransactionPaymentLeg[] | null;
  isGroupHeader: boolean;
}

function prepare(rows: TransactionRow[]): Prepared[] {
  const headers = computeSessionGroupHeaders(rows);
  return rows.map((row) => {
    const isGroupHeader =
      row.session_id != null && headers.get(row.session_id) === row.id;
    const pooled = isGroupHeader ? (row.session_payments ?? null) : null;
    return {
      row,
      when: parseDbDate(row.created_at),
      type: readableTitle(getTypeLabel(row)),
      money: rowMoney(row, pooled),
      pooled,
      isGroupHeader,
    };
  });
}

const DAY_FMT: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};

function dayText(d: Date): string {
  return d.toLocaleDateString("en-GB", DAY_FMT);
}

function timeOf(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** "2026-10-16" (the page's date filter) as a local date. */
function filterDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function periodText(
  filters: TransactionsExportOptions["filters"],
  prepared: Prepared[],
): string {
  let from = filterDate(filters.from);
  let to = filterDate(filters.to);
  if (!from && !to && prepared.length > 0) {
    const times = prepared.map((p) => p.when.getTime());
    from = new Date(Math.min(...times));
    to = new Date(Math.max(...times));
  }
  if (from && to) {
    const a = dayText(from);
    const b = dayText(to);
    return a === b ? a : `${a} – ${b}`;
  }
  if (from) return `From ${dayText(from)}`;
  if (to) return `Until ${dayText(to)}`;
  return "All dates";
}

function filtersText(filters: TransactionsExportOptions["filters"]): string {
  const parts: string[] = [];
  if (filters.types.length > 0) parts.push(`Type: ${filters.types.join(", ")}`);
  if (filters.search.trim()) parts.push(`Search: "${filters.search.trim()}"`);
  return parts.length > 0 ? parts.join(" · ") : "None";
}

function moneyText(m: Money, currencies: string[]): string {
  return currencies
    .filter((c) => m[c])
    .map((c) => formatDetailMoney(m[c]!, c))
    .join(" + ");
}

function addMoney(into: Money, from: Money): void {
  for (const [c, v] of Object.entries(from)) into[c] = (into[c] ?? 0) + v;
}

/* ------------------------------------------------------------------ */
/*  The template                                                       */
/* ------------------------------------------------------------------ */

export function transactionsExportTemplate(
  opts: TransactionsExportOptions,
): ExportTemplate<TransactionRow> {
  const ctx: ExportContext = {
    isAdmin: opts.isAdmin,
    methodLabel: (code) =>
      opts.methodLabelByCode.get(code) ?? fallbackMethodLabel(code),
  };

  const statusStyle = (row: TransactionRow) => {
    const s = rowStatus(row);
    return s === "VOIDED" ? "strike" : s === "REFUNDED" ? "muted" : null;
  };

  const moneyColumns = (currencies: string[]): ExportColumn<Prepared>[] =>
    currencies.flatMap((c) =>
      (["in", "out"] as const).map(
        (side): ExportColumn<Prepared> => ({
          header: `${side === "in" ? "In" : "Out"} ${c}`,
          value: (p) => p.money[side][c] ?? null,
          type: "money",
          currency: c,
          total: true,
          width: c === "LBP" ? 15 : 12,
        }),
      ),
    );

  function excel({
    rows,
    now,
  }: {
    rows: TransactionRow[];
    now: Date;
  }): ExportSheetSpec[] {
    const prepared = prepare(rows);
    const currencies = currenciesOf(prepared.map((p) => p.money));
    const period = periodText(opts.filters, prepared);

    // ── Summary ──
    const totals = { in: {} as Money, out: {} as Money };
    for (const p of prepared) {
      addMoney(totals.in, p.money.in);
      addMoney(totals.out, p.money.out);
    }
    const byType = new Map<string, Prepared[]>();
    for (const p of prepared) {
      byType.set(p.type, [...(byType.get(p.type) ?? []), p]);
    }
    const typeRows = [...byType.entries()]
      .map(([type, list]) => {
        const money: RowMoney = { in: {}, out: {} };
        for (const p of list) {
          addMoney(money.in, p.money.in);
          addMoney(money.out, p.money.out);
        }
        return { type, count: list.length, money };
      })
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

    const summary: ExportSheetSpec = {
      name: "Summary",
      blocks: [
        exportFacts("Transactions", [
          ...(opts.shopName
            ? [["Shop", opts.shopName] as [string, string]]
            : []),
          ["Period", period],
          ["Filters", filtersText(opts.filters)],
          ["Transactions", prepared.length, { type: "integer" }],
          ["Exported by", opts.exportedBy],
          ["Exported at", now, { type: "datetime" }],
        ]),
        exportTable({
          title: "Money in / out",
          rows: currencies.filter(
            (c) => totals.in[c] !== undefined || totals.out[c] !== undefined,
          ),
          columns: [
            { header: "Currency", value: (c) => c, width: 16 },
            {
              header: "In",
              value: (c) => roundTo(totals.in[c] ?? 0, c),
              type: "money",
              currency: (c) => c,
            },
            {
              header: "Out",
              value: (c) => roundTo(totals.out[c] ?? 0, c),
              type: "money",
              currency: (c) => c,
            },
            {
              header: "Net",
              value: (c) =>
                roundTo(
                  roundTo(totals.in[c] ?? 0, c) -
                    roundTo(totals.out[c] ?? 0, c),
                  c,
                ),
              type: "money",
              currency: (c) => c,
            },
          ],
        }),
        exportTable({
          title: "By type",
          rows: typeRows,
          columns: [
            { header: "Type", value: (t) => t.type },
            {
              header: "Count",
              value: (t) => t.count,
              type: "integer",
              total: true,
            },
            ...currencies.flatMap((c) =>
              (["in", "out"] as const).map(
                (side): ExportColumn<(typeof typeRows)[number]> => ({
                  header: `${side === "in" ? "In" : "Out"} ${c}`,
                  value: (t) => {
                    const v = t.money[side][c];
                    return v === undefined ? null : roundTo(v, c);
                  },
                  type: "money",
                  currency: c,
                  total: true,
                }),
              ),
            ),
          ],
        }),
      ],
    };

    // ── Transactions ──
    const transactions: ExportSheetSpec = {
      name: "Transactions",
      blocks: [
        exportTable<Prepared>({
          rows: prepared,
          freezeHeader: true,
          autoFilter: true,
          rowStyle: (p) => statusStyle(p.row),
          columns: [
            { header: "Date", value: (p) => p.when, type: "date", width: 12 },
            { header: "Time", value: (p) => p.when, type: "time", width: 7 },
            { header: "#", value: (p) => p.row.id, type: "integer", width: 8 },
            { header: "Type", value: (p) => p.type, width: 20 },
            {
              header: "Client",
              value: (p) => p.row.client_name ?? null,
              width: 18,
            },
            {
              header: "Phone",
              value: (p) => p.row.client_phone ?? null,
              width: 12,
            },
            {
              header: "Summary",
              value: (p) => displaySummary(p.row) ?? null,
              width: 46,
            },
            {
              header: "Amount",
              value: (p) =>
                amountCellText(p.row, deriveRow(p.row, p.isGroupHeader)),
              width: 18,
            },
            ...moneyColumns(currencies),
            {
              header: "Method",
              value: (p) => methodText(p.row, opts.methodLabelByCode),
              width: 20,
            },
            { header: "User", value: (p) => p.row.username || null, width: 10 },
            { header: "Status", value: (p) => rowStatusText(p.row), width: 15 },
            {
              header: "Key details",
              value: (p) => keyDetailsText(p.row, ctx),
              width: 70,
            },
          ],
        }),
      ],
    };

    // ── Payments ──
    const lines = prepared.flatMap((p) => paymentLines(p.row, p.pooled, ctx));
    const whenOf = new Map(prepared.map((p) => [p.row.id, p]));
    const payments: ExportSheetSpec = {
      name: "Payments",
      blocks: [
        exportTable<PaymentLineRow>({
          rows: lines,
          freezeHeader: true,
          autoFilter: true,
          columns: [
            {
              header: "Txn #",
              value: (l) => l.row.id,
              type: "integer",
              width: 8,
            },
            {
              header: "Date",
              value: (l) => whenOf.get(l.row.id)!.when,
              type: "date",
              width: 12,
            },
            {
              header: "Time",
              value: (l) => whenOf.get(l.row.id)!.when,
              type: "time",
              width: 7,
            },
            {
              header: "Type",
              value: (l) => whenOf.get(l.row.id)!.type,
              width: 20,
            },
            { header: "Kind", value: (l) => l.kind, width: 20 },
            { header: "In/Out", value: (l) => l.inOut, width: 8 },
            { header: "Method", value: (l) => l.method || null, width: 18 },
            { header: "Currency", value: (l) => l.currency || null, width: 9 },
            {
              header: "Amount",
              value: (l) => (Number.isNaN(l.amount) ? null : l.amount),
              type: "money",
              currency: (l) => l.currency || "USD",
              width: 16,
            },
            { header: "Note", value: (l) => l.note || null, width: 30 },
          ],
        }),
      ],
    };

    // ── Details ──
    const fields = prepared.flatMap((p) =>
      fieldRows(p.row, ctx).map((f) => ({ p, ...f })),
    );
    const details: ExportSheetSpec = {
      name: "Details",
      blocks: [
        exportTable({
          rows: fields,
          freezeHeader: true,
          autoFilter: true,
          columns: [
            {
              header: "Txn #",
              value: (f) => f.p.row.id,
              type: "integer",
              width: 8,
            },
            {
              header: "Date",
              value: (f) => f.p.when,
              type: "datetime",
              width: 17,
            },
            { header: "Type", value: (f) => f.p.type, width: 20 },
            { header: "Section", value: (f) => f.section, width: 16 },
            { header: "Field", value: (f) => f.field, width: 30 },
            { header: "Value", value: (f) => f.value, width: 60 },
          ],
        }),
      ],
    };

    return [summary, transactions, payments, details];
  }

  function pdf({
    rows,
    now,
  }: {
    rows: TransactionRow[];
    now: Date;
  }): PdfReport {
    const prepared = prepare(rows);
    const currencies = currenciesOf(prepared.map((p) => p.money));
    const period = periodText(opts.filters, prepared);

    const totals: RowMoney = { in: {}, out: {} };
    const counts = new Map<string, number>();
    for (const p of prepared) {
      addMoney(totals.in, p.money.in);
      addMoney(totals.out, p.money.out);
      counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
    }
    const moneyRows = currencies
      .filter((c) => totals.in[c] !== undefined || totals.out[c] !== undefined)
      .map((c) => {
        const i = roundTo(totals.in[c] ?? 0, c);
        const o = roundTo(totals.out[c] ?? 0, c);
        return [
          c,
          formatDetailMoney(i, c),
          formatDetailMoney(o, c),
          formatDetailMoney(roundTo(i - o, c), c),
        ];
      });
    const typeList = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const half = Math.ceil(typeList.length / 2);
    const typeRows = typeList.slice(0, half).map(([t, n], i) => {
      const other = typeList[half + i];
      return [t, String(n), other?.[0] ?? "", other ? String(other[1]) : ""];
    });

    // Group by day, in the exported order.
    const groups = new Map<string, Prepared[]>();
    for (const p of prepared) {
      const key = dayText(p.when);
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }

    const item = (p: Prepared): PdfItem => {
      const status = rowStatus(p.row);
      const tags = [
        status === "PARTLY_REFUNDED"
          ? "PARTLY REFUNDED"
          : status !== "ACTIVE"
            ? status
            : "",
        hasReturnedCredits(p.row)
          ? `${returnedCreditsText(p.row.returned_credits_usd)} credits back`
          : "",
      ].filter(Boolean);
      const inText = moneyText(p.money.in, currencies);
      const outText = moneyText(p.money.out, currencies);
      const cells: PdfCell[] = [
        { text: timeOf(p.when), bold: false },
        { text: `#${p.row.id}`, bold: false },
        tags.length > 0 ? `${p.type}\n${tags.join(" · ")}` : p.type,
        p.row.client_name ?? "",
        { text: displaySummary(p.row) ?? "", bold: false },
        inText ? { text: inText, tone: "in", align: "right" } : "",
        outText ? { text: outText, tone: "out", align: "right" } : "",
        { text: methodText(p.row, opts.methodLabelByCode), bold: false },
      ];
      const sub = keyDetailsText(p.row, ctx);
      return {
        cells,
        ...(sub ? { sub } : {}),
        ...(status === "VOIDED" ? { strike: true } : {}),
        ...(status === "REFUNDED" ? { muted: true } : {}),
      };
    };

    const sideText = (label: string, m: Money) => {
      const t = moneyText(m, currencies);
      return t ? `${label} ${t}` : "";
    };

    return {
      title: `Transactions — ${period}`,
      orientation: "landscape",
      headerLines: [
        ...(opts.shopName ? [opts.shopName] : []),
        `Period: ${period}   ·   Filters: ${filtersText(opts.filters)}   ·   ${prepared.length} transactions`,
        `Printed by ${opts.exportedBy} on ${dayText(now)}, ${timeOf(now)}`,
      ],
      summary: [
        {
          title: "Money in / out",
          head: ["Currency", "In", "Out", "Net"],
          rows: moneyRows,
        },
        {
          title: "Transactions by type",
          head: ["Type", "Count", "Type", "Count"],
          rows: typeRows,
          numericColumns: [1, 3],
        },
      ],
      columns: [
        { header: "Time", width: 36 },
        { header: "#", width: 42 },
        { header: "Type", width: 92 },
        { header: "Client", width: 84 },
        { header: "Summary" },
        { header: "In", width: 98, align: "right" },
        { header: "Out", width: 98, align: "right" },
        { header: "Method", width: 92 },
      ],
      groups: [...groups.entries()].map(([day, list]) => {
        const dayMoney: RowMoney = { in: {}, out: {} };
        for (const p of list) {
          addMoney(dayMoney.in, p.money.in);
          addMoney(dayMoney.out, p.money.out);
        }
        for (const side of [dayMoney.in, dayMoney.out]) {
          for (const c of Object.keys(side)) side[c] = roundTo(side[c]!, c);
        }
        const weekday = list[0]!.when.toLocaleDateString("en-GB", {
          weekday: "short",
        });
        return {
          label: `${weekday} ${day}  ·  ${list.length} transaction${list.length === 1 ? "" : "s"}`,
          totals: [sideText("In", dayMoney.in), sideText("Out", dayMoney.out)]
            .filter(Boolean)
            .join("   ·   "),
          items: list.map(item),
        };
      }),
    };
  }

  return { excel, pdf };
}

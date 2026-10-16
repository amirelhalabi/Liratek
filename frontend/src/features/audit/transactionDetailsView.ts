/**
 * The generic transaction details viewer's data side (owner request
 * 2026-10-16: "a generic way to see the metadata of all transactions").
 *
 * ONE renderer for every row: `metadata_json.details` (LIRA-329, any `kind` —
 * a kind added later shows automatically), `metadata_json.payment_snapshot`,
 * and every other (legacy) metadata key, so rows saved before LIRA-329 still
 * show what they have. No per-kind layouts, on purpose.
 *
 * Pure: metadata in, display rows out. The panel component
 * (`components/TransactionDetailsPanel.tsx`) only lays these out, and the
 * export (`transactionExport.ts`) flattens the same rows — so the panel and
 * the export never word a value differently (rule 14). Kept in its own
 * module because a module may export components or helpers, not both
 * (react-refresh/only-export-components).
 *
 * Readable values (owner decision Q7, shop-day test 2026-10-16): a saved
 * code reads as words ("DEDUCTED" → "Deducted"), a date as a date, an amount
 * with its currency and decimals, a rate exactly, an id as the name it
 * points at. Free text the cashier typed (names, notes, references, IMEIs)
 * and drawer / currency codes are shown exactly as saved.
 *
 * Costs: `isCostKey` is the ONE definition of which saved fields are cost /
 * profit / commission data. Those are dropped for non-admins at every depth —
 * object keys, nested objects and array-table columns.
 */
import {
  PROVIDER_LABELS,
  RECHARGE_SUBTYPE_LABELS,
  type PaymentSnapshot,
} from "@liratek/core";
import { getCurrencyDecimals, getCurrencySymbol } from "@/utils/currency";
import { getRowCashFlowDirection } from "./cashFlow";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import type { TransactionRow } from "./hooks/useTransactionRows";

export type DetailValue =
  | { kind: "text"; text: string }
  | { kind: "group"; rows: DetailRow[] }
  | {
      kind: "table";
      columns: { key: string; label: string }[];
      rows: string[][];
    };

export interface DetailRow {
  key: string;
  label: string;
  value: DetailValue;
}

export interface PaymentLineView {
  direction: "In" | "Out";
  method: string;
  currency: string;
  amount: string;
  note: string | null;
}

/** One currency of change handed back or kept (the export's Payments sheet
 *  lists them one per row). */
export interface MoneyItemView {
  /** Method label; "" for kept change (it never left the drawer). */
  method: string;
  currency: string;
  amount: string;
}

export interface PaymentView {
  lines: PaymentLineView[];
  /** True when `lines` are a void/refund's own legs (`row.payments`) — a
   *  reversal saves no payment snapshot of its own. */
  reversal: boolean;
  /** "Cash 89,500 LBP" — null when no change was handed back. */
  changeReturned: string | null;
  /**
   * How to name `changeReturned`: on a sale / send the shop hands change
   * BACK to the customer ("Change returned"); on a payout (an expense, a
   * supplier payment) the change came back TO the shop ("Change received").
   * From the row's own cash-flow direction — the table's ↓/↑ badge.
   */
  changeLabel: "Change returned" | "Change received";
  changeItems: MoneyItemView[];
  /** "5,000 LBP" — change the customer left with the shop. */
  kept: string | null;
  /** How to name `kept`: on a sale the customer left the change with the
   *  shop; on a payout (an expense) the vendor kept the change it owed. */
  keptLabel: "Change kept by the shop" | "Change kept by them";
  keptItems: MoneyItemView[];
  /** "Paid in session #N" — from the snapshot or `details.paid_in_session`. */
  sessionId: number | null;
}

export interface TransactionDetailsView {
  /** Readable `details.kind` ("OMT / Whish transfer"); null without details. */
  kindLabel: string | null;
  details: DetailRow[];
  payment: PaymentView | null;
  /** Every metadata key other than `details` / `payment_snapshot`. */
  other: DetailRow[];
  isEmpty: boolean;
}

/** The row's own columns the view reads for context (currency, names,
 *  reversal legs). Optional: without it the view uses the metadata alone. */
export type DetailsRowContext = Pick<
  TransactionRow,
  | "type"
  | "metadata_json"
  | "amount_usd"
  | "amount_lbp"
  | "payments"
  | "reverses_id"
  | "client_id"
  | "client_name"
>;

export interface DetailsViewOptions {
  isAdmin: boolean;
  /** Payment-method code → label (the page's own `methodLabelByCode`). */
  methodLabel: (code: string) => string;
  row?: DetailsRowContext;
}

// ── Cost keys (ONE definition) ──────────────────────────────────────────

/**
 * A saved field is cost data — hidden from non-admins — when its key
 * contains one of these WHOLE words (camelCase / snake_case split): so
 * `unitCost`, `repairCost`, `cost_usd`, `profitUsd`, `net_profit_usd`,
 * `commissionRate`, `commission_usd` all match, while `discount` or
 * `omtFee` (what the customer paid) do not.
 */
export const COST_KEY_WORDS: readonly string[] = [
  "cost",
  "costs",
  "profit",
  "profits",
  "commission",
  "commissions",
  "margin",
  "markup",
];

/** Whole keys that are cost data without containing a cost word. */
const COST_KEYS_EXACT: readonly string[] = ["buy_rate", "buyRate"];

function splitWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

export function isCostKey(key: string): boolean {
  if (COST_KEYS_EXACT.includes(key)) return true;
  return splitWords(key).some((w) => COST_KEY_WORDS.includes(w));
}

// ── Labels ──────────────────────────────────────────────────────────────

/** Words always written in capitals — in labels and in readable codes. */
const ACRONYMS = new Set([
  "id",
  "omt",
  "usd",
  "lbp",
  "usdt",
  "eur",
  "gbp",
  "mtc",
  "sms",
  "imei",
  "pos",
  "ref",
]);

/** Brand words a readable code / title keeps capitalised mid-sentence. */
const BRAND_WORDS: Record<string, string> = {
  whish: "Whish",
  binance: "Binance",
  katsh: "Katsh",
  ipick: "iPick",
  alfa: "Alfa",
};

/** Only where humanising the key reads badly. */
const LABEL_OVERRIDES: Record<string, string> = {
  includingFees: "Fees included",
  smsExpenseTxnId: "SMS fee transaction",
  walletOrReference: "Wallet / reference",
  sourceDrawer: "From drawer",
  destDrawer: "To drawer",
};

const KIND_LABELS: Record<string, string> = {
  omt_whish_transfer: "OMT / Whish transfer",
};

function wordsToLabel(words: string[]): string {
  return words
    .map((w, i) => {
      if (ACRONYMS.has(w)) return w.toUpperCase();
      if (BRAND_WORDS[w]) return BRAND_WORDS[w];
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    })
    .join(" ");
}

/** `serviceType` → "Service type", `omtFee` → "OMT fee". */
export function humaniseKey(key: string): string {
  return LABEL_OVERRIDES[key] ?? wordsToLabel(splitWords(key));
}

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? wordsToLabel(splitWords(kind));
}

/**
 * A transaction title in sentence case for the Details panel and the
 * export's extra sheets: core's `transactionTitle` shouts some types
 * ("CUSTOM SERVICE", "OMT SEND"); those become "Custom service",
 * "OMT send". A title that already has lower-case letters is left alone.
 * (The table's own Type column keeps core's title — not changed here.)
 */
export function readableTitle(title: string): string {
  if (/[a-z]/.test(title)) return title;
  return title.replace(/[A-Za-z][A-Za-z_]*/g, (word, offset: number) => {
    const w = word.toLowerCase();
    if (ACRONYMS.has(w)) return w.toUpperCase();
    if (BRAND_WORDS[w]) return BRAND_WORDS[w];
    return offset === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  });
}

// ── Money ───────────────────────────────────────────────────────────────

/**
 * An amount with its currency's symbol and decimals — "$18.50", "€50.00",
 * "5,162,000 LBP", "150.00 USDT" — from the app's currency table
 * (`utils/currency`), with thousands separators and a real minus sign.
 * Every amount in the panel and the export's Details/Payments sheets.
 */
export function formatDetailMoney(amount: number, currency: string): string {
  const decimals = getCurrencyDecimals(currency);
  const symbol = getCurrencySymbol(currency);
  const digits = Math.abs(amount).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sign = amount < 0 ? "−" : "";
  return ["$", "€", "£"].includes(symbol)
    ? `${sign}${symbol}${digits}`
    : `${sign}${digits} ${symbol}`;
}

/** `{usd, lbp}` as "$55.00 + 450,000 LBP" (zero sides left out). */
function formatUsdLbp(usd: number, lbp: number): string {
  const parts: string[] = [];
  if (usd) parts.push(formatDetailMoney(usd, "USD"));
  if (lbp) parts.push(formatDetailMoney(lbp, "LBP"));
  return parts.join(" + ") || formatDetailMoney(0, "USD");
}

// ── Values ──────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function isPlainObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Words that make a number a money amount (formatted with its currency). */
const MONEY_WORDS = new Set([
  "amount",
  "price",
  "fee",
  "cost",
  "total",
  "profit",
  "commission",
  "paid",
  "change",
  "balance",
  "usd",
  "lbp",
  "usdt",
]);

/** A currency named in the key itself (`costUsd`, `amountUsdt`). */
const KEY_CURRENCY: Record<string, string> = {
  usd: "USD",
  lbp: "LBP",
  usdt: "USDT",
};

/** Rates that are fractions — shown as a percentage. A rate under any
 *  other key (an exchange `rate` / `marketRate`) is a plain number. */
const PERCENT_RATE_WORDS = new Set([
  "commission",
  "fee",
  "discount",
  "tax",
  "percent",
  "markup",
  "margin",
]);

/** Keys whose text the cashier typed or that name a thing — never
 *  re-cased (a reference "C2B-889120", a drawer "OMT_App", a name). */
const VERBATIM_KEY_WORDS = new Set([
  "name",
  "names",
  "note",
  "notes",
  "reason",
  "description",
  "issue",
  "reference",
  "ref",
  "phone",
  "number",
  "imei",
  "code",
  "codes",
  "key",
  "label",
  "title",
  "device",
  "drawer",
  "drawers",
  "wallet",
  "username",
  "summary",
  "message",
  "currency",
  "from",
  "to",
  "via",
]);

/** A key holding a payment-method code — named by the page's own labels
 *  (`cashoutMethod`, `payment_method`, `paid_by`; not `feePaidBy`). */
function isMethodKey(key: string): boolean {
  return (
    key === "paid_by" || key === "paidBy" || splitWords(key).includes("method")
  );
}

/** Codes generic humanising cannot word well. */
const VALUE_OVERRIDES: Record<string, string> = {
  Delivered_Paid: "Delivered and paid",
};

/**
 * Amounts whose currency the writer knows but does not save beside them
 * (LIRA-329 detail builders): a telecom card's `amount` is its dollar
 * value even when the row was paid in LBP; a Binance fee is in dollars;
 * inventory items and maintenance parts are priced in dollars
 * (`sold_price_usd`, `unit_price_usd`).
 */
function knownCurrency(
  kind: string | null,
  parentKey: string | null,
  key: string,
): string | null {
  if (kind === "telecom_recharge" && parentKey === null && key === "amount") {
    return "USD";
  }
  // A Binance fee is booked in dollars (FinancialServiceRepository: "always
  // in USD", summary "+$3 fee"), while the transfer itself is USDT.
  if (kind === "crypto_transfer" && parentKey === null && key === "fee") {
    return "USD";
  }
  if (
    (kind === "pos_sale" && parentKey === "items") ||
    (kind === "maintenance_job" && parentKey === "parts")
  ) {
    if (key === "unitPrice" || key === "unitCost") return "USD";
  }
  return null;
}

/** Names the row knows, by entity ("supplier" → id → "Katsh"). */
type NameIndex = Map<string, Map<number, string>>;

/** What every value of one view needs to know. */
interface Env {
  isAdmin: boolean;
  methodLabel: (code: string) => string;
  kind: string | null;
  /** The row's own amount currency when it is unambiguous — a saved
   *  `currency` beside the legacy amount, or the one non-zero column. */
  rowCurrency: string | null;
  names: NameIndex;
  /** The legacy top level: no sibling-currency pairing (see `toRows`). */
  legacy: boolean;
}

/** Where a value sits: its key, the object holding it, the key of that
 *  object (or the array it is in), and a currency inherited from it. */
interface Place {
  key: string;
  siblings: Json;
  parentKey: string | null;
  inheritedCurrency: string | null;
}

function isIdKey(key: string): boolean {
  const words = splitWords(key);
  return words[words.length - 1] === "id";
}

function exactNumber(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 10 });
}

/** 0.0445 → "4.45%" — exact, without floating-point noise. */
function percent(n: number): string {
  return `${exactNumber(Number((n * 100).toPrecision(12)))}%`;
}

function asCurrency(v: unknown): string | null {
  return typeof v === "string" && /^[A-Z]{3,4}$/.test(v) ? v : null;
}

/** The currency of a money number, most specific first; null = unknown
 *  (the number is then shown plain — never a guessed currency). */
function moneyCurrency(place: Place, env: Env): string | null {
  const words = splitWords(place.key);
  for (const w of words) if (KEY_CURRENCY[w]) return KEY_CURRENCY[w];
  if (env.legacy) return null;
  const sibling = asCurrency(place.siblings.currency);
  if (sibling) return sibling;
  if (env.kind === "exchange") {
    if (place.key === "amountIn") return asCurrency(place.siblings.from);
    if (place.key === "amountOut") return asCurrency(place.siblings.to);
  }
  const known = knownCurrency(env.kind, place.parentKey, place.key);
  if (known) return known;
  return place.inheritedCurrency ?? env.rowCurrency;
}

function nameFor(
  key: string,
  id: number,
  siblings: Json,
  env: Env,
): string | null {
  const words = splitWords(key);
  const entity = words.slice(0, -1).join(" ");
  if (!entity) return null;
  const known = env.names.get(entity)?.get(id);
  if (known) return known;
  // A legacy `clientId` saved beside its own `clientName`.
  for (const k of [`${entity}Name`, `${entity}_name`]) {
    const v = siblings[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

function formatNumber(n: number, place: Place, env: Env): string {
  const { key } = place;
  if (isIdKey(key)) {
    const name = nameFor(key, n, place.siblings, env);
    return name ? `${name} (#${n})` : `#${n}`;
  }
  const words = splitWords(key);
  if (words.includes("rate")) {
    const parentWords = place.parentKey ? splitWords(place.parentKey) : [];
    const isPercent = [...words, ...parentWords].some((w) =>
      PERCENT_RATE_WORDS.has(w),
    );
    return isPercent ? percent(n) : exactNumber(n);
  }
  if (words.some((w) => MONEY_WORDS.has(w))) {
    const currency = moneyCurrency(place, env);
    return currency ? formatDetailMoney(n, currency) : exactNumber(n);
  }
  return exactNumber(n);
}

const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * "2026-10-16" and "2026-10-16T00:00:00.000Z" are calendar DAYS: shown from
 * their own digits (in UTC), so a shop west of UTC never sees 15 Oct
 * (rule 27). A real moment ("…T14:05:00Z") is shown in local time.
 */
function readableDate(s: string): string | null {
  const m = ISO_DATE.exec(s);
  if (!m) return null;
  const isDay = !m[4] || (m[4] === "00" && m[5] === "00" && !Number(m[6]));
  const opts: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
  };
  if (isDay) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return Number.isNaN(d.getTime())
      ? null
      : d.toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
  }
  const d = parseDbDate(s);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString("en-GB", {
        ...opts,
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** A saved code as words: `DEDUCTED` → "Deducted", `SMS_Transfer_Fee` →
 *  "SMS transfer fee", `other` → "Other". Mixed-case words ("Katsh",
 *  "Bill") are already readable; anything with digits, spaces, hyphens or
 *  slashes is not a code. */
function readableCode(s: string): string {
  if (VALUE_OVERRIDES[s]) return VALUE_OVERRIDES[s];
  if (!/^[A-Za-z]+(_[A-Za-z]+)*$/.test(s)) return s;
  const isCode =
    s === s.toUpperCase() || s === s.toLowerCase() || s.includes("_");
  if (!isCode) return s;
  return wordsToLabel(s.toLowerCase().split("_"));
}

function lookupLabel(map: Record<string, string>, s: string): string | null {
  if (map[s]) return map[s];
  const hit = Object.keys(map).find((k) => k.toUpperCase() === s.toUpperCase());
  return hit ? (map[hit] ?? null) : null;
}

function formatString(s: string, place: Place, env: Env): string {
  const words = splitWords(place.key);
  const methodKey = isMethodKey(place.key);
  if (!methodKey && words.some((w) => VERBATIM_KEY_WORDS.has(w))) return s;
  const date = readableDate(s);
  if (date) return date;
  if (words.includes("provider") || words.includes("carrier")) {
    const label = lookupLabel(PROVIDER_LABELS, s);
    if (label) return label;
  }
  if (place.key === "type") {
    const label = RECHARGE_SUBTYPE_LABELS[s];
    if (label) return label;
  }
  if (methodKey && /^[A-Z_]+$/.test(s)) {
    const label = env.methodLabel(s);
    if (label !== s) return label;
  }
  return readableCode(s);
}

function formatScalar(v: unknown, place: Place, env: Env): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return formatNumber(v, place, env);
  if (typeof v === "string") return formatString(v, place, env);
  if (Array.isArray(v)) {
    return v
      .filter((x) => !isBlank(x))
      .map((x) => formatScalar(x, place, env))
      .join(", ");
  }
  if (isPlainObject(v)) return compactObject(v, place, env) ?? "";
  return String(v);
}

function onlyKeys(obj: Json, allowed: string[]): boolean {
  const keys = Object.keys(obj).filter((k) => !isBlank(obj[k]));
  return keys.length > 0 && keys.every((k) => allowed.includes(k));
}

/**
 * The one-line forms of a small object, or null when it needs sub-rows:
 * `{usd, lbp}` → "$55.00 + 450,000 LBP", `{name, phone}` → "Ali · 70123456",
 * `{amount, currency}` → "1,000 LBP", `{key, label}` → its label,
 * `{id, name, mode}` → "Rami (#4) · Via".
 */
function compactObject(obj: Json, place: Place, env: Env): string | null {
  if (onlyKeys(obj, ["usd", "lbp"])) {
    const usd = typeof obj.usd === "number" ? obj.usd : 0;
    const lbp = typeof obj.lbp === "number" ? obj.lbp : 0;
    return formatUsdLbp(usd, lbp);
  }
  if (onlyKeys(obj, ["name", "phone"])) {
    return [obj.name, obj.phone]
      .filter((x): x is string => typeof x === "string" && x !== "")
      .join(" · ");
  }
  if (
    onlyKeys(obj, ["amount", "currency"]) &&
    typeof obj.amount === "number" &&
    typeof obj.currency === "string"
  ) {
    return formatDetailMoney(obj.amount, obj.currency);
  }
  if (onlyKeys(obj, ["key", "label"])) {
    const label = typeof obj.label === "string" && obj.label ? obj.label : null;
    return label ?? (typeof obj.key === "string" ? obj.key : null);
  }
  if (
    typeof obj.id === "number" &&
    typeof obj.name === "string" &&
    obj.name &&
    Object.entries(obj).every(
      ([k, v]) => k === "id" || k === "name" || typeof v === "string",
    )
  ) {
    const rest = Object.keys(obj)
      .filter((k) => k !== "id" && k !== "name" && !isBlank(obj[k]))
      .map((k) =>
        formatScalar(obj[k], { ...place, key: k, siblings: obj }, env),
      );
    return [`${obj.name} (#${obj.id})`, ...rest].join(" · ");
  }
  return null;
}

function visibleKeys(obj: Json, isAdmin: boolean): string[] {
  return Object.keys(obj).filter(
    (k) => !isBlank(obj[k]) && (isAdmin || !isCostKey(k)),
  );
}

/** The currency an object passes down to its children (`items[]` of a
 *  catalog sale priced in its `currencyMode`). */
function currencyOf(obj: Json, inherited: string | null): string | null {
  return asCurrency(obj.currency) ?? asCurrency(obj.currencyMode) ?? inherited;
}

/** "Supplier ID" → "Supplier" once the id shows the supplier's name. */
function labelFor(key: string, value: DetailValue): string {
  const label = humaniseKey(key);
  if (
    isIdKey(key) &&
    value.kind === "text" &&
    !value.text.startsWith("#") &&
    label.endsWith(" ID")
  ) {
    return label.slice(0, -3);
  }
  return label;
}

function toTable(
  key: string,
  objects: Json[],
  inherited: string | null,
  env: Env,
): DetailValue | null {
  let columnKeys: string[] = [];
  for (const o of objects) {
    for (const k of visibleKeys(o, env.isAdmin)) {
      if (!columnKeys.includes(k)) columnKeys.push(k);
    }
  }
  // A catalog item reads by its label; its key only when it has none.
  const labelled = columnKeys.includes("label") && columnKeys.includes("key");
  if (labelled) {
    columnKeys = columnKeys
      .filter((k) => k !== "label")
      .map((k) => (k === "key" ? "label" : k));
  }
  if (columnKeys.length === 0) return null;
  return {
    kind: "table",
    columns: columnKeys.map((k) => ({ key: k, label: humaniseKey(k) })),
    rows: objects.map((o) =>
      columnKeys.map((k) => {
        const v = labelled && k === "label" && isBlank(o.label) ? o.key : o[k];
        return isBlank(v)
          ? ""
          : formatScalar(
              v,
              {
                key: k,
                siblings: o,
                parentKey: key,
                inheritedCurrency: currencyOf(o, inherited),
              },
              env,
            );
      }),
    ),
  };
}

function toValue(v: unknown, place: Place, env: Env): DetailValue | null {
  if (Array.isArray(v) && v.some(isPlainObject)) {
    return toTable(
      place.key,
      v.filter(isPlainObject),
      currencyOf(place.siblings, place.inheritedCurrency),
      env,
    );
  }
  if (isPlainObject(v)) {
    const shown = env.isAdmin
      ? v
      : Object.fromEntries(Object.entries(v).filter(([k]) => !isCostKey(k)));
    const compact = compactObject(shown, place, env);
    if (compact !== null) return { kind: "text", text: compact };
    const rows = toRows(v, env, [], {
      parentKey: place.key,
      inheritedCurrency: currencyOf(place.siblings, place.inheritedCurrency),
    });
    return rows.length > 0 ? { kind: "group", rows } : null;
  }
  const text = formatScalar(v, place, env);
  return text === "" ? null : { kind: "text", text };
}

/**
 * `env.legacy` — the legacy metadata's top level never pairs a number with
 * its sibling `currency` key: there `currency` belongs to whichever amount
 * the writer meant (a recharge's `currency` is the price's, while its
 * `amount` is the card's dollar value), so pairing it would print a wrong
 * amount. Plain numbers are never wrong.
 */
function toRows(
  obj: Json,
  env: Env,
  skip: string[],
  at: { parentKey: string | null; inheritedCurrency: string | null } = {
    parentKey: null,
    inheritedCurrency: null,
  },
): DetailRow[] {
  const rows: DetailRow[] = [];
  for (const key of visibleKeys(obj, env.isAdmin)) {
    if (skip.includes(key)) continue;
    const value = toValue(obj[key], { key, siblings: obj, ...at }, env);
    if (value) rows.push({ key, label: labelFor(key, value), value });
  }
  return rows;
}

// ── Row context ─────────────────────────────────────────────────────────

function addName(
  names: NameIndex,
  entity: unknown,
  id: unknown,
  name: unknown,
): void {
  if (typeof entity !== "string" || typeof id !== "number") return;
  if (typeof name !== "string" || !name) return;
  const byId = names.get(entity) ?? new Map<number, string>();
  byId.set(id, name);
  names.set(entity, byId);
}

/** Names saved on the row: the counterparty, a `partner {id, name}`, the
 *  row's own client. */
function nameIndex(
  meta: Json,
  details: Json | null,
  row: DetailsRowContext | undefined,
): NameIndex {
  const names: NameIndex = new Map();
  const cp = isPlainObject(meta.counterparty) ? meta.counterparty : null;
  if (cp) addName(names, cp.kind, cp.id, cp.name);
  for (const holder of [details, meta]) {
    const p = holder && isPlainObject(holder.partner) ? holder.partner : null;
    if (p) addName(names, "partner", p.id, p.name);
  }
  if (row) addName(names, "client", row.client_id, row.client_name);
  return names;
}

/** The row's amount currency, only when unambiguous. */
function rowCurrencyOf(
  meta: Json,
  row: DetailsRowContext | undefined,
): string | null {
  const saved = asCurrency(meta.currency);
  if (saved) return saved;
  if (!row) return null;
  if (row.amount_usd && !row.amount_lbp) return "USD";
  if (row.amount_lbp && !row.amount_usd) return "LBP";
  return null;
}

// ── Payment snapshot ────────────────────────────────────────────────────

function positiveId(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null;
}

/** A void / refund row: it reverses another (whole: `reverses_id`; an item
 *  refund: `details.originalTransactionId`). */
function isReversalRow(
  row: DetailsRowContext | undefined,
  details: Json | null,
): boolean {
  if (details?.kind === "reversal") return true;
  return !!row && (row.reverses_id != null || row.type === "REFUND");
}

/**
 * The row's MAIN money goes out (a payout): the same direction the table's
 * badge and Method column use (`getRowCashFlowDirection`); when the badge
 * says "both" only because of a fee / change leg, the principal's
 * direction, asked without the legs (as `methodColumnLegs` does).
 */
function isPayoutRow(row: DetailsRowContext | undefined): boolean {
  if (!row) return false;
  let direction = getRowCashFlowDirection(row);
  if (direction === "both") {
    direction = getRowCashFlowDirection({ ...row, payments: undefined });
  }
  return direction === "out";
}

function buildPayment(
  snapshot: unknown,
  sessionFromDetails: number | null,
  methodLabel: (code: string) => string,
  reversalLegs: DetailsRowContext["payments"] | null,
  isPayout: boolean,
): PaymentView | null {
  const snap = isPlainObject(snapshot)
    ? (snapshot as Partial<PaymentSnapshot>)
    : null;
  const sessionId = positiveId(snap?.session_id) ?? sessionFromDetails;
  const snapLines = Array.isArray(snap?.lines) ? snap.lines : [];
  // A reversal saves no snapshot: its money is its own legs.
  const legs = snapLines.length === 0 ? (reversalLegs ?? []) : [];
  if (!snap && sessionId === null && legs.length === 0) return null;

  const lines: PaymentLineView[] =
    legs.length > 0
      ? legs.map((l) => ({
          direction: l.direction === "out" ? "Out" : "In",
          method: methodLabel(l.method),
          currency: l.currency_code,
          amount: formatDetailMoney(l.amount, l.currency_code),
          note: null,
        }))
      : snapLines
          .filter(
            (l) =>
              isPlainObject(l) &&
              typeof l.amount === "number" &&
              typeof l.currency === "string",
          )
          .map((l) => ({
            direction: l.direction === "OUT" ? "Out" : "In",
            method: methodLabel(String(l.method ?? "")),
            currency: l.currency,
            amount: formatDetailMoney(l.amount, l.currency),
            note: typeof l.note === "string" && l.note ? l.note : null,
          }));

  const changeItems: MoneyItemView[] = (
    Array.isArray(snap?.change_returned) ? snap.change_returned : []
  )
    .filter(
      (c) =>
        isPlainObject(c) &&
        typeof c.amount === "number" &&
        typeof c.currency === "string" &&
        c.amount !== 0,
    )
    .map((c) => ({
      method: methodLabel(String(c.method ?? "")),
      currency: c.currency,
      amount: formatDetailMoney(c.amount, c.currency),
    }));

  const kept = isPlainObject(snap?.kept) ? snap.kept : null;
  const keptUsd = typeof kept?.usd === "number" ? kept.usd : 0;
  const keptLbp = typeof kept?.lbp === "number" ? kept.lbp : 0;
  const keptItems: MoneyItemView[] = [
    { currency: "USD", value: keptUsd },
    { currency: "LBP", value: keptLbp },
  ]
    .filter((k) => k.value !== 0)
    .map((k) => ({
      method: "",
      currency: k.currency,
      amount: formatDetailMoney(k.value, k.currency),
    }));

  return {
    lines,
    reversal: legs.length > 0,
    changeLabel: isPayout ? "Change received" : "Change returned",
    changeReturned:
      changeItems.length > 0
        ? changeItems.map((c) => `${c.method} ${c.amount}`).join(" + ")
        : null,
    changeItems,
    kept: keptUsd || keptLbp ? formatUsdLbp(keptUsd, keptLbp) : null,
    keptLabel: isPayout ? "Change kept by them" : "Change kept by the shop",
    keptItems,
    sessionId,
  };
}

// ── Entry point ─────────────────────────────────────────────────────────

const HIDDEN_DETAIL_KEYS = ["v", "kind", "paid_in_session"];

function parseMetadata(raw: string | null): Json | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Everything the Details panel shows below its header, from a row's
 * `metadata_json` (plus, when given, the row's own columns for currency,
 * names and a reversal's legs). Never throws: missing or malformed metadata
 * is an empty view ("Nothing else was saved for this transaction.").
 */
export function buildTransactionDetailsView(
  metadataJson: string | null,
  opts: DetailsViewOptions,
): TransactionDetailsView {
  const meta = parseMetadata(metadataJson) ?? {};
  const details = isPlainObject(meta.details) ? meta.details : null;
  const kind = typeof details?.kind === "string" ? details.kind : null;
  const env: Env = {
    isAdmin: opts.isAdmin,
    methodLabel: opts.methodLabel,
    kind,
    rowCurrency: rowCurrencyOf(meta, opts.row),
    names: nameIndex(meta, details, opts.row),
    legacy: false,
  };

  const detailRows = details ? toRows(details, env, HIDDEN_DETAIL_KEYS) : [];
  const payment = buildPayment(
    meta.payment_snapshot,
    positiveId(details?.paid_in_session),
    opts.methodLabel,
    isReversalRow(opts.row, details) ? (opts.row?.payments ?? null) : null,
    isPayoutRow(opts.row),
  );
  const other = toRows(meta, { ...env, kind: null, legacy: true }, [
    "details",
    "payment_snapshot",
  ]);

  return {
    kindLabel: kind ? kindLabel(kind) : null,
    details: detailRows,
    payment,
    other,
    isEmpty:
      detailRows.length === 0 &&
      other.length === 0 &&
      (payment === null ||
        (payment.lines.length === 0 &&
          !payment.changeReturned &&
          !payment.kept &&
          payment.sessionId === null)),
  };
}

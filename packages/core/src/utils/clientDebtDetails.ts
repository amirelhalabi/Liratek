/**
 * LIRA-350 — what a client's account row says, in words the client
 * understands: ONE line per row plus the detail window's fields, items and
 * payment legs, built from what the transaction already saved
 * (`metadata_json.details`, its `payment_snapshot`, and the voucher / loto
 * record) instead of the short debt note.
 *
 * The one definition (rule 14): the Accounts page rows, their details
 * window, the repayment picker's item labels and the client statement
 * export all read it.
 *
 * Client-facing by construction (review finding C13): every value below is
 * picked by name from a WHITELIST of saved fields. Cost, profit,
 * commission, product ids and internal status codes are never read, so
 * they cannot leak when the screen is turned to the client.
 *
 * Read-time only: nothing here is stored, so there is no second copy to
 * keep in step (rule 31) — editing a transaction's saved details changes
 * the line on the next read.
 *
 * Pure and import-free (rule 29: exported from `browser.ts`). Numbers are
 * formatted by hand, never `toLocaleString`, so desktop and web read the
 * same text whatever the host locale (rule 27). Field labels are keys the
 * screen translates; the line itself is English, like the transaction
 * summary it replaces.
 */

import { providerDisplayLabel } from "./financialServiceSummary.js";
import {
  buildSplitCheckoutLabel,
  type SplitCheckoutItem,
} from "./splitCheckoutItems.js";

// ── Inputs ──────────────────────────────────────────────────────────────

/** The transaction a debt row belongs to, plus its voucher / loto record. */
export interface ClientDebtTxSource {
  id: number;
  type: string;
  summary: string | null;
  metadata_json: string | null;
  amount_usd: number;
  amount_lbp: number;
  /** LIRA-319 extra the customer added on top (transactions.extra_*). */
  extra_usd?: number | null;
  extra_lbp?: number | null;
  source_id?: number | null;
  /** LIRA-349 A3 — every unit of the multi-unit split checkout this row
   *  carries (`TransactionRepository.getSplitCheckoutItems`); null/absent
   *  for anything else. */
  splitItems?: SplitCheckoutItem[] | null;
  /** The live `vouchers` row (note / status / expiry are only there). */
  voucher?: {
    code: string;
    amount: number;
    currency_code: string;
    expiry_date: string | null;
    status: string;
    note: string | null;
  } | null;
  /** The `loto_tickets` row (ticket number / note are only there). */
  loto?: {
    ticket_number: string | null;
    sale_date: string | null;
    note: string | null;
  } | null;
}

/** One item of a session basket and its share of the basket's debt
 *  (`customer_session_transactions.owed_*`, read as stored). */
export interface ClientDebtSessionMember {
  tx: ClientDebtTxSource;
  owed_usd: number;
  owed_lbp: number;
}

export interface ClientDebtSource {
  /** The debt_ledger row: its amounts are what is on the account. */
  ledger: {
    transaction_type: string;
    amount_usd: number;
    amount_lbp: number;
    note: string | null;
    session_id?: number | null;
  };
  tx?: ClientDebtTxSource | null;
  /** A session basket row: its items and the basket's checkout legs. */
  session?: {
    members: ClientDebtSessionMember[];
    payments: Array<{ method: string; currency: string; amount: number }>;
  } | null;
}

// ── Output ──────────────────────────────────────────────────────────────

export type ClientDebtKind =
  | "pos_sale"
  | "recharge"
  | "transfer"
  | "bill"
  | "custom_service"
  | "maintenance"
  | "loto"
  | "exchange"
  | "voucher"
  | "session"
  | "manual"
  | "other";

/** Field label keys (translated by the screen, `clientDebt.field.<key>`). */
export type ClientDebtFieldKey =
  | "service"
  | "carrier"
  | "phone"
  | "credits"
  | "days"
  | "gift"
  | "price"
  | "amount"
  | "fee"
  | "total"
  | "discount"
  | "reference"
  | "sender"
  | "receiver"
  | "description"
  | "device"
  | "issue"
  | "labour"
  | "warrantyUntil"
  | "status"
  | "ticket"
  | "date"
  | "gave"
  | "received"
  | "rate"
  | "code"
  | "value"
  | "expiry";

export interface ClientDebtField {
  key: ClientDebtFieldKey;
  value: string;
  /** "date" = a `YYYY-MM-DD` day the screen formats. */
  type?: "date";
}

export interface ClientDebtItem {
  name: string;
  quantity: number;
  unitPrice?: string;
  total?: string;
}

export interface ClientDebtPayment {
  /** Payment-method code; the screen shows its label. */
  method: string;
  currency: string;
  amount: number;
  text: string;
  /** IN = the client paid; OUT = handed to the client (change, exchange). */
  direction: "IN" | "OUT";
}

export interface ClientDebtDetails {
  kind: ClientDebtKind;
  /** "#282", "#51" — shown next to the kind's title; null when none. */
  ref: string | null;
  line: string;
  fields: ClientDebtField[];
  items: ClientDebtItem[];
  payments: ClientDebtPayment[];
  /** What this row put on the account (the debt row's own amounts). */
  onAccount: { usd: number; lbp: number };
  /** The cashier's own note, exactly as typed. */
  note: string | null;
  /** Session basket only: each item, with how it was paid. */
  members?: ClientDebtMemberDetails[];
}

export interface ClientDebtMemberDetails {
  kind: ClientDebtKind;
  line: string;
  /** "Paid" or "600,000 LBP on account" (English, for exports). */
  paidText: string;
  /** This item's share of the basket's debt (0/0 = paid at checkout). */
  onAccount: { usd: number; lbp: number };
}

// ── Formatting (deterministic, rule 27) ─────────────────────────────────

function group(n: number): string {
  const [int, frac] = Math.abs(n).toString().split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${n < 0 ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

/** "$25", "$6.74", "300,000 LBP", "12 EUR". */
export function clientMoney(amount: number, currency: string): string {
  const c = (currency || "USD").toUpperCase();
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  if (c === "LBP") {
    const lbp = Math.round(abs);
    return `${lbp === 0 ? "" : sign}${group(lbp)} LBP`;
  }
  const cents = Math.round(abs * 100);
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  const text = `${group(whole)}${frac ? `.${frac.toString().padStart(2, "0")}` : ""}`;
  const signed = cents === 0 ? "" : sign;
  return c === "USD" ? `${signed}$${text}` : `${signed}${text} ${c}`;
}

function usdLbpText(usd: number, lbp: number): string {
  const parts: string[] = [];
  if (Math.abs(usd) > 0.004) parts.push(clientMoney(usd, "USD"));
  if (Math.abs(lbp) > 0.5) parts.push(clientMoney(lbp, "LBP"));
  return parts.join(" + ");
}

function words(code: string): string {
  const s = code.replace(/_/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Saved-data readers ──────────────────────────────────────────────────

type Json = Record<string, unknown>;

function obj(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function arr(v: unknown): Json[] {
  return Array.isArray(v) ? v.map(obj).filter((x): x is Json => !!x) : [];
}

function parseMeta(json: string | null): Json {
  if (!json) return {};
  try {
    return obj(JSON.parse(json)) ?? {};
  } catch {
    return {};
  }
}

const PROVIDER_NAMES: Record<string, string> = {
  OMT: "OMT",
  WHISH: "Whish",
  OMT_APP: "OMT App",
  WHISH_APP: "Whish App",
  BINANCE: "Binance",
  IPICK: "iPick",
  KATSH: "Katsh",
  MTC: "MTC",
  ALFA: "Alfa",
};
function providerName(code: string | null): string {
  if (!code) return "";
  return PROVIDER_NAMES[code.toUpperCase()] ?? code;
}

function snapshotPayments(meta: Json): ClientDebtPayment[] {
  const snap = obj(meta.payment_snapshot);
  return arr(snap?.lines).flatMap((l): ClientDebtPayment[] => {
    const method = str(l.method);
    const currency = str(l.currency);
    const amount = num(l.amount);
    if (!method || !currency || amount == null) return [];
    return [
      {
        method,
        currency,
        amount,
        text: clientMoney(amount, currency),
        direction: l.direction === "OUT" ? "OUT" : "IN",
      },
    ];
  });
}

const ACCOUNT_METHODS = new Set(["CUSTOMER_ACCOUNT", "DEBT"]);

/** What the client paid there and then (IN legs not put on the account). */
function paidNowText(payments: ClientDebtPayment[]): string {
  return payments
    .filter((p) => p.direction === "IN" && !ACCOUNT_METHODS.has(p.method))
    .map((p) => p.text)
    .join(" + ");
}

// ── Per-kind builders ───────────────────────────────────────────────────

interface Built {
  kind: ClientDebtKind;
  ref: string | null;
  /** The "what" part of the line, its money included. */
  what: string;
  fields: ClientDebtField[];
  items: ClientDebtItem[];
  note: string | null;
}

function field(
  key: ClientDebtFieldKey,
  value: string | null | undefined,
  type?: "date",
): ClientDebtField[] {
  if (!value) return [];
  return [type ? { key, value, type } : { key, value }];
}

function txTotal(tx: ClientDebtTxSource): string {
  return usdLbpText(tx.amount_usd, tx.amount_lbp);
}

function summaryRef(summary: string | null): string | null {
  const m = summary?.match(/#(\d+)/);
  return m ? `#${m[1]}` : null;
}

function buildPosSale(tx: ClientDebtTxSource, d: Json): Built {
  const currency = str(d.paymentCurrency) ?? "USD";
  const items = arr(d.items).map((i): ClientDebtItem => {
    const quantity = num(i.quantity) ?? 1;
    const unit = num(i.unitPrice);
    return {
      name: str(i.name) ?? "Item",
      quantity,
      ...(unit != null
        ? {
            unitPrice: clientMoney(unit, currency),
            total: clientMoney(unit * quantity, currency),
          }
        : {}),
    };
  });
  const discount = obj(d.discount);
  const discountAmount = num(discount?.amount);
  const discountText =
    discountAmount && discountAmount > 0
      ? clientMoney(discountAmount, str(discount?.currency) ?? currency)
      : null;
  const names = items.map((i) => `${group(i.quantity)}× ${i.name}`).join(", ");
  const total = txTotal(tx);
  const ref = summaryRef(tx.summary);
  return {
    kind: "pos_sale",
    ref,
    what: `${ref ? `Sale ${ref}: ` : ""}${names || "Sale"} — ${total}${discountText ? ` (discount ${discountText})` : ""}`,
    fields: [...field("discount", discountText), ...field("total", total)],
    items,
    note: str(d.note),
  };
}

function buildRecharge(tx: ClientDebtTxSource, d: Json, meta: Json): Built {
  const carrier = providerName(str(d.carrier) ?? str(meta.provider));
  const type = str(d.type) ?? str(meta.type) ?? "";
  const phone = str(d.phone) ?? str(meta.phone);
  const price = txTotal(tx);
  let what: string;
  const fields: ClientDebtField[] = [...field("carrier", carrier)];
  if (type === "DAYS") {
    const days = num(d.days) ?? num(meta.amount);
    what = `${carrier} ${days ?? ""} days`.replace(/\s+/g, " ");
    fields.push(...field("days", days != null ? String(days) : null));
  } else if (type === "ALFA_GIFT") {
    const gift = str(obj(d.giftTier)?.label);
    what = `${carrier} gift${gift ? ` ${gift}` : ""}`;
    fields.push(...field("gift", gift));
  } else {
    const credits = num(d.amount) ?? num(meta.amount);
    what =
      `${carrier} ${credits != null ? clientMoney(credits, "USD") : ""} credit`.replace(
        /\s+/g,
        " ",
      );
    fields.push(
      ...field("credits", credits != null ? clientMoney(credits, "USD") : null),
    );
  }
  fields.push(...field("phone", phone), ...field("price", price));
  return {
    kind: "recharge",
    ref: null,
    what: `${what}${phone ? ` → ${phone}` : ""} — ${price}`,
    fields,
    items: [],
    note: str(d.note),
  };
}

function person(p: unknown): string | null {
  const o = obj(p);
  if (!o) return null;
  const parts = [str(o.name), str(o.phone)].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * "OMT send $20 + $1 fee = $21, ref OMT-REF-2610" — the ONE wording of a
 * transfer send (rule 14): the debt note written at booking time
 * (`FinancialServiceRepository.transferSendDebtNote`, LIRA-349) and the
 * Accounts line read here both come from it. `onAccount` adds
 * " — $10 on account" when only part of the charge went on the account.
 */
export function transferSendLine(i: {
  provider: string;
  amount: number;
  fee: number;
  extra: number;
  currency: string;
  reference?: string | null;
  onAccount?: { amount: number; currency: string };
}): string {
  const fmt = (n: number, cur: string = i.currency) => clientMoney(n, cur);
  const total = i.amount + i.fee + i.extra;
  let line = `${providerDisplayLabel(i.provider)} send ${fmt(i.amount)}`;
  if (i.fee > 0) line += ` + ${fmt(i.fee)} fee`;
  if (i.extra > 0) line += ` + ${fmt(i.extra)} extra`;
  if (i.fee > 0 || i.extra > 0) line += ` = ${fmt(total)}`;
  const ref = i.reference?.trim();
  if (ref) line += `, ref ${ref}`;
  if (
    i.onAccount &&
    (i.onAccount.currency !== i.currency ||
      Math.abs(i.onAccount.amount - total) > 0.005)
  ) {
    line += ` — ${fmt(i.onAccount.amount, i.onAccount.currency)} on account`;
  }
  return line;
}

function buildTransfer(tx: ClientDebtTxSource, d: Json, meta: Json): Built {
  const providerCode = str(d.provider) ?? str(meta.provider) ?? "";
  const provider = providerName(providerCode);
  const direction = (
    str(d.direction) ??
    str(meta.service_type) ??
    "SEND"
  ).toUpperCase();
  const serviceType = str(d.serviceType);
  const currency = str(meta.currency) ?? (tx.amount_lbp ? "LBP" : "USD");
  const amount = num(meta.amount);
  const fee = num(d.omtFee) ?? num(d.whishFee) ?? 0;
  const extra = (currency === "LBP" ? tx.extra_lbp : tx.extra_usd) ?? 0;
  const total = txTotal(tx);
  const reference = str(d.reference);
  const amountText = amount != null ? clientMoney(amount, currency) : null;
  const feeText = fee > 0 ? clientMoney(fee, currency) : null;
  const what =
    direction === "SEND" && amount != null
      ? transferSendLine({
          provider: providerCode,
          amount,
          fee,
          extra,
          currency,
          reference,
        })
      : `${provider} ${direction.toLowerCase()} ${amountText ?? total}${reference ? `, ref ${reference}` : ""}`;
  return {
    kind: "transfer",
    ref: null,
    what,
    fields: [
      ...field(
        "service",
        `${provider} ${direction.toLowerCase()}${serviceType ? ` (${words(serviceType)})` : ""}`,
      ),
      ...field("amount", amountText),
      ...field("fee", feeText),
      ...field("total", total),
      ...field("reference", reference),
      ...field("sender", person(d.sender)),
      ...field("receiver", person(d.receiver)),
    ],
    items: [],
    note: str(d.note),
  };
}

/** "alfa: 3.03 (Prepaid)" — the sale note's own wording
 *  (`formatCatalogItemName`); the subcategory is the key's third part. */
function catalogItemName(i: Json): string {
  const key = str(i.key);
  const parts = key ? key.split("/") : [];
  const sub = parts.length >= 4 ? parts[2]!.trim() : "";
  const category = str(i.category) ?? parts[1] ?? "";
  const label =
    str(i.label) ?? (parts.length >= 4 ? parts.slice(3).join("/") : "");
  const name = [category, label].filter(Boolean).join(": ");
  return `${name}${sub ? ` (${sub})` : ""}`.trim() || "Item";
}

function buildBill(tx: ClientDebtTxSource, d: Json, meta: Json): Built {
  const provider = providerName(str(d.provider) ?? str(meta.provider));
  const split =
    tx.splitItems && tx.splitItems.length > 1 ? tx.splitItems : null;
  if (split) {
    // LIRA-349 A3 — the ONE label of a multi-unit checkout, built on theirs.
    return {
      kind: "bill",
      ref: null,
      what: buildSplitCheckoutLabel(split),
      fields: [...field("service", `${provider} bill`)],
      items: split.map((u) => ({
        name: u.name,
        quantity: 1,
        unitPrice: clientMoney(u.amount, u.currency),
        total: clientMoney(u.amount, u.currency),
      })),
      note: str(d.note),
    };
  }
  const currency = str(d.currencyMode) ?? str(meta.currency) ?? "LBP";
  const items = arr(d.items).map((i): ClientDebtItem => {
    const quantity = num(i.quantity) ?? 1;
    const unit = num(i.unitPrice);
    return {
      name: catalogItemName(i),
      quantity,
      ...(unit != null
        ? {
            unitPrice: clientMoney(unit, currency),
            total: clientMoney(unit * quantity, currency),
          }
        : {}),
    };
  });
  const names = items
    .map((i) => (i.quantity > 1 ? `${i.name} x${group(i.quantity)}` : i.name))
    .join(", ");
  const total = txTotal(tx);
  return {
    kind: "bill",
    ref: null,
    // No saved items (older rows): the stored summary, as before.
    what: names ? `${provider}: ${names} — ${total}` : (tx.summary ?? total),
    fields: [...field("service", `${provider} bill`), ...field("total", total)],
    items,
    note: str(d.note),
  };
}

function buildCustomService(
  tx: ClientDebtTxSource,
  d: Json,
  meta: Json,
): Built {
  const description =
    str(d.description) ??
    tx.summary?.replace(/^Custom Service:\s*/, "").trim() ??
    "Service";
  const total = txTotal(tx);
  return {
    kind: "custom_service",
    ref: null,
    what: `${description} — ${total}`,
    fields: [...field("description", description), ...field("price", total)],
    items: [],
    note: str(d.note) ?? str(meta.note),
  };
}

/** "Delivered_Paid" → "Delivered": whether the job is paid is what the
 *  account itself says, so only the job's stage is shown. */
function maintenanceStage(status: string | null): string | null {
  if (!status) return null;
  return words(status.replace(/_Paid$/i, ""));
}

function buildMaintenance(tx: ClientDebtTxSource, d: Json): Built {
  const jobId = num(d.jobId) ?? tx.source_id ?? null;
  const device = str(d.device);
  const issue = str(d.issue);
  const price = obj(d.price);
  const labour = usdLbpText(num(price?.usd) ?? 0, num(price?.lbp) ?? 0);
  const items = arr(d.parts).map((p): ClientDebtItem => {
    const quantity = num(p.quantity) ?? 1;
    const unit = num(p.unitPrice);
    return {
      name: str(p.name) ?? "Part",
      quantity,
      ...(unit != null
        ? {
            unitPrice: clientMoney(unit, "USD"),
            total: clientMoney(unit * quantity, "USD"),
          }
        : {}),
    };
  });
  const total = txTotal(tx);
  const about = [device, issue].filter(Boolean).join(": ");
  return {
    kind: "maintenance",
    ref: jobId != null ? `#${jobId}` : null,
    what: `Job${jobId != null ? ` #${jobId}` : ""}${about ? ` — ${about}` : ""} — ${total}`,
    fields: [
      ...field("device", device),
      ...field("issue", issue),
      ...field("labour", labour || null),
      ...field("total", total),
      ...field("warrantyUntil", str(d.warrantyUntil), "date"),
      ...field("status", maintenanceStage(str(d.status))),
    ],
    items,
    note: str(d.note),
  };
}

function buildLoto(tx: ClientDebtTxSource, d: Json): Built {
  const ticket = str(tx.loto?.ticket_number) ?? str(d.ticketNumber);
  const total = txTotal(tx);
  const day = str(tx.loto?.sale_date)?.slice(0, 10) ?? null;
  return {
    kind: "loto",
    ref: null,
    what: `Loto ticket${ticket ? ` #${ticket}` : ""} — ${total}`,
    fields: [
      ...field("ticket", ticket),
      ...field("amount", total),
      ...field("date", day, "date"),
    ],
    items: [],
    note: str(tx.loto?.note) ?? str(d.note),
  };
}

function buildExchange(tx: ClientDebtTxSource, d: Json, meta: Json): Built {
  const from = str(d.from) ?? str(meta.from_currency) ?? "USD";
  const to = str(d.to) ?? str(meta.to_currency) ?? "LBP";
  const amountIn = num(d.amountIn) ?? num(meta.amount_in);
  const amountOut = num(d.amountOut) ?? num(meta.amount_out);
  const rate =
    num(arr(d.legs)[0]?.rate) ?? num(d.payoutRate) ?? num(meta.leg1_rate);
  const gave = amountIn != null ? clientMoney(amountIn, from) : null;
  const received = amountOut != null ? clientMoney(amountOut, to) : null;
  const rateText = rate != null ? group(rate) : null;
  return {
    kind: "exchange",
    ref: null,
    what:
      gave && received
        ? `${gave} → ${received}${rateText ? ` @ ${rateText}` : ""}`
        : (tx.summary ?? "Exchange"),
    fields: [
      ...field("gave", gave),
      ...field("received", received),
      ...field("rate", rateText),
    ],
    items: [],
    note: str(d.note),
  };
}

function buildVoucher(tx: ClientDebtTxSource, meta: Json): Built {
  const v = tx.voucher;
  const code = str(v?.code) ?? str(meta.code) ?? "";
  const value =
    v != null ? clientMoney(v.amount, v.currency_code || "USD") : txTotal(tx);
  const status = v?.status ? words(v.status) : null;
  const expiry = str(v?.expiry_date)?.slice(0, 10) ?? null;
  const state = [status, expiry ? `expires ${expiry}` : v ? "no expiry" : null]
    .filter(Boolean)
    .join(", ");
  return {
    kind: "voucher",
    ref: null,
    what: `Voucher ${code} ${value}${state ? ` (${state})` : ""}`.replace(
      /\s+/g,
      " ",
    ),
    fields: [
      ...field("code", code || null),
      ...field("value", value),
      ...field("expiry", expiry, "date"),
      ...field("status", status),
    ],
    items: [],
    note: str(v?.note),
  };
}

function buildFromTx(tx: ClientDebtTxSource): Built {
  const meta = parseMeta(tx.metadata_json);
  const d = obj(meta.details) ?? {};
  const kind = str(d.kind);
  if (kind === "pos_sale" || (tx.type === "SALE" && !kind))
    return buildPosSale(tx, d);
  if (kind === "telecom_recharge") return buildRecharge(tx, d, meta);
  if (kind === "omt_whish_transfer") return buildTransfer(tx, d, meta);
  if (kind === "catalog_sale" || (tx.splitItems && tx.splitItems.length > 1))
    return buildBill(tx, d, meta);
  if (kind === "custom_service" || tx.type === "CUSTOM_SERVICE")
    return buildCustomService(tx, d, meta);
  if (kind === "maintenance_job") return buildMaintenance(tx, d);
  if (kind === "loto_sale" || tx.type === "LOTO") return buildLoto(tx, d);
  if (kind === "exchange" || tx.type === "EXCHANGE")
    return buildExchange(tx, d, meta);
  if (tx.type === "VOUCHER_SALE" || meta.kind === "voucher_sale")
    return buildVoucher(tx, meta);
  if (tx.type === "RECHARGE") return buildRecharge(tx, d, meta);
  // Any other saved kind: the transaction's own summary (never its
  // metadata) with its amount.
  return {
    kind: "other",
    ref: null,
    what: tx.summary ?? txTotal(tx),
    fields: [...field("total", txTotal(tx))],
    items: [],
    note: str(d.note),
  };
}

/** ", paid $10, $15 on account" — only when part was paid there and then
 *  (an all-on-account row's amount is already in the row's own columns). */
function paidSuffix(
  payments: ClientDebtPayment[],
  onAccount: { usd: number; lbp: number },
): string {
  // Only a row that put money ON the account (a charge) says so; a
  // repayment / refund / discount row (negative) took money off it and
  // reads as its own summary.
  const owed = usdLbpText(
    Math.max(0, onAccount.usd),
    Math.max(0, onAccount.lbp),
  );
  if (!owed) return "";
  const paid = paidNowText(payments);
  if (!paid) return "";
  return `, paid ${paid}, ${owed} on account`;
}

function joinNote(line: string, note: string | null): string {
  return note ? `${line} — ${note}` : line;
}

// ── Entry point ─────────────────────────────────────────────────────────

export function buildClientDebtDetails(
  src: ClientDebtSource,
): ClientDebtDetails {
  const onAccount = {
    usd: src.ledger.amount_usd || 0,
    lbp: src.ledger.amount_lbp || 0,
  };

  if (src.session) {
    const sessionId = src.ledger.session_id ?? null;
    const members = src.session.members.map((m): ClientDebtMemberDetails => {
      const b = buildFromTx(m.tx);
      const owed = usdLbpText(m.owed_usd || 0, m.owed_lbp || 0);
      return {
        kind: b.kind,
        line: b.what,
        paidText: owed ? `${owed} on account` : "Paid",
        onAccount: { usd: m.owed_usd || 0, lbp: m.owed_lbp || 0 },
      };
    });
    const payments = src.session.payments.map(
      (p): ClientDebtPayment => ({
        method: p.method,
        currency: p.currency,
        amount: Math.abs(p.amount),
        text: clientMoney(Math.abs(p.amount), p.currency),
        direction: p.amount < 0 ? "OUT" : "IN",
      }),
    );
    const list = members
      .map((m) => `${m.line} (${m.paidText === "Paid" ? "paid" : m.paidText})`)
      .join("; ");
    return {
      kind: "session",
      ref: sessionId != null ? `#${sessionId}` : null,
      line:
        list.length > 0
          ? `Session${sessionId != null ? ` #${sessionId}` : ""}: ${list}`
          : (src.ledger.note ?? ""),
      fields: [],
      items: [],
      payments,
      onAccount,
      note: null,
      members,
    };
  }

  if (!src.tx) {
    return {
      kind: "manual",
      ref: null,
      line: src.ledger.note ?? "",
      fields: [],
      items: [],
      payments: [],
      onAccount,
      note: null,
    };
  }

  const built = buildFromTx(src.tx);
  const payments = snapshotPayments(parseMeta(src.tx.metadata_json));
  return {
    kind: built.kind,
    ref: built.ref,
    line: joinNote(
      `${built.what}${paidSuffix(payments, onAccount)}`,
      built.note,
    ),
    fields: built.fields,
    items: built.items,
    payments,
    onAccount,
    note: built.note,
  };
}

/** The short line for an item of the repayment picker (no ledger row at
 *  hand): the same "what" the Accounts row shows, without its payments. */
export function clientDebtItemLine(tx: ClientDebtTxSource): string {
  const b = buildFromTx(tx);
  return joinNote(b.what, b.note);
}

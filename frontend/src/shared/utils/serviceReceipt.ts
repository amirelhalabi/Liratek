/**
 * Service-transaction receipt builder (RCP-2, docs/plans/done_plans/RECEIPTS_PLAN.md).
 *
 * ONE builder for every non-sale module (mobile services, recharge,
 * maintenance, custom services, loto). Sourced entirely from the PERSISTED
 * unified transaction + its customer-facing payment legs — never live form
 * state — so print-after-success and reprint-from-history are provably
 * identical (same lesson as the T2 display-vs-booking split).
 *
 * "Detailed" = customer-facing detail: amount, fee/commission, and the
 * payment-method split + change. It deliberately NEVER prints cost / price /
 * profit (that would leak the shop's margin onto the customer's receipt).
 *
 * Card-grid items (Katsh/iPick catalog, item_key set): the transaction `note`
 * already reads "category: label (subcategory)" (formatCatalogItemName), so
 * it is shown as the item line — the "nice simple way" to surface the
 * category + subcategory without threading structured metadata.
 */

import { printReceipt } from "./printReceipt";
import { rechargeDetailLabel } from "./rechargeLabels";
import { wrapReceiptText } from "./receiptWrap";

const WIDTH = 42;

/** The transaction fields the receipt needs (a subset of the unified row). */
export interface ServiceReceiptTxn {
  id: number;
  type: string;
  summary: string | null;
  note: string | null;
  client_name: string | null;
  client_phone: string | null;
  created_at: string;
  /** Parsed metadata_json (provider/service_type/amount/currency/commission/…). */
  metadata: Record<string, unknown> | null;
}

/** A customer-facing payment leg (already filtered per lira-064 by the caller). */
export interface ServiceReceiptLeg {
  method: string;
  currency_code: string;
  amount: number;
  direction?: "IN" | "OUT";
}

/** The shop fields a service receipt prints. `headerText` (LIRA-296, SF-3)
 *  is the saved "Receipt Header Text", printed under the shop name. */
export interface ServiceReceiptShop {
  name: string;
  phone?: string;
  location?: string;
  headerText?: string;
}

export interface ServiceReceiptInput {
  shop: ServiceReceiptShop;
  txn: ServiceReceiptTxn;
  legs: ServiceReceiptLeg[];
  operator?: string;
}

/**
 * The slice of `ApiAdapter` (`@liratek/ui`) the receipt-by-transaction
 * helpers below need — rule 19 fix. This file is a plain util, not a hook,
 * so it can't call `useApi()` itself; the caller passes its `useApi()`
 * result (or, in `TransactionsViewer.tsx`, the ref holding it — rule 25) in
 * as a parameter instead. Narrowed to exactly the 3 reads used (ISP) rather
 * than taking the whole `ApiAdapter`, so a test mock only has to stub 3
 * methods.
 */
export interface ServiceReceiptApi {
  getTransactionById: (id: number) => Promise<unknown>;
  getCustomerFacingLegs: (transactionId: number) => Promise<ServiceReceiptLeg[]>;
  getAllSettings: () => Promise<Array<{ key_name: string; value: string }>>;
}

function fmtMoney(amount: number, currency: string): string {
  const abs = Math.abs(amount);
  return currency === "LBP" || currency === "USDT"
    ? `${Math.round(abs).toLocaleString()} ${currency}`
    : `$${abs.toFixed(2)}`;
}

/** Title-case a raw catalog key ("alfa" → "Alfa") for a tidy item line. */
function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Pretty the card-grid note "category: label (subcategory)" → title-cased. */
function prettyItemNote(note: string): string {
  const m = note.match(/^([^:]+):\s*(.*?)\s*(?:\(([^)]*)\))?$/);
  if (!m) return note;
  const [, cat, label, sub] = m;
  const head = `${titleCase(cat.trim())}: ${label.trim()}`;
  return sub ? `${head} (${titleCase(sub.trim())})` : head;
}

/**
 * Build the monospace text for a service-transaction receipt (58/80mm).
 * Pure — unit-tested directly.
 */
export function buildServiceReceiptText(input: ServiceReceiptInput): string {
  const { shop, txn, legs, operator } = input;
  const meta = txn.metadata ?? {};
  const provider = String(meta.provider ?? "");
  // RECHARGE has no metadata.service_type — its subtype + dollar face value
  // (e.g. "Credits $6") lives in metadata.type + metadata.amount instead,
  // matching the audit table's own "MTC Credits $6 — 720,000 LBP" summary.
  const serviceType =
    txn.type === "RECHARGE" && meta.type
      ? rechargeDetailLabel(String(meta.type), Number(meta.amount ?? 0))
      : String(meta.service_type ?? "");
  const currency = String(meta.currency ?? "USD");
  // RECHARGE's metadata.amount is NEVER a currency figure — for CREDIT_TRANSFER/
  // VOUCHER/ALFA_GIFT it's the recharge's dollar face value (e.g. "$6 credits",
  // RechargeRepository's describeRechargeAmount) and for DAYS it's a day count —
  // both independent of `currency`/`price` (what the customer actually paid,
  // e.g. 720,000 LBP for a "$6" MTC package at a shop-set rate). Pairing
  // `amount` with `currency` printed "6 LBP" instead of "720,000 LBP". Every
  // other module (FINANCIAL_SERVICE, etc.) keeps `amount` — there it's the
  // real customer-facing base figure and `price` is 0/absent outside the
  // cost+price catalog flow.
  const amount =
    txn.type === "RECHARGE" && meta.price != null
      ? Number(meta.price)
      : Number(meta.amount ?? 0);
  const commission = Number(meta.commission ?? 0);
  // LIRA-185 #1 follow-up (owner decision 2026-10-02): an MTC/Alfa sale with
  // a payment-sheet Discount stamps `metadata_json.discount`/`list_price`
  // alongside the charged `price` (RechargeRepository.processRecharge). When
  // present and > 0, the receipt breaks the single "Amount:" line into
  // Price/Discount/Total so the customer sees what was actually taken off —
  // no other module stamps these fields today, so this is a no-op for every
  // other receipt (gated on discount > 0, never shown at 0).
  const discountAmt = Number(meta.discount ?? 0);
  const listPrice = Number(meta.list_price ?? 0);
  const itemKey = meta.item_key;
  // Maintenance parts (LIRA-176 7a): always USD, never converted (owner
  // decision 2026-09-07) — priced and printed independently of `currency`/
  // `amount` above, so an LBP-priced job's receipt shows pound labour and
  // dollar parts together. Price only: metadata carries no cost/margin field
  // for parts, so there is nothing to accidentally leak here.
  const rawParts = meta.parts;
  const parts: Array<{
    name: string;
    quantity: number;
    unit_price_usd: number;
  }> = Array.isArray(rawParts)
    ? rawParts.filter(
        (p): p is { name: string; quantity: number; unit_price_usd: number } =>
          typeof p === "object" &&
          p !== null &&
          typeof (p as Record<string, unknown>).name === "string" &&
          typeof (p as Record<string, unknown>).quantity === "number" &&
          typeof (p as Record<string, unknown>).unit_price_usd === "number",
      )
    : [];

  const border = "=".repeat(WIDTH);
  const rule = "-".repeat(WIDTH);

  const center = (text: string): string => {
    const t = (text || "").trim();
    if (!t) return "";
    const pad = Math.max(0, WIDTH - t.length);
    const left = Math.floor(pad / 2);
    return " ".repeat(left) + t + " ".repeat(pad - left);
  };
  const line = (label: string, value: string): string => {
    const gap = Math.max(1, WIDTH - label.length - value.length);
    return label + " ".repeat(gap) + value + "\n";
  };

  let r = border + "\n";
  if (shop.name) r += center(shop.name) + "\n";
  for (const headerLine of wrapReceiptText(shop.headerText ?? "", WIDTH)) {
    r += center(headerLine) + "\n";
  }
  if (shop.location) r += center(shop.location) + "\n";
  if (shop.phone) r += center(shop.phone) + "\n";
  r += border + "\n";

  const dt = new Date(txn.created_at);
  r += `#${txn.id}\n`;
  r += `${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}\n`;
  if (operator) r += `Served by: ${operator}\n`;

  if (txn.client_name?.trim()) {
    r += txn.client_name.trim();
    if (txn.client_phone?.trim()) r += ` ${txn.client_phone.trim()}`;
    r += "\n";
  }

  r += rule + "\n";

  // Service line: provider + service type.
  const svcHead = [provider, serviceType].filter(Boolean).join(" ").trim();
  if (svcHead) r += `Service: ${svcHead}\n`;

  // Card-grid item (item_key set): the note carries category/label/subcategory.
  if (itemKey && txn.note?.trim()) {
    r += `Item: ${prettyItemNote(txn.note.trim())}\n`;
  } else if (!itemKey && txn.note?.trim()) {
    // Non-catalog note (e.g. maintenance issue, custom-service description).
    r += `${txn.note.trim()}\n`;
  }

  r += rule + "\n";

  // Maintenance parts (LIRA-176 7a) — price only, always USD, never
  // converted. One line per part; quantity shown only when > 1 so a single
  // part reads as a plain name. Absent/empty/malformed metadata.parts
  // renders nothing, keeping every historical receipt byte-identical.
  for (const part of parts) {
    const label =
      part.quantity > 1 ? `${part.name} x${part.quantity}` : part.name;
    r += line(label, fmtMoney(part.unit_price_usd * part.quantity, "USD"));
  }

  // Amount + fee (customer-facing figures only — never cost/price/profit).
  if (amount) {
    if (discountAmt > 0 && listPrice > 0) {
      r += line("Price:", fmtMoney(listPrice, currency));
      r += line("Discount:", `-${fmtMoney(discountAmt, currency)}`);
      r += line("Total:", fmtMoney(amount, currency));
    } else {
      r += line("Amount:", fmtMoney(amount, currency));
    }
  }
  if (commission > 0) r += line("Fee:", fmtMoney(commission, currency));

  // Payment-method split (customer-paid IN legs) and change (OUT legs).
  const inLegs = legs.filter((l) => l.direction !== "OUT" && l.amount !== 0);
  const outLegs = legs.filter((l) => l.direction === "OUT" && l.amount !== 0);
  if (inLegs.length > 0) {
    r += rule + "\n";
    for (const l of inLegs) {
      r += line(
        `Paid (${l.method.replace(/_/g, " ")}):`,
        fmtMoney(l.amount, l.currency_code),
      );
    }
  }
  if (outLegs.length > 0) {
    for (const l of outLegs) {
      r += line("Change:", fmtMoney(l.amount, l.currency_code));
    }
  }

  r += border + "\n";
  r += center("Thank you!") + "\n";
  return r;
}

/**
 * Fetch a persisted transaction + its customer-facing legs and build the
 * receipt text (RCP-3), without printing. Shared by the print path below
 * and by any preview UI (e.g. TransactionsViewer's Print button) that needs
 * to show the receipt before committing to a print.
 *
 * `api` is required (rule 19 fix) — this used to call `window.api.*`
 * directly, which is `undefined` in a browser, so the Transactions page's
 * reprint button silently couldn't work on web.
 */
export async function buildServiceReceiptTextByTransaction(
  api: ServiceReceiptApi,
  transactionId: number,
  shop: ServiceReceiptShop,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const txn = await api.getTransactionById(transactionId);
    if (!txn) return { ok: false, error: "Transaction not found" };

    const legs = await api.getCustomerFacingLegs(transactionId);

    let metadata: Record<string, unknown> | null = null;
    const raw = (txn as { metadata_json?: unknown }).metadata_json;
    if (typeof raw === "string") {
      try {
        metadata = JSON.parse(raw);
      } catch {
        metadata = null;
      }
    } else if (raw && typeof raw === "object") {
      metadata = raw as Record<string, unknown>;
    }

    const t = txn as Record<string, unknown>;
    const text = buildServiceReceiptText({
      shop,
      txn: {
        id: Number(t.id),
        type: String(t.type ?? ""),
        summary: (t.summary as string) ?? null,
        note: (t.note as string) ?? null,
        client_name: (t.client_name as string) ?? null,
        client_phone: (t.client_phone as string) ?? null,
        created_at: String(t.created_at ?? new Date().toISOString()),
        metadata,
      },
      legs: legs ?? [],
    });

    return { ok: true, text };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to build receipt",
    };
  }
}

/** Look up the configured silent-print target printer (empty when none set). */
export async function getConfiguredReceiptPrinter(
  api: ServiceReceiptApi,
): Promise<string> {
  try {
    const settings = await api.getAllSettings();
    return (
      (settings?.find(
        (s: { key_name: string; value: string }) =>
          s.key_name === "receipt_printer",
      )?.value as string) || ""
    );
  } catch {
    return "";
  }
}

/**
 * Fetch a persisted transaction + its customer-facing legs and print a
 * service receipt (RCP-3). ONE path for both print-after-success and
 * reprint-from-history — the caller only needs the transaction id.
 * Resolves the configured silent printer and the shop logo itself.
 */
export async function printServiceReceiptByTransaction(
  api: ServiceReceiptApi,
  transactionId: number,
  shop: ServiceReceiptShop & { logo?: string },
): Promise<{ ok: boolean; error?: string }> {
  const built = await buildServiceReceiptTextByTransaction(
    api,
    transactionId,
    shop,
  );
  if (!built.ok || !built.text) {
    return { ok: false, ...(built.error ? { error: built.error } : {}) };
  }

  const printer = await getConfiguredReceiptPrinter(api);

  await printReceipt({
    text: built.text,
    printer,
    ...(shop.logo ? { logo: shop.logo } : {}),
  });
  return { ok: true };
}

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

export interface ServiceReceiptInput {
  shop: { name: string; phone?: string; location?: string };
  txn: ServiceReceiptTxn;
  legs: ServiceReceiptLeg[];
  operator?: string;
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
  const itemKey = meta.item_key;

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

  // Amount + fee (customer-facing figures only — never cost/price/profit).
  if (amount) r += line("Amount:", fmtMoney(amount, currency));
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
 */
export async function buildServiceReceiptTextByTransaction(
  transactionId: number,
  shop: { name: string; phone?: string; location?: string },
): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const txn = await window.api.transactions.getById(transactionId);
    if (!txn) return { ok: false, error: "Transaction not found" };

    const legs = (await window.api.transactions.getCustomerLegs(
      transactionId,
    )) as ServiceReceiptLeg[];

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
export async function getConfiguredReceiptPrinter(): Promise<string> {
  try {
    const settings = await window.api.settings.getAll();
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
  transactionId: number,
  shop: { name: string; phone?: string; location?: string; logo?: string },
): Promise<{ ok: boolean; error?: string }> {
  const built = await buildServiceReceiptTextByTransaction(transactionId, shop);
  if (!built.ok || !built.text) {
    return { ok: false, ...(built.error ? { error: built.error } : {}) };
  }

  const printer = await getConfiguredReceiptPrinter();

  await printReceipt({
    text: built.text,
    printer,
    ...(shop.logo ? { logo: shop.logo } : {}),
  });
  return { ok: true };
}

/**
 * Service-transaction receipt builder (RCP-2, docs/plans/RECEIPTS_PLAN.md).
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
  const serviceType = String(meta.service_type ?? "");
  const currency = String(meta.currency ?? "USD");
  const amount = Number(meta.amount ?? 0);
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

/**
 * Receipt Formatter Utility
 * Generates receipt data for thermal printer (58mm and 80mm widths)
 */

import { addMonthsIso } from "./dateMath";
import { wrapReceiptText } from "@/shared/utils/receiptWrap";

export interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
  subtotal: number;
  imei?: string | null;
  /** LIRA-296 P3: what the unit's serial is called ('IMEI' | 'Serial') —
   *  the product's category label. Missing on older data: "IMEI". */
  serial_label?: string | null;
  /** LIRA-143 phase 6a (owner decision #4) — live checkout preview/print,
   *  BEFORE the sale row exists: compute "Warranty until" from this
   *  receipt's `timestamp` + the product's warranty_months. Ignored when
   *  `warranty_until` (below) is present. */
  warranty_months?: number | null;
  /** LIRA-143 phase 6a — historical reprint (SaleDetailModal): the EXACT
   *  value already stamped on `sale_items.warranty_until` at sale time
   *  (correct even under a backdated transaction_time, unlike recomputing
   *  from `warranty_months` + "now"). Takes precedence over
   *  `warranty_months` when both are present. */
  warranty_until?: string | null;
}

/** "Warranty until: YYYY-MM-DD", or null when the item carries neither a
 *  stamped `warranty_until` nor a `warranty_months` to compute one from. */
function warrantyLineFor(item: ReceiptItem, timestamp: string): string | null {
  const until =
    item.warranty_until ??
    (item.warranty_months
      ? addMonthsIso(timestamp, item.warranty_months)
      : null);
  return until ? `Warranty until: ${until}` : null;
}

/** LIRA-296: the terms print only when at least one line carries a warranty. */
function hasWarrantyLine(data: ReceiptData): boolean {
  return data.items.some(
    (item) => !!item.warranty_until || (item.warranty_months ?? 0) > 0,
  );
}

export interface ReceiptData {
  shop_name: string;
  shop_phone?: string;
  shop_location?: string;
  receipt_number: string;
  client_name?: string;
  client_phone?: string;
  items: ReceiptItem[];
  subtotal: number;
  discount: number;
  /** LIRA-319: an extra charge added on top of the items (its own
   *  "Extra +$X" line). `total` already includes it. Omitted/0 = none. */
  extra?: number;
  total: number;
  /** Cash/wallet tender actually handed over — excludes on-account legs. */
  payment_usd: number;
  payment_lbp: number;
  /** LIRA-333: the gift-card part of a saved sale (USD) — its own
   *  "Gift card" line; omitted/0 = none. */
  gift_card_usd?: number;
  /** Portion charged to the client's account (debt) — printed separately so
   *  the receipt never claims a debt was paid as tender. */
  on_account_usd?: number;
  on_account_lbp?: number;
  change_usd: number;
  change_lbp: number;
  exchange_rate: number;
  timestamp: string;
  operator?: string;
  note?: string;
  /** Currency symbol for the primary currency (default: "$") */
  currency_symbol?: string;
  /** LIRA-296 (SF-3): the shop's saved "Receipt Header Text", printed under
   *  the shop name when not empty. */
  header_text?: string;
  /** LIRA-296: the shop's warranty terms, printed below the items only when
   *  a line carries a warranty. */
  warranty_terms?: string;
}

/**
 * Format receipt for 58mm thermal printer (default)
 */
export function formatReceipt58mm(data: ReceiptData): string {
  const width = 42; // 80mm paper width in characters
  const sym = data.currency_symbol ?? "$";

  const padCenter = (text: string, char = " "): string => {
    const cleanText = (text || "").trim();
    if (!cleanText) return "";
    const padding = Math.max(0, width - cleanText.length);
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return char.repeat(left) + cleanText + char.repeat(right);
  };

  let receipt = "";

  // Header
  const border = "=".repeat(width);
  receipt += border + "\n";

  const name = padCenter(data.shop_name);
  if (name) receipt += name + "\n";

  // LIRA-296 (SF-3): the saved receipt header, under the shop name.
  for (const headerLine of wrapReceiptText(data.header_text ?? "", width)) {
    receipt += padCenter(headerLine) + "\n";
  }

  const location = padCenter(data.shop_location || "");
  if (location) receipt += location + "\n";

  const phone = padCenter(data.shop_phone || "");
  if (phone) receipt += phone + "\n";

  receipt += border + "\n";

  // Receipt Info — date+time on one line
  const dt = new Date(data.timestamp);
  // LIRA-296: no number before the sale is saved (never a made-up one).
  if (data.receipt_number) receipt += `#${data.receipt_number}\n`;
  receipt += `${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}\n`;

  // Client Info (if available)
  if (data.client_name?.trim()) {
    receipt += `${data.client_name.trim()}`;
    if (data.client_phone?.trim()) receipt += ` ${data.client_phone.trim()}`;
    receipt += "\n";
  }

  // Items — single line per item: name  qty x price
  receipt += "-".repeat(width) + "\n";

  data.items.forEach((item) => {
    const priceStr = `${sym}${item.subtotal.toFixed(2)}`;
    const qtyPrice = `${item.quantity}x${sym}${item.price.toFixed(2)}`;
    // Available space for name = width - priceStr.length - 1 (space)
    const nameWidth = Math.max(8, width - priceStr.length - 1);
    const itemName =
      item.name.length > nameWidth
        ? item.name.substring(0, nameWidth)
        : item.name;

    // First line: name left-aligned, subtotal right-aligned
    receipt += itemName;
    receipt += " ".repeat(
      Math.max(1, width - itemName.length - priceStr.length),
    );
    receipt += priceStr + "\n";

    // Qty x unit-price on same or next mini-line if needed
    if (item.quantity > 1) {
      receipt += `  ${qtyPrice}\n`;
    }

    if (item.imei) {
      receipt += `  ${item.serial_label || "IMEI"}: ${item.imei}\n`;
    }

    const warrantyLine = warrantyLineFor(item, data.timestamp);
    if (warrantyLine) {
      receipt += `  ${warrantyLine}\n`;
    }
  });

  // LIRA-296: the shop's warranty terms, below the items, only when a line
  // carries a warranty.
  if (hasWarrantyLine(data)) {
    for (const termsLine of wrapReceiptText(data.warranty_terms ?? "", width)) {
      receipt += termsLine + "\n";
    }
  }

  receipt += "-".repeat(width) + "\n";

  // Totals
  const fmtLine = (label: string, value: string) => {
    const gap = Math.max(1, width - label.length - value.length);
    return label + " ".repeat(gap) + value + "\n";
  };

  const extra = data.extra ?? 0;
  if (data.discount > 0 || extra > 0) {
    receipt += fmtLine("Subtotal:", `${sym}${data.subtotal.toFixed(2)}`);
  }
  if (data.discount > 0) {
    receipt += fmtLine("Discount:", `-${sym}${data.discount.toFixed(2)}`);
  }
  if (extra > 0) {
    receipt += fmtLine("Extra:", `+${sym}${extra.toFixed(2)}`);
  }
  receipt += fmtLine("TOTAL:", `${sym}${data.total.toFixed(2)}`);

  const lbpTotal = data.total * data.exchange_rate;
  if (lbpTotal > 0) {
    const lbpStr = `${lbpTotal.toLocaleString()} LBP`;
    receipt += lbpStr.padStart(width, " ") + "\n";
  }

  // Payment
  receipt += "-".repeat(width) + "\n";
  receipt += fmtLine("Paid USD:", `${sym}${data.payment_usd.toFixed(2)}`);

  if (data.payment_lbp > 0) {
    receipt += fmtLine("Paid LBP:", `${data.payment_lbp.toLocaleString()}`);
  }

  if ((data.gift_card_usd ?? 0) > 0) {
    receipt += fmtLine(
      "Gift card:",
      `${sym}${(data.gift_card_usd ?? 0).toFixed(2)}`,
    );
  }

  if ((data.on_account_usd ?? 0) > 0) {
    receipt += fmtLine(
      "On Account:",
      `${sym}${(data.on_account_usd ?? 0).toFixed(2)}`,
    );
  }
  if ((data.on_account_lbp ?? 0) > 0) {
    receipt += fmtLine(
      "On Account LBP:",
      `${(data.on_account_lbp ?? 0).toLocaleString()}`,
    );
  }

  if (data.change_usd > 0) {
    receipt += fmtLine("Change:", `${sym}${data.change_usd.toFixed(2)}`);
  }
  if (data.change_lbp > 0) {
    receipt += fmtLine("Change LBP:", `${data.change_lbp.toLocaleString()}`);
  }

  receipt += border + "\n";
  if (data.note?.trim()) {
    const note = padCenter(data.note);
    if (note) receipt += note + "\n";
  }
  receipt += padCenter("Thank You!") + "\n";
  receipt += padCenter("Powered by LiraTek • 81077357") + "\n";
  receipt += border + "\n";

  return receipt;
}

/**
 * Format receipt for 80mm thermal printer
 */
export function formatReceipt80mm(data: ReceiptData): string {
  const width = 56; // 80mm width in characters
  const sym = data.currency_symbol ?? "$";

  const padCenter = (text: string): string => {
    const cleanText = (text || "").trim();
    if (!cleanText) return "";
    const padding = Math.max(0, width - cleanText.length);
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return " ".repeat(left) + cleanText + " ".repeat(right);
  };

  const padRight = (text: string, w: number): string => {
    return (text + " ".repeat(w)).slice(0, w);
  };

  let receipt = "";

  // Header
  const border = "═".repeat(width);
  receipt += padCenter(border) + "\n";

  const name = padCenter(data.shop_name);
  if (name) receipt += name + "\n";

  // LIRA-296 (SF-3): the saved receipt header, under the shop name.
  for (const headerLine of wrapReceiptText(data.header_text ?? "", width)) {
    receipt += padCenter(headerLine) + "\n";
  }

  const location = padCenter(data.shop_location || "");
  if (location) receipt += location + "\n";

  const phone = padCenter(data.shop_phone || "");
  if (phone) receipt += phone + "\n";

  receipt += padCenter("═ RECEIPT ═") + "\n";
  receipt += padCenter(border) + "\n";
  receipt += "\n";

  // Receipt Info
  if (data.receipt_number) {
    receipt += `Receipt #: ${data.receipt_number}`.padEnd(width) + "\n";
  }
  receipt +=
    `Date: ${new Date(data.timestamp).toLocaleDateString()}  Time: ${new Date(data.timestamp).toLocaleTimeString()}`.padEnd(
      width,
    ) + "\n";
  receipt += "\n";

  // Client Info
  if (data.client_name?.trim()) {
    receipt += `Client: ${data.client_name.trim()}`.padEnd(width) + "\n";
    if (data.client_phone?.trim()) {
      receipt += `Phone: ${data.client_phone.trim()}`.padEnd(width) + "\n";
    }
    receipt += "\n";
  }

  // Items Header
  receipt += "ITEM DETAILS\n";
  receipt += "─".repeat(width) + "\n";
  receipt += padRight("Item", 28) + padRight("Qty", 8) + "Amount\n";
  receipt += "─".repeat(width) + "\n";

  // Items
  data.items.forEach((item) => {
    const itemName = item.name.substring(0, 28);
    receipt += padRight(itemName, 28);
    receipt += padRight(item.quantity.toString(), 8);
    receipt += `${sym}${item.subtotal.toFixed(2)}\n`;
    if (item.imei) {
      receipt += `  ${item.serial_label || "IMEI"}: ${item.imei}\n`;
    }

    const warrantyLine = warrantyLineFor(item, data.timestamp);
    if (warrantyLine) {
      receipt += `  ${warrantyLine}\n`;
    }
  });

  // LIRA-296: the shop's warranty terms, below the items, only when a line
  // carries a warranty.
  if (hasWarrantyLine(data)) {
    for (const termsLine of wrapReceiptText(data.warranty_terms ?? "", width)) {
      receipt += termsLine + "\n";
    }
  }

  receipt += "─".repeat(width) + "\n";

  // Totals
  receipt += padRight("Subtotal:", 46) + `${sym}${data.subtotal.toFixed(2)}\n`;
  if (data.discount > 0) {
    receipt +=
      padRight("Discount:", 46) + `-${sym}${data.discount.toFixed(2)}\n`;
  }
  if ((data.extra ?? 0) > 0) {
    receipt +=
      padRight("Extra:", 46) + `+${sym}${(data.extra ?? 0).toFixed(2)}\n`;
  }
  receipt += padRight("TOTAL DUE:", 46) + `${sym}${data.total.toFixed(2)}\n`;
  receipt +=
    padRight("(LBP Equivalent):", 46) +
    `${(data.total * data.exchange_rate).toLocaleString()}\n`;
  receipt += "\n";

  // Payment Info
  receipt += "PAYMENT METHOD\n";
  receipt += "─".repeat(width) + "\n";
  receipt +=
    padRight("USD Received:", 46) + `${sym}${data.payment_usd.toFixed(2)}\n`;
  if (data.payment_lbp > 0) {
    receipt +=
      padRight("LBP Received:", 46) + `${data.payment_lbp.toLocaleString()}\n`;
    receipt +=
      padRight(`(@ ${data.exchange_rate}/USD)`, 46) +
      `${sym}${(data.payment_lbp / data.exchange_rate).toFixed(2)}\n`;
  }
  if ((data.gift_card_usd ?? 0) > 0) {
    receipt +=
      padRight("Gift card:", 46) +
      `${sym}${(data.gift_card_usd ?? 0).toFixed(2)}\n`;
  }
  if ((data.on_account_usd ?? 0) > 0) {
    receipt +=
      padRight("On Account - USD:", 46) +
      `${sym}${(data.on_account_usd ?? 0).toFixed(2)}\n`;
  }
  if ((data.on_account_lbp ?? 0) > 0) {
    receipt +=
      padRight("On Account - LBP:", 46) +
      `${(data.on_account_lbp ?? 0).toLocaleString()}\n`;
  }
  receipt +=
    padRight("Change - USD:", 46) + `${sym}${data.change_usd.toFixed(2)}\n`;
  if (data.change_lbp > 0) {
    receipt +=
      padRight("Change - LBP:", 46) + `${data.change_lbp.toLocaleString()}\n`;
  }

  receipt += "\n" + padCenter("═".repeat(width)) + "\n";
  if (data.note?.trim()) {
    const note = padCenter(data.note);
    if (note) receipt += note + "\n";
  }
  receipt += padCenter("✓ THANK YOU FOR YOUR BUSINESS ✓") + "\n";
  receipt += padCenter("Powered by LiraTek • 81077357") + "\n";
  receipt += padCenter("═".repeat(width)) + "\n";

  return receipt;
}

// ─────────────────────────────────────────────────────────────────────────────
// LIRA-333 — the receipt as a WhatsApp message (contracts/whatsapp-message.md)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Longest `encodeURIComponent(text)` the click-to-chat link may carry before
 * the message is shortened (FR-011).
 *
 * PROVISIONAL (2026-10-17): a conservative guess, NOT a measurement. Task
 * T031 measures the real limit on WhatsApp desktop (Windows), WhatsApp Web
 * (Chrome) and Android WhatsApp; replace this value and this comment with
 * that measurement (date + devices) when it is done.
 */
export const WHATSAPP_TEXT_MAX_ENCODED = 2000;

export const WHATSAPP_SHORTENED_NOTE =
  "(shortened — ask the shop for the full receipt)";

interface WhatsAppLayout {
  terms: boolean;
  itemDetails: boolean;
  /** how many items to list; the rest become "…and N more items" */
  itemLimit: number;
  shortened: boolean;
}

/** Non-empty trimmed lines of a free-text setting (header, terms). */
function textLines(text: string | undefined | null): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function renderWhatsApp(data: ReceiptData, layout: WhatsAppLayout): string {
  const sym = data.currency_symbol ?? "$";
  const usd = (n: number) => `${sym}${n.toFixed(2)}`;
  const out: string[] = [];

  if (data.shop_name?.trim()) out.push(`*${data.shop_name.trim()}*`);
  out.push(...textLines(data.header_text));
  if (data.shop_location?.trim()) out.push(data.shop_location.trim());
  if (data.shop_phone?.trim()) out.push(data.shop_phone.trim());
  out.push("");

  // Same toLocale* calls as paper: the cashier's own device (rule 27).
  const dt = new Date(data.timestamp);
  if (data.receipt_number) out.push(`Receipt: ${data.receipt_number}`);
  out.push(`Date: ${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}`);
  if (data.client_name?.trim()) out.push(`Client: ${data.client_name.trim()}`);
  out.push("");

  const shown = data.items.slice(0, layout.itemLimit);
  for (const item of shown) {
    out.push(`${item.name} — ${usd(item.subtotal)}`);
    if (!layout.itemDetails) continue;
    if (item.quantity > 1) out.push(`  ${item.quantity} × ${usd(item.price)}`);
    if (item.imei) out.push(`  ${item.serial_label || "IMEI"}: ${item.imei}`);
    const warrantyLine = warrantyLineFor(item, data.timestamp);
    if (warrantyLine) out.push(`  ${warrantyLine}`);
  }
  const hidden = data.items.length - shown.length;
  if (hidden > 0) out.push(`…and ${hidden} more items`);
  if (layout.terms && hasWarrantyLine(data)) {
    out.push(...textLines(data.warranty_terms));
  }
  out.push("");

  const extra = data.extra ?? 0;
  if (data.discount > 0 || extra > 0) {
    out.push(`Subtotal: ${usd(data.subtotal)}`);
  }
  if (data.discount > 0) out.push(`Discount: -${usd(data.discount)}`);
  if (extra > 0) out.push(`Extra: +${usd(extra)}`);
  out.push(`*Total: ${usd(data.total)}*`);
  const lbpTotal = data.total * data.exchange_rate;
  if (lbpTotal > 0) out.push(`Total in LBP: ${lbpTotal.toLocaleString()} LBP`);

  out.push(`Paid USD: ${usd(data.payment_usd)}`);
  if (data.payment_lbp > 0) {
    out.push(`Paid LBP: ${data.payment_lbp.toLocaleString()}`);
  }
  if ((data.gift_card_usd ?? 0) > 0) {
    out.push(`Gift card: ${usd(data.gift_card_usd ?? 0)}`);
  }
  // FR-008: the account part is its own line, never inside "Paid".
  if ((data.on_account_usd ?? 0) > 0) {
    out.push(`On account: ${usd(data.on_account_usd ?? 0)}`);
  }
  if ((data.on_account_lbp ?? 0) > 0) {
    out.push(`On account LBP: ${(data.on_account_lbp ?? 0).toLocaleString()}`);
  }
  if (data.change_usd > 0) out.push(`Change: ${usd(data.change_usd)}`);
  if (data.change_lbp > 0) {
    out.push(`Change LBP: ${data.change_lbp.toLocaleString()}`);
  }

  out.push("");
  if (data.note?.trim()) out.push(data.note.trim());
  out.push("Thank You!");
  out.push("Powered by LiraTek • 81077357");
  if (layout.shortened) out.push(WHATSAPP_SHORTENED_NOTE);

  return out.join("\n");
}

/**
 * The receipt laid out for reading on a phone (FR-009): one fact per line,
 * label and amount together, no padding. Every figure uses the same format
 * as the paper receipt (FR-006). Over `maxEncoded`, it shortens in this
 * order — warranty terms, item sub-lines, then the tail of the item list —
 * and never drops the totals, payment, gift card, account or change lines
 * (FR-011).
 */
export function formatReceiptWhatsApp(
  data: ReceiptData,
  opts: { maxEncoded?: number } = {},
): string {
  const max = opts.maxEncoded ?? WHATSAPP_TEXT_MAX_ENCODED;
  const fits = (t: string) => encodeURIComponent(t).length <= max;
  const all = data.items.length;

  const full = renderWhatsApp(data, {
    terms: true,
    itemDetails: true,
    itemLimit: all,
    shortened: false,
  });
  if (fits(full)) return full;

  const noTerms = renderWhatsApp(data, {
    terms: false,
    itemDetails: true,
    itemLimit: all,
    shortened: true,
  });
  if (fits(noTerms)) return noTerms;

  let compact = "";
  for (let limit = all; limit >= 0; limit--) {
    compact = renderWhatsApp(data, {
      terms: false,
      itemDetails: false,
      itemLimit: limit,
      shortened: true,
    });
    if (fits(compact)) return compact;
  }
  return compact;
}

/** The free click-to-chat link (FR-019): `https://wa.me/<digits>?text=…`. */
export function buildWhatsAppLink(digits: string, text: string): string {
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/**
 * Return receipt as JSON (for future API/network printing)
 */
export function getReceiptJSON(data: ReceiptData): Record<string, unknown> {
  return {
    receipt_number: data.receipt_number,
    shop_name: data.shop_name,
    client: {
      name: data.client_name || "Walk-in",
      phone: data.client_phone || null,
    },
    timestamp: data.timestamp,
    items: data.items,
    summary: {
      subtotal: data.subtotal,
      discount: data.discount,
      extra: data.extra ?? 0,
      total: data.total,
      total_lbp: data.total * data.exchange_rate,
    },
    payment: {
      paid_usd: data.payment_usd,
      paid_lbp: data.payment_lbp,
      change_usd: data.change_usd,
      change_lbp: data.change_lbp,
      exchange_rate: data.exchange_rate,
    },
    note: data.note || null,
    operator: data.operator || "Staff",
  };
}

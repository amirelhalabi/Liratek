/**
 * Session-checkout receipt builder (LIRA-069 W1.b).
 *
 * A customer-session basket's payment is recorded DIFFERENTLY from a
 * standalone module transaction: `SessionPaymentService.recordBasketPayment`
 * inserts every customer-facing leg with `session_id` set and
 * `transaction_id NULL` (see packages/core/src/services/SessionPaymentService.ts)
 * — no single unified `transactions` row owns the basket's payment legs, and
 * no dedicated "checkout" transaction row is created either. Each cart item
 * IS its own transaction (recharges/financial_services/etc.), but those rows
 * carry `deferPayment: true` and have NO payment legs of their own.
 *
 * Consequence: `printServiceReceiptByTransaction(txnId)` — the shared path
 * every other module uses — cannot represent a session checkout, because
 * `transactions.getCustomerLegs(txnId)` for any ONE item would return empty
 * (the real legs live on the session, not that item), and the item's own
 * `note`/metadata only describes ONE line of a potentially multi-item,
 * multi-currency basket.
 *
 * This builder instead renders directly from data already in the checkout
 * flow's OWN state at the moment of success (cart items + the payment legs
 * just submitted) — the most accurate representation of what actually
 * happened, no backend round-trip, no invented "carrier transaction". Mirrors
 * the visual conventions of `shared/utils/serviceReceipt.ts`'s
 * buildServiceReceiptText (same width/border/line helpers) but is basket-
 * shaped: N item lines, multi-currency totals, multi-currency payment legs.
 */

const WIDTH = 42;

export interface SessionReceiptItem {
  label: string;
  /** Signed — negative for a cashout/payout item (e.g. RECEIVE, loto prize). */
  amount: number;
  currency: string;
}

export interface SessionReceiptLeg {
  method: string;
  currency_code: string;
  amount: number;
  direction: "IN" | "OUT";
}

export interface SessionReceiptInput {
  shop: { name: string; phone?: string; location?: string };
  sessionId: number;
  customerName?: string | undefined;
  customerPhone?: string | undefined;
  items: SessionReceiptItem[];
  legs: SessionReceiptLeg[];
  /** ISO timestamp — defaults to "now" (the moment checkout succeeded). */
  createdAt?: string | undefined;
}

function fmtMoney(amount: number, currency: string): string {
  const abs = Math.abs(amount);
  return currency === "LBP" || currency === "USDT"
    ? `${Math.round(abs).toLocaleString()} ${currency}`
    : `$${abs.toFixed(2)}`;
}

/**
 * Build the monospace text for a session-basket checkout receipt. Pure —
 * unit-tested directly.
 */
export function buildSessionCheckoutReceiptText(
  input: SessionReceiptInput,
): string {
  const { shop, sessionId, customerName, customerPhone, items, legs } = input;
  const createdAt = input.createdAt ?? new Date().toISOString();

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

  const dt = new Date(createdAt);
  r += `Session #${sessionId}\n`;
  r += `${dt.toLocaleDateString()} ${dt.toLocaleTimeString()}\n`;

  if (customerName?.trim()) {
    r += customerName.trim();
    if (customerPhone?.trim()) r += ` ${customerPhone.trim()}`;
    r += "\n";
  }

  r += rule + "\n";

  // Item lines — the whole basket, unlike a single-transaction receipt.
  for (const item of items) {
    const sign = item.amount < 0 ? "-" : "";
    r += line(item.label, `${sign}${fmtMoney(item.amount, item.currency)}`);
  }

  r += rule + "\n";

  // Totals per currency (a basket can be USD AND LBP at once).
  const totalsByCurrency = new Map<string, number>();
  for (const item of items) {
    totalsByCurrency.set(
      item.currency,
      (totalsByCurrency.get(item.currency) ?? 0) + item.amount,
    );
  }
  for (const [currency, total] of totalsByCurrency) {
    if (total === 0) continue;
    const sign = total < 0 ? "-" : "";
    r += line("Total:", `${sign}${fmtMoney(total, currency)}`);
  }

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
      r += line(
        `${l.method === "CUSTOMER_ACCOUNT" ? "Credited" : "Change"}:`,
        fmtMoney(l.amount, l.currency_code),
      );
    }
  }

  r += border + "\n";
  r += center("Thank you!") + "\n";
  return r;
}

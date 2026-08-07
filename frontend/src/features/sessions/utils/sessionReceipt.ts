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
  /**
   * Commission/fee already charged as part of `amount` (in this item's own
   * currency), POST per-item discount. Optional/absent (or 0) for item types
   * with no profit concept (POS/loto/maintenance/custom_service) — no "Fees:"
   * line is printed for those. Mirrors `serviceReceipt.ts`'s standalone
   * "Fee:" line, which this session-basket receipt lacked (LIRA note:
   * "iPick: no commission on bill" — the gap was here, not iPick-specific).
   */
  fee?: number;
}

export interface SessionReceiptLeg {
  method: string;
  currency_code: string;
  amount: number;
  direction: "IN" | "OUT";
  /**
   * BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F — which kind of OUT leg
   * this is: `"PAYOUT"` (the shop pays the customer — RECEIVE/loto/Binance
   * cash-out) or `"CHANGE"` (change handed back from the pooled payment).
   * Never set on an IN leg. Optional/absent is treated as `"CHANGE"` for
   * backward compatibility with legs built before this field existed.
   * TODO(core): mirrors the `kind` field the core-side leg schema
   * (packages/core/src/validators/...) grows in the parallel core lane —
   * this file does not import from core.
   */
  kind?: "PAYOUT" | "CHANGE";
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

  // GROSS totals per currency (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F):
  // a basket's Charges (customer pays, +) and Payout to customer (shop pays
  // out, −) are printed SEPARATELY, never netted against each other — a $50
  // charge + a $50 cash-out used to print one "Total: $0.00" line, hiding
  // that both movements actually happened. Mirrors the split
  // `splitBasketCashSides` (binanceCart.ts) applies to the live basket; this
  // receipt has no item `module` to fold a Binance USDT tag with, so (as
  // before this split) each item's OWN `currency` is its own bucket.
  const chargesByCurrency = new Map<string, number>();
  const payoutsByCurrency = new Map<string, number>();
  for (const item of items) {
    if (item.amount >= 0) {
      chargesByCurrency.set(
        item.currency,
        (chargesByCurrency.get(item.currency) ?? 0) + item.amount,
      );
    } else {
      payoutsByCurrency.set(
        item.currency,
        (payoutsByCurrency.get(item.currency) ?? 0) + -item.amount,
      );
    }
  }
  for (const [currency, total] of chargesByCurrency) {
    if (total === 0) continue;
    r += line("Charges:", fmtMoney(total, currency));
  }
  for (const [currency, total] of payoutsByCurrency) {
    if (total === 0) continue;
    r += line("Payout to customer:", fmtMoney(total, currency));
  }

  // Commission/fee already included in the item amounts above, broken out
  // per currency — mirrors serviceReceipt.ts's standalone "Fee:" line.
  const feesByCurrency = new Map<string, number>();
  for (const item of items) {
    const fee = item.fee ?? 0;
    if (fee <= 0) continue;
    feesByCurrency.set(
      item.currency,
      (feesByCurrency.get(item.currency) ?? 0) + fee,
    );
  }
  for (const [currency, total] of feesByCurrency) {
    if (total <= 0) continue;
    r += line("Fees:", fmtMoney(total, currency));
  }

  // Payment-method split (customer-paid IN legs) and change/payout (OUT legs).
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
      // CUSTOMER_ACCOUNT always reads "Credited" regardless of `kind` (it IS
      // a payout, just settled to store credit instead of handed over).
      // Otherwise: `kind: "PAYOUT"` (loto prize / RECEIVE / Binance cash-out)
      // reads "Payout (<method>)"; missing/`"CHANGE"` reads "Change" — the
      // pre-Phase-F default, kept for legs built before `kind` existed.
      const label =
        l.method === "CUSTOMER_ACCOUNT"
          ? "Credited"
          : l.kind === "PAYOUT"
            ? `Payout (${l.method.replace(/_/g, " ")})`
            : "Change";
      r += line(`${label}:`, fmtMoney(l.amount, l.currency_code));
    }
  }

  r += border + "\n";
  r += center("Thank you!") + "\n";
  return r;
}

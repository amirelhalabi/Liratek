/**
 * SessionDebtDetailModal
 *
 * Shows the itemized breakdown of a customer-session basket that was charged
 * to a client's account, originating a "Session Debt" entry. debt_ledger has
 * no per-item FK for these rows (one basket → one debt entry, lira-session-
 * basket-debt) — the items live in session_cart_items / customer_session_transactions,
 * joined here by session_id.
 *
 * Opened from the eye button (👁) on "Session Debt" entries.
 */

import { useEffect, useState } from "react";
import { X, ShoppingCart } from "lucide-react";
import { useApi } from "@liratek/ui";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";

// ─── Types (mirror electron.d.ts session.cartGet / session.getTransactions) ──

interface SessionCartItem {
  id: number;
  module: string;
  label: string;
  amount: number;
  currency: string;
  created_at: string;
}

interface SessionTransactionRow {
  id: number;
  transaction_type: string;
  amount_usd: number;
  amount_lbp: number;
  created_at: string;
}

interface Props {
  sessionId: number;
  debtAmountUsd: number;
  debtAmountLbp: number;
  /** True when the client has credit (shop owes them) — changes debt language to account charge */
  isCreditor?: boolean;
  /** Which side of the basket to show. The Purchases-side eye button opens
   *  "charges" (positive: what the customer bought/was charged); the
   *  Payments-side eye button opens "payouts" (negative: cash-outs settled to
   *  the account). "all" (default) keeps the original both-signs view. */
  mode?: "charges" | "payouts" | "all";
  onClose: () => void;
}

// A row/item is a PAYOUT (shop pays the customer) iff any currency is negative;
// otherwise it is a CHARGE. Sign is the only reliable discriminator — a
// transaction_type like "binance"/"omt_system" is written for both directions.
const isPayoutAmount = (usd: number, lbp: number): boolean =>
  usd < 0 || lbp < 0;

// ─── Component ────────────────────────────────────────────────────────────────

export function SessionDebtDetailModal({
  sessionId,
  debtAmountUsd,
  debtAmountLbp,
  isCreditor = false,
  mode = "all",
  onClose,
}: Props) {
  const api = useApi();
  useModalFocusFix(true);
  const [cartItems, setCartItems] = useState<SessionCartItem[]>([]);
  const [transactions, setTransactions] = useState<SessionTransactionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [cartResult, txResult] = await Promise.all([
          api.session.cartGet(sessionId),
          api.session.getTransactions(sessionId),
        ]);
        if (cancelled) return;
        if (cartResult.success && cartResult.items) {
          setCartItems(cartResult.items as SessionCartItem[]);
        }
        if (txResult.success && txResult.transactions) {
          setTransactions(txResult.transactions as SessionTransactionRow[]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const fmt = (amount: number, currency: string): string =>
    currency === "LBP"
      ? `${Math.round(Math.abs(amount)).toLocaleString()} LBP`
      : `$${Math.abs(amount).toFixed(2)}`;

  // Customer-perspective signed amount, matching the session basket view
  // (SessionFloatingWindow): + when the customer pays / is charged, − when the
  // shop pays the customer (Binance/OMT/Whish/loto cash-outs). Without the sign
  // a payout read as a charge; with the old `> 0` guard a payout's negative
  // amount rendered as nothing at all.
  const fmtSigned = (amount: number, currency: string): string =>
    `${amount < 0 ? "-" : "+"}${fmt(amount, currency)}`;
  const amountColor = (amount: number): string =>
    amount < 0 ? "text-red-400" : "text-emerald-400";
  const nonZero = (n: number): boolean => Math.abs(n) > 0.005;

  // Filter to the requested side. Cart items carry a single signed `amount`;
  // committed transactions carry signed amount_usd/amount_lbp.
  const cartInMode = (amount: number): boolean =>
    mode === "all" ? true : mode === "payouts" ? amount < 0 : amount >= 0;
  const displayCartItems = cartItems.filter((i) => cartInMode(i.amount));
  const displayTransactions = transactions.filter((t) =>
    mode === "all"
      ? true
      : mode === "payouts"
        ? isPayoutAmount(t.amount_usd, t.amount_lbp)
        : !isPayoutAmount(t.amount_usd, t.amount_lbp),
  );

  const itemsHeading =
    mode === "payouts" ? "Payouts" : mode === "charges" ? "Charges" : "Items";
  const summaryUsd = Math.abs(debtAmountUsd);
  const summaryLbp = Math.abs(debtAmountLbp);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <ShoppingCart size={16} className="text-indigo-400" />
            <h2 className="text-base font-bold text-white">
              Session #{sessionId} Basket
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <p className="text-xs text-slate-500 text-center py-4">
              Loading basket items...
            </p>
          ) : displayCartItems.length === 0 &&
            displayTransactions.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">
              No {mode === "payouts" ? "payouts" : "items"} found for this
              session.
            </p>
          ) : (
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                {itemsHeading}
              </h3>
              <div className="space-y-1.5">
                {displayCartItems.length > 0
                  ? displayCartItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/30"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] uppercase text-slate-500 font-medium shrink-0">
                            {item.module}
                          </span>
                          <span className="text-sm text-slate-200 truncate">
                            {item.label}
                          </span>
                        </div>
                        <span
                          className={`font-mono text-sm font-semibold shrink-0 ml-2 ${amountColor(item.amount)}`}
                        >
                          {fmtSigned(item.amount, item.currency)}
                        </span>
                      </div>
                    ))
                  : displayTransactions.map((tx) => (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/30"
                      >
                        <span className="text-sm text-slate-300 capitalize">
                          {tx.transaction_type}
                        </span>
                        <span className="font-mono text-sm font-semibold">
                          {nonZero(tx.amount_usd) && (
                            <span className={amountColor(tx.amount_usd)}>
                              {fmtSigned(tx.amount_usd, "USD")}
                            </span>
                          )}
                          {nonZero(tx.amount_usd) && nonZero(tx.amount_lbp) && (
                            <span className="mx-1 text-slate-500">+</span>
                          )}
                          {nonZero(tx.amount_lbp) && (
                            <span className={amountColor(tx.amount_lbp)}>
                              {fmtSigned(tx.amount_lbp, "LBP")}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
              </div>
            </div>
          )}

          {/* Summary: the aggregate ledger row this modal was opened from —
              a payouts modal shows the credit (emerald), otherwise the debt/
              account-charge. Amounts are abs (the row stores credits negative). */}
          {(summaryUsd > 0.005 || summaryLbp > 0.5) && (
            <div
              className={`flex items-center justify-between px-3 py-2.5 rounded-lg ${
                mode === "payouts"
                  ? "bg-emerald-950/40 border border-emerald-500/20"
                  : isCreditor
                    ? "bg-sky-950/40 border border-sky-500/20"
                    : "bg-red-950/40 border border-red-500/20"
              }`}
            >
              <span
                className={`text-sm font-medium ${
                  mode === "payouts"
                    ? "text-emerald-300"
                    : isCreditor
                      ? "text-sky-300"
                      : "text-red-300"
                }`}
              >
                {mode === "payouts"
                  ? "Credited to Account"
                  : isCreditor
                    ? "Charged to Account"
                    : "Basket Debt"}
              </span>
              <span
                className={`font-mono text-sm font-bold ${
                  mode === "payouts"
                    ? "text-emerald-400"
                    : isCreditor
                      ? "text-sky-400"
                      : "text-red-400"
                }`}
              >
                {summaryUsd > 0.005 && fmt(summaryUsd, "USD")}
                {summaryUsd > 0.005 && summaryLbp > 0.5 && " + "}
                {summaryLbp > 0.5 && fmt(summaryLbp, "LBP")}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

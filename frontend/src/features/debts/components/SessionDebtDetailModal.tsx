/**
 * SessionDebtDetailModal
 *
 * Shows the itemized breakdown of a customer-session basket that was charged
 * to a client's account, originating a "Session Debt" entry. debt_ledger has
 * no per-item FK for these rows (one basket → one debt entry, lira-session-
 * basket-debt) — the items live in session_cart_items / customer_session_transactions,
 * joined here by session_id.
 *
 * Opened from the eye button (👁) on "Session Debt" entries. Each paid line
 * opens in place to show the same details as the Transactions page.
 */

import { useEffect, useRef, useState } from "react";
import { X, ShoppingCart, ChevronDown, ChevronRight } from "lucide-react";
import { useApi } from "@liratek/ui";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import { buildClientDebtDetails } from "@liratek/core";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import type { TransactionRow } from "@/features/audit/hooks/useTransactionRows";
import { ClientDebtDetailsBody } from "./ClientDebtDetailModal";

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
  /** The `transactions` row this line became; null on older rows. */
  unified_transaction_id?: number | null;
  created_at: string;
}

/** A basket holds a few dozen lines at most; this caps the details fetch. */
const SESSION_ROWS_LIMIT = 500;

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

/** "recharge_mtc" → "Recharge mtc" — a saved module code shown as words
 *  when the item has no saved transaction to name it (LIRA-350, B11). */
const readableCode = (code: string): string => {
  const s = code.replace(/_/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

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
  // rule 25: read `api` through a ref inside the effect.
  const apiRef = useRef(api);
  apiRef.current = api;
  const { t } = useTranslation("debts");
  useModalFocusFix(true);
  const [cartItems, setCartItems] = useState<SessionCartItem[]>([]);
  const [transactions, setTransactions] = useState<SessionTransactionRow[]>([]);
  // Full rows (as the Transactions page loads them), by transaction id.
  const [fullRows, setFullRows] = useState<Map<number, TransactionRow>>(
    () => new Map(),
  );
  const [openId, setOpenId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [cartResult, txResult, rows] = await Promise.all([
          apiRef.current.session.cartGet(sessionId),
          apiRef.current.session.getTransactions(sessionId),
          apiRef.current
            .getRecentTransactions(SESSION_ROWS_LIMIT, {
              session_id: sessionId,
            })
            .catch(() => [] as TransactionRow[]),
        ]);
        if (cancelled) return;
        setFullRows(
          new Map(
            ((rows ?? []) as TransactionRow[]).map((r) => [r.id, r] as const),
          ),
        );
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
      ? `${formatNumber(Math.round(Math.abs(amount)))} LBP`
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
  // LIRA-232 round-3 review (finding 5) — core's `findClientHistory` hides a
  // 0/0 "Refund Reversal" debt_ledger marker row (written when a
  // whole-basket reversal has nothing left to reverse in a currency because
  // prior item refunds already consumed it — SESSION_ITEM_REFUND_PLAN.md §9b
  // point 8). This modal reads a DIFFERENT source
  // (`session.getTransactions`/`customer_session_transactions`, not
  // `debt_ledger`/`findClientHistory`), so core's hide never reaches it — but
  // the exact same shape can occur here: a session-linked transaction row
  // whose amount_usd/amount_lbp are BOTH ~0 renders as a bare
  // `transaction_type` label with an empty amount span (nonZero already
  // hides each currency span individually, but not the whole row). Applying
  // the same "hide a 0/0 row" rule here keeps the two views consistent.
  const displayTransactions = transactions
    .filter((t) => nonZero(t.amount_usd) || nonZero(t.amount_lbp))
    .filter((t) =>
      mode === "all"
        ? true
        : mode === "payouts"
          ? isPayoutAmount(t.amount_usd, t.amount_lbp)
          : !isPayoutAmount(t.amount_usd, t.amount_lbp),
    );

  const itemsHeading =
    mode === "payouts"
      ? t("sessionModal.payouts")
      : mode === "charges"
        ? t("sessionModal.charges")
        : t("sessionModal.items");
  const summaryUsd = Math.abs(debtAmountUsd);
  const summaryLbp = Math.abs(debtAmountLbp);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <ShoppingCart size={16} className="text-indigo-400" />
            <h2 className="text-base font-bold text-white">
              {t("sessionModal.title", { id: sessionId })}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {loading ? (
            <p className="text-xs text-slate-500 text-center py-4">
              {t("sessionModal.loading")}
            </p>
          ) : displayCartItems.length === 0 &&
            displayTransactions.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">
              {mode === "payouts"
                ? t("sessionModal.noPayouts")
                : t("sessionModal.noItems")}
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
                            {readableCode(item.module)}
                          </span>
                          <span className="text-sm text-slate-200 truncate">
                            {item.label}
                          </span>
                        </div>
                        <span
                          className={`font-mono text-sm font-semibold shrink-0 ms-2 ${amountColor(item.amount)}`}
                        >
                          <Ltr>{fmtSigned(item.amount, item.currency)}</Ltr>
                        </span>
                      </div>
                    ))
                  : displayTransactions.map((tx) => {
                      const full =
                        tx.unified_transaction_id != null
                          ? fullRows.get(tx.unified_transaction_id)
                          : undefined;
                      const isOpen = full !== undefined && openId === tx.id;
                      // LIRA-350 — the item in the client's words (C13: no
                      // cost, product id or saved-data dump; B11: no raw
                      // "recharge_mtc" keys).
                      const clientView = full
                        ? buildClientDebtDetails({
                            ledger: {
                              transaction_type: "",
                              amount_usd: 0,
                              amount_lbp: 0,
                              note: null,
                            },
                            tx: full,
                          })
                        : null;
                      return (
                        <div
                          key={tx.id}
                          className="rounded-lg bg-slate-800/50 border border-slate-700/30"
                        >
                          <button
                            type="button"
                            disabled={!full}
                            aria-expanded={full ? isOpen : undefined}
                            data-testid={`session-line-${tx.id}`}
                            onClick={() => setOpenId(isOpen ? null : tx.id)}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-start enabled:hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            <span className="flex items-center gap-1.5 min-w-0">
                              {full &&
                                (isOpen ? (
                                  <ChevronDown
                                    size={14}
                                    className="text-slate-500 shrink-0"
                                  />
                                ) : (
                                  <ChevronRight
                                    size={14}
                                    className="text-slate-500 shrink-0 rtl:rotate-180"
                                  />
                                ))}
                              <span className="text-sm text-slate-300 truncate">
                                {clientView
                                  ? t(`clientDebt.kind.${clientView.kind}`)
                                  : readableCode(tx.transaction_type)}
                              </span>
                              {clientView?.line && (
                                <span className="text-xs text-slate-500 truncate">
                                  {clientView.line}
                                </span>
                              )}
                            </span>
                            <span
                              dir="ltr"
                              className="font-mono text-sm font-semibold"
                            >
                              {nonZero(tx.amount_usd) && (
                                <span className={amountColor(tx.amount_usd)}>
                                  {fmtSigned(tx.amount_usd, "USD")}
                                </span>
                              )}
                              {nonZero(tx.amount_usd) &&
                                nonZero(tx.amount_lbp) && (
                                  <span className="mx-1 text-slate-500">+</span>
                                )}
                              {nonZero(tx.amount_lbp) && (
                                <span className={amountColor(tx.amount_lbp)}>
                                  {fmtSigned(tx.amount_lbp, "LBP")}
                                </span>
                              )}
                            </span>
                          </button>
                          {isOpen && clientView && (
                            <div className="border-t border-slate-700/50 px-3 py-3">
                              <ClientDebtDetailsBody
                                details={clientView}
                                showLine={false}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
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
                  ? t("sessionModal.creditedToAccount")
                  : isCreditor
                    ? t("sessionModal.chargedToAccount")
                    : t("sessionModal.basketDebt")}
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
                <Ltr>
                  {summaryUsd > 0.005 && fmt(summaryUsd, "USD")}
                  {summaryUsd > 0.005 && summaryLbp > 0.5 && " + "}
                  {summaryLbp > 0.5 && fmt(summaryLbp, "LBP")}
                </Ltr>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

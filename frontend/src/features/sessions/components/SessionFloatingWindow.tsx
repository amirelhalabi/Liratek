import { useState } from "react";
import {
  Pencil,
  Check,
  X as XIcon,
  ShoppingCart,
  Trash2,
  Save,
} from "lucide-react";
import logger from "@/utils/logger";
import { useSession } from "../context/SessionContext";
import { binanceCashSide, splitBasketCashSides } from "../utils/binanceCart";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
import { Ltr } from "@liratek/ui/components/ui/Ltr";

/**
 * SessionPopupPanel — renders cart items + committed transactions for the active session.
 * Designed to be shown as a dropdown/popup inside the TopBar on hover.
 * No drag logic, no fixed positioning — the parent controls visibility.
 *
 * The checkout modal is NOT rendered here: this panel unmounts the moment the
 * session closes (and on hover-out), and checkout always closes the session —
 * so the modal's "Checkout Complete" / Print view would vanish with it. The
 * parent owns the modal and passes `onCheckout` to open it.
 */
export function SessionPopupPanel({ onCheckout }: { onCheckout: () => void }) {
  const {
    activeSession,
    sessionTransactions,
    cartItems,
    removeFromCart,
    getCartTotals,
    cartItemCount,
    closeCurrentSession,
    updateSessionInfo,
  } = useSession();
  const { t } = useTranslation("sessions");
  const { t: tc } = useTranslation("common");

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");

  if (!activeSession) return null;

  return (
    <>
      <div className="w-[28rem] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col max-h-[500px] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-600 to-violet-700 text-white px-3 py-2 rounded-t-xl flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {isEditing ? (
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="bg-violet-800/50 border border-violet-400/30 rounded px-1.5 py-0.5 text-sm text-white w-24 focus:outline-none focus:ring-1 focus:ring-violet-300"
                  placeholder={t("field.name")}
                  autoFocus
                />
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="bg-violet-800/50 border border-violet-400/30 rounded px-1.5 py-0.5 text-sm text-white w-24 focus:outline-none focus:ring-1 focus:ring-violet-300"
                  placeholder={t("field.phone")}
                />
              </div>
            ) : (
              <>
                <svg
                  className="w-4 h-4 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
                <div className="truncate text-sm">
                  <span className="font-semibold">
                    {activeSession.customer_name || t("panel.customer")}
                  </span>
                  {activeSession.customer_phone && (
                    <span className="ms-2 opacity-90">
                      <Ltr>{activeSession.customer_phone}</Ltr>
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="flex gap-1 flex-shrink-0">
            {isEditing ? (
              <>
                <button
                  onClick={async () => {
                    try {
                      const updates: {
                        customer_name?: string;
                        customer_phone?: string;
                      } = {};
                      if (editName.trim())
                        updates.customer_name = editName.trim();
                      if (editPhone.trim())
                        updates.customer_phone = editPhone.trim();
                      await updateSessionInfo(updates);
                    } catch (err) {
                      logger.error("Failed to update session:", err);
                    }
                    setIsEditing(false);
                  }}
                  className="hover:bg-violet-800 px-1.5 py-1 rounded transition-colors text-green-300"
                  title={tc("actions.save")}
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="hover:bg-violet-800 px-1.5 py-1 rounded transition-colors text-red-300"
                  title={tc("actions.cancel")}
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    setEditName(activeSession.customer_name || "");
                    setEditPhone(activeSession.customer_phone || "");
                    setIsEditing(true);
                  }}
                  className="hover:bg-violet-800 px-1.5 py-1 rounded transition-colors"
                  title={t("panel.editSession")}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={async () => {
                    if (
                      window.confirm(
                        t("panel.confirmClose", {
                          name:
                            activeSession.customer_name || t("thisCustomer"),
                        }),
                      )
                    ) {
                      try {
                        await closeCurrentSession();
                      } catch (err) {
                        logger.error("Failed to close session:", err);
                        alert(t("closeFailed"));
                      }
                    }
                  }}
                  className="hover:bg-violet-800 px-1.5 py-1 rounded transition-colors"
                  title={t("panel.closeSession")}
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Content: Cart Items + Committed Transactions */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {cartItems.length === 0 && sessionTransactions.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-slate-400">
              <p className="text-xs">{t("panel.empty")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Cart Items (pending) */}
              {cartItems.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider mb-1.5">
                    {t("panel.cart", { n: cartItems.length })}
                  </div>
                  <ul className="space-y-1.5">
                    {cartItems.map((item) => (
                      <li
                        key={item.id}
                        className="border border-emerald-500/20 rounded-lg p-2.5 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors group"
                      >
                        <div className="flex justify-between items-center gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="text-xs">
                              {getModuleIcon(item.module)}
                            </span>
                            <span className="text-sm text-slate-200 truncate">
                              {item.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {(() => {
                              // Binance: the customer's money is the CASH
                              // side (USD) — the USDT is the service, named
                              // in the label; the wallet movement is shop
                              // bookkeeping (transactions view).
                              const binance = binanceCashSide(item);
                              const cash = binance ? binance.cashUsd : null;
                              return (
                                <span
                                  className={`text-sm font-mono font-semibold ${
                                    (cash ?? item.amount) >= 0
                                      ? "text-emerald-400"
                                      : "text-red-400"
                                  }`}
                                >
                                  {cash !== null ? (
                                    <Ltr>
                                      {cash >= 0 ? "+" : "-"}$
                                      {Math.abs(cash).toFixed(2)}
                                    </Ltr>
                                  ) : (
                                    <Ltr>
                                      {item.amount >= 0 ? "+" : "-"}
                                      {item.currency === "LBP"
                                        ? `${formatNumber(Math.abs(item.amount))} LBP`
                                        : `$${Math.abs(item.amount).toFixed(2)}`}
                                    </Ltr>
                                  )}
                                </span>
                              );
                            })()}
                            <button
                              onClick={() => removeFromCart(item.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300 p-0.5"
                              title={t("panel.removeFromCart")}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Committed Transactions */}
              {sessionTransactions.length > 0 && (
                <div>
                  {cartItems.length > 0 && (
                    <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      {t("panel.completed", {
                        n: sessionTransactions.length,
                      })}
                    </div>
                  )}
                  <ul className="space-y-1.5">
                    {sessionTransactions.map((tx) => (
                      <li
                        key={tx.id}
                        className="border border-slate-700 rounded-lg p-2.5 bg-slate-800/30 hover:bg-slate-800 transition-colors"
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-medium text-sm flex items-center gap-1.5 text-slate-300">
                            {getTransactionIcon(tx.transaction_type)}
                            {formatTransactionType(tx.transaction_type, t)}
                          </span>
                          <div className="text-sm font-semibold">
                            {tx.amount_usd > 0 && (
                              <span className="text-green-400">
                                <Ltr>${tx.amount_usd.toFixed(2)}</Ltr>
                              </span>
                            )}
                            {tx.amount_usd > 0 && tx.amount_lbp > 0 && (
                              <span className="mx-1 text-slate-500">+</span>
                            )}
                            {tx.amount_lbp > 0 && (
                              <span className="text-blue-400">
                                <Ltr>{formatNumber(tx.amount_lbp)} LBP</Ltr>
                              </span>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer - Cart Total + Checkout */}
        {(cartItems.length > 0 || sessionTransactions.length > 0) && (
          <div className="px-4 py-3 bg-slate-800/50 border-t border-slate-700 rounded-b-xl space-y-2">
            {cartItems.length > 0 &&
              (() => {
                const totals = getCartTotals();
                // Customer's NET position per currency (+ pays / − is paid).
                // The "usdt" bucket is the Binance items' CASH side in USD, so
                // it folds into the USD net — a $50 purchase and a $50 cash
                // out net to $0 for the customer.
                const netUsd = totals.usd + totals.usdt;
                const netLbp = totals.lbp;
                // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F: the net Cart
                // Total above cancels a same-currency charge against a payout
                // (a $50 sale + a $50 cash-out reads "Cart Total $0.00"),
                // hiding that both movements are real. Surface the GROSS
                // split too, but ONLY when the basket actually mixes both
                // directions — a charge-only or payout-only basket is
                // unchanged (the net already tells the whole story there,
                // e.g. lira-098's payout-only "-$50.00" assertion).
                const { chargeUsd, chargeLbp, payoutUsd, payoutLbp } =
                  splitBasketCashSides(cartItems);
                const isMixed =
                  (chargeUsd > 0 || chargeLbp > 0) &&
                  (payoutUsd > 0 || payoutLbp > 0);
                return (
                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-sm">
                      <span className="font-medium text-emerald-300">
                        {t("panel.cartTotal")}
                      </span>
                      <div className="font-bold">
                        {(netUsd !== 0 || netLbp === 0) && (
                          <span
                            className={
                              netUsd >= 0 ? "text-emerald-400" : "text-red-400"
                            }
                          >
                            <Ltr>
                              {netUsd < 0 ? "-" : ""}$
                              {Math.abs(netUsd).toFixed(2)}
                            </Ltr>
                          </span>
                        )}
                        {netUsd !== 0 && netLbp !== 0 && (
                          <span className="mx-1 text-slate-500">+</span>
                        )}
                        {netLbp !== 0 && (
                          <span
                            className={
                              netLbp >= 0 ? "text-blue-400" : "text-red-400"
                            }
                          >
                            <Ltr>
                              {netLbp < 0 ? "-" : ""}
                              {formatNumber(Math.abs(netLbp))} LBP
                            </Ltr>
                          </span>
                        )}
                      </div>
                    </div>
                    {isMixed && (
                      <div
                        data-testid="session-cart-gross-split"
                        className="flex justify-between items-center text-xs text-slate-400"
                      >
                        <span>
                          {t("panel.charge")}{" "}
                          <Ltr>
                            {chargeUsd > 0 && (
                              <span>${chargeUsd.toFixed(2)}</span>
                            )}
                            {chargeUsd > 0 && chargeLbp > 0 && " + "}
                            {chargeLbp > 0 && (
                              <span>{formatNumber(chargeLbp)} LBP</span>
                            )}
                          </Ltr>
                        </span>
                        <span>
                          {t("panel.payout")}{" "}
                          <Ltr>
                            {payoutUsd > 0 && (
                              <span>${payoutUsd.toFixed(2)}</span>
                            )}
                            {payoutUsd > 0 && payoutLbp > 0 && " + "}
                            {payoutLbp > 0 && (
                              <span>{formatNumber(payoutLbp)} LBP</span>
                            )}
                          </Ltr>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}
            {cartItems.length > 0 ? (
              <button
                onClick={onCheckout}
                className="w-full py-2 rounded-lg font-semibold text-sm text-white bg-emerald-600 hover:bg-emerald-500 transition-colors flex items-center justify-center gap-2"
              >
                <ShoppingCart className="w-4 h-4" />
                {t("panel.checkout", { n: cartItemCount })}
              </button>
            ) : sessionTransactions.length > 0 ? (
              <button
                onClick={async () => {
                  if (
                    window.confirm(
                      t("panel.confirmSaveClose", {
                        name: activeSession.customer_name || t("thisCustomer"),
                      }),
                    )
                  ) {
                    try {
                      await closeCurrentSession();
                    } catch (err) {
                      logger.error("Failed to close session:", err);
                      alert(t("closeFailed"));
                    }
                  }
                }}
                className="w-full py-2 rounded-lg font-semibold text-sm text-white bg-violet-600 hover:bg-violet-500 transition-colors flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" />
                {t("panel.saveClose")}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}

// Helper functions
function formatTransactionType(type: string, t: TFunction<"sessions">): string {
  const map: Record<string, string> = {
    sale: t("txType.sale"),
    recharge: t("txType.recharge"),
    exchange: t("txType.exchange"),
    omt: t("txType.omt"),
    whish: t("txType.whish"),
    maintenance: t("txType.maintenance"),
    expense: t("txType.expense"),
  };
  // Unknown codes fall back to the capitalised DB code (a data value).
  return map[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

function getTransactionIcon(type: string) {
  const iconMap: Record<string, string> = {
    sale: "🛒",
    recharge: "📱",
    exchange: "💱",
    omt: "💸",
    whish: "💳",
    maintenance: "🔧",
    expense: "💰",
  };
  return <span>{iconMap[type] || "📄"}</span>;
}

function getModuleIcon(module: string): string {
  const iconMap: Record<string, string> = {
    pos: "🛒",
    recharge_mtc: "📱",
    recharge_alfa: "📱",
    omt_app: "💸",
    whish_app: "💳",
    ipick: "🎮",
    katsh: "🎮",
    binance_send: "₿",
    binance_receive: "₿",
    omt_system: "💸",
    whish_system: "💳",
    loto_ticket: "🎟️",
    loto_prize: "🏆",
    custom_service: "⚙️",
    maintenance: "🔧",
  };
  return iconMap[module] || "📄";
}

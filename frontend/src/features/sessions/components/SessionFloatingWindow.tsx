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
import { SessionCheckoutModal } from "./SessionCheckoutModal";

/**
 * SessionPopupPanel — renders cart items + committed transactions for the active session.
 * Designed to be shown as a dropdown/popup inside the TopBar on hover.
 * No drag logic, no fixed positioning — the parent controls visibility.
 */
export function SessionPopupPanel() {
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

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

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
                  placeholder="Name"
                  autoFocus
                />
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="bg-violet-800/50 border border-violet-400/30 rounded px-1.5 py-0.5 text-sm text-white w-24 focus:outline-none focus:ring-1 focus:ring-violet-300"
                  placeholder="Phone"
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
                    {activeSession.customer_name || "Customer"}
                  </span>
                  {activeSession.customer_phone && (
                    <span className="ml-2 opacity-90">
                      {activeSession.customer_phone}
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
                  title="Save"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="hover:bg-violet-800 px-1.5 py-1 rounded transition-colors text-red-300"
                  title="Cancel"
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
                  title="Edit Session"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={async () => {
                    if (
                      window.confirm(
                        `Close session for ${activeSession.customer_name || "this customer"}?`,
                      )
                    ) {
                      try {
                        await closeCurrentSession();
                      } catch (err) {
                        logger.error("Failed to close session:", err);
                        alert("Failed to close session");
                      }
                    }
                  }}
                  className="hover:bg-violet-800 px-1.5 py-1 rounded transition-colors"
                  title="Close Session"
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
              <p className="text-xs">No items yet — add from any module</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Cart Items (pending) */}
              {cartItems.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider mb-1.5">
                    Cart ({cartItems.length})
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
                            <span
                              className={`text-sm font-mono font-semibold ${
                                item.amount >= 0
                                  ? "text-emerald-400"
                                  : "text-red-400"
                              }`}
                            >
                              {item.amount >= 0 ? "+" : ""}
                              {item.currency === "LBP"
                                ? `${item.amount.toLocaleString()} LBP`
                                : item.currency === "USDT"
                                  ? `${item.amount.toFixed(2)} USDT`
                                  : `$${item.amount.toFixed(2)}`}
                            </span>
                            <button
                              onClick={() => removeFromCart(item.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300 p-0.5"
                              title="Remove from cart"
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
                      Completed ({sessionTransactions.length})
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
                            {formatTransactionType(tx.transaction_type)}
                          </span>
                          <div className="text-sm font-semibold">
                            {tx.amount_usd > 0 && (
                              <span className="text-green-400">
                                ${tx.amount_usd.toFixed(2)}
                              </span>
                            )}
                            {tx.amount_usd > 0 && tx.amount_lbp > 0 && (
                              <span className="mx-1 text-slate-500">+</span>
                            )}
                            {tx.amount_lbp > 0 && (
                              <span className="text-blue-400">
                                {tx.amount_lbp.toLocaleString()} LBP
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
                return (
                  <div className="flex justify-between items-center text-sm">
                    <span className="font-medium text-emerald-300">
                      Cart Total
                    </span>
                    <div className="font-bold">
                      {totals.usd !== 0 && (
                        <span
                          className={
                            totals.usd >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                          }
                        >
                          ${Math.abs(totals.usd).toFixed(2)}
                        </span>
                      )}
                      {totals.usd !== 0 && totals.lbp !== 0 && (
                        <span className="mx-1 text-slate-500">+</span>
                      )}
                      {totals.lbp !== 0 && (
                        <span
                          className={
                            totals.lbp >= 0 ? "text-blue-400" : "text-red-400"
                          }
                        >
                          {Math.abs(totals.lbp).toLocaleString()} LBP
                        </span>
                      )}
                      {totals.usdt !== 0 && (
                        <>
                          <span className="mx-1 text-slate-500">+</span>
                          <span className="text-yellow-400">
                            {totals.usdt.toFixed(2)} USDT
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}
            {cartItems.length > 0 ? (
              <button
                onClick={() => setIsCheckoutOpen(true)}
                className="w-full py-2 rounded-lg font-semibold text-sm text-white bg-emerald-600 hover:bg-emerald-500 transition-colors flex items-center justify-center gap-2"
              >
                <ShoppingCart className="w-4 h-4" />
                Checkout ({cartItemCount} items)
              </button>
            ) : sessionTransactions.length > 0 ? (
              <button
                onClick={async () => {
                  if (
                    window.confirm(
                      `Save & close session for ${activeSession.customer_name || "this customer"}?`,
                    )
                  ) {
                    try {
                      await closeCurrentSession();
                    } catch (err) {
                      logger.error("Failed to close session:", err);
                      alert("Failed to close session");
                    }
                  }
                }}
                className="w-full py-2 rounded-lg font-semibold text-sm text-white bg-violet-600 hover:bg-violet-500 transition-colors flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" />
                Save & Close Session
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* Checkout modal rendered outside the popup so it stays open */}
      <SessionCheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
      />
    </>
  );
}

// Helper functions
function formatTransactionType(type: string): string {
  const map: Record<string, string> = {
    sale: "Sale",
    recharge: "Recharge",
    exchange: "Exchange",
    omt: "OMT",
    whish: "Whish",
    maintenance: "Maintenance",
    expense: "Expense",
  };
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

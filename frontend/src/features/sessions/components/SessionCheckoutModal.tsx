import { useState, useMemo, useCallback, useEffect } from "react";
import {
  ShoppingCart,
  X,
  AlertTriangle,
  CheckCircle,
  Loader2,
  ChevronDown,
} from "lucide-react";
import logger from "@/utils/logger";
import { appEvents } from "@liratek/ui";
import { useSession } from "../context/SessionContext";
import { useAuth } from "@/features/auth/context/AuthContext";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import type { CartItem } from "../types/cart";

interface SessionCheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Module label mapping for display */
const MODULE_LABELS: Record<string, string> = {
  pos: "POS Sale",
  recharge_mtc: "MTC Recharge",
  recharge_alfa: "Alfa Recharge",
  omt_app: "OMT App Transfer",
  whish_app: "Whish App Transfer",
  ipick: "iPick",
  katsh: "KATCH",
  binance_send: "Binance Send",
  binance_receive: "Binance Receive",
  omt_system: "OMT System",
  whish_system: "Whish System",
  loto_ticket: "Loto Ticket",
  loto_prize: "Loto Prize",
  custom_service: "Custom Service",
  maintenance: "Maintenance",
};

/**
 * Map of module → formData field name for payment method.
 * Used to read and write the correct field when displaying/editing per-item payment methods.
 */
const PAYMENT_METHOD_FIELD: Record<string, string> = {
  pos: "payment_method",
  recharge_mtc: "paid_by_method",
  recharge_alfa: "paid_by_method",
  omt_app: "paidByMethod",
  whish_app: "paidByMethod",
  ipick: "paidByMethod",
  katsh: "paidByMethod",
  binance_send: "paidByMethod",
  binance_receive: "paidByMethod",
  omt_system: "paidByMethod",
  whish_system: "paidByMethod",
  loto_ticket: "payment_method",
  loto_prize: "payment_method",
  custom_service: "paid_by",
  maintenance: "paid_by",
};

/**
 * Extract the payment method from a cart item's formData.
 * Handles batch items (_batch: true) by reading from the first sub-item.
 */
function getItemPaymentMethod(item: CartItem): string {
  const field = PAYMENT_METHOD_FIELD[item.module] || "paidByMethod";
  const fd = item.formData;

  // Batch items (FinancialForm/KatchForm) — read from first sub-item
  if (
    fd._batch &&
    Array.isArray(fd.items) &&
    (fd.items as Array<Record<string, unknown>>).length > 0
  ) {
    const firstSub = (fd.items as Array<Record<string, unknown>>)[0];
    return (firstSub[field] as string) || "CASH";
  }

  return (fd[field] as string) || "CASH";
}

/**
 * Set the payment method on a cart item's formData (returns a new formData copy).
 * Handles batch items by updating all sub-items.
 */
function setItemPaymentMethod(
  item: CartItem,
  method: string,
): Record<string, unknown> {
  const field = PAYMENT_METHOD_FIELD[item.module] || "paidByMethod";
  const fd = { ...item.formData };

  if (fd._batch && Array.isArray(fd.items)) {
    fd.items = (fd.items as Array<Record<string, unknown>>).map((sub) => ({
      ...sub,
      [field]: method,
    }));
  } else {
    fd[field] = method;
  }

  return fd;
}

/** Modules where only cashout methods are valid (CASH, DEBT, OMT, WHISH, BINANCE) */
const CASHOUT_ONLY_MODULES = new Set(["binance_receive"]);

/** Valid cashout method codes */
const CASHOUT_METHOD_CODES = new Set([
  "CASH",
  "DEBT",
  "OMT",
  "WHISH",
  "BINANCE",
]);

/** Check if a cart item is a RECEIVE/cashout transaction */
function isCashoutItem(item: CartItem): boolean {
  if (CASHOUT_ONLY_MODULES.has(item.module)) return true;
  // OMT/Whish system or app RECEIVE: amount is negative
  if (
    (item.module === "omt_system" ||
      item.module === "whish_system" ||
      item.module === "omt_app" ||
      item.module === "whish_app") &&
    item.amount < 0
  )
    return true;
  return false;
}

function formatAmount(amount: number, currency: string): string {
  if (currency === "LBP") {
    return `${Math.abs(amount).toLocaleString()} LBP`;
  }
  if (currency === "USDT") {
    return `${Math.abs(amount).toFixed(2)} USDT`;
  }
  return `$${Math.abs(amount).toFixed(2)}`;
}

export function SessionCheckoutModal({
  isOpen,
  onClose,
}: SessionCheckoutModalProps) {
  const {
    activeSession,
    cartItems,
    clearCart,
    getCartTotals,
    refreshActiveSessions,
  } = useSession();
  const { user } = useAuth();
  const { allMethods } = usePaymentMethods();

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-item payment method overrides: cartItemId → method
  const [itemPaymentMethods, setItemPaymentMethods] = useState<
    Record<string, string>
  >({});

  // Initialize per-item payment methods from formData when modal opens
  useEffect(() => {
    if (isOpen && cartItems.length > 0) {
      const initial: Record<string, string> = {};
      for (const item of cartItems) {
        initial[item.id] = getItemPaymentMethod(item);
      }
      setItemPaymentMethods(initial);
    }
  }, [isOpen, cartItems]);

  const totals = useMemo(() => getCartTotals(), [cartItems, getCartTotals]);

  // Group items by module for display
  const groupedItems = useMemo(() => {
    const groups = new Map<string, CartItem[]>();
    for (const item of cartItems) {
      const existing = groups.get(item.module) || [];
      existing.push(item);
      groups.set(item.module, existing);
    }
    return groups;
  }, [cartItems]);

  const handleItemMethodChange = useCallback(
    (itemId: string, method: string) => {
      setItemPaymentMethods((prev) => ({ ...prev, [itemId]: method }));
    },
    [],
  );

  const handleBulkSetAll = useCallback(
    (method: string) => {
      const updated: Record<string, string> = {};
      for (const item of cartItems) {
        updated[item.id] = method;
      }
      setItemPaymentMethods(updated);
    },
    [cartItems],
  );

  if (!isOpen || !activeSession) return null;

  const handleCheckout = async () => {
    if (!user) {
      setError("No authenticated user");
      return;
    }

    if (cartItems.length === 0) {
      setError("Cart is empty");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Build cart items with updated payment methods in formData
      const updatedCartItems = cartItems.map((item) => {
        const method =
          itemPaymentMethods[item.id] || getItemPaymentMethod(item);
        const updatedFormData = setItemPaymentMethod(item, method);

        // For RECEIVE/cashout items, map the selected method to cashoutMethod
        if (isCashoutItem(item)) {
          if (method === "DEBT") {
            updatedFormData.cashoutMethod = "CUSTOMER_ACCOUNT";
          } else {
            updatedFormData.cashoutMethod = method;
          }
        }

        return {
          id: item.id,
          module: item.module,
          label: item.label,
          amount: item.amount,
          currency: item.currency,
          formData: updatedFormData,
          ipcChannel: item.ipcChannel,
        };
      });

      // Use the first item's payment method as the fallback paidByMethod
      const primaryMethod = itemPaymentMethods[cartItems[0]?.id] || "CASH";

      const result = await window.api.session.checkout({
        sessionId: activeSession.id,
        cartItems: updatedCartItems,
        paidByMethod: primaryMethod,
        payments: [],
        userId: user.id,
      });

      if (result.success) {
        logger.info(`Session checkout completed: ${result.itemCount} items`);
        clearCart();
        await refreshActiveSessions();
        appEvents.emit(
          "notification:show",
          `Checkout complete — ${result.itemCount} items processed`,
          "success",
        );
        onClose();
      } else {
        setError(result.error || "Checkout failed");
        logger.error(`Session checkout failed: ${result.error}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Checkout failed";
      setError(msg);
      logger.error(`Session checkout error: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-600/20 rounded-lg flex items-center justify-center">
              <ShoppingCart className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                Session Checkout
              </h2>
              <p className="text-xs text-slate-400">
                {activeSession.customer_name || "Walk-in"} — {cartItems.length}{" "}
                item{cartItems.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Bulk Payment Method */}
          <div className="flex items-center justify-between bg-slate-800/50 border border-slate-700/40 rounded-lg px-3 py-2">
            <span className="text-xs font-medium text-slate-400">
              Set all items to:
            </span>
            <div className="relative">
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    handleBulkSetAll(e.target.value);
                    e.target.value = "";
                  }
                }}
                defaultValue=""
                className="appearance-none bg-slate-700 border border-slate-600 text-slate-200 text-xs font-medium rounded-md px-3 py-1.5 pr-7 cursor-pointer hover:bg-slate-600 transition-colors focus:outline-none focus:ring-1 focus:ring-violet-500"
              >
                <option value="" disabled>
                  Choose...
                </option>
                {allMethods.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            </div>
          </div>

          {/* Cart Items with Per-Item Payment Method */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-slate-300">Cart Items</h3>
            {Array.from(groupedItems.entries()).map(([module, items]) => (
              <div
                key={module}
                className="bg-slate-800/50 border border-slate-700/40 rounded-lg p-3"
              >
                <div className="text-xs font-medium text-slate-400 mb-2">
                  {MODULE_LABELS[module] || module}
                </div>
                <div className="space-y-2">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="text-sm text-slate-200 truncate flex-1 min-w-0">
                        {item.label}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Per-item payment method dropdown */}
                        <div className="relative">
                          <select
                            value={
                              itemPaymentMethods[item.id] ||
                              getItemPaymentMethod(item)
                            }
                            onChange={(e) =>
                              handleItemMethodChange(item.id, e.target.value)
                            }
                            className="appearance-none bg-slate-700 border border-slate-600 text-xs font-medium rounded-md px-2 py-1 pr-6 cursor-pointer hover:bg-slate-600 transition-colors focus:outline-none focus:ring-1 focus:ring-violet-500 text-slate-200"
                          >
                            {(isCashoutItem(item)
                              ? allMethods.filter((m) =>
                                  CASHOUT_METHOD_CODES.has(m.code),
                                )
                              : allMethods
                            ).map((m) => (
                              <option key={m.code} value={m.code}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
                        </div>
                        {/* Amount */}
                        <span
                          className={`text-sm font-mono whitespace-nowrap min-w-[5rem] text-right ${
                            item.amount < 0
                              ? "text-red-400"
                              : "text-emerald-400"
                          }`}
                        >
                          {item.amount < 0 ? "-" : "+"}
                          {formatAmount(item.amount, item.currency)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="bg-slate-800/50 border border-slate-700/40 rounded-lg p-3 space-y-1">
            <h3 className="text-sm font-medium mb-2 text-emerald-400">
              Cart Totals
            </h3>
            {totals.usd !== 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">USD</span>
                <span className="font-mono text-emerald-400">
                  ${totals.usd.toFixed(2)}
                </span>
              </div>
            )}
            {totals.lbp !== 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">LBP</span>
                <span className="font-mono text-blue-400">
                  {totals.lbp.toLocaleString()} LBP
                </span>
              </div>
            )}
            {totals.usdt !== 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">USDT</span>
                <span className="font-mono text-yellow-400">
                  {totals.usdt.toFixed(2)} USDT
                </span>
              </div>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-700/50 flex gap-3">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="flex-1 py-2.5 rounded-lg font-medium text-sm text-slate-300 bg-slate-800 hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCheckout}
            disabled={isProcessing || cartItems.length === 0}
            className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-white bg-emerald-600 hover:bg-emerald-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                Confirm Checkout
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

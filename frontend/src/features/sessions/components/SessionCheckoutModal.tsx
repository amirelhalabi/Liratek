import { useState, useMemo } from "react";
import {
  ShoppingCart,
  X,
  AlertTriangle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import logger from "@/utils/logger";
import { appEvents } from "@liratek/ui";
import { useSession } from "../context/SessionContext";
import { useAuth } from "@/features/auth/context/AuthContext";
import {
  MultiPaymentInput,
  type PaymentLine,
} from "@/shared/components/MultiPaymentInput";
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
    refreshSessionTransactions,
  } = useSession();
  const { user } = useAuth();

  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(() => getCartTotals(), [cartItems, getCartTotals]);

  // Primary total for payment matching — use USD if any USD items, else LBP
  const primaryTotal = useMemo(() => {
    if (totals.usd !== 0)
      return { amount: totals.usd, currency: "USD" as const };
    if (totals.lbp !== 0)
      return { amount: totals.lbp, currency: "LBP" as const };
    if (totals.usdt !== 0)
      return { amount: totals.usdt, currency: "USDT" as const };
    return { amount: 0, currency: "USD" as const };
  }, [totals]);

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

    // Determine primary payment method from lines
    const primaryMethod =
      paymentLines.length > 0 ? paymentLines[0].method : "CASH";

    setIsProcessing(true);
    setError(null);

    try {
      const result = await window.api.session.checkout({
        sessionId: activeSession.id,
        cartItems: cartItems.map((item) => ({
          id: item.id,
          module: item.module,
          label: item.label,
          amount: item.amount,
          currency: item.currency,
          formData: item.formData,
          ipcChannel: item.ipcChannel,
        })),
        paidByMethod: primaryMethod,
        payments: paymentLines.map((line) => ({
          method: line.method,
          currency_code: line.currencyCode,
          amount: line.amount,
        })),
        userId: user.id,
      });

      if (result.success) {
        logger.info(`Session checkout completed: ${result.itemCount} items`);
        clearCart();
        await refreshSessionTransactions();
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
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
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
          {/* Cart Items Summary */}
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
                <div className="space-y-1.5">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex justify-between items-center"
                    >
                      <span className="text-sm text-slate-200 truncate mr-3">
                        {item.label}
                      </span>
                      <span
                        className={`text-sm font-mono whitespace-nowrap ${
                          item.amount < 0 ? "text-red-400" : "text-emerald-400"
                        }`}
                      >
                        {item.amount < 0 ? "-" : "+"}
                        {formatAmount(item.amount, item.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="bg-slate-800/50 border border-slate-700/40 rounded-lg p-3 space-y-1">
            <h3 className="text-sm font-medium text-slate-300 mb-2">
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

          {/* Payment Input */}
          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-2">Payment</h3>
            <MultiPaymentInput
              totalAmount={primaryTotal.amount}
              currency={primaryTotal.currency}
              totalAmountCurrency={primaryTotal.currency}
              onChange={setPaymentLines}
              transactionType="SALE"
            />
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

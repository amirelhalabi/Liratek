import { useState, useMemo, useCallback, useEffect } from "react";
import {
  ShoppingCart,
  X,
  AlertTriangle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import logger from "@/utils/logger";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { appEvents, MultiPaymentInput, type PaymentLine } from "@liratek/ui";
import { useSession } from "../context/SessionContext";
import { useAuth } from "@/features/auth/context/AuthContext";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useExchangeRate } from "@/hooks/useExchangeRate";
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

/** Cart modules where paying by GIFT_CARD (voucher) is supported. */
const VOUCHER_SUPPORTED_MODULES = new Set([
  "pos",
  "custom_service",
  "recharge_mtc",
  "recharge_alfa",
]);

/**
 * Inject a voucher code into a cart item's formData so the replayed service
 * redeems it. Each module reads the code from a different place:
 *  - pos            → a GIFT_CARD payments leg (amount counts as paid)
 *  - custom_service → top-level voucher_code
 *  - recharge       → a GIFT_CARD payments leg
 */
function injectVoucherCode(
  item: CartItem,
  fd: Record<string, unknown>,
  code: string,
): void {
  const amount = Math.abs(item.amount);
  switch (item.module) {
    case "pos":
      fd.payments = [
        {
          method: "GIFT_CARD",
          currency_code: "USD",
          amount,
          voucher_code: code,
        },
      ];
      fd.payment_usd = amount;
      fd.payment_lbp = 0;
      break;
    case "custom_service":
      fd.voucher_code = code;
      break;
    case "recharge_mtc":
    case "recharge_alfa":
      fd.payments = [
        {
          method: "GIFT_CARD",
          currencyCode: String(item.currency || "USD"),
          amount,
          voucherCode: code,
        },
      ];
      break;
    default:
      break;
  }
}

/** Modules where only cashout methods are valid (CASH, CUSTOMER_ACCOUNT, OMT, WHISH, BINANCE) */
const CASHOUT_ONLY_MODULES = new Set(["binance_receive"]);

/** Valid cashout method codes */
const CASHOUT_METHOD_CODES = new Set([
  "CASH",
  "CUSTOMER_ACCOUNT",
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

/**
 * Determine the initial payment method for MultiPaymentInput.
 * Returns "CUSTOMER_ACCOUNT" when a client is in session and the method is available,
 * otherwise "CASH".
 */
function resolveInitialMethod(
  hasClient: boolean,
  methods: Array<{ code: string }>,
): string {
  if (
    hasClient &&
    methods.some((m) => m.code === "CUSTOMER_ACCOUNT")
  ) {
    return "CUSTOMER_ACCOUNT";
  }
  return "CASH";
}

export function SessionCheckoutModal({
  isOpen,
  onClose,
}: SessionCheckoutModalProps) {
  useModalFocusFix(isOpen);
  const {
    activeSession,
    cartItems,
    clearCart,
    getCartTotals,
    refreshActiveSessions,
  } = useSession();
  const { user } = useAuth();
  const { allMethods } = usePaymentMethods();
  const { rate: exchangeRate } = useExchangeRate("USD", "LBP");

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-item payment method overrides: cartItemId → method
  const [itemPaymentMethods, setItemPaymentMethods] = useState<
    Record<string, string>
  >({});

  // Per-item voucher codes (when method === GIFT_CARD): cartItemId → code
  const [itemVoucherCodes, setItemVoucherCodes] = useState<
    Record<string, string>
  >({});
  // Per-item voucher validation feedback
  const [voucherFeedback, setVoucherFeedback] = useState<
    Record<string, { status: "loading" | "ok" | "error"; message: string }>
  >({});

  // ── MultiPaymentInput state ──────────────────────────────────────────────
  // Payment legs emitted by MultiPaymentInput for USD totals
  const [usdPaymentLines, setUsdPaymentLines] = useState<PaymentLine[]>([]);
  // Payment legs emitted by MultiPaymentInput for LBP totals
  const [lbpPaymentLines, setLbpPaymentLines] = useState<PaymentLine[]>([]);

  // Key used to force-remount MultiPaymentInput when client context changes
  const [paymentInputKey, setPaymentInputKey] = useState(0);

  // Whether the session has a named client (drives CUSTOMER_ACCOUNT auto-select)
  const hasClient = !!(activeSession?.customer_name);

  // Initial method for MultiPaymentInput — recomputed when methods load or client changes
  const initialMethod = useMemo(
    () => resolveInitialMethod(hasClient, allMethods),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasClient, allMethods.map((m) => m.code).join(",")],
  );

  // Remount MultiPaymentInput whenever initialMethod or cart totals change so
  // the first line tracks the current state correctly.
  useEffect(() => {
    setPaymentInputKey((k) => k + 1);
  }, [initialMethod]);

  const validateItemVoucher = useCallback(async (itemId: string, code: string) => {
    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      setVoucherFeedback((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      return;
    }
    setVoucherFeedback((prev) => ({
      ...prev,
      [itemId]: { status: "loading", message: "Checking..." },
    }));
    const result = await window.api.vouchers.validate(normalized);
    if (result.success && result.voucher) {
      const v = result.voucher;
      setVoucherFeedback((prev) => ({
        ...prev,
        [itemId]: {
          status: "ok",
          message: `${v.client_name} · $${v.amount.toFixed(2)}`,
        },
      }));
    } else {
      setVoucherFeedback((prev) => ({
        ...prev,
        [itemId]: { status: "error", message: result.error ?? "Invalid voucher" },
      }));
    }
  }, []);

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

  const totals = useMemo(() => getCartTotals(), [getCartTotals]);

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

  // Currency configs for MultiPaymentInput
  const currencies = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];

  // Payment methods typed as required by MultiPaymentInput
  const paymentMethodOptions = allMethods.map((m) => ({
    code: m.code,
    label: m.label,
  }));

  // Derive combined payment legs from both MultiPaymentInput instances
  const allPaymentLegs: Array<{ method: string; currency_code: string; amount: number }> =
    useMemo(() => {
      const usdLegs = usdPaymentLines.map((l) => ({
        method: l.method,
        currency_code: l.currencyCode,
        amount: l.amount,
      }));
      const lbpLegs = lbpPaymentLines.map((l) => ({
        method: l.method,
        currency_code: l.currencyCode,
        amount: l.amount,
      }));
      return [...usdLegs, ...lbpLegs];
    }, [usdPaymentLines, lbpPaymentLines]);

  // Primary method is the first non-zero leg's method, or CASH as fallback
  const primaryMethod = allPaymentLegs.find((l) => l.amount > 0)?.method ?? "CASH";

  // Validate payment totals are covered
  const usdPaymentTolerance = 0.01;
  const lbpPaymentTolerance = 100;

  const usdPaid = useMemo(
    () =>
      usdPaymentLines.reduce((sum, l) => {
        if (l.currencyCode === "USD") return sum + (l.amount || 0);
        if (l.currencyCode === "LBP") return sum + (l.amount || 0) / exchangeRate;
        return sum;
      }, 0),
    [usdPaymentLines, exchangeRate],
  );

  const lbpPaid = useMemo(
    () =>
      lbpPaymentLines.reduce((sum, l) => {
        if (l.currencyCode === "LBP") return sum + (l.amount || 0);
        if (l.currencyCode === "USD") return sum + (l.amount || 0) * exchangeRate;
        return sum;
      }, 0),
    [lbpPaymentLines, exchangeRate],
  );

  const isUsdCovered =
    totals.usd <= 0 ||
    Math.abs(usdPaid - totals.usd) <= usdPaymentTolerance;

  const isLbpCovered =
    totals.lbp <= 0 ||
    Math.abs(lbpPaid - totals.lbp) <= lbpPaymentTolerance;

  const isPaymentValid = isUsdCovered && isLbpCovered;

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

    if (!isPaymentValid) {
      setError("Payment total does not match cart total");
      return;
    }

    // Validate gift-card items: require a code on a supported module
    for (const item of cartItems) {
      const method = itemPaymentMethods[item.id] || getItemPaymentMethod(item);
      if (method !== "GIFT_CARD") continue;
      if (!VOUCHER_SUPPORTED_MODULES.has(item.module)) {
        setError(`Gift card payment is not supported for "${item.label}"`);
        return;
      }
      if (!(itemVoucherCodes[item.id] ?? "").trim()) {
        setError(`Enter a voucher code for "${item.label}"`);
        return;
      }
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
          updatedFormData.cashoutMethod = method;
        }

        // Gift card / voucher: inject the code so the replayed service redeems it
        if (method === "GIFT_CARD") {
          injectVoucherCode(item, updatedFormData, itemVoucherCodes[item.id] ?? "");
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

      const result = await window.api.session.checkout({
        sessionId: activeSession.id,
        cartItems: updatedCartItems,
        paidByMethod: primaryMethod,
        payments: allPaymentLegs,
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
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
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
                  {items.map((item) => {
                    const selectedMethod =
                      itemPaymentMethods[item.id] || getItemPaymentMethod(item);
                    const methodOptions = (
                      isCashoutItem(item)
                        ? allMethods.filter((m) =>
                            CASHOUT_METHOD_CODES.has(m.code),
                          )
                        : allMethods
                    ).filter(
                      (m) =>
                        m.code !== "GIFT_CARD" ||
                        VOUCHER_SUPPORTED_MODULES.has(item.module),
                    );
                    return (
                      <div key={item.id} className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-slate-200 truncate flex-1 min-w-0">
                            {item.label}
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            {/* Per-item payment method dropdown */}
                            <select
                              value={selectedMethod}
                              onChange={(e) =>
                                handleItemMethodChange(
                                  item.id,
                                  e.target.value,
                                )
                              }
                              className="appearance-none bg-slate-700 border border-slate-600 text-xs font-medium rounded-md px-2 py-1 cursor-pointer hover:bg-slate-600 transition-colors focus:outline-none focus:ring-1 focus:ring-violet-500 text-slate-200"
                            >
                              {methodOptions.map((m) => (
                                <option key={m.code} value={m.code}>
                                  {m.label}
                                </option>
                              ))}
                            </select>
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

                        {/* Voucher code field (GIFT_CARD) */}
                        {selectedMethod === "GIFT_CARD" && (
                          <div className="pl-1">
                            <input
                              type="text"
                              value={itemVoucherCodes[item.id] ?? ""}
                              onChange={(e) =>
                                setItemVoucherCodes((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value.toUpperCase(),
                                }))
                              }
                              onBlur={(e) =>
                                validateItemVoucher(item.id, e.target.value)
                              }
                              className="w-full bg-slate-900 border border-slate-600 rounded-md px-2 py-1 text-xs text-white font-mono tracking-wider focus:outline-none focus:border-orange-500"
                              placeholder="GIFT-XXXX-XXXX"
                            />
                            {voucherFeedback[item.id] && (
                              <p
                                className={`mt-0.5 text-[11px] ${
                                  voucherFeedback[item.id].status === "ok"
                                    ? "text-emerald-400"
                                    : voucherFeedback[item.id].status === "error"
                                      ? "text-red-400"
                                      : "text-slate-400"
                                }`}
                              >
                                {voucherFeedback[item.id].message}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* MultiPaymentInput — USD */}
          {totals.usd > 0 && (
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-slate-300">
                USD Payment
              </h3>
              <MultiPaymentInput
                key={`usd-${paymentInputKey}`}
                totalAmount={totals.usd}
                currency="USD"
                totalAmountCurrency="USD"
                onChange={setUsdPaymentLines}
                requiresClientForDebt={true}
                hasClient={hasClient}
                paymentMethods={paymentMethodOptions}
                currencies={currencies}
                exchangeRate={exchangeRate}
                showDiscount={false}
                label="USD Payment"
                initialMethod={initialMethod}
              />
            </div>
          )}

          {/* MultiPaymentInput — LBP */}
          {totals.lbp > 0 && (
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-slate-300">
                LBP Payment
              </h3>
              <MultiPaymentInput
                key={`lbp-${paymentInputKey}`}
                totalAmount={totals.lbp}
                currency="LBP"
                totalAmountCurrency="LBP"
                onChange={setLbpPaymentLines}
                requiresClientForDebt={true}
                hasClient={hasClient}
                paymentMethods={paymentMethodOptions}
                currencies={currencies}
                exchangeRate={exchangeRate}
                showDiscount={false}
                label="LBP Payment"
                initialMethod={initialMethod}
              />
            </div>
          )}

          {/* USDT totals (display only — no MultiPaymentInput for USDT) */}
          {totals.usdt !== 0 && (
            <div className="bg-slate-800/50 border border-slate-700/40 rounded-lg p-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">USDT Total</span>
                <span className="font-mono text-yellow-400">
                  {totals.usdt.toFixed(2)} USDT
                </span>
              </div>
            </div>
          )}

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
            disabled={isProcessing || cartItems.length === 0 || !isPaymentValid}
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

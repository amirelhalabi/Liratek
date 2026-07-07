import { useState, useMemo, useEffect } from "react";
import {
  ShoppingCart,
  X,
  AlertTriangle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import logger from "@/utils/logger";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import {
  appEvents,
  canChargeToCustomerAccount,
  MultiPaymentInput,
  type PaymentLine,
} from "@liratek/ui";
import { useSession } from "../context/SessionContext";
import { binanceCashSide, splitBasketCashSides } from "../utils/binanceCart";
import { useAuth } from "@/features/auth/context/AuthContext";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useSellRate } from "@/hooks/useSellRate";
import { fetchClientVouchers } from "@/shared/utils/clientVouchers";
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
 * Read a cart item's profit cap (in the item's own currency). The per-item
 * discount cannot exceed this. Returns 0 for items with no profit concept
 * (POS / loto / maintenance / custom_service), which hides the discount input.
 *
 *  - Batch items (FinancialForm / KatchForm): sum of each sub-item's commission.
 *  - Non-batch items (app transfer / recharge / crypto): top-level commission.
 */
function getItemProfitCap(item: CartItem): number {
  const fd = item.formData;

  if (fd._batch && Array.isArray(fd.items)) {
    return (fd.items as Array<Record<string, unknown>>).reduce((sum, sub) => {
      const c = sub.commission;
      return sum + (typeof c === "number" && c > 0 ? c : 0);
    }, 0);
  }

  const c = fd.commission;
  return typeof c === "number" && c > 0 ? c : 0;
}

/**
 * Apply a per-item discount to a cart item's formData (returns a new copy).
 * The discount reduces the recorded profit so the net commission is stamped on
 * the transaction. For batch items the discount is distributed proportionally
 * across sub-items by their commission.
 */
function applyItemDiscount(
  item: CartItem,
  discount: number,
): Record<string, unknown> {
  const fd = { ...item.formData };
  if (discount <= 0) return fd;

  if (fd._batch && Array.isArray(fd.items)) {
    const subs = fd.items as Array<Record<string, unknown>>;
    const totalCommission = subs.reduce((sum, sub) => {
      const c = sub.commission;
      return sum + (typeof c === "number" && c > 0 ? c : 0);
    }, 0);
    if (totalCommission <= 0) return fd;
    fd.items = subs.map((sub) => {
      const c = typeof sub.commission === "number" ? sub.commission : 0;
      const share = Math.round((discount * Math.max(0, c)) / totalCommission);
      return { ...sub, commission: Math.max(0, c - share) };
    });
    return fd;
  }

  const c = typeof fd.commission === "number" ? fd.commission : 0;
  fd.commission = Math.max(0, c - discount);
  return fd;
}

/** Modules where only cashout methods are valid (CASH, CUSTOMER_ACCOUNT, OMT, WHISH, BINANCE) */
const CASHOUT_ONLY_MODULES = new Set(["binance_receive"]);

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
  if (hasClient && methods.some((m) => m.code === "CUSTOMER_ACCOUNT")) {
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

  // Payments use the BUY rate (owner decision 2026-07-06): every
  // MultiPaymentInput converts LBP↔USD at buyRate. Seeded from the hook but kept
  // editable: the operator overrides it via the rate field inside
  // MultiPaymentInput (see onRateChange below), and the chosen rate is sent in
  // the checkout payload (and used for the USD↔LBP coverage math below).
  const { buyRate } = useSellRate();
  const [exchangeRate, setExchangeRate] = useState(buyRate);
  // Track whether the operator has manually edited the rate so the seeded value
  // doesn't clobber their override once the async rate resolves.
  const [rateEdited, setRateEdited] = useState(false);
  useEffect(() => {
    if (!rateEdited) setExchangeRate(buyRate);
  }, [buyRate, rateEdited]);

  // Mirror the rate edited inside either MultiPaymentInput up to the parent so
  // both instances stay in sync and the coverage math + payload use it.
  const handleRateChange = (rate: number) => {
    setRateEdited(true);
    setExchangeRate(rate);
  };

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-item discount (in the item's own currency), capped at each item's
  // profit. Keyed by cart item id. Items with no profit have no input.
  const [itemDiscounts, setItemDiscounts] = useState<Record<string, number>>(
    {},
  );

  // Reset per-item discounts AND the manual rate override whenever the modal
  // (re)opens with a fresh cart. The component stays mounted between checkouts
  // (it early-returns null when closed), so without clearing rateEdited a rate
  // typed in one checkout would stick for the component's lifetime and block the
  // re-seed effect above from picking up the current DB rate on the next one.
  useEffect(() => {
    if (isOpen) {
      setItemDiscounts({});
      setRateEdited(false);
    }
  }, [isOpen]);

  // Resolve the session's client id from its phone so the basket GIFT_CARD leg
  // can offer that client's vouchers. The session object only carries the
  // customer name/phone, not a numeric client id.
  const [sessionClientId, setSessionClientId] = useState<number | null>(null);
  const sessionPhone = activeSession?.customer_phone?.trim() ?? "";
  useEffect(() => {
    if (!isOpen || !sessionPhone) {
      setSessionClientId(null);
      return;
    }
    let cancelled = false;
    window.api.clients
      .getAll(sessionPhone)
      .then((clients) => {
        if (cancelled) return;
        const match = clients.find(
          (c) => (c.phone_number ?? "").trim() === sessionPhone,
        );
        setSessionClientId(match?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setSessionClientId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, sessionPhone]);

  // ── MultiPaymentInput state ──────────────────────────────────────────────
  // One pooled instance covers both currencies (any line, in either currency,
  // can cover any part of the combined total — matches how the backend already
  // treats payments[] as one flat pool per basket, see FEATURE_GUIDE §11).
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  // Return/change (OUT) legs emitted by MultiPaymentInput
  const [returnLines, setReturnLines] = useState<PaymentLine[]>([]);

  // Key used to force-remount MultiPaymentInput when client context changes
  const [paymentInputKey, setPaymentInputKey] = useState(0);

  // Whether the session can charge to the customer's account. CUSTOMER_ACCOUNT
  // needs BOTH a name and a phone — for a first-time walk-in the backend creates
  // the client on the fly from name+phone, so a name-only session has no account
  // to charge. Gating here stops the basket from auto-selecting CUSTOMER_ACCOUNT,
  // which otherwise fails server-side with
  // "Client is required for CUSTOMER_ACCOUNT cashout".
  const hasClient = canChargeToCustomerAccount({
    name: activeSession?.customer_name,
    phone: activeSession?.customer_phone,
  });

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

  const totals = useMemo(() => getCartTotals(), [getCartTotals]);

  // Customer NET position per currency (+ pays / − is paid). Every part of
  // this modal — the Total row, the payment seeds, the required total, the
  // payout instruction, and the net OUT leg — must speak this ONE number:
  // a $50 purchase and a $50 cash-out cancel, so nothing is collected and
  // nothing is paid out. The usdt fold covers legacy carts saved while
  // Binance items still carried the old "USDT" bucket tag (their amount is
  // the cash side in USD).
  const netUsd = totals.usd + totals.usdt;
  const netLbp = totals.lbp;

  // GROSS split — charges (customer pays, +) and cash-out payouts (shop pays,
  // −) are tracked SEPARATELY per currency, never cancelled against each other.
  // The Debts page must list both in full: a $10 charge + a $20 cash-out books
  // a $10 debt AND a $20 credit (net −$10), not one collapsed −$10 line. The
  // charges seed the payment / debt; the payouts become the cash payout or the
  // account credit. (binanceCashSide folds a Binance item's USDT tag into its
  // USD cash side.)
  const { chargeUsd, chargeLbp, payoutUsd, payoutLbp } = useMemo(
    () => splitBasketCashSides(cartItems),
    [cartItems],
  );

  // Does the operator settle this basket on the customer's account? Then the
  // cash-out payouts (shop owes the customer, e.g. a Binance/OMT/Whish
  // cash-out) are booked as store CREDIT on their account — reducing their
  // balance and showing on the Debts Payments side — rather than handed over
  // as cash. Requires a chargeable client (name + phone). A cash-paid or
  // clientless basket keeps the cash payout (lira-098).
  const payoutOnAccount =
    hasClient && paymentLines.some((l) => l.method === "CUSTOMER_ACCOUNT");

  // Cash the operator must physically hand the customer on confirm — the GROSS
  // payout (not the net), zero when settled to the account instead.
  const cashPayoutUsd = payoutOnAccount ? 0 : -payoutUsd;
  const cashPayoutLbp = payoutOnAccount ? 0 : -payoutLbp;

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

  // Currency configs for MultiPaymentInput
  const currencies = [
    { code: "USD", symbol: "$" },
    { code: "LBP", symbol: "LBP" },
  ];

  // Payment methods typed as required by MultiPaymentInput. GIFT_CARD is offered
  // at the basket level — the customer can redeem a voucher against the whole
  // basket (its code + value flow through the GIFT_CARD payment leg).
  const paymentMethodOptions = allMethods.map((m) => ({
    code: m.code,
    label: m.label,
  }));

  // Combined total the pooled MultiPaymentInput must cover — the GROSS charges
  // (never netted against the payouts, which are settled separately below).
  // LBP is converted to USD via the operator rate.
  const combinedTotalUSD = useMemo(() => {
    return chargeUsd + (exchangeRate > 0 ? chargeLbp / exchangeRate : 0);
  }, [chargeUsd, chargeLbp, exchangeRate]);

  // Seed one line per currency that has a GROSS charge — this opens
  // MultiPaymentInput directly in split mode with both rows pre-filled instead
  // of showing two separate widget instances (initialLines is read once, on
  // mount/remount, per the component's own contract).
  const paymentInitialLines = useMemo(() => {
    const lines: Array<{ currencyCode: string; amount: number }> = [];
    if (chargeUsd > 0) lines.push({ currencyCode: "USD", amount: chargeUsd });
    if (chargeLbp > 0) lines.push({ currencyCode: "LBP", amount: chargeLbp });
    return lines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentInputKey]);

  // Derive combined payment legs from the pooled MultiPaymentInput. IN legs are
  // what the customer paid; OUT legs are change handed back. `direction` is
  // carried through so the checkout handler can record the change (e.g. paid
  // $100, returned 180,000 LBP) rather than just the net. GIFT_CARD legs carry
  // their voucher_code so the basket recorder can redeem the voucher.
  const allPaymentLegs: Array<{
    method: string;
    currency_code: string;
    amount: number;
    direction: "IN" | "OUT";
    voucher_code?: string;
  }> = useMemo(() => {
    const toLeg = (direction: "IN" | "OUT") => (l: PaymentLine) => ({
      method: l.method,
      currency_code: l.currencyCode,
      amount: l.amount,
      direction,
      ...(l.method === "GIFT_CARD" && l.voucherCode
        ? { voucher_code: l.voucherCode }
        : {}),
    });
    const legs = [
      ...paymentLines.map(toLeg("IN")),
      ...returnLines.map(toLeg("OUT")),
    ];
    // Cash-out payouts (loto cash prize, OMT/Whish RECEIVE, Binance cash out):
    // the shop owes the customer. Emit the GROSS payout as ONE OUT leg per
    // currency — NOT netted against the charges, so the Debts page lists the
    // full payout ($20), not a net. Route to the customer's ACCOUNT (store
    // credit) when the basket is settled on account, else to CASH (default,
    // lira-098). Deferred cash-out items self-post nothing, so this leg is the
    // only place the payout is booked — recordBasketPayment turns a
    // CUSTOMER_ACCOUNT OUT leg into a session credit (Debts Payments side).
    const payoutMethod = payoutOnAccount ? "CUSTOMER_ACCOUNT" : "CASH";
    if (payoutUsd > 0) {
      legs.push({
        method: payoutMethod,
        currency_code: "USD",
        amount: payoutUsd,
        direction: "OUT",
      });
    }
    if (payoutLbp > 0) {
      legs.push({
        method: payoutMethod,
        currency_code: "LBP",
        amount: payoutLbp,
        direction: "OUT",
      });
    }
    return legs;
  }, [paymentLines, returnLines, payoutUsd, payoutLbp, payoutOnAccount]);

  // Primary method is the first non-zero leg's method, or CASH as fallback
  const primaryMethod =
    allPaymentLegs.find((l) => l.amount > 0)?.method ?? "CASH";

  // A CUSTOMER_ACCOUNT (charge-to-account) leg — whether auto-selected or chosen
  // manually — requires a chargeable client (name + phone). Block checkout
  // otherwise so it fails fast in the UI instead of server-side mid-transaction
  // with "Client is required for CUSTOMER_ACCOUNT cashout".
  const usesCustomerAccount = allPaymentLegs.some(
    (l) => l.method === "CUSTOMER_ACCOUNT",
  );
  const customerAccountBlocked = usesCustomerAccount && !hasClient;

  // Validate the combined (USD-equivalent) total is covered. Any line, in
  // either currency, counts toward the whole pool — see combinedTotalUSD above.
  const usdPaymentTolerance = 0.01;
  const lbpPaymentTolerance = 100;
  const combinedTolerance =
    usdPaymentTolerance + lbpPaymentTolerance / (exchangeRate || 1);

  const paidUSD = useMemo(
    () =>
      paymentLines.reduce((sum, l) => {
        if (l.currencyCode === "USD") return sum + (l.amount || 0);
        if (l.currencyCode === "LBP")
          return sum + (exchangeRate > 0 ? (l.amount || 0) / exchangeRate : 0);
        return sum;
      }, 0),
    [paymentLines, exchangeRate],
  );

  // Payment is valid once the total is COVERED. Overpayment is allowed — the
  // operator hands back the difference as change (the Return/Change row), so we
  // must not require an exact match (that disabled Confirm whenever the customer
  // paid more than the total, e.g. $100 paid on a $98 total with $2 change).
  const isPaymentValid =
    combinedTotalUSD <= 0 || paidUSD >= combinedTotalUSD - combinedTolerance;

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

    if (customerAccountBlocked) {
      setError(
        "Customer Account requires both a customer name and phone number. Add a phone to this session or pick another payment method.",
      );
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Build cart items: apply the per-item discount (reduces recorded profit)
      // and, for cashout items, derive the cashout method from the basket's
      // primary payment method. Payment is collected once at the basket level —
      // the item formData carries no payment method.
      const updatedCartItems = cartItems.map((item) => {
        const discount = itemDiscounts[item.id] ?? 0;
        const updatedFormData = applyItemDiscount(item, discount);

        // For RECEIVE/cashout items, map the basket's primary method to
        // cashoutMethod (binance_receive only accepts CASH / CUSTOMER_ACCOUNT).
        if (isCashoutItem(item)) {
          updatedFormData.cashoutMethod =
            primaryMethod === "CUSTOMER_ACCOUNT" ? "CUSTOMER_ACCOUNT" : "CASH";
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
        exchangeRate,
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
                    const profitCap = getItemProfitCap(item);
                    const discount = itemDiscounts[item.id] ?? 0;
                    return (
                      <div key={item.id} className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-slate-200 truncate flex-1 min-w-0">
                            {item.label}
                          </span>
                          {/* Amount — customer perspective only. Binance
                              items show their CASH side in USD (the USDT is
                              the service, named in the label; the wallet
                              movement is shop bookkeeping). */}
                          <span
                            className={`text-sm font-mono whitespace-nowrap min-w-[5rem] text-right shrink-0 ${
                              item.amount < 0
                                ? "text-red-400"
                                : "text-emerald-400"
                            }`}
                          >
                            {item.amount < 0 ? "-" : "+"}
                            {binanceCashSide(item)
                              ? `$${Math.abs(item.amount).toFixed(2)}`
                              : formatAmount(item.amount, item.currency)}
                          </span>
                        </div>

                        {/* Per-item discount — capped at the item's profit.
                            Hidden for items with no profit concept. */}
                        {profitCap > 0 && (
                          <div className="flex items-center justify-end gap-2 pl-1">
                            <label className="text-[11px] text-slate-400 whitespace-nowrap">
                              Discount (max{" "}
                              {formatAmount(profitCap, item.currency)})
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={profitCap}
                              step={item.currency === "LBP" ? 1000 : 0.01}
                              value={discount || ""}
                              onChange={(e) => {
                                const raw = parseFloat(e.target.value) || 0;
                                const clamped = Math.min(
                                  Math.max(0, raw),
                                  profitCap,
                                );
                                setItemDiscounts((prev) => ({
                                  ...prev,
                                  [item.id]: clamped,
                                }));
                              }}
                              className="w-28 bg-slate-900 border border-slate-600 rounded-md px-2 py-1 text-xs text-white font-mono text-right focus:outline-none focus:border-orange-500"
                              placeholder="0"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Basket total — combined USD/LBP breakdown, shown once before the
              payment section since the pooled MultiPaymentInput below only
              displays its running total in USD-equivalent. */}
          {(netUsd !== 0 || netLbp !== 0) && (
            <div className="bg-slate-800/50 border border-slate-700/40 rounded-lg px-3 py-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">Total</span>
              <span className="flex items-center gap-3 font-mono text-sm">
                {netUsd !== 0 && (
                  <span
                    className={netUsd < 0 ? "text-red-400" : "text-emerald-400"}
                  >
                    {netUsd < 0 ? "-" : ""}
                    {formatAmount(netUsd, "USD")}
                  </span>
                )}
                {netLbp !== 0 && (
                  <span
                    className={netLbp < 0 ? "text-red-400" : "text-emerald-400"}
                  >
                    {netLbp < 0 ? "-" : ""}
                    {formatAmount(netLbp, "LBP")}
                  </span>
                )}
              </span>
            </div>
          )}

          {/* MultiPaymentInput — one pooled section covering both currencies.
              Pre-seeded with one row per positive currency total, opening
              directly in split mode instead of two separate widgets. */}
          {(totals.usd > 0 || totals.lbp > 0) && (
            <div className="space-y-1">
              <MultiPaymentInput
                key={`payment-${paymentInputKey}`}
                totalAmount={combinedTotalUSD}
                currency="USD"
                totalAmountCurrency="USD"
                initialLines={paymentInitialLines}
                onChange={setPaymentLines}
                onReturnChange={setReturnLines}
                requiresClientForDebt={true}
                hasClient={hasClient}
                paymentMethods={paymentMethodOptions}
                currencies={currencies}
                exchangeRate={exchangeRate}
                onRateChange={handleRateChange}
                showDiscount={false}
                label="Payment"
                initialMethod={initialMethod}
                clientId={sessionClientId}
                fetchClientVouchers={fetchClientVouchers}
              />
            </div>
          )}

          {/* Net cash-OUT to the customer (loto prize / RECEIVE / Binance cash
              out). Shown when the basket nets negative in cash — the shop pays
              this out of the General drawer on confirm. Binance cash-outs live
              in the usdt bucket (their payout is self-posted at replay) but the
              operator still hands over CASH — include them here. */}
          {(cashPayoutUsd < 0 || cashPayoutLbp < 0) && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 space-y-1">
              <div className="text-xs font-medium text-amber-300">
                Payout to customer (cash)
              </div>
              {cashPayoutUsd < 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">USD</span>
                  <span className="font-mono text-amber-400">
                    {formatAmount(cashPayoutUsd, "USD")}
                  </span>
                </div>
              )}
              {cashPayoutLbp < 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">LBP</span>
                  <span className="font-mono text-amber-400">
                    {formatAmount(cashPayoutLbp, "LBP")}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* On-account payout: the GROSS cash-out booked as store credit, not
              cash handed over (never netted against the charges). */}
          {payoutOnAccount && (payoutUsd > 0 || payoutLbp > 0) && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 space-y-1">
              <div className="text-xs font-medium text-emerald-300">
                Credited to customer account
              </div>
              {payoutUsd > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">USD</span>
                  <span className="font-mono text-emerald-400">
                    {formatAmount(-payoutUsd, "USD")}
                  </span>
                </div>
              )}
              {payoutLbp > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">LBP</span>
                  <span className="font-mono text-emerald-400">
                    {formatAmount(-payoutLbp, "LBP")}
                  </span>
                </div>
              )}
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
            disabled={
              isProcessing ||
              cartItems.length === 0 ||
              !isPaymentValid ||
              customerAccountBlocked
            }
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

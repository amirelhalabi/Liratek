import { useState, useEffect, useCallback, memo, startTransition } from "react";
import { ChevronDown, Phone, Plus, X } from "lucide-react";
import {
  formatWithCommas,
  isPartialDecimal,
} from "@/shared/utils/formatWithCommas";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { ClientAutocompleteInput } from "@/shared/components/ClientAutocompleteInput";
import { ensureRechargeClient } from "../utils/ensureClient";
import AlfaLogo from "@/assets/logos/alfa.svg?react";
import MtcLogo from "@/assets/logos/mtc.svg?react";
import { type PaymentLine, useApi } from "@liratek/ui";
import { toCamelLegs } from "@/utils/paymentUtils";
import { useSession } from "@/features/sessions/context/SessionContext";
import { useSessionAutoFill } from "@/features/sessions/hooks/useSessionAutoFill";
import type { ProviderConfig, FinancialTransaction } from "../types";
import type { ServiceItem, ProviderKey } from "../hooks/useMobileServiceItems";
import { getCategoryColor } from "../utils/categoryColors";
import { HistoryModal } from "./HistoryModal";
import { PaymentSheet } from "./PaymentSheet";
import { fetchClientVouchers } from "@/shared/utils/clientVouchers";
import logger from "@/utils/logger";

// ─── Module-level pure helpers ────────────────────────────────────────────────

function isTelecomVoucher(item: ServiceItem): boolean {
  return (
    item.category === "alfa" ||
    item.category === "mtc" ||
    item.subcategory === "alfa" ||
    item.subcategory === "mtc"
  );
}

function calcReturnedCredits(denomination: number): number {
  return Math.floor(denomination / 0.5) * 0.5;
}

function calcPrice(item: ServiceItem, onlyDays: boolean, returnedCredits: number, sellRate: number): number {
  const sellPrice = item.catalogSellPrice ?? 0;
  return onlyDays ? sellPrice - returnedCredits * sellRate : sellPrice;
}

function calcCost(item: ServiceItem, onlyDays: boolean, returnedCredits: number, costRate: number): number {
  const cost = item.catalogCost ?? 0;
  return onlyDays ? cost - returnedCredits * costRate : cost;
}

// ─── ItemCard (memo'd, module scope) ─────────────────────────────────────────

interface ItemCardProps {
  item: ServiceItem;
  qty: number;
  isExpanded: boolean;
  onlyDays: boolean;
  returnedCreditsUsd: number;
  onCardClick: (item: ServiceItem) => void;
  onQtyDecrease: (item: ServiceItem) => void;
  onQtyIncrease: (item: ServiceItem) => void;
  onOnlyDaysChange: (item: ServiceItem, checked: boolean) => void;
  onReturnedCreditsChange: (item: ServiceItem, value: number) => void;
}

const ItemCard = memo(function ItemCard({
  item,
  qty,
  isExpanded,
  onlyDays,
  returnedCreditsUsd,
  onCardClick,
  onQtyDecrease,
  onQtyIncrease,
  onOnlyDaysChange,
  onReturnedCreditsChange,
}: ItemCardProps) {
  const cost = item.catalogCost ?? 0;
  const sellPrice = item.catalogSellPrice ?? 0;
  const isTelecom = isTelecomVoucher(item);

  return (
    <div className="relative">
      <div
        className={`w-full p-3 rounded-lg border transition-all ${
          qty > 0
            ? "border-orange-500/40 ring-1 ring-orange-500/30"
            : "border-white/10 hover:border-white/20"
        } ${isExpanded && qty > 0 ? "ring-2 ring-orange-500/50" : ""}`}
        style={{ backgroundColor: `${getCategoryColor(item.category)}18` }}
      >
        <div onClick={() => onCardClick(item)} className="cursor-pointer">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-white font-medium text-sm truncate">{item.label}</div>
            {qty > 0 && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); onQtyDecrease(item); }}
                  className="w-5 h-5 rounded-full bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 flex items-center justify-center transition-colors cursor-pointer text-xs font-bold"
                  type="button"
                >−</button>
                <span className="w-4 text-center text-xs font-bold text-orange-400">{qty}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onQtyIncrease(item); }}
                  className="w-5 h-5 rounded-full bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 flex items-center justify-center transition-colors cursor-pointer text-xs font-bold"
                  type="button"
                >+</button>
              </div>
            )}
          </div>
          <div className="flex flex-col items-center justify-center gap-0.5">
            {item.subcategory === "alfa" || item.category === "alfa" ? (
              <AlfaLogo className="h-4 w-auto" />
            ) : item.subcategory === "mtc" || item.category === "mtc" ? (
              <MtcLogo className="h-4 w-auto" />
            ) : null}
            <span className="text-slate-500 text-[10px] truncate max-w-full">{item.subcategory}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-slate-400">Cost:</span>
            <span className="text-xs text-white font-mono">{cost.toLocaleString()} LBP</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Sell:</span>
            <span className="text-xs text-emerald-400 font-mono">{sellPrice.toLocaleString()} LBP</span>
          </div>
        </div>
      </div>

      {qty > 0 && isExpanded && (
        <div className="mt-2 p-3 bg-slate-900 rounded-lg border border-slate-700">
          {isTelecom && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  type="checkbox"
                  id={`onlydays-${item.key}`}
                  checked={onlyDays}
                  onChange={(e) => onOnlyDaysChange(item, e.target.checked)}
                  className="w-4 h-4 rounded border-slate-600 text-orange-500 focus:ring-orange-500 cursor-pointer"
                />
                <label htmlFor={`onlydays-${item.key}`} className="text-xs text-slate-300 cursor-pointer select-none whitespace-nowrap">
                  Only Days
                </label>
              </div>
              {onlyDays && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-xs text-slate-400 whitespace-nowrap">Credits</span>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max={parseFloat(item.label) || 0}
                    value={returnedCreditsUsd}
                    onChange={(e) => onReturnedCreditsChange(item, parseFloat(e.target.value) || 0)}
                    className="w-14 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-orange-500"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ─── KatchFormInner ──────────────────────────────────────────────────────────

interface CartLineItem {
  item: ServiceItem;
  quantity: number;
  onlyDays: boolean;
  returnedCreditsUsd: number;
}

interface NewItemForm {
  provider: string;
  category: string;
  subcategory: string;
  label: string;
  cost_lbp: string;
  sell_lbp: string;
  sort_order: string;
}

interface KatchFormProps {
  activeConfig: ProviderConfig | undefined;
  activeProvider: ProviderKey | null;
  getCategoriesForProvider: (provider: ProviderKey) => string[];
  getServiceItems: (provider: ProviderKey, category: string) => ServiceItem[];
  methods: { code: string; label: string }[];
  loadFinancialData: () => void;
  formatAmount: (val: number, currency: string) => string;
  alfaCreditSellRate: number;
  alfaCreditCostRate: number;
  exchangeRate: number;
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  onRefreshItems?: () => Promise<void>;
  isAdmin?: boolean;
}

function KatchFormInner({
  activeConfig,
  activeProvider,
  getCategoriesForProvider,
  getServiceItems,
  methods,
  loadFinancialData,
  formatAmount,
  alfaCreditSellRate,
  alfaCreditCostRate,
  exchangeRate,
  showHistory,
  setShowHistory,
  onRefreshItems,
  isAdmin,
}: KatchFormProps) {
  const api = useApi();
  const {
    activeSession,
    linkTransaction,
    addToCart: addToSessionCart,
  } = useSession();
  const [cart, setCart] = useState<Map<string, CartLineItem>>(new Map());
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientId, setClientId] = useState<number | null>(null);
  const [paymentInputKey, setPaymentInputKey] = useState(0);
  const [initialPaymentMethod, setInitialPaymentMethod] = useState("CASH");
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [newItemForm, setNewItemForm] = useState<NewItemForm | null>(null);
  const [addItemError, setAddItemError] = useState("");

  // Autofill client name + phone from active customer session
  useSessionAutoFill([
    { select: (s) => s.customer_name, set: setClientName, clearValue: "" },
    { select: (s) => s.customer_phone, set: setClientPhone, clearValue: "" },
  ]);

  // Auto-promote CUSTOMER_ACCOUNT once both name+phone are filled for a brand-new client
  useEffect(() => {
    const hasNewClientInfo =
      !clientId && clientName.trim().length > 0 && clientPhone.trim().length > 0;
    if (hasNewClientInfo && initialPaymentMethod !== "CUSTOMER_ACCOUNT") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInitialPaymentMethod("CUSTOMER_ACCOUNT");
       
      setPaymentInputKey((k) => k + 1);
    }
  }, [clientId, clientName, clientPhone, initialPaymentMethod]);

  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [returnLegs, setReturnLegs] = useState<PaymentLine[]>([]);
  const isSplitPayment = paymentLines.length > 1;
  const [transactionTime, setTransactionTime] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [discount, setDiscount] = useState(0);
  const [showPaymentSheet, setShowPaymentSheet] = useState(false);
  const [itemsReady, setItemsReady] = useState(false);
  const [historyTransactions, setHistoryTransactions] = useState<FinancialTransaction[]>([]);

  // Lazy-load provider history only when the history modal is opened.
  useEffect(() => {
    if (showHistory && activeProvider) {
      api.getOMTHistory(activeProvider).then((txs: FinancialTransaction[]) => {
        setHistoryTransactions(
          (txs ?? []).filter((tx: FinancialTransaction) => tx.provider === activeProvider),
        );
      }).catch((err: unknown) => {
        logger.error("Failed to load Katch history:", err);
      });
    }
  }, [showHistory, activeProvider, api]);

  // Reset and defer card grid rendering on every provider switch so the shell
  // (search bar + proceed button) paints before the heavy DOM is created.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItemsReady(false);
    const rafId = requestAnimationFrame(() => {
      startTransition(() => setItemsReady(true));
    });
    return () => cancelAnimationFrame(rafId);
  }, [activeProvider]);

  // ─── Stable callbacks (empty deps — use only functional setState) ─────────

  const handleCardClick = useCallback((item: ServiceItem) => {
    if (isTelecomVoucher(item)) {
      setExpandedKeys((prev) => {
        if (prev.has(item.key)) return prev;
        const next = new Set(prev);
        next.add(item.key);
        return next;
      });
    }
    setCart((prev) => {
      if (prev.has(item.key)) return prev;
      const next = new Map(prev);
      next.set(item.key, { item, quantity: 1, onlyDays: false, returnedCreditsUsd: 0 });
      return next;
    });
  }, []);

  const handleQtyDecrease = useCallback((item: ServiceItem) => {
    setCart((prev) => {
      const existing = prev.get(item.key);
      if (!existing) return prev;
      const newQty = existing.quantity - 1;
      if (newQty <= 0) {
        const next = new Map(prev);
        next.delete(item.key);
        return next;
      }
      const next = new Map(prev);
      next.set(item.key, { ...existing, quantity: newQty });
      return next;
    });
  }, []);

  const handleQtyIncrease = useCallback((item: ServiceItem) => {
    setCart((prev) => {
      const existing = prev.get(item.key);
      const next = new Map(prev);
      if (existing) {
        next.set(item.key, { ...existing, quantity: existing.quantity + 1 });
      } else {
        next.set(item.key, { item, quantity: 1, onlyDays: false, returnedCreditsUsd: 0 });
      }
      return next;
    });
  }, []);

  const handleOnlyDaysChange = useCallback((item: ServiceItem, checked: boolean) => {
    setCart((prev) => {
      const existing = prev.get(item.key);
      if (!existing) return prev;
      let returnedCredits = 0;
      if (checked) {
        const denomination = parseFloat(item.label);
        if (!isNaN(denomination)) returnedCredits = calcReturnedCredits(denomination);
      }
      const next = new Map(prev);
      next.set(item.key, { ...existing, onlyDays: checked, returnedCreditsUsd: returnedCredits });
      return next;
    });
  }, []);

  const handleReturnedCreditsChange = useCallback((item: ServiceItem, value: number) => {
    setCart((prev) => {
      const existing = prev.get(item.key);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(item.key, { ...existing, returnedCreditsUsd: value });
      return next;
    });
  }, []);

  const toggleCategoryCollapse = useCallback((category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  if (!activeConfig || !activeProvider) return null;

  const categories = getCategoriesForProvider(activeProvider);

  const filterItemsBySearch = (items: ServiceItem[]): ServiceItem[] => {
    if (!searchQuery.trim()) return items;
    const query = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(query) ||
        item.subcategory.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query),
    );
  };

  const totalPrice = Array.from(cart.values()).reduce((sum, line) => {
    return sum + calcPrice(line.item, line.onlyDays, line.returnedCreditsUsd, alfaCreditSellRate) * line.quantity;
  }, 0);

  const totalCost = Array.from(cart.values()).reduce((sum, line) => {
    return sum + calcCost(line.item, line.onlyDays, line.returnedCreditsUsd, alfaCreditCostRate) * line.quantity;
  }, 0);

  // Max discount = total commission (sell - cost), discount cannot exceed profit
  const maxDiscount = Math.max(0, totalPrice - totalCost);

  const totalItems = Array.from(cart.values()).reduce(
    (sum, line) => sum + line.quantity,
    0,
  );

  const getCartCountForCategory = (category: string): number =>
    Array.from(cart.values())
      .filter((line) => line.item.category === category && line.item.provider === activeProvider)
      .reduce((sum, line) => sum + line.quantity, 0);

  const handleAddItem = async () => {
    if (!newItemForm) return;
    setAddItemError("");
    if (!newItemForm.label.trim() || !newItemForm.cost_lbp || !newItemForm.sell_lbp) {
      setAddItemError("Label, cost, and sell are required");
      return;
    }
    const costLbp = parseInt(newItemForm.cost_lbp, 10);
    const sellLbp = parseInt(newItemForm.sell_lbp, 10);
    if (isNaN(costLbp) || isNaN(sellLbp)) {
      setAddItemError("Cost and sell must be valid numbers");
      return;
    }
    try {
      const res = await window.api.mobileServiceItems.create({
        provider: newItemForm.provider,
        category: newItemForm.category,
        subcategory: newItemForm.subcategory,
        label: newItemForm.label.trim(),
        cost_lbp: costLbp,
        sell_lbp: sellLbp,
        sort_order: parseInt(newItemForm.sort_order, 10) || 0,
      });
      if (!res.success) {
        setAddItemError(res.error ?? "Failed to create item");
        return;
      }
      setNewItemForm(null);
      await onRefreshItems?.();
    } catch {
      setAddItemError("Create failed");
    }
  };

  const handleSubmit = async () => {
    if (cart.size === 0 || localSubmitting) return;

    const clientResult = await ensureRechargeClient({
      clientId,
      name: clientName,
      phone: clientPhone,
      paymentLines,
    });
    if (!clientResult.ok) {
      alert(clientResult.error);
      return;
    }
    const resolvedClientId = clientResult.id;
    if (resolvedClientId && resolvedClientId !== clientId) {
      setClientId(resolvedClientId);
    }

    // If session is active, add all cart items as one session cart entry
    if (activeSession) {
      const cartItems = Array.from(cart.values());
      const providerLabel = activeProvider === "Katsh" ? "Katsh" : "iPick";
      const itemLabels = cartItems
        .map((line) => `${line.item.label} x${line.quantity}`)
        .join(", ");
      const label =
        itemLabels.length > 60
          ? `${providerLabel} (${cartItems.length} items) - ${totalPrice.toLocaleString()} LBP`
          : `${providerLabel}: ${itemLabels}`;

      const finalPaymentMethod = isSplitPayment ? "MULTI" : paymentMethod;
      // Always send the payment breakdown when the user has interacted with
      // MultiPaymentInput — this preserves per-line currency choices (e.g. a
      // single CUSTOMER_ACCOUNT line in USD against an LBP transaction).
      const paymentsPayload =
        paymentLines.length > 0
          ? toCamelLegs(paymentLines, returnLegs)
          : undefined;

      // Store each line item for replay at checkout
      // Distribute discount proportionally across items based on sell price
      const sessionTotalSellPrice = cartItems.reduce((sum, line) => {
        return sum + calcPrice(line.item, line.onlyDays, line.returnedCreditsUsd, alfaCreditSellRate) * line.quantity;
      }, 0);

      const formDataItems = cartItems.flatMap((line) => {
        const sellPrice = calcPrice(line.item, line.onlyDays, line.returnedCreditsUsd, alfaCreditSellRate);
        const cost = calcCost(line.item, line.onlyDays, line.returnedCreditsUsd, alfaCreditCostRate);
        const unitDiscountShare =
          sessionTotalSellPrice > 0
            ? Math.round((discount * sellPrice) / sessionTotalSellPrice)
            : 0;
        const discountedSellPrice = sellPrice - unitDiscountShare;
        const commission = discountedSellPrice - cost;
        return Array.from({ length: line.quantity }, () => ({
          provider: activeProvider,
          serviceType: "SEND",
          amount: discountedSellPrice,
          cost,
          currency: "LBP",
          commission: Math.max(0, commission),
          paidByMethod: finalPaymentMethod,
          payments: paymentsPayload,
          clientId: resolvedClientId || undefined,
          clientName: clientName || undefined,
          itemKey: line.item.key,
          itemCategory: line.item.category,
          returnedCreditsUsd: line.onlyDays
            ? line.returnedCreditsUsd
            : undefined,
          note: `${line.item.label} (${line.item.subcategory})${line.onlyDays ? " [Only Days]" : ""}`,
        }));
      });

      addToSessionCart({
        module: activeProvider === "Katsh" ? "katsh" : "ipick",
        label,
        amount: totalPrice - discount,
        currency: "LBP",
        ipcChannel: "financial:create",
        formData: {
          _batch: true,
          items: formDataItems,
        },
      });

      // Reset form
      setCart(new Map());
      setClientName("");
      setClientPhone("");
      setClientId(null);
      setExpandedKeys(new Set());
      setReturnLegs([]);
      return;
    }

    setLocalSubmitting(true);

    const cartItems = Array.from(cart.values());
    const finalPaymentMethod = isSplitPayment ? "MULTI" : paymentMethod;
    const paymentsPayload =
      paymentLines.length > 0
        ? toCamelLegs(paymentLines, returnLegs)
        : undefined;

    // Aggregate all items into one transaction
    const totalSellPrice = cartItems.reduce((sum, line) => {
      return sum + calcPrice(line.item, line.onlyDays, line.returnedCreditsUsd, alfaCreditSellRate) * line.quantity;
    }, 0);

    const aggregatedCost = cartItems.reduce((sum, line) => {
      return sum + calcCost(line.item, line.onlyDays, line.returnedCreditsUsd, alfaCreditCostRate) * line.quantity;
    }, 0);

    const discountedTotal = totalSellPrice - discount;
    const aggregatedCommission = Math.max(0, discountedTotal - aggregatedCost);

    const noteLines = cartItems.flatMap((line) =>
      line.quantity > 1
        ? [`${line.item.label} x${line.quantity}${line.onlyDays ? " [Only Days]" : ""}`]
        : [`${line.item.label}${line.onlyDays ? " [Only Days]" : ""}`],
    );
    const note = noteLines.join(", ");

    let allSucceeded = false;
    try {
      const result = await api.addOMTTransaction({
        provider: activeProvider,
        serviceType: "SEND",
        amount: discountedTotal,
        cost: aggregatedCost,
        currency: "LBP",
        commission: aggregatedCommission,
        paidByMethod: finalPaymentMethod,
        payments: paymentsPayload,
        clientId: resolvedClientId || undefined,
        clientName: clientName || undefined,
        note,
        transaction_time: transactionTime,
      });

      if (result?.success) {
        allSucceeded = true;
        if (activeSession && result.id) {
          try {
            await linkTransaction({
              transactionType: "financial_service",
              transactionId: result.id,
              amountUsd: 0,
              amountLbp: discountedTotal,
              profitLbp: aggregatedCommission,
            });
          } catch (err) {
            logger.error("Failed to link Katch tx to session:", err);
          }
        }
      } else {
        logger.error("Katch submit failed:", result?.error);
        alert(result?.error || "Failed to process payment");
      }
    } catch (err) {
      logger.error("Katch submit error:", err);
      alert("Failed to process payment");
    }

    if (allSucceeded) {
      setCart(new Map());
      setClientName("");
      setClientPhone("");
      setClientId(null);
      setExpandedKeys(new Set());
      setReturnLegs([]);
      setTransactionTime(undefined);
      const hasDebtPayment =
        paymentMethod === "CUSTOMER_ACCOUNT" ||
        paymentLines.some((l) => l.method === "CUSTOMER_ACCOUNT");
      if (hasDebtPayment) {
        window.dispatchEvent(new CustomEvent("debt-ledger-changed"));
      }
    }
    loadFinancialData();
    setLocalSubmitting(false);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Top Row: Search Bar + Proceed to Pay — sticky so it never scrolls away */}
      <div className="sticky top-0 z-10 flex items-center gap-3 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pb-1">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${activeProvider} items...`}
            className="w-full px-4 py-2.5 pl-10 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
              aria-label="Clear search"
              type="button"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {totalItems > 0 && (
            <div className="text-right leading-tight">
              <div className="text-xs text-white font-bold">{totalItems} items</div>
              <div className="text-xs text-emerald-400 font-mono font-semibold">{totalPrice.toLocaleString()} LBP</div>
              {exchangeRate > 0 && (
                <div className="text-xs text-slate-400 font-mono">${(totalPrice / exchangeRate).toFixed(2)}</div>
              )}
            </div>
          )}
          {/* Payment method quick-select */}
          <div className="relative">
            <select
              value={initialPaymentMethod}
              onChange={(e) => {
                setInitialPaymentMethod(e.target.value);
                setPaymentInputKey((k) => k + 1);
              }}
              className="appearance-none bg-slate-900 border border-slate-600 rounded-lg pl-3 pr-7 py-2 text-white text-xs font-medium focus:outline-none focus:border-orange-500 transition-all cursor-pointer"
            >
              {methods.map((m) => (
                <option key={m.code} value={m.code}>{m.label}</option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
          <button
            type="button"
            onClick={() => setShowPaymentSheet(true)}
            disabled={totalItems === 0}
            className={`px-4 py-2.5 rounded-lg font-bold text-sm transition-all whitespace-nowrap ${
              totalItems === 0
                ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                : "bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/20"
            }`}
          >
            {activeSession ? "Add to Cart" : "Proceed to Pay"}
          </button>
        </div>
      </div>

      {/* Card Grid */}
      {!itemsReady ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3 text-slate-400">
            <div className="w-8 h-8 border-2 border-slate-700 border-t-orange-500 rounded-full animate-spin" />
            <span className="text-sm">Loading items...</span>
          </div>
        </div>
      ) : (
      <div className="space-y-6 pb-2">
        {categories.map((category) => {
          const allCategoryItems = getServiceItems(activeProvider, category);
          const categoryItems = filterItemsBySearch(allCategoryItems);

          // Skip category if no items match search
          if (categoryItems.length === 0) return null;

          return (
            <div
              key={category}
              className="bg-slate-800 rounded-xl border border-slate-700/50 p-4"
            >
              <div
                onClick={() => toggleCategoryCollapse(category)}
                className="flex items-center justify-between cursor-pointer select-none"
              >
                <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: getCategoryColor(category) }}
                  />
                  {category}
                  {getCartCountForCategory(category) > 0 && (
                    <span className="px-1.5 py-0.5 bg-orange-500/20 text-orange-400 text-[10px] font-bold rounded-full leading-none">
                      {getCartCountForCategory(category)}
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-1.5">
                  {isAdmin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAddItemError("");
                        setNewItemForm(
                          newItemForm?.category === category
                            ? null
                            : {
                                provider: activeProvider as string,
                                category,
                                subcategory: "",
                                label: "",
                                cost_lbp: "",
                                sell_lbp: "",
                                sort_order: "0",
                              },
                        );
                      }}
                      className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                      type="button"
                      title="Add item"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      collapsedCategories.has(category) ? "-rotate-90" : ""
                    }`}
                  />
                </div>
              </div>
              {newItemForm?.category === category && (
                <div className="mt-3 border border-slate-600/40 rounded-lg p-3 bg-slate-900/50 space-y-2">
                  {addItemError && (
                    <p className="text-xs text-red-400">{addItemError}</p>
                  )}
                  <div className="flex items-end gap-2 flex-wrap">
                    <div className="flex-1 min-w-24">
                      <label className="text-slate-400 text-xs block mb-1">Subcategory</label>
                      <input
                        type="text"
                        value={newItemForm.subcategory}
                        onChange={(e) => setNewItemForm({ ...newItemForm, subcategory: e.target.value })}
                        placeholder="e.g. pubg"
                        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500"
                      />
                    </div>
                    <div className="flex-1 min-w-24">
                      <label className="text-slate-400 text-xs block mb-1">Label</label>
                      <input
                        autoFocus
                        type="text"
                        value={newItemForm.label}
                        onChange={(e) => setNewItemForm({ ...newItemForm, label: e.target.value })}
                        placeholder="e.g. 60UC"
                        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500"
                      />
                    </div>
                    <div className="w-28">
                      <label className="text-slate-400 text-xs block mb-1">Cost</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={formatWithCommas(newItemForm.cost_lbp)}
                        onChange={(e) => {
                          const cleaned = e.target.value.replace(/,/g, "");
                          if (isPartialDecimal(cleaned))
                            setNewItemForm({ ...newItemForm, cost_lbp: cleaned });
                        }}
                        placeholder="LBP"
                        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500"
                      />
                    </div>
                    <div className="w-28">
                      <label className="text-slate-400 text-xs block mb-1">Sell</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={formatWithCommas(newItemForm.sell_lbp)}
                        onChange={(e) => {
                          const cleaned = e.target.value.replace(/,/g, "");
                          if (isPartialDecimal(cleaned))
                            setNewItemForm({ ...newItemForm, sell_lbp: cleaned });
                        }}
                        placeholder="LBP"
                        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500"
                      />
                    </div>
                    <div className="w-16">
                      <label className="text-slate-400 text-xs block mb-1">Order</label>
                      <input
                        type="number"
                        value={newItemForm.sort_order}
                        onChange={(e) => setNewItemForm({ ...newItemForm, sort_order: e.target.value })}
                        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500"
                      />
                    </div>
                    <button
                      onClick={handleAddItem}
                      className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-medium transition-colors"
                      type="button"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => { setNewItemForm(null); setAddItemError(""); }}
                      className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm transition-colors"
                      type="button"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
              {!collapsedCategories.has(category) && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mt-3">
                  {categoryItems.map((item) => {
                    const inCart = cart.get(item.key);
                    return (
                      <ItemCard
                        key={item.key}
                        item={item}
                        qty={inCart?.quantity ?? 0}
                        isExpanded={expandedKeys.has(item.key)}
                        onlyDays={inCart?.onlyDays ?? false}
                        returnedCreditsUsd={inCart?.returnedCreditsUsd ?? 0}
                        onCardClick={handleCardClick}
                        onQtyDecrease={handleQtyDecrease}
                        onQtyIncrease={handleQtyIncrease}
                        onOnlyDaysChange={handleOnlyDaysChange}
                        onReturnedCreditsChange={handleReturnedCreditsChange}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

      <PaymentSheet
        open={showPaymentSheet}
        onClose={() => setShowPaymentSheet(false)}
        onConfirm={handleSubmit}
        isSubmitting={localSubmitting}
        title={activeSession ? "Add to Cart" : "Confirm Payment"}
        subtitle={`${totalItems} items — ${totalPrice.toLocaleString()} LBP`}
        accentColor="bg-orange-500 hover:bg-orange-600 text-white"
        totalAmount={totalPrice}
        totalAmountCurrency="LBP"
        currency="LBP"
        paymentMethods={methods}
        clientId={clientId}
        fetchClientVouchers={fetchClientVouchers}
        exchangeRate={exchangeRate}
        showDiscount={true}
        maxDiscount={maxDiscount}
        onDiscountChange={setDiscount}
        hasClient={
          !!clientId || (!!clientName.trim() && !!clientPhone.trim())
        }
        paymentInputKey={paymentInputKey}
        initialPaymentMethod={initialPaymentMethod}
        onPaymentChange={(lines) => {
          setPaymentLines(lines);
          if (lines.length === 1) {
            setPaymentMethod(lines[0].method);
          }
        }}
        onReturnChange={setReturnLegs}
      >
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Client Name
          </label>
          <ClientAutocompleteInput
            type="text"
            value={clientName}
            onChange={(v) => {
              setClientName(v);
              if (!v) {
                setClientId(null);
                setClientPhone("");
              }
            }}
            onClientSelect={(c) => {
              setClientId(c.id);
              setClientPhone(c.phone_number || "");
              setInitialPaymentMethod("CUSTOMER_ACCOUNT");
              setPaymentInputKey((k) => k + 1);
            }}
            placeholder="Client name (optional)"
            className="w-full mt-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
          />
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
              <Phone size={14} />
            </div>
            <input
              type="tel"
              inputMode="numeric"
              value={clientPhone}
              onChange={(e) => setClientPhone(e.target.value)}
              placeholder="Phone number (registers a new client)"
              className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-10 pr-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-orange-500"
            />
          </div>
          {clientName.trim() && clientPhone.trim() && !clientId && (
            <p className="text-xs text-orange-300/80 px-1">
              New client will be created on confirm.
            </p>
          )}
          <TransactionTimeOverride
            value={transactionTime}
            onChange={setTransactionTime}
          />
        </div>
      </PaymentSheet>

      {/* History Modal */}
      {showHistory && (
        <HistoryModal
          transactions={historyTransactions}
          provider={activeProvider as string}
          onClose={() => setShowHistory(false)}
          onRefresh={loadFinancialData}
          formatAmount={formatAmount}
          onUpdateMetadata={async (id, data) => {
            const result = await window.api.financial.updateMetadata({
              id,
              ...(data.client_name !== undefined && {
                customer_name: data.client_name,
              }),
              ...(data.phone_number !== undefined && {
                phone_number: data.phone_number,
              }),
              ...(data.note !== undefined && { note: data.note }),
            });
            return result;
          }}
        />
      )}
    </div>
  );
}

export const KatchForm = memo(KatchFormInner);

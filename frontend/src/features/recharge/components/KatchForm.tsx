import { useState, useEffect } from "react";
import { ChevronDown, Phone, Plus, X } from "lucide-react";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { ClientAutocompleteInput } from "@/shared/components/ClientAutocompleteInput";
import { ensureRechargeClient } from "../utils/ensureClient";
import AlfaLogo from "@/assets/logos/alfa.svg?react";
import MtcLogo from "@/assets/logos/mtc.svg?react";
import { type PaymentLine, useApi } from "@liratek/ui";
import { useSession } from "@/features/sessions/context/SessionContext";
import { useSessionAutoFill } from "@/features/sessions/hooks/useSessionAutoFill";
import type { ProviderConfig, FinancialTransaction } from "../types";
import type { ServiceItem, ProviderKey } from "../hooks/useMobileServiceItems";
import { getCategoryColor } from "../utils/categoryColors";
import { HistoryModal } from "./HistoryModal";
import { PaymentSheet } from "./PaymentSheet";
import { fetchClientVouchers } from "@/shared/utils/clientVouchers";
import { getExchangeRates } from "@/utils/exchangeRates";
import logger from "@/utils/logger";

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
  finTransactions: FinancialTransaction[];
  activeProvider: ProviderKey | null;
  getCategoriesForProvider: (provider: ProviderKey) => string[];
  getServiceItems: (provider: ProviderKey, category: string) => ServiceItem[];
  methods: { code: string; label: string }[];
  loadFinancialData: () => void;
  formatAmount: (val: number, currency: string) => string;
  alfaCreditSellRate: number;
  alfaCreditCostRate: number;
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  onRefreshItems?: () => Promise<void>;
  isAdmin?: boolean;
}

export function KatchForm({
  activeConfig,
  finTransactions,
  activeProvider,
  getCategoriesForProvider,
  getServiceItems,
  methods,
  loadFinancialData,
  formatAmount,
  alfaCreditSellRate,
  alfaCreditCostRate,
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
      setInitialPaymentMethod("CUSTOMER_ACCOUNT");
      setPaymentInputKey((k) => k + 1);
    }
  }, [clientId, clientName, clientPhone, initialPaymentMethod]);

  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const isSplitPayment = paymentLines.length > 1;
  const [transactionTime, setTransactionTime] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [discount, setDiscount] = useState(0);
  const [showPaymentSheet, setShowPaymentSheet] = useState(false);
  const [rates, setRates] = useState({ buyRate: 89000, sellRate: 89500 });

  // Fetch exchange rates on mount
  useEffect(() => {
    const loadRates = async () => {
      try {
        const list = await api.getRates();
        const { buyRate, sellRate } = getExchangeRates(list);
        setRates({ buyRate, sellRate });
      } catch (error) {
        console.error("Failed to load exchange rates:", error);
      }
    };
    loadRates();
  }, [api]);

  // Katsh/iPick transactions - customer always pays us (money IN)
  // Use Customer Pays rate (higher - benefits shop)
  const exchangeRate = rates.sellRate;

  if (!activeConfig || !activeProvider) return null;

  const categories = getCategoriesForProvider(activeProvider);

  // Filter items by search query
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

  const isTelecomVoucher = (item: ServiceItem) => {
    return (
      item.category === "alfa" ||
      item.category === "mtc" ||
      item.subcategory === "alfa" ||
      item.subcategory === "mtc"
    );
  };

  const calculateReturnedCredits = (denomination: number): number => {
    return Math.floor(denomination / 0.5) * 0.5;
  };

  const calculatePrice = (
    item: ServiceItem,
    onlyDays: boolean,
    returnedCredits: number,
  ): number => {
    const sellPrice = item.catalogSellPrice ?? 0;
    if (!onlyDays) {
      return sellPrice;
    }
    return sellPrice - returnedCredits * alfaCreditSellRate;
  };

  const calculateCost = (
    item: ServiceItem,
    onlyDays: boolean,
    returnedCredits: number,
  ): number => {
    const cost = item.catalogCost ?? 0;
    if (!onlyDays) {
      return cost;
    }
    return cost - returnedCredits * alfaCreditCostRate;
  };

  const updateCart = (
    item: ServiceItem,
    quantity: number,
    onlyDays?: boolean,
    returnedCreditsUsd?: number,
  ) => {
    setCart((prev) => {
      const newCart = new Map(prev);
      const existing = newCart.get(item.key);

      if (quantity <= 0) {
        newCart.delete(item.key);
        setExpandedKeys((prevKeys) => {
          const newKeys = new Set(prevKeys);
          newKeys.delete(item.key);
          return newKeys;
        });
      } else {
        const newOnlyDays = onlyDays ?? existing?.onlyDays ?? false;
        const newReturnedCredits =
          returnedCreditsUsd ?? existing?.returnedCreditsUsd ?? 0;

        newCart.set(item.key, {
          item,
          quantity,
          onlyDays: newOnlyDays,
          returnedCreditsUsd: newReturnedCredits,
        });
      }
      return newCart;
    });
  };

  const handleCardClick = (item: ServiceItem) => {
    const itemKey = item.key;
    // Only expand accordion for telecom vouchers (they have the "Only Days" option)
    if (isTelecomVoucher(item)) {
      setExpandedKeys((prev) => {
        const newSet = new Set(prev);
        newSet.add(itemKey);
        return newSet;
      });
    }
    if (!cart.has(itemKey)) {
      updateCart(item, 1);
    }
  };

  const toggleCategoryCollapse = (category: string) => {
    setCollapsedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

  const handleQuantityChange = (item: ServiceItem, delta: number) => {
    const existing = cart.get(item.key);
    const newQty = (existing?.quantity ?? 0) + delta;

    if (existing || delta > 0) {
      updateCart(
        item,
        newQty,
        existing?.onlyDays,
        existing?.returnedCreditsUsd,
      );
    }
  };

  const handleOnlyDaysChange = (item: ServiceItem, checked: boolean) => {
    const existing = cart.get(item.key);
    if (!existing) return;

    let returnedCredits = 0;
    if (checked) {
      const denomination = parseFloat(item.label);
      if (!isNaN(denomination)) {
        returnedCredits = calculateReturnedCredits(denomination);
      }
    }

    updateCart(item, existing.quantity, checked, returnedCredits);
  };

  const handleReturnedCreditsChange = (item: ServiceItem, value: number) => {
    const existing = cart.get(item.key);
    if (!existing) return;
    updateCart(item, existing.quantity, existing.onlyDays, value);
  };

  const totalPrice = Array.from(cart.values()).reduce((sum, line) => {
    const unitPrice = calculatePrice(
      line.item,
      line.onlyDays,
      line.returnedCreditsUsd,
    );
    return sum + unitPrice * line.quantity;
  }, 0);

  const totalCost = Array.from(cart.values()).reduce((sum, line) => {
    const unitCost = calculateCost(
      line.item,
      line.onlyDays,
      line.returnedCreditsUsd,
    );
    return sum + unitCost * line.quantity;
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
          ? paymentLines.map((l) => ({
              method: l.method,
              currencyCode: l.currencyCode,
              amount: l.amount,
              ...(l.method === "GIFT_CARD" && l.voucherCode
                ? { voucherCode: l.voucherCode }
                : {}),
            }))
          : undefined;

      // Store each line item for replay at checkout
      // Distribute discount proportionally across items based on sell price
      const sessionTotalSellPrice = cartItems.reduce((sum, line) => {
        return (
          sum +
          calculatePrice(line.item, line.onlyDays, line.returnedCreditsUsd) *
            line.quantity
        );
      }, 0);

      const formDataItems = cartItems.flatMap((line) => {
        const sellPrice = calculatePrice(
          line.item,
          line.onlyDays,
          line.returnedCreditsUsd,
        );
        const cost = calculateCost(
          line.item,
          line.onlyDays,
          line.returnedCreditsUsd,
        );
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
      return;
    }

    setLocalSubmitting(true);

    const cartItems = Array.from(cart.values());
    const finalPaymentMethod = isSplitPayment ? "MULTI" : paymentMethod;
    const paymentsPayload =
      paymentLines.length > 0
        ? paymentLines.map((l) => ({
            method: l.method,
            currencyCode: l.currencyCode,
            amount: l.amount,
            ...(l.method === "GIFT_CARD" && l.voucherCode
              ? { voucherCode: l.voucherCode }
              : {}),
          }))
        : undefined;

    // Aggregate all items into one transaction
    const totalSellPrice = cartItems.reduce((sum, line) => {
      return (
        sum +
        calculatePrice(line.item, line.onlyDays, line.returnedCreditsUsd) *
          line.quantity
      );
    }, 0);

    const aggregatedCost = cartItems.reduce((sum, line) => {
      return (
        sum +
        calculateCost(line.item, line.onlyDays, line.returnedCreditsUsd) *
          line.quantity
      );
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

  const filterProviderTransactions = (txs: FinancialTransaction[]) => {
    return txs.filter((tx) => tx.provider === activeProvider);
  };

  const providerTransactions = filterProviderTransactions(finTransactions);

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0">
      {/* Search Bar */}
      <div className="relative">
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

      {/* Card Grid */}
      <div className="flex-1 min-h-0 overflow-auto space-y-6 pb-2">
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
                        type="number"
                        value={newItemForm.cost_lbp}
                        onChange={(e) => setNewItemForm({ ...newItemForm, cost_lbp: e.target.value })}
                        placeholder="LBP"
                        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500"
                      />
                    </div>
                    <div className="w-28">
                      <label className="text-slate-400 text-xs block mb-1">Sell</label>
                      <input
                        type="number"
                        value={newItemForm.sell_lbp}
                        onChange={(e) => setNewItemForm({ ...newItemForm, sell_lbp: e.target.value })}
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
                    const qty = inCart?.quantity ?? 0;
                    const isExpanded = expandedKeys.has(item.key);
                    const isTelecom = isTelecomVoucher(item);
                    const cost = item.catalogCost ?? 0;
                    const sellPrice = item.catalogSellPrice ?? 0;

                    return (
                      <div key={item.key} className="relative">
                        <div
                          className={`w-full p-3 rounded-lg border transition-all ${
                            qty > 0
                              ? "border-orange-500/40 ring-1 ring-orange-500/30"
                              : "border-white/10 hover:border-white/20"
                          } ${isExpanded ? "ring-2 ring-orange-500/50" : ""}`}
                          style={{
                            backgroundColor: `${getCategoryColor(item.category)}18`,
                          }}
                        >
                          {/* Card Header - clickable area */}
                          <div
                            onClick={() => handleCardClick(item)}
                            className="cursor-pointer"
                          >
                            {/* Label row with optional stepper */}
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="text-white font-medium text-sm truncate">
                                {item.label}
                              </div>
                              {qty > 0 && (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleQuantityChange(item, -1);
                                    }}
                                    className="w-5 h-5 rounded-full bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 flex items-center justify-center transition-colors cursor-pointer text-xs font-bold"
                                    type="button"
                                  >
                                    −
                                  </button>
                                  <span className="w-4 text-center text-xs font-bold text-orange-400">
                                    {qty}
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleQuantityChange(item, 1);
                                    }}
                                    className="w-5 h-5 rounded-full bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 flex items-center justify-center transition-colors cursor-pointer text-xs font-bold"
                                    type="button"
                                  >
                                    +
                                  </button>
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col items-center justify-center gap-0.5">
                              {item.subcategory === "alfa" ||
                              item.category === "alfa" ? (
                                <AlfaLogo className="h-4 w-auto" />
                              ) : item.subcategory === "mtc" ||
                                item.category === "mtc" ? (
                                <MtcLogo className="h-4 w-auto" />
                              ) : null}
                              <span className="text-slate-500 text-[10px] truncate max-w-full">
                                {item.subcategory}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center justify-between">
                              <span className="text-xs text-slate-400">
                                Cost:
                              </span>
                              <span className="text-xs text-white font-mono">
                                {cost.toLocaleString()} LBP
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-slate-400">
                                Sell:
                              </span>
                              <span className="text-xs text-emerald-400 font-mono">
                                {sellPrice.toLocaleString()} LBP
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Accordion Detail */}
                        {isExpanded && (
                          <div className="mt-2 p-3 bg-slate-900 rounded-lg border border-slate-700">
                            {isTelecom && (
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <input
                                    type="checkbox"
                                    id={`onlydays-${item.key}`}
                                    checked={inCart?.onlyDays ?? false}
                                    onChange={(e) =>
                                      handleOnlyDaysChange(
                                        item,
                                        e.target.checked,
                                      )
                                    }
                                    className="w-4 h-4 rounded border-slate-600 text-orange-500 focus:ring-orange-500 cursor-pointer"
                                  />
                                  <label
                                    htmlFor={`onlydays-${item.key}`}
                                    className="text-xs text-slate-300 cursor-pointer select-none whitespace-nowrap"
                                  >
                                    Only Days
                                  </label>
                                </div>
                                {(inCart?.onlyDays ?? false) && (
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-xs text-slate-400 whitespace-nowrap">
                                      Credits
                                    </span>
                                    <input
                                      type="number"
                                      step="0.5"
                                      min="0"
                                      max={parseFloat(item.label) || 0}
                                      value={inCart?.returnedCreditsUsd ?? 0}
                                      onChange={(e) =>
                                        handleReturnedCreditsChange(
                                          item,
                                          parseFloat(e.target.value) || 0,
                                        )
                                      }
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
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sticky Bottom Trigger Bar */}
      <div className="shrink-0 bg-slate-800/95 backdrop-blur-sm rounded-xl border border-slate-700/50 p-3 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-400">
              Items: <span className="text-white font-bold">{totalItems}</span>
              <span className="text-slate-600 mx-1">·</span>
              <span className="text-emerald-400 font-mono font-semibold">
                {totalPrice.toLocaleString()} LBP
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowPaymentSheet(true)}
            disabled={totalItems === 0}
            className={`px-5 py-2.5 rounded-lg font-bold text-sm transition-all ${
              totalItems === 0
                ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                : "bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/20"
            }`}
          >
            {activeSession ? "Add to Cart" : "Proceed to Pay"}
          </button>
        </div>
      </div>

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
          transactions={providerTransactions}
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

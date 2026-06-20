import { useState, useEffect } from "react";
import { ChevronDown, Phone, Search, X, Plus } from "lucide-react";
import {
  useApi,
  ServiceTypeTabs,
  DecimalInput,
  type PaymentLine,
} from "@liratek/ui";
import { PaymentSheet } from "./PaymentSheet";
import { fetchClientVouchers } from "@/shared/utils/clientVouchers";
import { useSession } from "@/features/sessions/context/SessionContext";
import { ensureRechargeClient } from "../utils/ensureClient";
import type { ServiceItem, ProviderKey } from "../hooks/useMobileServiceItems";
import { getCategoryColor } from "../utils/categoryColors";
import type {
  FinancialTransaction,
  ServiceType,
  ProviderConfig,
  AnyProvider,
} from "../types";
import { HistoryModal } from "./HistoryModal";
import { getExchangeRates } from "@/utils/exchangeRates";
import logger from "@/utils/logger";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { ClientAutocompleteInput } from "@/shared/components/ClientAutocompleteInput";
import { PartnerSelector } from "@/features/partners/components/PartnerSelector";

interface CartLineItem {
  item: ServiceItem;
  quantity: number;
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

interface FinancialFormProps {
  activeConfig: ProviderConfig | undefined;
  finTransactions: FinancialTransaction[];
  activeProvider: AnyProvider | null;
  serviceType?: ServiceType;
  setServiceType?: (type: ServiceType) => void;
  getCategoriesForProvider: (provider: ProviderKey) => string[];
  getServiceItems: (provider: ProviderKey, category: string) => ServiceItem[];
  methods: { code: string; label: string }[];
  clientName: string;
  setClientName: (val: string) => void;
  loadFinancialData: () => void;
  formatAmount: (val: number, currency: string) => string;
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  onRefreshItems?: () => Promise<void>;
  isAdmin?: boolean;
}

export function FinancialForm({
  activeConfig,
  finTransactions,
  activeProvider,
  serviceType,
  setServiceType,
  getCategoriesForProvider,
  getServiceItems,
  methods,
  clientName,
  setClientName,
  loadFinancialData,
  formatAmount,
  showHistory,
  setShowHistory,
  onRefreshItems,
  isAdmin,
}: FinancialFormProps) {
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
  const [paymentLines, setPaymentLines] = useState<any[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const isSplitPayment = paymentLines.length > 1;
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const [showPaymentSheet, setShowPaymentSheet] = useState(false);
  const [rates, setRates] = useState({ buyRate: 89000, sellRate: 89500 });
  const [searchQuery, setSearchQuery] = useState("");
  const [discount, setDiscount] = useState(0);
  const [transactionTime, setTransactionTime] = useState<string | undefined>();
  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const [clientPhone, setClientPhone] = useState("");
  const [paymentInputKey, setPaymentInputKey] = useState(0);
  const [initialPaymentMethod, setInitialPaymentMethod] = useState("CASH");
  const [newItemForm, setNewItemForm] = useState<NewItemForm | null>(null);
  const [addItemError, setAddItemError] = useState("");

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

  // Fetch exchange rates on mount
  useEffect(() => {
    const loadRates = async () => {
      try {
        const list = await api.getRates();
        const { buyRate, sellRate } = getExchangeRates(list);
        setRates({ buyRate, sellRate });
      } catch (error) {
        logger.error("Failed to load exchange rates:", error);
      }
    };
    loadRates();
  }, [api]);

  // Determine exchange rate based on transaction type
  //   - SEND = customer sends money (money IN) → sellRate (customer pays us more LBP)
  //   - RECEIVE = customer receives money (money OUT) → buyRate (we pay customer less LBP)
  const isMoneyIn = serviceType === "SEND";
  const exchangeRate = isMoneyIn ? rates.sellRate : rates.buyRate;

  if (!activeConfig || !activeProvider) return null;
  const meta = activeConfig;

  const providerTx = finTransactions.filter(
    (tx) => tx.provider === activeProvider,
  );

  const categories = getCategoriesForProvider(activeProvider as ProviderKey);

  const handleCardClick = (item: ServiceItem) => {
    const itemKey = item.key;
    setExpandedKeys((prev) => {
      const newSet = new Set(prev);
      newSet.add(itemKey);
      return newSet;
    });
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

  const updateCart = (item: ServiceItem, quantity: number) => {
    setCart((prev) => {
      const newCart = new Map(prev);
      if (quantity <= 0) {
        newCart.delete(item.key);
        setExpandedKeys((prevKeys) => {
          const newKeys = new Set(prevKeys);
          newKeys.delete(item.key);
          return newKeys;
        });
      } else {
        newCart.set(item.key, { item, quantity });
      }
      return newCart;
    });
  };

  const handleQuantityChange = (item: ServiceItem, delta: number) => {
    const existing = cart.get(item.key);
    const newQty = (existing?.quantity ?? 0) + delta;
    if (existing || delta > 0) {
      updateCart(item, newQty);
    }
  };

  const totalPrice = Array.from(cart.values()).reduce((sum, line) => {
    const unitPrice = line.item.catalogSellPrice ?? 0;
    return sum + unitPrice * line.quantity;
  }, 0);

  const totalCost = Array.from(cart.values()).reduce((sum, line) => {
    const unitCost = line.item.catalogCost ?? 0;
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

    // If session is active, add all cart items as one session cart entry.
    // The basket owns the payment, so the cart sub-items carry NO payment fields
    // (paidByMethod / payments) and no per-item discount — the Session Checkout
    // modal collects payment once for the whole basket and applies any discount
    // there (capped at each item's profit).
    if (activeSession) {
      const cartItems = Array.from(cart.values());
      const itemLabels = cartItems
        .map((line) => `${line.item.label} x${line.quantity}`)
        .join(", ");
      const providerLabel =
        activeConfig?.label || activeProvider || "Financial";
      const label =
        itemLabels.length > 60
          ? `${providerLabel} (${cartItems.length} items) - ${totalPrice.toLocaleString()} LBP`
          : `${providerLabel}: ${itemLabels}`;

      // Store each line item for replay at checkout
      const formDataItems = cartItems.flatMap((line) => {
        const sellPrice = line.item.catalogSellPrice ?? 0;
        const cost = line.item.catalogCost ?? 0;
        const commission = sellPrice - cost;
        return Array.from({ length: line.quantity }, () => ({
          provider: activeProvider,
          serviceType: serviceType || "SEND",
          amount: sellPrice,
          cost,
          currency: "LBP",
          commission: Math.max(0, commission),
          clientId: resolvedClientId || undefined,
          clientName: clientName || undefined,
          itemKey: line.item.key,
          itemCategory: line.item.category,
          note: `${line.item.label} (${line.item.subcategory})`,
        }));
      });

      addToSessionCart({
        module: activeProvider === "WHISH_APP" ? "whish_app" : "omt_app",
        label,
        amount: totalPrice,
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
      setSearchQuery("");
      return;
    }

    setLocalSubmitting(true);

    const cartItems = Array.from(cart.values());
    const finalPaymentMethod = isSplitPayment ? "MULTI" : paymentMethod;
    const hasVoucherLeg = paymentLines.some(
      (l: PaymentLine) => l.method === "GIFT_CARD",
    );
    const paymentsPayload =
      isSplitPayment || hasVoucherLeg
        ? paymentLines.map((l: PaymentLine) => ({
            method: l.method,
            currencyCode: l.currencyCode,
            amount: l.amount,
            ...(l.method === "GIFT_CARD" && l.voucherCode
              ? { voucherCode: l.voucherCode }
              : {}),
          }))
        : undefined;

    let allSucceeded = true;

    // Distribute discount proportionally across items based on sell price
    const totalSellPrice = cartItems.reduce((sum, line) => {
      return sum + (line.item.catalogSellPrice ?? 0) * line.quantity;
    }, 0);

    for (const line of cartItems) {
      const sellPrice = line.item.catalogSellPrice ?? 0;
      const cost = line.item.catalogCost ?? 0;
      // Proportional discount per unit
      const unitDiscountShare =
        totalSellPrice > 0
          ? Math.round((discount * sellPrice) / totalSellPrice)
          : 0;
      const discountedSellPrice = sellPrice - unitDiscountShare;
      const commission = discountedSellPrice - cost;

      for (let i = 0; i < line.quantity; i++) {
        try {
          const result = await api.addOMTTransaction({
            provider: activeProvider,
            serviceType: serviceType || "SEND",
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
            note: `${line.item.label} (${line.item.subcategory})`,
            partnerId: partnerId || undefined,
            transaction_time: transactionTime,
          });

          if (result?.success) {
            // Link to active customer session
            if (activeSession && result.id) {
              try {
                await linkTransaction({
                  transactionType: "financial_service",
                  transactionId: result.id,
                  amountUsd: 0,
                  amountLbp: discountedSellPrice,
                  profitLbp: Math.max(0, commission),
                });
              } catch (err) {
                logger.error("Failed to link financial tx to session:", err);
              }
            }
          } else {
            logger.error("Financial submit failed:", result?.error);
            alert(result?.error || "Failed to process item");
            allSucceeded = false;
            break;
          }
        } catch (err) {
          logger.error("Financial submit error:", err);
          alert("Failed to process item");
          allSucceeded = false;
          break;
        }
      }
      if (!allSucceeded) break;
    }

    if (allSucceeded) {
      setCart(new Map());
      setClientName("");
      setClientPhone("");
      setClientId(null);
      setExpandedKeys(new Set());
      setSearchQuery("");
      setTransactionTime(undefined);
      const hasDebtPayment =
        paymentMethod === "CUSTOMER_ACCOUNT" ||
        paymentLines.some((l: any) => l.method === "CUSTOMER_ACCOUNT");
      if (hasDebtPayment) {
        window.dispatchEvent(new CustomEvent("debt-ledger-changed"));
      }
    }
    loadFinancialData();
    setLocalSubmitting(false);
  };

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

  return (
    <>
      <div className="flex flex-col gap-3">
        {/* Header with SEND/RECEIVE Tabs - hidden for Whish App and MTC */}
        {activeProvider !== "WHISH_APP" && activeProvider !== "MTC" && (
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <ServiceTypeTabs
                options={[
                  { id: "SEND", label: "Money In", iconKey: "Send" },
                  { id: "RECEIVE", label: "Money Out", iconKey: "Package" },
                ]}
                value={serviceType || "SEND"}
                onChange={(val) => setServiceType?.(val as ServiceType)}
                accentColor={
                  activeProvider === "iPick" || activeProvider === "Katsh"
                    ? "orange"
                    : "violet"
                }
                customColor={
                  activeProvider === "OMT_APP" ? "#ffde00" : undefined
                }
                customTextColor={
                  activeProvider === "OMT_APP" ? "black" : "white"
                }
                size="sm"
              />
            </div>
            <PartnerSelector
              selectedPartnerId={partnerId}
              onSelect={setPartnerId}
            />
          </div>
        )}

        {/* Sticky top row: Search + Proceed to Pay — never scrolls away */}
        <div className="sticky top-0 z-10 flex items-center gap-3 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pb-1">
          {(activeProvider === "iPick" ||
            activeProvider === "Katsh" ||
            activeProvider === "WHISH_APP") && (
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search ${activeProvider === "iPick" ? "iPick" : activeProvider === "Katsh" ? "Katsh" : "Whish App"} items...`}
                className="w-full px-4 py-2.5 pl-10 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 transition-all"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                  aria-label="Clear search"
                  type="button"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 ml-auto shrink-0">
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
                className="appearance-none bg-slate-900 border border-slate-600 rounded-lg pl-3 pr-7 py-2 text-white text-xs font-medium focus:outline-none focus:border-violet-500 transition-all cursor-pointer"
              >
                {methods.map((m) => (
                  <option key={m.code} value={m.code}>{m.label}</option>
                ))}
              </select>
              <ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
            <button
              type="button"
              onClick={() => {
                // Session mode: add to cart directly (basket owns the payment),
                // skipping the PaymentSheet. Non-session: open the PaymentSheet.
                if (activeSession) {
                  handleSubmit();
                } else {
                  setShowPaymentSheet(true);
                }
              }}
              disabled={totalItems === 0}
              className={`px-4 py-2.5 rounded-lg font-bold text-sm transition-all whitespace-nowrap ${
                totalItems === 0
                  ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                  : activeProvider === "WHISH_APP"
                    ? "bg-[#ff0a46] hover:bg-[#ff0a46]/80 text-white shadow-lg shadow-[#ff0a46]/20"
                    : activeProvider === "OMT_APP"
                      ? "bg-[#ffde00] hover:bg-[#ffde00]/80 text-black shadow-lg shadow-[#ffde00]/20"
                      : "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-500/20"
              }`}
            >
              {activeSession ? "Add to Cart" : "Proceed to Pay"}
            </button>
          </div>
        </div>

        {/* Card Grid - hidden for OMT_APP (no items) */}
        {activeProvider !== "OMT_APP" && (
          <div className="space-y-6 pb-2">
            {categories.map((category) => {
              const categoryItems = getServiceItems(
                activeProvider as ProviderKey,
                category,
              );
              const filteredItems = filterItemsBySearch(categoryItems);
              if (filteredItems.length === 0) return null;

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
                          <DecimalInput
                            value={parseFloat(newItemForm.cost_lbp) || 0}
                            onChange={(n) =>
                              setNewItemForm({
                                ...newItemForm,
                                cost_lbp: n ? String(n) : "",
                              })
                            }
                            placeholder="LBP"
                            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-orange-500"
                          />
                        </div>
                        <div className="w-28">
                          <label className="text-slate-400 text-xs block mb-1">Sell</label>
                          <DecimalInput
                            value={parseFloat(newItemForm.sell_lbp) || 0}
                            onChange={(n) =>
                              setNewItemForm({
                                ...newItemForm,
                                sell_lbp: n ? String(n) : "",
                              })
                            }
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
                      {filteredItems.map((item) => {
                        const inCart = cart.get(item.key);
                        const qty = inCart?.quantity ?? 0;
                        const isExpanded = expandedKeys.has(item.key);
                        const cost = item.catalogCost ?? 0;
                        const sellPrice = item.catalogSellPrice ?? 0;

                        return (
                          <div key={item.key} className="relative">
                            <div
                              className={`w-full p-3 rounded-lg border transition-all ${
                                qty > 0
                                  ? "border-violet-500/40 ring-1 ring-violet-500/30"
                                  : "border-white/10 hover:border-white/20"
                              } ${isExpanded ? "ring-2 ring-violet-500/50" : ""}`}
                              style={{
                                backgroundColor: `${getCategoryColor(item.category)}18`,
                              }}
                            >
                              <div
                                onClick={() => handleCardClick(item)}
                                className="cursor-pointer"
                              >
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
                                        className="w-5 h-5 rounded-full bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 flex items-center justify-center transition-colors cursor-pointer text-xs font-bold"
                                        type="button"
                                      >
                                        −
                                      </button>
                                      <span className="w-4 text-center text-xs font-bold text-violet-400">
                                        {qty}
                                      </span>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleQuantityChange(item, 1);
                                        }}
                                        className="w-5 h-5 rounded-full bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 flex items-center justify-center transition-colors cursor-pointer text-xs font-bold"
                                        type="button"
                                      >
                                        +
                                      </button>
                                    </div>
                                  )}
                                </div>
                                <div className="h-4 flex items-center justify-center">
                                  <span className="text-slate-500 text-xs truncate">
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
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Empty state for OMT_APP */}
        {activeProvider === "OMT_APP" && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-slate-500">
              <p className="text-sm">OMT App money transfer coming soon</p>
            </div>
          </div>
        )}

        <PaymentSheet
          open={showPaymentSheet}
          onClose={() => setShowPaymentSheet(false)}
          onConfirm={handleSubmit}
          isSubmitting={localSubmitting}
          title={activeSession ? "Add to Cart" : "Confirm Payment"}
          subtitle={`${totalItems} items — ${totalPrice.toLocaleString()} LBP`}
          accentColor={
            activeProvider === "WHISH_APP"
              ? "bg-[#ff0a46] hover:bg-[#ff0a46]/90 text-white"
              : activeProvider === "OMT_APP"
                ? "bg-[#ffde00] hover:bg-[#ffde00]/90 text-black"
                : "bg-violet-600 hover:bg-violet-500 text-white"
          }
          totalAmount={totalPrice}
          totalAmountCurrency="LBP"
          currency="LBP"
          paymentMethods={methods}
          clientId={clientId}
          fetchClientVouchers={fetchClientVouchers}
          exchangeRate={exchangeRate}
          requiresClientForDebt={true}
          hasClient={
            !!clientId ||
            !!activeSession?.customer_name ||
            (!!clientName.trim() && !!clientPhone.trim())
          }
          paymentInputKey={paymentInputKey}
          initialPaymentMethod={initialPaymentMethod}
          showDiscount={true}
          maxDiscount={maxDiscount}
          onDiscountChange={setDiscount}
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
              className="w-full mt-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500"
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
                className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-10 pr-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-violet-500"
              />
            </div>
            {clientName.trim() && clientPhone.trim() && !clientId && (
              <p className="text-xs text-violet-300/80 px-1">
                New client will be created on confirm.
              </p>
            )}
          </div>
          <TransactionTimeOverride
            value={transactionTime}
            onChange={setTransactionTime}
          />
        </PaymentSheet>
      </div>

      {/* History Modal */}
      {showHistory && (
        <HistoryModal
          transactions={providerTx}
          provider={meta.label}
          onClose={() => setShowHistory(false)}
          onRefresh={loadFinancialData}
          formatAmount={formatAmount}
          showFeeAndProfit
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
    </>
  );
}
